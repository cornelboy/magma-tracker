import { ethers } from 'ethers';

import { CONFIG } from '../config/contracts';
import { withRetry } from '../lib/retry';
import type { ProtocolPosition } from '../types/exposure';

export interface MagmaCoreExposureResult {
  walletGmon: bigint;
  pendingRedeemShares: bigint;
  claimableRedeemShares: bigint;
  claimableRedeemMon: bigint;
  protocolPositions: ProtocolPosition[];
}

export async function getMagmaCoreExposure(
  provider: ethers.JsonRpcProvider,
  wallet: string,
): Promise<MagmaCoreExposureResult> {
  const magma = new ethers.Contract(CONFIG.contracts.gmon, CONFIG.abis.magmaCore, provider);

  const walletGmon = await withRetry(() => magma.balanceOf(wallet) as Promise<bigint>);

  let requestId = 0n;
  try {
    requestId = await withRetry(() => magma.ownerRequestId(wallet) as Promise<bigint>);
  } catch (error) {
    console.warn('Magma ownerRequestId read failed. Falling back to zero redeem state.', error);
  }

  if (requestId === 0n) {
    return {
      walletGmon,
      pendingRedeemShares: 0n,
      claimableRedeemShares: 0n,
      claimableRedeemMon: 0n,
      protocolPositions: [],
    };
  }

  let pendingRedeemShares = 0n;
  try {
    pendingRedeemShares = await withRetry(
      () => magma.pendingRedeemRequest(requestId, wallet) as Promise<bigint>,
    );
  } catch (error) {
    console.warn('Magma pending redeem read failed. Treating pending shares as zero.', error);
  }

  let claimableRedeemShares = 0n;
  try {
    claimableRedeemShares = await withRetry(
      () => magma.claimableRedeemRequest(requestId, wallet) as Promise<bigint>,
    );
  } catch (error) {
    console.warn('Magma claimable redeem read failed. Treating claimable shares as zero.', error);
  }

  let claimableRedeemMon = 0n;
  if (claimableRedeemShares > 0n) {
    try {
      claimableRedeemMon = await withRetry(
        () => magma.convertToAssets(claimableRedeemShares) as Promise<bigint>,
      );
    } catch (error) {
      console.warn('Magma convertToAssets failed. Treating claimable MON as zero.', error);
    }
  }

  const protocolPositions: ProtocolPosition[] = [];
  if (pendingRedeemShares > 0n || claimableRedeemShares > 0n || claimableRedeemMon > 0n) {
    protocolPositions.push({
      protocol: 'Magma',
      category: 'redeem',
      suppliedGmon: 0n,
      borrowedGmon: 0n,
      underlyingGmon: pendingRedeemShares + claimableRedeemShares,
      claimableMon: claimableRedeemMon,
      metadata: {
        requestId: requestId.toString(),
        pendingShares: pendingRedeemShares.toString(),
        claimableShares: claimableRedeemShares.toString(),
      },
    });
  }

  return {
    walletGmon,
    pendingRedeemShares,
    claimableRedeemShares,
    claimableRedeemMon,
    protocolPositions,
  };
}
