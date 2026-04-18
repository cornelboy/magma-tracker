export type ProtocolCategory = 'lending' | 'lp' | 'vault' | 'collateral' | 'redeem';

export interface MagmaPerformance {
  status: 'available' | 'unavailable';
  reason: string | null;
  principalMon: bigint;
  redeemableMon: bigint;
  yieldMon: bigint;
  holdingSeconds: number | null;
  realizedReturn: number | null;
  realizedApy: number | null;
}

export interface ProtocolPosition {
  protocol: string;
  category: ProtocolCategory;
  suppliedGmon: bigint;
  borrowedGmon: bigint;
  underlyingGmon: bigint;
  claimableMon: bigint;
  metadata?: Record<string, string>;
}

export interface WalletExposureWarning {
  protocol: string;
  message: string;
}

export interface WalletExposure {
  wallet: string;
  walletGmon: bigint;
  pendingRedeemShares: bigint;
  claimableRedeemShares: bigint;
  claimableRedeemMon: bigint;
  magmaPerformance: MagmaPerformance;
  protocolPositions: ProtocolPosition[];
  grossGmonExposure: bigint;
  borrowedGmon: bigint;
  netGmonExposure: bigint;
  warnings: WalletExposureWarning[];
}

export function createEmptyWalletExposure(wallet: string): WalletExposure {
  return {
    wallet,
    walletGmon: 0n,
    pendingRedeemShares: 0n,
    claimableRedeemShares: 0n,
    claimableRedeemMon: 0n,
    magmaPerformance: {
      status: 'unavailable',
      reason: 'No claimable Magma redeem request detected yet.',
      principalMon: 0n,
      redeemableMon: 0n,
      yieldMon: 0n,
      holdingSeconds: null,
      realizedReturn: null,
      realizedApy: null,
    },
    protocolPositions: [],
    grossGmonExposure: 0n,
    borrowedGmon: 0n,
    netGmonExposure: 0n,
    warnings: [],
  };
}
