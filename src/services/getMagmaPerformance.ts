import { ethers } from 'ethers';

import { CONFIG } from '../config/contracts';
import type { MagmaCoreExposureResult } from '../adapters/magmaCore';
import type { MagmaPerformance } from '../types/exposure';

const ZERO_ADDRESS = ethers.ZeroAddress.toLowerCase();
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
const MIN_RATE = -0.999999;
const MAX_RATE = 1_000_000;

interface PositionLot {
  remainingShares: bigint;
  remainingPrincipalMon: bigint;
  timestamp: number;
  source: 'direct' | 'unknown';
  reason?: string;
}

interface ConsumedLot {
  principalMon: bigint;
  shares: bigint;
  timestamp: number;
  source: 'direct' | 'unknown';
  reason?: string;
}

interface CashFlow {
  amount: number;
  timestamp: number;
}

function unavailable(reason: string): MagmaPerformance {
  return {
    status: 'unavailable',
    reason,
    principalMon: 0n,
    redeemableMon: 0n,
    yieldMon: 0n,
    holdingSeconds: null,
    realizedReturn: null,
    realizedApy: null,
  };
}

function toLower(value: string) {
  return value.toLowerCase();
}

function getTransferValue(log: ethers.EventLog) {
  const value = log.args?.[2];
  return typeof value === 'bigint' ? value : null;
}

function compareLogs(a: ethers.EventLog, b: ethers.EventLog) {
  if (a.blockNumber !== b.blockNumber) {
    return a.blockNumber - b.blockNumber;
  }

  return a.index - b.index;
}

function isDirectStake(
  tx: ethers.TransactionResponse | null,
  wallet: string,
  contract: string,
) {
  return Boolean(
    tx &&
    tx.to &&
    toLower(tx.from) === wallet &&
    toLower(tx.to) === contract &&
    tx.value > 0n,
  );
}

function createLotFromMint(
  log: ethers.EventLog,
  tx: ethers.TransactionResponse | null,
  timestamp: number,
  wallet: string,
  contract: string,
): PositionLot {
  const shares = getTransferValue(log);
  if (shares === null) {
    return {
      remainingShares: 0n,
      remainingPrincipalMon: 0n,
      timestamp,
      source: 'unknown',
      reason: 'Mint shares could not be decoded from the transfer log.',
    };
  }

  if (isDirectStake(tx, wallet, contract)) {
    return {
      remainingShares: shares,
      remainingPrincipalMon: tx!.value,
      timestamp,
      source: 'direct',
    };
  }

  return {
    remainingShares: shares,
    remainingPrincipalMon: 0n,
    timestamp,
    source: 'unknown',
    reason: 'Shares did not come from a direct MON stake by this wallet.',
  };
}

function consumeLots(
  lots: PositionLot[],
  sharesToConsume: bigint,
): { consumed: ConsumedLot[]; remaining: bigint; invalidReason: string | null } {
  let remaining = sharesToConsume;
  const consumed: ConsumedLot[] = [];

  for (const lot of lots) {
    if (remaining === 0n) {
      break;
    }
    if (lot.remainingShares === 0n) {
      continue;
    }

    const consumedShares = lot.remainingShares < remaining ? lot.remainingShares : remaining;
    const consumedPrincipal = lot.source === 'direct'
      ? (consumedShares === lot.remainingShares
        ? lot.remainingPrincipalMon
        : (lot.remainingPrincipalMon * consumedShares) / lot.remainingShares)
      : 0n;

    lot.remainingShares -= consumedShares;
    if (lot.source === 'direct') {
      lot.remainingPrincipalMon -= consumedPrincipal;
    }
    remaining -= consumedShares;

    consumed.push({
      principalMon: consumedPrincipal,
      shares: consumedShares,
      timestamp: lot.timestamp,
      source: lot.source,
      reason: lot.reason,
    });
  }

  if (remaining > 0n) {
    return {
      consumed,
      remaining,
      invalidReason: 'Historical gMON balance could not cover the current redeem burn.',
    };
  }

  return { consumed, remaining: 0n, invalidReason: null };
}

function toMonNumber(value: bigint) {
  return Number(ethers.formatUnits(value, 18));
}

function computeWeightedHoldingSeconds(principalLots: ConsumedLot[], redeemTimestamp: number, principalMon: bigint) {
  if (principalMon <= 0n) {
    return null;
  }

  const weightedSeconds = principalLots.reduce((sum, lot) => {
    const heldSeconds = Math.max(0, redeemTimestamp - lot.timestamp);
    return sum + (lot.principalMon * BigInt(heldSeconds));
  }, 0n);

  return Number(weightedSeconds / principalMon);
}

function xnpv(rate: number, cashFlows: CashFlow[]) {
  const start = cashFlows[0].timestamp;

  return cashFlows.reduce((sum, flow) => {
    const years = (flow.timestamp - start) / SECONDS_PER_YEAR;
    return sum + (flow.amount / Math.pow(1 + rate, years));
  }, 0);
}

function solveXirr(cashFlows: CashFlow[]) {
  if (cashFlows.length < 2) {
    return null;
  }

  const hasNegative = cashFlows.some((flow) => flow.amount < 0);
  const hasPositive = cashFlows.some((flow) => flow.amount > 0);
  if (!hasNegative || !hasPositive) {
    return null;
  }

  let low = MIN_RATE;
  let high = 1;
  let lowValue = xnpv(low, cashFlows);
  let highValue = xnpv(high, cashFlows);

  while (highValue > 0 && high < MAX_RATE) {
    high *= 2;
    highValue = xnpv(high, cashFlows);
  }

  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) {
    return null;
  }

  for (let index = 0; index < 120; index += 1) {
    const mid = (low + high) / 2;
    const midValue = xnpv(mid, cashFlows);

    if (!Number.isFinite(midValue)) {
      return null;
    }

    if (Math.abs(midValue) < 1e-10) {
      return mid;
    }

    if (midValue > 0) {
      low = mid;
      lowValue = midValue;
    } else {
      high = mid;
      highValue = midValue;
    }

    if (Math.abs(high - low) < 1e-10 || Math.abs(highValue - lowValue) < 1e-10) {
      return (low + high) / 2;
    }
  }

  return (low + high) / 2;
}

export async function getMagmaPerformance(
  provider: ethers.JsonRpcProvider,
  wallet: string,
  magmaExposure: MagmaCoreExposureResult,
): Promise<MagmaPerformance> {
  if (magmaExposure.claimableRedeemShares === 0n && magmaExposure.pendingRedeemShares > 0n) {
    return unavailable(
      'Redeem is still in the queue. Realized APY appears after shares become claimable.',
    );
  }

  if (magmaExposure.claimableRedeemShares === 0n || magmaExposure.claimableRedeemMon === 0n) {
    return unavailable('No fully claimable Magma redeem request is available yet.');
  }

  if (magmaExposure.pendingRedeemShares > 0n) {
    return unavailable(
      'Realized APY is not shown yet for this redeem request.',
    );
  }

  const gmon = new ethers.Contract(CONFIG.contracts.gmon, CONFIG.abis.erc20, provider);
  const normalizedWallet = toLower(wallet);
  const normalizedContract = toLower(CONFIG.contracts.gmon);
  const redeemShares = magmaExposure.claimableRedeemShares;

  let transferLogs: ethers.EventLog[];
  try {
    const latestBlock = await provider.getBlockNumber();
    const [incomingResult, outgoingResult] = await Promise.all([
      gmon.queryFilter(gmon.filters.Transfer(null, wallet), 0, latestBlock),
      gmon.queryFilter(gmon.filters.Transfer(wallet, null), 0, latestBlock),
    ]);

    transferLogs = [...incomingResult, ...outgoingResult]
      .filter((log): log is ethers.EventLog => 'args' in log)
      .sort(compareLogs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return unavailable(`Could not load gMON transfer history: ${message}`);
  }

  const burnLog = [...transferLogs].reverse().find((log) => {
    const from = log.args?.[0];
    const to = log.args?.[1];
    const value = getTransferValue(log);

    return (
      typeof from === 'string' &&
      typeof to === 'string' &&
      toLower(from) === normalizedWallet &&
      toLower(to) === ZERO_ADDRESS &&
      value === redeemShares
    );
  });

  if (!burnLog) {
    return unavailable('Could not match the current redeem request to a gMON burn event.');
  }

  const historicalLogs = transferLogs.filter((log) => compareLogs(log, burnLog) <= 0);
  const txCache = new Map<string, Promise<ethers.TransactionResponse | null>>();
  const blockCache = new Map<number, Promise<ethers.Block | null>>();

  const getTx = (hash: string) => {
    if (!txCache.has(hash)) {
      txCache.set(hash, provider.getTransaction(hash));
    }
    return txCache.get(hash)!;
  };

  const getBlock = (blockNumber: number) => {
    if (!blockCache.has(blockNumber)) {
      blockCache.set(blockNumber, provider.getBlock(blockNumber));
    }
    return blockCache.get(blockNumber)!;
  };

  const burnTxPromise = getTx(burnLog.transactionHash);
  const burnBlockPromise = getBlock(burnLog.blockNumber);

  const lots: PositionLot[] = [];
  let currentBurnLots: ConsumedLot[] | null = null;

  for (const log of historicalLogs) {
    const from = log.args?.[0];
    const to = log.args?.[1];
    const shares = getTransferValue(log);

    if (typeof from !== 'string' || typeof to !== 'string' || shares === null || shares === 0n) {
      continue;
    }

    const normalizedFrom = toLower(from);
    const normalizedTo = toLower(to);

    if (normalizedTo === normalizedWallet) {
      const block = await getBlock(log.blockNumber);
      if (!block) {
        return unavailable('Required block history for this Magma position is incomplete on the RPC.');
      }

      if (normalizedFrom === ZERO_ADDRESS) {
        const tx = await getTx(log.transactionHash);
        lots.push(createLotFromMint(log, tx, block.timestamp, normalizedWallet, normalizedContract));
      } else {
        lots.push({
          remainingShares: shares,
          remainingPrincipalMon: 0n,
          timestamp: block.timestamp,
          source: 'unknown',
          reason: 'The wallet received gMON by transfer, so its original MON cost basis is unknown.',
        });
      }

      continue;
    }

    if (normalizedFrom === normalizedWallet) {
      const { consumed, invalidReason } = consumeLots(lots, shares);
      if (invalidReason) {
        return unavailable(invalidReason);
      }

      if (compareLogs(log, burnLog) === 0) {
        currentBurnLots = consumed;
      }
    }
  }

  if (!currentBurnLots || currentBurnLots.length === 0) {
    return unavailable('Could not reconstruct the stake lots consumed by the current redeem request.');
  }

  const unknownLots = currentBurnLots.filter((lot) => lot.source !== 'direct');
  if (unknownLots.length > 0) {
    return unavailable(
      unknownLots[0].reason
        ?? 'The current redeem includes gMON that did not come from direct Magma staking by this wallet.',
    );
  }

  const burnTx = await burnTxPromise;
  const burnBlock = await burnBlockPromise;
  if (!burnTx || !burnBlock) {
    return unavailable('Required redeem transaction history is incomplete on the RPC.');
  }

  if (!burnTx.to || toLower(burnTx.to) !== normalizedContract) {
    return unavailable('The matched redeem request did not go directly through the Magma contract.');
  }

  const principalMon = currentBurnLots.reduce((sum, lot) => sum + lot.principalMon, 0n);
  if (principalMon <= 0n) {
    return unavailable('The current redeem could not be mapped back to direct MON principal.');
  }

  const redeemableMon = magmaExposure.claimableRedeemMon;
  const yieldMon = redeemableMon - principalMon;
  const realizedReturn = (toMonNumber(redeemableMon) / toMonNumber(principalMon)) - 1;

  const holdingSeconds = computeWeightedHoldingSeconds(currentBurnLots, burnBlock.timestamp, principalMon);
  if (holdingSeconds === null || holdingSeconds <= 0) {
    return unavailable('Stake and redeem timestamps could not be ordered reliably for this position.');
  }

  const cashFlows: CashFlow[] = currentBurnLots.map((lot) => ({
    amount: -toMonNumber(lot.principalMon),
    timestamp: lot.timestamp,
  }));
  cashFlows.push({
    amount: toMonNumber(redeemableMon),
    timestamp: burnBlock.timestamp,
  });
  cashFlows.sort((a, b) => a.timestamp - b.timestamp);

  const realizedApy = solveXirr(cashFlows);
  if (realizedApy === null || !Number.isFinite(realizedApy)) {
    return unavailable('Could not solve a stable annualized rate for this multi-stake Magma position.');
  }

  return {
    status: 'available',
    reason: null,
    principalMon,
    redeemableMon,
    yieldMon,
    holdingSeconds,
    realizedReturn,
    realizedApy,
  };
}
