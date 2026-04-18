import { ethers } from 'ethers';

import { CONFIG } from '../config/contracts';
import { withRetry } from '../lib/retry';
import type { ProtocolPosition } from '../types/exposure';

export async function getCurvancePosition(
  provider: ethers.JsonRpcProvider,
  wallet: string,
): Promise<ProtocolPosition | null> {
  const cgmon = new ethers.Contract(
    CONFIG.contracts.curvance.cgmon,
    CONFIG.abis.curvanceCtoken,
    provider,
  );

  const shareBalance = await withRetry(() => cgmon.balanceOf(wallet) as Promise<bigint>);
  const [suppliedGmon, borrowedGmon] = await Promise.all([
    shareBalance > 0n
      ? withRetry(() => cgmon.convertToAssets(shareBalance) as Promise<bigint>)
      : Promise.resolve(0n),
    withRetry(() => cgmon.debtBalance(wallet) as Promise<bigint>),
  ]);

  if (suppliedGmon === 0n && borrowedGmon === 0n) {
    return null;
  }

  return {
    protocol: 'Curvance',
    category: 'lending',
    suppliedGmon,
    borrowedGmon,
    underlyingGmon: 0n,
    claimableMon: 0n,
    metadata: {
      market: 'gMON / WMON',
      collateralToken: 'cgMON',
      shares: shareBalance.toString(),
    },
  };
}
