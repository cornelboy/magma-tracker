import { ethers } from 'ethers';

import { getCurvancePosition } from '../adapters/curvance';
import { getLiquidityPoolPositions } from '../adapters/liquidityPools';
import { getMagmaCoreExposure } from '../adapters/magmaCore';
import { getNeverlandPosition } from '../adapters/neverland';
import { withRetry } from '../lib/retry';
import { getMagmaPerformance } from './getMagmaPerformance';
import { createEmptyWalletExposure, type ProtocolPosition, type WalletExposure } from '../types/exposure';

function protocolContribution(position: ProtocolPosition) {
  if (position.category === 'redeem') {
    return 0n;
  }

  return position.suppliedGmon + position.underlyingGmon;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function loadAdapter<T>(reader: () => Promise<T>) {
  return withRetry(reader, { attempts: 2, delayMs: 300 });
}

export async function getWalletExposure(
  provider: ethers.JsonRpcProvider,
  wallet: string,
): Promise<WalletExposure> {
  const exposure = createEmptyWalletExposure(wallet);

  const [magmaResult, neverlandResult, curvanceResult, liquidityResult] = await Promise.allSettled([
    loadAdapter(() => getMagmaCoreExposure(provider, wallet)),
    loadAdapter(() => getNeverlandPosition(provider, wallet)),
    loadAdapter(() => getCurvancePosition(provider, wallet)),
    loadAdapter(() => getLiquidityPoolPositions(provider, wallet)),
  ]);

  if (magmaResult.status === 'fulfilled') {
    exposure.walletGmon = magmaResult.value.walletGmon;
    exposure.pendingRedeemShares = magmaResult.value.pendingRedeemShares;
    exposure.claimableRedeemShares = magmaResult.value.claimableRedeemShares;
    exposure.claimableRedeemMon = magmaResult.value.claimableRedeemMon;
    try {
      exposure.magmaPerformance = await getMagmaPerformance(provider, wallet, magmaResult.value);
    } catch (error) {
      exposure.magmaPerformance = {
        status: 'unavailable',
        reason: errorMessage(error),
        principalMon: 0n,
        redeemableMon: 0n,
        yieldMon: 0n,
        holdingSeconds: null,
        realizedReturn: null,
        realizedApy: null,
      };
    }
    exposure.protocolPositions.push(...magmaResult.value.protocolPositions);
  } else {
    exposure.warnings.push({
      protocol: 'Magma',
      message: errorMessage(magmaResult.reason),
    });
  }

  if (neverlandResult.status === 'fulfilled') {
    if (neverlandResult.value) {
      exposure.protocolPositions.push(neverlandResult.value);
    }
  } else {
    exposure.warnings.push({
      protocol: 'Neverland',
      message: errorMessage(neverlandResult.reason),
    });
  }

  if (curvanceResult.status === 'fulfilled') {
    if (curvanceResult.value) {
      exposure.protocolPositions.push(curvanceResult.value);
    }
  } else {
    exposure.warnings.push({
      protocol: 'Curvance',
      message: errorMessage(curvanceResult.reason),
    });
  }

  if (liquidityResult.status === 'fulfilled') {
    exposure.protocolPositions.push(...liquidityResult.value);
  } else {
    exposure.warnings.push({
      protocol: 'Liquidity',
      message: errorMessage(liquidityResult.reason),
    });
  }

  const protocolGmon = exposure.protocolPositions.reduce((sum, position) => {
    return sum + protocolContribution(position);
  }, 0n);

  exposure.borrowedGmon = exposure.protocolPositions.reduce((sum, position) => {
    return sum + position.borrowedGmon;
  }, 0n);

  exposure.grossGmonExposure = (
    exposure.walletGmon +
    exposure.pendingRedeemShares +
    exposure.claimableRedeemShares +
    protocolGmon
  );
  exposure.netGmonExposure = exposure.grossGmonExposure - exposure.borrowedGmon;

  return exposure;
}
