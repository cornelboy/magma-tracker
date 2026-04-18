import { ethers } from 'ethers';

import { CONFIG } from '../config/contracts';
import { withRetry } from '../lib/retry';
import type { ProtocolPosition } from '../types/exposure';

async function readBalance(contract: ethers.Contract, wallet: string, label: string) {
  try {
    return await withRetry(() => contract.balanceOf(wallet) as Promise<bigint>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Neverland ${label} read failed: ${message}`);
  }
}

export async function getNeverlandPosition(
  provider: ethers.JsonRpcProvider,
  wallet: string,
): Promise<ProtocolPosition | null> {
  const { aToken, stableDebt, variableDebt } = CONFIG.contracts.neverland;

  const aTokenContract = new ethers.Contract(aToken, CONFIG.abis.erc20, provider);
  const stableDebtContract = new ethers.Contract(stableDebt, CONFIG.abis.erc20, provider);
  const variableDebtContract = new ethers.Contract(variableDebt, CONFIG.abis.erc20, provider);

  const [suppliedGmon, stableDebtGmon, variableDebtGmon] = await Promise.all([
    readBalance(aTokenContract, wallet, 'aToken'),
    readBalance(stableDebtContract, wallet, 'stable debt'),
    readBalance(variableDebtContract, wallet, 'variable debt'),
  ]);

  const borrowedGmon = stableDebtGmon + variableDebtGmon;
  if (suppliedGmon === 0n && borrowedGmon === 0n) {
    return null;
  }

  const metadata: Record<string, string> = {};
  if (stableDebtGmon > 0n) {
    metadata.stableDebt = stableDebtGmon.toString();
  }
  if (variableDebtGmon > 0n) {
    metadata.variableDebt = variableDebtGmon.toString();
  }

  return {
    protocol: 'Neverland',
    category: 'lending',
    suppliedGmon,
    borrowedGmon,
    underlyingGmon: 0n,
    claimableMon: 0n,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}
