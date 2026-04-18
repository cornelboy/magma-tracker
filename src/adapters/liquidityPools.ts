import { ethers } from 'ethers';

import { CONFIG } from '../config/contracts';
import { formatBalance } from '../lib/format';
import { withRetry } from '../lib/retry';
import { getAmountsForLiquidity, isTickInRange } from '../lib/v3Math';
import type { ProtocolPosition } from '../types/exposure';

interface V2MarketConfig {
  protocol: string;
  version: string;
  pairAddress: string;
  quoteToken: keyof typeof CONFIG.tokens;
  market: string;
}

interface V3MarketConfig {
  protocol: string;
  version: string;
  factoryAddress: string;
  positionManagerAddress: string;
  quoteTokens: Array<keyof typeof CONFIG.tokens>;
}

const GMON_ADDRESS = CONFIG.tokens.gmon.address.toLowerCase();

const V2_MARKETS: V2MarketConfig[] = [
  {
    protocol: 'PancakeSwap',
    version: 'V2 LP',
    pairAddress: CONFIG.contracts.liquidity.pancakeswap.v2Pairs.gmonWmon,
    quoteToken: 'wmon',
    market: 'gMON / MON',
  },
];

const V3_MARKETS: V3MarketConfig[] = [
  {
    protocol: 'PancakeSwap',
    version: 'V3 LP',
    factoryAddress: CONFIG.contracts.liquidity.pancakeswap.v3Factory,
    positionManagerAddress: CONFIG.contracts.liquidity.pancakeswap.positionManager,
    quoteTokens: ['wmon', 'usdc'],
  },
  {
    protocol: 'Uniswap',
    version: 'V3 LP',
    factoryAddress: CONFIG.contracts.liquidity.uniswap.v3Factory,
    positionManagerAddress: CONFIG.contracts.liquidity.uniswap.positionManager,
    quoteTokens: ['wmon'],
  },
];

function tokenConfigByAddress(address: string) {
  const normalized = address.toLowerCase();
  return Object.values(CONFIG.tokens).find((token) => token.address.toLowerCase() === normalized) ?? null;
}

function buildLpPosition(params: {
  protocol: string;
  version: string;
  market: string;
  gmonUnderlying: bigint;
  pairedAmount: bigint;
  pairedToken: keyof typeof CONFIG.tokens;
  positionLabel: string;
  feeLabel?: string;
  rangeLabel?: string;
}): ProtocolPosition {
  const pairedToken = CONFIG.tokens[params.pairedToken];
  const metadata: Record<string, string> = {
    market: params.market,
    version: params.version,
    pairedAmount: params.pairedAmount.toString(),
    pairedDecimals: pairedToken.decimals.toString(),
    pairedSymbol: pairedToken.displaySymbol,
    positionLabel: params.positionLabel,
  };

  if (params.feeLabel) {
    metadata.feeLabel = params.feeLabel;
  }
  if (params.rangeLabel) {
    metadata.rangeLabel = params.rangeLabel;
  }

  return {
    protocol: params.protocol,
    category: 'lp' as const,
    suppliedGmon: 0n,
    borrowedGmon: 0n,
    underlyingGmon: params.gmonUnderlying,
    claimableMon: 0n,
    metadata,
  };
}

function formatFeeTier(fee: bigint) {
  const percent = Number(fee) / 10000;
  return `${percent.toLocaleString('en-US', {
    minimumFractionDigits: percent < 0.1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}%`;
}

async function safeRead<T>(label: string, read: () => Promise<T>, fallback: T) {
  try {
    return await withRetry(read);
  } catch (error) {
    console.warn(`${label} failed. Falling back to safe default.`, error);
    return fallback;
  }
}

async function getV2LpPositions(
  provider: ethers.JsonRpcProvider,
  wallet: string,
): Promise<ProtocolPosition[]> {
  const positions = await Promise.all(V2_MARKETS.map(async (market): Promise<ProtocolPosition | null> => {
    const pair = new ethers.Contract(market.pairAddress, CONFIG.abis.v2Pair, provider);
    const [lpBalance, totalSupply, reserves, token0, token1] = await Promise.all([
      safeRead(`${market.protocol} ${market.market} LP balance`, () => pair.balanceOf(wallet) as Promise<bigint>, 0n),
      safeRead(`${market.protocol} ${market.market} totalSupply`, () => pair.totalSupply() as Promise<bigint>, 0n),
      safeRead(
        `${market.protocol} ${market.market} reserves`,
        () => pair.getReserves() as Promise<[bigint, bigint, number]>,
        [0n, 0n, 0] as [bigint, bigint, number],
      ),
      safeRead(`${market.protocol} ${market.market} token0`, () => pair.token0() as Promise<string>, ''),
      safeRead(`${market.protocol} ${market.market} token1`, () => pair.token1() as Promise<string>, ''),
    ]);

    if (lpBalance === 0n || totalSupply === 0n) {
      return null;
    }

    const [reserve0, reserve1] = reserves;
    const token0Address = token0.toLowerCase();
    const token1Address = token1.toLowerCase();

    if (token0Address !== GMON_ADDRESS && token1Address !== GMON_ADDRESS) {
      return null;
    }

    const isGmonToken0 = token0Address === GMON_ADDRESS;
    const gmonReserve = isGmonToken0 ? reserve0 : reserve1;
    const pairedReserve = isGmonToken0 ? reserve1 : reserve0;

    const gmonUnderlying = (gmonReserve * lpBalance) / totalSupply;
    const pairedAmount = (pairedReserve * lpBalance) / totalSupply;

    if (gmonUnderlying === 0n && pairedAmount === 0n) {
      return null;
    }

    return buildLpPosition({
      protocol: market.protocol,
      version: market.version,
      market: market.market,
      gmonUnderlying,
      pairedAmount,
      pairedToken: market.quoteToken,
      positionLabel: 'Pool Share',
    });
  }));

  return positions.filter((position): position is ProtocolPosition => position !== null);
}

async function getOwnedTokenIds(positionManager: ethers.Contract, wallet: string) {
  const balance = await safeRead(
    'V3 position manager balanceOf',
    () => positionManager.balanceOf(wallet) as Promise<bigint>,
    0n,
  );
  if (balance === 0n) {
    return [];
  }

  const tokenIds = await Promise.allSettled(
    Array.from({ length: Number(balance) }, (_, index) => (
      positionManager.tokenOfOwnerByIndex(wallet, index) as Promise<bigint>
    )),
  );

  return tokenIds.flatMap((result, index) => {
    if (result.status === 'fulfilled') {
      return [result.value];
    }

    console.warn(`V3 position manager tokenOfOwnerByIndex(${index}) failed. Skipping token.`, result.reason);
    return [];
  });
}

async function getV3LpPositionsForMarket(
  provider: ethers.JsonRpcProvider,
  wallet: string,
  market: V3MarketConfig,
): Promise<ProtocolPosition[]> {
  const positionManager = new ethers.Contract(
    market.positionManagerAddress,
    CONFIG.abis.v3PositionManager,
    provider,
  );
  const factory = new ethers.Contract(market.factoryAddress, CONFIG.abis.v3Factory, provider);
  const tokenIds = await getOwnedTokenIds(positionManager, wallet);

  const positions = await Promise.all(tokenIds.map(async (tokenId): Promise<ProtocolPosition | null> => {
    const position = await safeRead(
      `${market.protocol} V3 position ${tokenId.toString()}`,
      () => positionManager.positions(tokenId) as Promise<{
        token0: string;
        token1: string;
        fee: bigint;
        tickLower: bigint;
        tickUpper: bigint;
        liquidity: bigint;
      }>,
      null,
    );

    if (!position) {
      return null;
    }

    if (position.liquidity === 0n) {
      return null;
    }

    const token0Address = position.token0.toLowerCase();
    const token1Address = position.token1.toLowerCase();

    if (token0Address !== GMON_ADDRESS && token1Address !== GMON_ADDRESS) {
      return null;
    }

    const pairedTokenConfig = [token0Address, token1Address]
      .map((address) => tokenConfigByAddress(address))
      .find((token) => token && token.address.toLowerCase() !== GMON_ADDRESS);

    if (!pairedTokenConfig) {
      return null;
    }

    const pairedTokenKey = Object.entries(CONFIG.tokens).find(([, token]) => (
      token.address.toLowerCase() === pairedTokenConfig.address.toLowerCase()
    ))?.[0] as keyof typeof CONFIG.tokens | undefined;

    if (!pairedTokenKey || !market.quoteTokens.includes(pairedTokenKey)) {
      return null;
    }

    const poolAddress = await safeRead(
      `${market.protocol} V3 pool lookup`,
      () => factory.getPool(position.token0, position.token1, position.fee) as Promise<string>,
      ethers.ZeroAddress,
    );
    if (poolAddress === ethers.ZeroAddress) {
      return null;
    }

    const pool = new ethers.Contract(poolAddress, CONFIG.abis.v3Pool, provider);
    const slot0 = await safeRead(
      `${market.protocol} V3 slot0 ${poolAddress}`,
      () => pool.slot0() as Promise<{ sqrtPriceX96: bigint; tick: bigint }>,
      null,
    );
    if (!slot0) {
      return null;
    }

    const { amount0, amount1 } = getAmountsForLiquidity(
      slot0.sqrtPriceX96,
      Number(position.tickLower),
      Number(position.tickUpper),
      position.liquidity,
    );

    const isGmonToken0 = token0Address === GMON_ADDRESS;
    const gmonUnderlying = isGmonToken0 ? amount0 : amount1;
    const pairedAmount = isGmonToken0 ? amount1 : amount0;

    if (gmonUnderlying === 0n && pairedAmount === 0n) {
      return null;
    }

    return buildLpPosition({
      protocol: market.protocol,
      version: market.version,
      market: `gMON / ${pairedTokenConfig.displaySymbol}`,
      gmonUnderlying,
      pairedAmount,
      pairedToken: pairedTokenKey,
      positionLabel: `NFT #${tokenId.toString()}`,
      feeLabel: formatFeeTier(position.fee),
      rangeLabel: isTickInRange(Number(slot0.tick), Number(position.tickLower), Number(position.tickUpper))
        ? 'In Range'
        : 'Out of Range',
    });
  }));

  return positions.filter((position): position is ProtocolPosition => position !== null);
}

async function getV3LpPositions(
  provider: ethers.JsonRpcProvider,
  wallet: string,
): Promise<ProtocolPosition[]> {
  const allPositions = await Promise.all(V3_MARKETS.map(async (market) => {
    try {
      return await getV3LpPositionsForMarket(provider, wallet, market);
    } catch (error) {
      console.warn(`${market.protocol} LP scan failed. Skipping this market.`, error);
      return [];
    }
  }));

  return allPositions.flat();
}

export async function getLiquidityPoolPositions(
  provider: ethers.JsonRpcProvider,
  wallet: string,
): Promise<ProtocolPosition[]> {
  const [v2Positions, v3Positions] = await Promise.all([
    safeRead('V2 LP scan', () => getV2LpPositions(provider, wallet), [] as ProtocolPosition[]),
    safeRead('V3 LP scan', () => getV3LpPositions(provider, wallet), [] as ProtocolPosition[]),
  ]);

  return [...v2Positions, ...v3Positions].map((position) => {
    const pairedAmount = position.metadata?.pairedAmount ? BigInt(position.metadata.pairedAmount) : 0n;
    const pairedDecimals = position.metadata?.pairedDecimals ? Number(position.metadata.pairedDecimals) : 18;
    const pairedSymbol = position.metadata?.pairedSymbol ?? '';

    if (!position.metadata) {
      return position;
    }

    return {
      ...position,
      metadata: {
        ...position.metadata,
        pairedAmountDisplay: pairedAmount > 0n
          ? `${formatBalance(pairedAmount, pairedDecimals)} ${pairedSymbol}`
          : `0 ${pairedSymbol}`.trim(),
      },
    };
  });
}
