// @ts-nocheck

import { ethers } from 'ethers';

import { CONFIG } from './config/contracts';
import { formatBalance, formatDurationCompact, formatPercent, isValidAddress, timeAgo } from './lib/format';
import { initProvider } from './lib/provider';
import { withRetry } from './lib/retry';
import { getWalletExposure } from './services/getWalletExposure';
import {
  isWatchlisted,
  loadRecentWallets,
  loadWatchlist,
  saveRecentWallet,
  toggleWatchlistEntry,
} from './lib/storage';
import { createEmptyWalletExposure, type MagmaPerformance, type ProtocolPosition, type WalletExposure } from './types/exposure';

declare const Chart: any;

let provider: ethers.JsonRpcProvider | null = null;
let isLoading = false;
let syncInterval: ReturnType<typeof setInterval> | null = null;
let globalActivityInterval: ReturnType<typeof setInterval> | null = null;
let cachedMonPrice: number | null = null;
let lastPriceFetch = 0;
let monChartInstance: any = null;
let lastExposure: WalletExposure | null = null;
let lastMonData: { balance: bigint; formatted: string; num: number } | null = null;
let lookupRequestId = 0;

function getElement<T extends HTMLElement>(id: string) {
  const element = document.getElementById(id) as T | null;
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }
  return element;
}

function getQueryElement<T extends Element>(selector: string) {
  const element = document.querySelector(selector) as T | null;
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const elements = {
  walletInput: getElement<HTMLInputElement>('wallet-input'),
  lookupBtn: getElement<HTMLButtonElement>('lookup-btn'),
  clearBtn: getElement<HTMLButtonElement>('clear-btn'),
  btnText: getQueryElement<HTMLElement>('.btn-text'),
  btnLoader: getQueryElement<HTMLElement>('.btn-loader'),
  errorMsg: getElement<HTMLElement>('error-msg'),
  recentSearches: getElement<HTMLElement>('recent-searches'),
  dashboard: getElement<HTMLElement>('dashboard'),
  walletDisplay: getElement<HTMLElement>('wallet-display'),
  copyBtn: getElement<HTMLButtonElement>('copy-btn'),
  starBtn: getElement<HTMLButtonElement>('star-btn'),
  syncCheckbox: getElement<HTMLInputElement>('sync-checkbox'),
  syncStatus: getElement<HTMLElement>('sync-status'),
  watchlist: getElement<HTMLElement>('watchlist'),
  gmonBalance: getElement<HTMLElement>('gmon-balance'),
  gmonUsd: getElement<HTMLElement>('gmon-usd'),
  monBalance: getElement<HTMLElement>('mon-balance'),
  monUsd: getElement<HTMLElement>('mon-usd'),
  totalNfts: getElement<HTMLElement>('total-nfts'),
  protocolCount: getElement<HTMLElement>('protocol-count'),
  protocolWarning: getElement<HTMLElement>('protocol-warning'),
  protocolList: getElement<HTMLElement>('protocol-list'),
  protocolEmpty: getElement<HTMLElement>('protocol-empty'),
  globalActivityList: getElement<HTMLElement>('global-activity-list'),
  scaleGrid: getElement<HTMLElement>('scale-grid'),
  scaleCount: getElement<HTMLElement>('scale-count'),
  scaleEmpty: getElement<HTMLElement>('scale-empty'),
  roarrrGrid: getElement<HTMLElement>('roarrr-grid'),
  roarrrCount: getElement<HTMLElement>('roarrr-count'),
  roarrrEmpty: getElement<HTMLElement>('roarrr-empty'),
  exportBtn: getElement<HTMLButtonElement>('export-btn'),
  liveMonPrice: getElement<HTMLElement>('live-mon-price'),
  monChartCanvas: getElement<HTMLCanvasElement>('mon-chart'),
};

function renderRecentWallets() {
  const wallets = loadRecentWallets();

  if (wallets.length === 0) {
    elements.recentSearches.style.display = 'none';
    return;
  }

  elements.recentSearches.style.display = 'flex';
  let html = '<span class="recent-label">Recent:</span>';

  wallets.forEach((wallet) => {
    const short = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
    html += `<button class="recent-pill" data-address="${wallet}" title="${wallet}">${short}</button>`;
  });

  elements.recentSearches.innerHTML = html;
  elements.recentSearches.querySelectorAll<HTMLButtonElement>('.recent-pill').forEach((button) => {
    button.addEventListener('click', () => {
      const address = button.getAttribute('data-address');
      if (!address) return;

      elements.walletInput.value = address;
      elements.clearBtn.style.display = 'block';
      void lookupWallet(address);
    });
  });
}

function renderWatchlist() {
  const wallets = loadWatchlist();

  if (wallets.length === 0) {
    elements.watchlist.style.display = 'none';
    return;
  }

  elements.watchlist.style.display = 'flex';
  let html = '<span class="recent-label" style="color: var(--magma-orange);">Watchlist:</span>';

  wallets.forEach((wallet) => {
    const short = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
    html += `<button class="recent-pill watch-pill" style="border-color: rgba(242, 118, 18, 0.4); color: var(--magma-orange);" data-address="${wallet}" title="${wallet}">⭐ ${short}</button>`;
  });

  elements.watchlist.innerHTML = html;
  elements.watchlist.querySelectorAll<HTMLButtonElement>('.watch-pill').forEach((button) => {
    button.addEventListener('click', () => {
      const address = button.getAttribute('data-address');
      if (!address) return;

      elements.walletInput.value = address;
      elements.clearBtn.style.display = 'block';
      void lookupWallet(address);
    });
  });
}

function updateStarIcon(address: string) {
  if (isWatchlisted(address)) {
    elements.starBtn.classList.add('watched');
  } else {
    elements.starBtn.classList.remove('watched');
  }
}

function toDecimalNumber(value: bigint, decimals = 18) {
  return Number.parseFloat(ethers.formatUnits(value, decimals));
}

function formatUsdApprox(value: bigint, price: number) {
  if (price <= 0) {
    return '';
  }

  const amount = toDecimalNumber(value);
  if (amount <= 0) {
    return '';
  }

  return `~$${(amount * price).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatMagmaPerformanceValue(value: bigint, available: boolean) {
  return available ? formatBalance(value) : 'Unavailable';
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function exposureScore(exposure: WalletExposure) {
  return (exposure.protocolPositions.length * 10) - (exposure.warnings.length * 100);
}

function maxBigInt(first: bigint, second: bigint) {
  return first > second ? first : second;
}

function protocolPositionKey(position: ProtocolPosition) {
  const metadata = position.metadata ?? {};
  return [
    position.protocol,
    position.category,
    metadata.requestId ?? '',
    metadata.positionLabel ?? '',
    metadata.market ?? '',
    metadata.collateralToken ?? '',
    metadata.shares ?? '',
    metadata.pairedAmount ?? '',
  ].join('|');
}

function protocolPositionScore(position: ProtocolPosition) {
  return Number(position.suppliedGmon > 0n)
    + Number(position.borrowedGmon > 0n)
    + Number(position.underlyingGmon > 0n)
    + Number(position.claimableMon > 0n)
    + Object.keys(position.metadata ?? {}).length;
}

function mergeProtocolPositions(...positionSets: ProtocolPosition[][]) {
  const merged = new Map<string, ProtocolPosition>();

  positionSets.flat().forEach((position) => {
    const key = protocolPositionKey(position);
    const existing = merged.get(key);
    if (!existing || protocolPositionScore(position) >= protocolPositionScore(existing)) {
      merged.set(key, position);
    }
  });

  return Array.from(merged.values());
}

function pickMagmaPerformance(first: MagmaPerformance, second: MagmaPerformance) {
  if (first.status === 'available' && second.status !== 'available') {
    return first;
  }
  if (second.status === 'available' && first.status !== 'available') {
    return second;
  }
  if (first.status === 'available' && second.status === 'available') {
    return second.principalMon >= first.principalMon ? second : first;
  }

  const firstSignal = Number(first.principalMon > 0n) + Number(first.redeemableMon > 0n) + Number(first.holdingSeconds !== null);
  const secondSignal = Number(second.principalMon > 0n) + Number(second.redeemableMon > 0n) + Number(second.holdingSeconds !== null);
  if (secondSignal > firstSignal) {
    return second;
  }
  if (firstSignal > secondSignal) {
    return first;
  }

  return (second.reason?.length ?? 0) >= (first.reason?.length ?? 0) ? second : first;
}

function mergeWarnings(first: WalletExposure['warnings'], second: WalletExposure['warnings']) {
  const firstMap = new Map(first.map((warning) => [warning.protocol, warning]));
  const secondMap = new Map(second.map((warning) => [warning.protocol, warning]));

  return Array.from(firstMap.keys()).flatMap((protocol) => {
    if (!secondMap.has(protocol)) {
      return [];
    }

    return [secondMap.get(protocol) ?? firstMap.get(protocol)!];
  });
}

function mergeWalletExposures(first: WalletExposure, second: WalletExposure) {
  const merged = createEmptyWalletExposure(first.wallet);

  merged.walletGmon = maxBigInt(first.walletGmon, second.walletGmon);
  merged.pendingRedeemShares = maxBigInt(first.pendingRedeemShares, second.pendingRedeemShares);
  merged.claimableRedeemShares = maxBigInt(first.claimableRedeemShares, second.claimableRedeemShares);
  merged.claimableRedeemMon = maxBigInt(first.claimableRedeemMon, second.claimableRedeemMon);
  merged.magmaPerformance = pickMagmaPerformance(first.magmaPerformance, second.magmaPerformance);
  merged.protocolPositions = mergeProtocolPositions(first.protocolPositions, second.protocolPositions);
  merged.warnings = mergeWarnings(first.warnings, second.warnings);

  const protocolGmon = merged.protocolPositions.reduce((sum, position) => {
    return position.category === 'redeem'
      ? sum
      : sum + position.suppliedGmon + position.underlyingGmon;
  }, 0n);

  merged.borrowedGmon = merged.protocolPositions.reduce((sum, position) => {
    return sum + position.borrowedGmon;
  }, 0n);

  merged.grossGmonExposure = (
    merged.walletGmon +
    merged.pendingRedeemShares +
    merged.claimableRedeemShares +
    protocolGmon
  );
  merged.netGmonExposure = merged.grossGmonExposure - merged.borrowedGmon;

  return merged;
}

async function fetchStableExposure(
  activeProvider: ethers.JsonRpcProvider,
  address: string,
) {
  const firstExposure = await getWalletExposure(activeProvider, address);
  await wait(350);
  const secondExposure = await getWalletExposure(activeProvider, address);
  const mergedExposure = mergeWalletExposures(firstExposure, secondExposure);

  if (exposureScore(mergedExposure) >= exposureScore(firstExposure)
    && exposureScore(mergedExposure) >= exposureScore(secondExposure)) {
    return mergedExposure;
  }

  return exposureScore(secondExposure) > exposureScore(firstExposure) ? secondExposure : firstExposure;
}

function formatProtocolNotes(position: ProtocolPosition, exposure: WalletExposure) {
  const pendingShares = position.metadata?.pendingShares;
  const claimableShares = position.metadata?.claimableShares;
  const market = position.metadata?.market;
  const stableDebt = position.metadata?.stableDebt;
  const variableDebt = position.metadata?.variableDebt;
  const version = position.metadata?.version;
  const feeLabel = position.metadata?.feeLabel;
  const rangeLabel = position.metadata?.rangeLabel;

  if (position.protocol === 'Magma' && position.category === 'redeem') {
    const notes: string[] = [];
    const pendingSharesValue = pendingShares && pendingShares !== '0' ? BigInt(pendingShares) : 0n;
    const claimableSharesValue = claimableShares && claimableShares !== '0' ? BigInt(claimableShares) : 0n;

    if (claimableSharesValue > 0n) {
      const formattedShares = formatBalance(claimableSharesValue);
      if (position.claimableMon > 0n) {
        notes.push(`${formattedShares} gMON is claimable for ${formatBalance(position.claimableMon)} MON.`);
      } else {
        notes.push(`${formattedShares} gMON is claimable.`);
      }
    }

    if (exposure.magmaPerformance.status !== 'available' && exposure.magmaPerformance.reason) {
      notes.push(exposure.magmaPerformance.reason);
    }

    return notes.join(' ');
  }

  if (position.category === 'lp') {
    const notes: string[] = [];
    if (version) {
      notes.push(version);
    }
    if (feeLabel) {
      notes.push(`Fee ${feeLabel}`);
    }
    if (rangeLabel) {
      notes.push(rangeLabel);
    }
    if (market) {
      notes.push(`Market ${market}`);
    }

    return notes.join(' | ');
  }

  const notes: string[] = [];
  if (pendingShares && pendingShares !== '0') {
    notes.push(`Pending ${formatBalance(BigInt(pendingShares))} shares`);
  }
  if (stableDebt && stableDebt !== '0') {
    notes.push(`Stable debt ${formatBalance(BigInt(stableDebt))}`);
  }
  if (variableDebt && variableDebt !== '0') {
    notes.push(`Variable debt ${formatBalance(BigInt(variableDebt))}`);
  }
  if (market) {
    notes.push(`Market ${market}`);
  }

  return notes.join(' | ');
}

function getProtocolStatus(position: ProtocolPosition) {
  const pendingShares = position.metadata?.pendingShares ? BigInt(position.metadata.pendingShares) : 0n;
  const claimableShares = position.metadata?.claimableShares ? BigInt(position.metadata.claimableShares) : 0n;

  if (position.claimableMon > 0n || claimableShares > 0n) {
    return 'Claimable';
  }
  if (pendingShares > 0n) {
    return 'Pending';
  }

  return 'Active';
}

function getProtocolMetricItems(position: ProtocolPosition, exposure: WalletExposure) {
  if (position.protocol === 'Magma' && position.category === 'redeem') {
    const pendingShares = position.metadata?.pendingShares ? BigInt(position.metadata.pendingShares) : 0n;
    const requestId = position.metadata?.requestId ? `#${position.metadata.requestId}` : '-';
    const performanceAvailable = exposure.magmaPerformance.status === 'available';

    return [
      { label: 'Pending Redemption (gMON)', value: formatBalance(pendingShares) },
      { label: 'Claimable MON', value: formatBalance(position.claimableMon) },
      { label: 'Redeem Request', value: requestId },
      { label: 'Status', value: getProtocolStatus(position) },
      {
        label: 'Magma APY',
        value: formatPercent(exposure.magmaPerformance.realizedApy),
        tooltip: 'Calculated only for direct Magma stake lots with known MON cost basis. Transfers and swaps are excluded.',
      },
      { label: 'Stake Duration', value: formatDurationCompact(exposure.magmaPerformance.holdingSeconds) },
      {
        label: 'Original MON Staked',
        value: formatMagmaPerformanceValue(exposure.magmaPerformance.principalMon, performanceAvailable),
      },
      {
        label: 'Yield Earned (MON)',
        value: formatMagmaPerformanceValue(exposure.magmaPerformance.yieldMon, performanceAvailable),
      },
    ];
  }

  if (position.protocol === 'Neverland' && position.category === 'lending') {
    const stableDebt = position.metadata?.stableDebt ? BigInt(position.metadata.stableDebt) : 0n;
    const variableDebt = position.metadata?.variableDebt ? BigInt(position.metadata.variableDebt) : 0n;

    return [
      { label: 'Supplied', value: formatBalance(position.suppliedGmon) },
      { label: 'Borrowed', value: formatBalance(position.borrowedGmon) },
      { label: 'Stable Debt', value: formatBalance(stableDebt) },
      { label: 'Variable Debt', value: formatBalance(variableDebt) },
    ];
  }

  if (position.protocol === 'Curvance' && position.category === 'lending') {
    const market = position.metadata?.market ?? 'gMON / WMON';
    const positionType = position.borrowedGmon > 0n
      ? (position.suppliedGmon > 0n ? 'Supply + Borrow' : 'Borrow')
      : 'Supply';

    return [
      { label: 'Supplied', value: formatBalance(position.suppliedGmon) },
      { label: 'Borrowed', value: formatBalance(position.borrowedGmon) },
      { label: 'Market', value: market },
      { label: 'Position', value: positionType },
    ];
  }

  if (position.category === 'lp') {
    return [
      { label: 'gMON Underlying', value: formatBalance(position.underlyingGmon) },
      { label: 'Paired Asset', value: position.metadata?.pairedAmountDisplay ?? '0' },
      { label: 'Market', value: position.metadata?.market ?? '-' },
      { label: 'Position', value: position.metadata?.positionLabel ?? 'LP' },
    ];
  }

  return [
    { label: 'Supplied', value: formatBalance(position.suppliedGmon) },
    { label: 'Borrowed', value: formatBalance(position.borrowedGmon) },
    { label: 'Underlying', value: formatBalance(position.underlyingGmon) },
    { label: 'Claimable MON', value: formatBalance(position.claimableMon) },
  ];
}

function renderProtocolWarnings(exposure: WalletExposure) {
  if (exposure.warnings.length === 0) {
    elements.protocolWarning.style.display = 'none';
    elements.protocolWarning.textContent = '';
    return;
  }

  const protocols = exposure.warnings.map((warning) => warning.protocol).join(', ');
  elements.protocolWarning.style.display = 'block';
  elements.protocolWarning.textContent = `Partial protocol data only. Unavailable: ${protocols}.`;
}

function renderProtocolPositions(exposure: WalletExposure) {
  elements.protocolCount.textContent = exposure.protocolPositions.length.toString();
  renderProtocolWarnings(exposure);

  if (exposure.protocolPositions.length === 0) {
    elements.protocolList.innerHTML = '';
    elements.protocolEmpty.style.display = 'block';
    return;
  }

  elements.protocolEmpty.style.display = 'none';
  elements.protocolList.innerHTML = exposure.protocolPositions.map((position) => {
    const metrics = getProtocolMetricItems(position, exposure);
    const notes = formatProtocolNotes(position, exposure);

    return `
      <article class="protocol-card">
        <div class="protocol-card-header">
          <div class="protocol-name">${position.protocol}</div>
          <div class="protocol-category">${position.category}</div>
        </div>
        <div class="protocol-metrics">
          ${metrics.map((metric) => `
            <div class="protocol-metric">
              <span class="protocol-metric-label">
                ${metric.label}
                ${metric.tooltip ? `<span class="metric-help" data-tooltip="${metric.tooltip}">?</span>` : ''}
              </span>
              <div class="protocol-metric-value">${metric.value}</div>
            </div>
          `).join('')}
        </div>
        ${notes ? `<div class="protocol-notes">${notes}</div>` : ''}
      </article>
    `;
  }).join('');
}

async function fetchGmonBalance(address: string) {
  const contract = new ethers.Contract(CONFIG.contracts.gmon, CONFIG.abis.erc20, provider);

  try {
    const [balance, decimals] = await Promise.all([
      contract.balanceOf(address),
      contract.decimals(),
    ]);
    const num = Number.parseFloat(ethers.formatUnits(balance, decimals));

    return { balance, decimals, formatted: formatBalance(balance, decimals), num };
  } catch (error) {
    console.error('Error fetching gMON balance:', error);
    return { balance: 0n, decimals: 18, formatted: '0', num: 0 };
  }
}

async function fetchMonBalance(address: string) {
  try {
    const balance = await provider.getBalance(address);
    const num = Number.parseFloat(ethers.formatUnits(balance, 18));

    return { balance, formatted: formatBalance(balance, 18), num };
  } catch (error) {
    console.error('Error fetching MON balance:', error);
    return { balance: 0n, formatted: '0', num: 0 };
  }
}

async function fetchMonPrice() {
  const now = Date.now();
  if (cachedMonPrice && now - lastPriceFetch < 60000) {
    return cachedMonPrice;
  }

  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd');
    if (response.ok) {
      const data = await response.json();
      const usdPrice = data?.monad?.usd;

      if (usdPrice) {
        cachedMonPrice = usdPrice;
        lastPriceFetch = now;
        return cachedMonPrice;
      }
    }
  } catch (error) {
    console.warn('Could not fetch live MON price:', error);
  }

  return 0;
}

async function fetchMonHistoricalPrice() {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/coins/monad/market_chart?vs_currency=usd&days=7');
    if (response.ok) {
      const data = await response.json();
      if (data?.prices) return data.prices;
    }
  } catch (error) {
    console.warn('Could not fetch historical MON price:', error);
  }

  return [];
}

function renderMonChart(pricesData: Array<[number, number]>) {
  const ctx = elements.monChartCanvas.getContext('2d');
  if (!ctx || !pricesData || pricesData.length === 0) {
    return;
  }

  const labels = pricesData.map(([timestamp]) =>
    new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  );
  const dataPoints = pricesData.map(([, value]) => value);

  if (monChartInstance) {
    monChartInstance.destroy();
  }

  if (typeof Chart === 'undefined') {
    return;
  }

  monChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'MON Price (USD)',
        data: dataPoints,
        borderColor: '#F27612',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointBackgroundColor: '#F27612',
        fill: true,
        backgroundColor: 'rgba(242, 118, 18, 0.05)',
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label(context: { parsed: { y: number } }) {
              return `$${context.parsed.y.toFixed(3)}`;
            },
          },
        },
      },
      scales: {
        x: { display: false },
        y: { display: false, min: Math.min(...dataPoints) * 0.99 },
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false,
      },
    },
  });
}

async function loadMarketData() {
  const monPrice = await fetchMonPrice();

  if (monPrice > 0) {
    const formatted = monPrice.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });
    elements.liveMonPrice.textContent = `1 MON = 1 gMON = $${formatted}`;
  }

  if (!monChartInstance) {
    const historical = await fetchMonHistoricalPrice();
    renderMonChart(historical);
  }
}

async function fetchNFTs(contractAddress: string, ownerAddress: string) {
  const contract = new ethers.Contract(contractAddress, CONFIG.abis.erc721, provider);
  const nfts = [];

  try {
    const balanceBn = await withRetry(() => contract.balanceOf(ownerAddress));
    const balance = Number(balanceBn);

    if (balance === 0) {
      return nfts;
    }

    let tokenIds: Array<string | bigint> = [];

    try {
      const walletOfOwnerAbi = ['function walletOfOwner(address) view returns (uint256[])'];
      const walletOfOwnerContract = new ethers.Contract(contractAddress, walletOfOwnerAbi, provider);
      const ids = await withRetry(() => walletOfOwnerContract.walletOfOwner(ownerAddress));
      tokenIds = ids.map((id: bigint) => id.toString());
    } catch {
      try {
        const tokensOfOwnerAbi = ['function tokensOfOwner(address) view returns (uint256[])'];
        const tokensOfOwnerContract = new ethers.Contract(contractAddress, tokensOfOwnerAbi, provider);
        const ids = await withRetry(() => tokensOfOwnerContract.tokensOfOwner(ownerAddress));
        tokenIds = ids.map((id: bigint) => id.toString());
      } catch {
        try {
          const tokenIdPromises = [];
          for (let index = 0; index < balance; index += 1) {
            tokenIdPromises.push(withRetry(() => contract.tokenOfOwnerByIndex(ownerAddress, index)));
          }
          const settledTokenIds = await Promise.allSettled(tokenIdPromises);
          tokenIds = settledTokenIds.flatMap((result) => {
            return result.status === 'fulfilled' ? [result.value] : [];
          });
        } catch {
          console.warn(`Enumeration not supported for ${contractAddress}, attempting via Transfer logs...`);

          const eventAbi = [
            'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
            'function ownerOf(uint256 tokenId) view returns (address)',
          ];
          const eventContract = new ethers.Contract(contractAddress, eventAbi, provider);

          try {
            const filter = eventContract.filters.Transfer(null, ownerAddress);
            const candidateIds = new Set<string>();
            const currentBlock = await withRetry(() => provider.getBlockNumber());
            const maxBlocks = 100000;
            const chunkSize = 5000;

            for (let toBlock = currentBlock; toBlock >= Math.max(0, currentBlock - maxBlocks); toBlock -= chunkSize) {
              const fromBlock = Math.max(0, toBlock - chunkSize + 1);
              const logs = await withRetry(() => eventContract.queryFilter(filter, fromBlock, toBlock));

              logs.forEach((log: any) => {
                candidateIds.add(log.args[2].toString());
              });

              if (candidateIds.size >= balance) {
                break;
              }
            }

            const ownershipChecks = Array.from(candidateIds).map(async (id) => {
              try {
                const currentOwner = await withRetry(() => eventContract.ownerOf(id));
                if (currentOwner.toLowerCase() === ownerAddress.toLowerCase()) {
                  return id;
                }
              } catch {
                return null;
              }
              return null;
            });

            const verifiedIds = await Promise.all(ownershipChecks);
            tokenIds = verifiedIds.filter(Boolean).slice(0, balance);
          } catch (error) {
            console.error('Failed all fallback fetching methods:', error);
          }
        }
      }
    }

    if (balance > 0 && tokenIds.length === 0) {
      throw new Error(`NFT enumeration returned no token IDs for ${contractAddress} despite a positive balance.`);
    }

    const metadataPromises = tokenIds.map(async (tokenId) => {
      try {
        const tokenUri = await withRetry(() => contract.tokenURI(tokenId));
        let resolvedUri = tokenUri;

        if (resolvedUri.startsWith('ipfs://')) {
          resolvedUri = resolvedUri.replace('ipfs://', 'https://ipfs.io/ipfs/');
        }

        let metadata = null;
        try {
          const response = await fetch(resolvedUri);
          if (response.ok) {
            metadata = await response.json();
          }
        } catch (error) {
          console.warn(`Failed to fetch metadata for token ${tokenId}:`, error);
        }

        let imageUrl = '';
        if (metadata?.image) {
          imageUrl = metadata.image;
          if (imageUrl.startsWith('ipfs://')) {
            imageUrl = imageUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
          }
        }

        return {
          tokenId: tokenId.toString(),
          name: metadata?.name || `#${tokenId.toString()}`,
          image: imageUrl,
          attributes: metadata?.attributes || [],
        };
      } catch (error) {
        console.warn(`Failed to get metadata for token ${tokenId}:`, error);
        return {
          tokenId: tokenId.toString(),
          name: `#${tokenId.toString()}`,
          image: '',
          attributes: [],
        };
      }
    });

    const results = await Promise.all(metadataPromises);
    nfts.push(...results);
  } catch (error) {
    console.error(`Error fetching NFTs from ${contractAddress}:`, error);
  }

  return nfts;
}

async function fetchStableNFTs(contractAddress: string, ownerAddress: string) {
  const firstPass = await fetchNFTs(contractAddress, ownerAddress);
  await wait(350);
  const secondPass = await fetchNFTs(contractAddress, ownerAddress);
  const merged = new Map<string, any>();

  [...firstPass, ...secondPass].forEach((nft) => {
    const existing = merged.get(nft.tokenId);
    const score = Number(Boolean(nft.image)) + (nft.attributes?.length ?? 0) + Number(!nft.name.startsWith('#'));
    const existingScore = existing
      ? Number(Boolean(existing.image)) + (existing.attributes?.length ?? 0) + Number(!existing.name.startsWith('#'))
      : -1;

    if (!existing || score >= existingScore) {
      merged.set(nft.tokenId, nft);
    }
  });

  return Array.from(merged.values());
}

function renderNFTCards(nfts: any[], grid: HTMLElement, emptyElement: HTMLElement, collectionName: string) {
  const existingCards = grid.querySelectorAll('.nft-card, .nft-skeleton');
  existingCards.forEach((card) => card.remove());

  if (nfts.length === 0) {
    emptyElement.style.display = 'block';
    return;
  }

  emptyElement.style.display = 'none';

  nfts.forEach((nft, index) => {
    const card = document.createElement('div');
    card.className = 'nft-card';
    card.style.animationDelay = `${index * 0.08}s`;

    card.innerHTML = `
      <div class="nft-card-img-wrap">
        <img
          class="nft-card-img"
          src="${nft.image || ''}"
          alt="${nft.name}"
          loading="lazy"
          onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 200%22><rect fill=%22%23133F65%22 width=%22200%22 height=%22200%22/><text x=%2250%25%22 y=%2250%25%22 fill=%22%23F27612%22 font-size=%2240%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22 font-family=%22Arial%22>?</text></svg>';"
        />
      </div>
      <div class="nft-card-info">
        <div class="nft-card-name">${nft.name}</div>
        <div class="nft-card-id">Token #${nft.tokenId}</div>
        <span class="nft-card-collection">${collectionName}</span>
      </div>
    `;

    if (nft.attributes && nft.attributes.length > 0) {
      let pillsHtml = '';
      nft.attributes.forEach((attribute: { trait_type?: string; value?: string }) => {
        if (attribute.trait_type && attribute.value) {
          pillsHtml += `<span class="nft-trait-pill">${attribute.trait_type}: ${attribute.value}</span>`;
        }
      });

      const accordionHtml = `
        <div class="nft-traits-accordion">
          <button class="traits-toggle-btn">
            <span>Traits</span>
            <span class="traits-chevron">▼</span>
          </button>
          <div class="traits-content">
            ${pillsHtml}
          </div>
        </div>
      `;

      const infoDiv = card.querySelector('.nft-card-info');
      infoDiv?.insertAdjacentHTML('beforeend', accordionHtml);

      const toggleButton = card.querySelector<HTMLButtonElement>('.traits-toggle-btn');
      const content = card.querySelector<HTMLElement>('.traits-content');
      toggleButton?.addEventListener('click', () => {
        toggleButton.classList.toggle('expanded');
        content?.classList.toggle('expanded');
      });
    }

    grid.appendChild(card);
  });
}

function renderSkeletonCards(grid: HTMLElement, count = 4) {
  const existingCards = grid.querySelectorAll('.nft-card, .nft-skeleton');
  existingCards.forEach((card) => card.remove());

  for (let index = 0; index < count; index += 1) {
    const skeleton = document.createElement('div');
    skeleton.className = 'nft-skeleton';
    skeleton.innerHTML = `
      <div class="nft-skeleton-img"></div>
      <div class="nft-skeleton-info">
        <div class="nft-skeleton-line"></div>
        <div class="nft-skeleton-line"></div>
      </div>
    `;
    grid.appendChild(skeleton);
  }
}

function showLoading() {
  isLoading = true;
  elements.lookupBtn.disabled = true;
  elements.btnText.style.display = 'none';
  elements.btnLoader.style.display = 'block';

  elements.gmonUsd.textContent = '';
  elements.monUsd.textContent = '';
  elements.protocolCount.textContent = '0';
  elements.protocolWarning.style.display = 'none';
  elements.protocolWarning.textContent = '';
  elements.protocolList.innerHTML = '';
  elements.protocolEmpty.style.display = 'none';

  elements.gmonBalance.classList.add('skeleton-text');
  elements.gmonBalance.textContent = '—';
  elements.monBalance.classList.add('skeleton-text');
  elements.monBalance.textContent = '—';
  elements.totalNfts.classList.add('skeleton-text');
  elements.totalNfts.textContent = '—';

  elements.gmonBalance.textContent = '--';
  elements.monBalance.textContent = '--';
  elements.totalNfts.textContent = '--';

  document.querySelectorAll('.balance-card').forEach((card) => card.classList.remove('loaded'));

  elements.scaleEmpty.style.display = 'none';
  elements.roarrrEmpty.style.display = 'none';
  renderSkeletonCards(elements.scaleGrid, 4);
  renderSkeletonCards(elements.roarrrGrid, 4);

  elements.dashboard.style.display = 'block';
  elements.exportBtn.style.display = 'inline-flex';
}

function hideLoading() {
  isLoading = false;
  elements.lookupBtn.disabled = false;
  elements.btnText.style.display = 'flex';
  elements.btnLoader.style.display = 'none';
}

function showError(message: string) {
  elements.errorMsg.textContent = message;
  elements.errorMsg.style.opacity = '1';

  window.setTimeout(() => {
    elements.errorMsg.style.opacity = '0';
    window.setTimeout(() => {
      elements.errorMsg.textContent = '';
    }, 300);
  }, 5000);
}

function toggleSync() {
  if (elements.syncCheckbox.checked) {
    elements.syncStatus.textContent = 'Sync On';
    syncInterval = window.setInterval(() => {
      const address = elements.walletDisplay.textContent;
      if (address && isValidAddress(address)) {
        void lookupWallet(address, true);
      }
    }, 30000);
    return;
  }

  elements.syncStatus.textContent = 'Sync Off';
  if (syncInterval) {
    window.clearInterval(syncInterval);
    syncInterval = null;
  }
}

async function fetchGlobalActivity() {
  if (!provider) {
    try {
      provider = await initProvider();
    } catch {
      elements.globalActivityList.innerHTML = '<div class="activity-loading">Error connecting to network</div>';
      return;
    }
  }

  try {
    const blockCache: Record<number, number> = {};

    const getCachedBlockTime = async (blockNumber: number) => {
      if (blockCache[blockNumber]) {
        return blockCache[blockNumber];
      }

      const block = await provider.getBlock(blockNumber);
      const timestamp = block ? block.timestamp * 1000 : Date.now();
      blockCache[blockNumber] = timestamp;
      return timestamp;
    };

    const gmonContract = new ethers.Contract(CONFIG.contracts.gmon, CONFIG.abis.erc20, provider);
    const scaleContract = new ethers.Contract(CONFIG.contracts.scale, CONFIG.abis.erc721, provider);
    const roarrrContract = new ethers.Contract(CONFIG.contracts.roarrr, CONFIG.abis.erc721, provider);
    const currentBlock = await provider.getBlockNumber();

    const fetchRecentLogs = async (contract: ethers.Contract, filter: any, maxBlocks: number, limit: number) => {
      const logs = [];
      let toBlock = currentBlock;
      let fromBlock = currentBlock - 99;
      const targetOldest = currentBlock - maxBlocks;

      while (toBlock > targetOldest && logs.length < limit) {
        if (fromBlock < targetOldest) {
          fromBlock = targetOldest;
        }

        try {
          const chunk = await contract.queryFilter(filter, fromBlock, toBlock);
          logs.push(...chunk);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn('Chunk query error:', message);
          break;
        }

        toBlock = fromBlock - 1;
        fromBlock = toBlock - 99;
      }

      return logs;
    };

    const [gmonLogs, scaleLogs, roarrrLogs] = await Promise.all([
      fetchRecentLogs(gmonContract, gmonContract.filters.Transfer(), 2000, 15),
      fetchRecentLogs(scaleContract, scaleContract.filters.Transfer(), 5000, 15),
      fetchRecentLogs(roarrrContract, roarrrContract.filters.Transfer(), 5000, 15),
    ]);

    const allEvents = [];

    gmonLogs.forEach((log: any) => {
      allEvents.push({
        ...log,
        asset: 'gMON',
        amountStr: `${Number.parseFloat(ethers.formatUnits(log.args[2], 18)).toFixed(2)} gMON`,
      });
    });

    scaleLogs.forEach((log: any) => {
      allEvents.push({
        ...log,
        asset: 'Scale',
        amountStr: `Token #${log.args[2].toString()}`,
      });
    });

    roarrrLogs.forEach((log: any) => {
      allEvents.push({
        ...log,
        asset: 'Roarrr',
        amountStr: `Token #${log.args[2].toString()}`,
      });
    });

    allEvents.sort((a: any, b: any) => {
      if (b.blockNumber !== a.blockNumber) {
        return b.blockNumber - a.blockNumber;
      }
      return b.index - a.index;
    });

    const topEvents = allEvents.slice(0, 15);
    for (const event of topEvents) {
      event.timestamp = await getCachedBlockTime(event.blockNumber);
    }

    topEvents.forEach((event: any) => {
      const from = event.args[0];
      const to = event.args[1];
      const isGmon = event.asset === 'gMON';

      if (from === ethers.ZeroAddress) {
        event.actionType = isGmon ? 'Stake' : 'Mint';
      } else if (to === ethers.ZeroAddress) {
        event.actionType = isGmon ? 'Unstake' : 'Burn';
      } else {
        event.actionType = 'Transfer';
      }
    });

    renderGlobalActivity(topEvents);
  } catch (error) {
    console.error('Error fetching global activity:', error);
  }
}

function renderGlobalActivity(events: any[]) {
  if (events.length === 0) {
    elements.globalActivityList.innerHTML = '<div class="activity-loading">No recent transactions found.</div>';
    return;
  }

  let html = '';

  events.forEach((event) => {
    const from = event.args[0];
    const to = event.args[1];
    const fromText = from === ethers.ZeroAddress
      ? (event.asset === 'gMON' ? 'Stake' : 'Mint')
      : `${from.slice(0, 5)}...${from.slice(-4)}`;
    const toText = to === ethers.ZeroAddress
      ? (event.asset === 'gMON' ? 'Unstake' : 'Burn')
      : `${to.slice(0, 5)}...${to.slice(-4)}`;

    const badgeClass = event.asset === 'gMON'
      ? 'badge-gmon'
      : event.asset === 'Scale'
        ? 'badge-scale'
        : 'badge-roarrr';

    html += `
      <div class="activity-item">
        <div class="activity-badges" style="display:flex; flex-direction:column; gap:4px; align-items:center;">
          <div class="activity-badge ${badgeClass}">${event.asset}</div>
          <div class="activity-badge" style="background:var(--navy-lighter); color:var(--text-primary); border:1px solid var(--navy-card-border); font-size:0.6rem; min-width:unset; width:100%;">${event.actionType}</div>
        </div>
        <div class="activity-details">
          <span class="activity-addr">${fromText}</span>
          <span style="color:var(--text-muted); font-size: 0.7rem;">→</span>
          <span class="activity-addr">${toText}</span>
          <span style="margin: 0 4px; color:var(--navy-card-border)">|</span>
          <span class="activity-amount">${event.amountStr}</span>
        </div>
        <span class="activity-time">${timeAgo(event.timestamp)}</span>
        <a href="${CONFIG.explorerUrl}/tx/${event.transactionHash}" target="_blank" rel="noopener" class="activity-link" title="View on Explorer">↗</a>
      </div>
    `;
  });

  elements.globalActivityList.innerHTML = html;
}

async function lookupWallet(address: string, isSilent = false) {
  const activeLookupId = ++lookupRequestId;

  if (isLoading && !isSilent) {
    return;
  }

  if (!isValidAddress(address)) {
    if (!isSilent) {
      showError('Please enter a valid wallet address (0x...)');
    }
    return;
  }

  if (!provider) {
    try {
      provider = await initProvider();
    } catch (error) {
      if (!isSilent) {
        showError(error instanceof Error ? error.message : 'Unable to connect to Monad network.');
      }
      return;
    }
  }

  if (!isSilent) {
    showLoading();
    elements.errorMsg.textContent = '';
    elements.walletDisplay.textContent = address;
  }

  try {
    const [exposure, monData, scaleNfts, roarrrNfts, monPrice] = await Promise.all([
      fetchStableExposure(provider, address),
      fetchMonBalance(address),
      fetchStableNFTs(CONFIG.contracts.scale, address),
      fetchStableNFTs(CONFIG.contracts.roarrr, address),
      fetchMonPrice(),
    ]);

    if (activeLookupId !== lookupRequestId) {
      return;
    }

    lastExposure = exposure;
    lastMonData = monData;

    if (monPrice > 0) {
      const formatted = monPrice.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      });
      elements.liveMonPrice.textContent = `1 MON = 1 gMON = $${formatted}`;
    }

    elements.gmonBalance.textContent = formatBalance(exposure.walletGmon);
    elements.gmonBalance.classList.remove('skeleton-text');
    elements.gmonUsd.textContent = formatUsdApprox(exposure.walletGmon, monPrice);

    elements.monBalance.textContent = monData.formatted;
    elements.monBalance.classList.remove('skeleton-text');
    elements.monUsd.textContent = formatUsdApprox(monData.balance, monPrice);

    const totalNftCount = scaleNfts.length + roarrrNfts.length;
    elements.totalNfts.textContent = totalNftCount.toString();
    elements.totalNfts.classList.remove('skeleton-text');

    document.querySelectorAll('.balance-card').forEach((card) => card.classList.add('loaded'));
    renderProtocolPositions(exposure);
    elements.scaleCount.textContent = scaleNfts.length.toString();
    elements.roarrrCount.textContent = roarrrNfts.length.toString();

    renderNFTCards(scaleNfts, elements.scaleGrid, elements.scaleEmpty, 'SCALE');
    renderNFTCards(roarrrNfts, elements.roarrrGrid, elements.roarrrEmpty, 'ROARRR');

    if (!isSilent) {
      saveRecentWallet(address);
      renderRecentWallets();
      updateStarIcon(address);
    }
  } catch (error) {
    console.error('Lookup error:', error);
    if (!isSilent) {
      showError('An error occurred while fetching data. Please try again.');
    }
  } finally {
    if (!isSilent && activeLookupId === lookupRequestId) {
      hideLoading();
    }
  }
}

function exportToCSV() {
  const address = elements.walletDisplay.textContent;
  if (!address || !lastExposure || !lastMonData) {
    return;
  }

  let csv = 'Magma Tracker Export\n\n';
  csv += `Wallet Address,${address}\n`;
  csv += `Wallet gMON,${formatBalance(lastExposure.walletGmon)}\n`;
  csv += `Gross gMON Exposure,${formatBalance(lastExposure.grossGmonExposure)}\n`;
  csv += `Borrowed gMON,${formatBalance(lastExposure.borrowedGmon)}\n`;
  csv += `Net gMON Exposure,${formatBalance(lastExposure.netGmonExposure)}\n`;
  csv += `Pending Redeem Shares,${formatBalance(lastExposure.pendingRedeemShares)}\n`;
  csv += `Claimable Redeem Shares,${formatBalance(lastExposure.claimableRedeemShares)}\n`;
  csv += `Claimable MON,${formatBalance(lastExposure.claimableRedeemMon)}\n`;
  csv += `Magma APY Status,${lastExposure.magmaPerformance.status}\n`;
  csv += `Magma APY,${formatPercent(lastExposure.magmaPerformance.realizedApy)}\n`;
  csv += `Magma Hold Time,${formatDurationCompact(lastExposure.magmaPerformance.holdingSeconds)}\n`;
  csv += `Magma Principal MON,${formatBalance(lastExposure.magmaPerformance.principalMon)}\n`;
  csv += `Magma Yield MON,${formatBalance(lastExposure.magmaPerformance.yieldMon)}\n`;
  csv += `Magma APY Reason,"${(lastExposure.magmaPerformance.reason ?? '').replaceAll('"', '""')}"\n\n`;
  csv += `MON Balance,${lastMonData.formatted}\n\n`;

  csv += 'Protocol,Category,Supplied gMON,Borrowed gMON,Underlying gMON,Claimable MON,Notes\n';
  lastExposure.protocolPositions.forEach((position) => {
    const notes = formatProtocolNotes(position, lastExposure).replaceAll('"', '""');
    csv += `"${position.protocol}","${position.category}","${formatBalance(position.suppliedGmon)}","${formatBalance(position.borrowedGmon)}","${formatBalance(position.underlyingGmon)}","${formatBalance(position.claimableMon)}","${notes}"\n`;
  });

  csv += '\nCollection,Token ID,Name\n';

  const extractItems = (grid: HTMLElement, collection: string) => {
    grid.querySelectorAll('.nft-card').forEach((card) => {
      const name = card.querySelector('.nft-card-name')?.textContent || '';
      const idText = card.querySelector('.nft-card-id')?.textContent || '';
      const tokenId = idText.replace('Token ', '');
      csv += `"${collection}","${tokenId}","${name}"\n`;
    });
  };

  extractItems(elements.scaleGrid, 'SCALE');
  extractItems(elements.roarrrGrid, 'ROARRR');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `magma_export_${address.slice(0, 6)}.csv`);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function initApp() {
  elements.lookupBtn.addEventListener('click', () => {
    const address = elements.walletInput.value.trim();
    void lookupWallet(address);
  });

  elements.walletInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const address = elements.walletInput.value.trim();
      void lookupWallet(address);
    }
  });

  elements.walletInput.addEventListener('input', () => {
    const value = elements.walletInput.value.trim();
    elements.clearBtn.style.display = value.length > 0 ? 'block' : 'none';

    if (value.length > 0 && value.length !== 42) {
      elements.errorMsg.textContent = 'EVM addresses must be exactly 42 characters.';
      elements.errorMsg.style.opacity = '1';
      elements.lookupBtn.disabled = true;
      return;
    }

    if (value.length === 42) {
      if (isValidAddress(value)) {
        elements.errorMsg.textContent = '';
        elements.errorMsg.style.opacity = '0';
        elements.lookupBtn.disabled = false;
        void lookupWallet(value);
      } else {
        elements.errorMsg.textContent = 'Invalid EVM address format.';
        elements.errorMsg.style.opacity = '1';
        elements.lookupBtn.disabled = true;
      }
      return;
    }

    elements.errorMsg.textContent = '';
    elements.errorMsg.style.opacity = '0';
    elements.lookupBtn.disabled = false;
  });

  elements.clearBtn.addEventListener('click', () => {
    elements.walletInput.value = '';
    elements.clearBtn.style.display = 'none';
    elements.walletInput.focus();
    elements.dashboard.style.display = 'none';
    elements.errorMsg.textContent = '';
    lastExposure = null;
    lastMonData = null;
  });

  elements.copyBtn.addEventListener('click', async () => {
    const address = elements.walletDisplay.textContent;
    if (!address) {
      return;
    }

    try {
      await navigator.clipboard.writeText(address);
      elements.copyBtn.classList.add('copied');
      window.setTimeout(() => elements.copyBtn.classList.remove('copied'), 1500);
    } catch (error) {
      console.warn('Failed to copy:', error);
    }
  });

  elements.starBtn.addEventListener('click', () => {
    const address = elements.walletDisplay.textContent;
    if (!address || !isValidAddress(address)) {
      return;
    }

    toggleWatchlistEntry(address);
    renderWatchlist();
    updateStarIcon(address);
  });

  elements.syncCheckbox.addEventListener('change', toggleSync);
  elements.exportBtn.addEventListener('click', exportToCSV);

  elements.walletInput.focus();
  renderRecentWallets();
  renderWatchlist();

  void fetchGlobalActivity();
  globalActivityInterval = window.setInterval(() => {
    void fetchGlobalActivity();
  }, 15000);

  void loadMarketData();

  const hashAddress = window.location.hash.slice(1);
  if (hashAddress && isValidAddress(hashAddress)) {
    elements.walletInput.value = hashAddress;
    elements.clearBtn.style.display = 'block';
    void lookupWallet(hashAddress);
  }
}

initApp();
