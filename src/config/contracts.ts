export const CONFIG = {
  rpcUrl: 'https://rpc.monad.xyz',
  rpcFallbacks: [
    'https://monad-rpc.publicnode.com',
    'https://monad.drpc.org',
  ],
  tokens: {
    gmon: {
      address: '0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081',
      symbol: 'gMON',
      decimals: 18,
      displaySymbol: 'gMON',
    },
    wmon: {
      address: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
      symbol: 'WMON',
      decimals: 18,
      displaySymbol: 'MON',
    },
    usdc: {
      address: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
      symbol: 'USDC',
      decimals: 6,
      displaySymbol: 'USDC',
    },
  },
  contracts: {
    gmon: '0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081',
    curvance: {
      cgmon: '0x5ca6966543c0786f547446234492D2F11C82f11f',
    },
    liquidity: {
      pancakeswap: {
        v2Pairs: {
          gmonWmon: '0x5E45328675683823c522d82877438cE9190d2264',
        },
        v3Factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
        positionManager: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364',
      },
      uniswap: {
        v3Factory: '0x204faca1764b154221e35c0d20abb3c525710498',
        positionManager: '0x7197e214c0b767cfb76fb734ab638e2c192f4e53',
      },
    },
    neverland: {
      aToken: '0x7f81779736968836582d31d36274ed82053ad1ae',
      stableDebt: '0xd8842741b71e01aee846abec07cf26c52302d010',
      variableDebt: '0x905999cc7b7e26c1cb2761f6c00909b65c862b78',
    },
    scale: '0x427D16455784e2587088fe333024B870126A0c72',
    roarrr: '0xcbdFaD1bfb6A4414DD4D84B7A6420dc43683deB0',
  },
  abis: {
    erc20: [
      'function balanceOf(address owner) view returns (uint256)',
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)',
      'event Transfer(address indexed from, address indexed to, uint256 value)',
    ],
    erc721: [
      'function balanceOf(address owner) view returns (uint256)',
      'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
      'function tokenURI(uint256 tokenId) view returns (string)',
      'function name() view returns (string)',
      'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    ],
    magmaCore: [
      'function balanceOf(address owner) view returns (uint256)',
      'function ownerRequestId(address owner) view returns (uint256)',
      'function pendingRedeemRequest(uint256 requestId, address owner) view returns (uint256)',
      'function claimableRedeemRequest(uint256 requestId, address owner) view returns (uint256)',
      'function convertToAssets(uint256 shares) view returns (uint256)',
    ],
    curvanceCtoken: [
      'function balanceOf(address owner) view returns (uint256)',
      'function convertToAssets(uint256 amount) view returns (uint256)',
      'function debtBalance(address account) view returns (uint256)',
      'function asset() view returns (address)',
      'function symbol() view returns (string)',
    ],
    v2Pair: [
      'function balanceOf(address owner) view returns (uint256)',
      'function totalSupply() view returns (uint256)',
      'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
      'function token0() view returns (address)',
      'function token1() view returns (address)',
    ],
    v3Factory: [
      'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)',
    ],
    v3PositionManager: [
      'function balanceOf(address owner) view returns (uint256)',
      'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
      'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
    ],
    v3Pool: [
      'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    ],
  },
  explorerUrl: 'https://monadscan.com',
  recentWalletStorageKey: 'magma_recent_wallets',
  watchlistStorageKey: 'magma_watchlist',
  maxRecentWallets: 4,
} as const;
