// ============================================
// MAGMA TRACKER — Main Application Logic
// ============================================

import { ethers } from 'ethers';

// --- Configuration ---
const CONFIG = {
  // Monad mainnet RPC (public endpoint)
  RPC_URL: 'https://rpc.monad.xyz',
  // Fallback public RPCs
  RPC_FALLBACKS: [
    'https://monad-rpc.publicnode.com',
    'https://monad.drpc.org',
  ],

  // Contract addresses
  GMON_CONTRACT: '0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081',
  SCALE_CONTRACT: '0x427D16455784e2587088fe333024B870126A0c72',
  ROARRR_CONTRACT: '0xcbdFaD1bfb6A4414DD4D84B7A6420dc43683deB0',

  // ERC-20 ABI (minimal for balanceOf + decimals)
  ERC20_ABI: [
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'event Transfer(address indexed from, address indexed to, uint256 value)'
  ],

  // ERC-721 ABI (minimal for balanceOf + tokenOfOwnerByIndex + tokenURI)
  ERC721_ABI: [
    'function balanceOf(address owner) view returns (uint256)',
    'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function name() view returns (string)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
  ],
  // Explorer URL fallback
  EXPLORER_URL: 'https://monadscan.com',
};

// --- State ---
let provider = null;
let isLoading = false;

// --- DOM Elements ---
const elements = {
  walletInput: document.getElementById('wallet-input'),
  lookupBtn: document.getElementById('lookup-btn'),
  clearBtn: document.getElementById('clear-btn'),
  btnText: document.querySelector('.btn-text'),
  btnLoader: document.querySelector('.btn-loader'),
  errorMsg: document.getElementById('error-msg'),
  recentSearches: document.getElementById('recent-searches'),
  dashboard: document.getElementById('dashboard'),
  walletDisplay: document.getElementById('wallet-display'),
  copyBtn: document.getElementById('copy-btn'),
  starBtn: document.getElementById('star-btn'),
  syncCheckbox: document.getElementById('sync-checkbox'),
  syncStatus: document.getElementById('sync-status'),
  watchlist: document.getElementById('watchlist'),
  gmonBalance: document.getElementById('gmon-balance'),
  gmonUsd: document.getElementById('gmon-usd'),
  monBalance: document.getElementById('mon-balance'),
  monUsd: document.getElementById('mon-usd'),
  totalNfts: document.getElementById('total-nfts'),
  globalActivityList: document.getElementById('global-activity-list'),
  scaleGrid: document.getElementById('scale-grid'),
  scaleCount: document.getElementById('scale-count'),
  scaleEmpty: document.getElementById('scale-empty'),
  roarrrGrid: document.getElementById('roarrr-grid'),
  roarrrCount: document.getElementById('roarrr-count'),
  roarrrEmpty: document.getElementById('roarrr-empty'),
  exportBtn: document.getElementById('export-btn'),
  liveMonPrice: document.getElementById('live-mon-price'),
  monChartCanvas: document.getElementById('mon-chart'),
};

// --- Initialize Provider ---
async function initProvider() {
  // Try each RPC in order
  const rpcs = [CONFIG.RPC_URL, ...CONFIG.RPC_FALLBACKS];
  for (const rpc of rpcs) {
    try {
      const p = new ethers.JsonRpcProvider(rpc);
      // Quick test
      await p.getBlockNumber();
      console.log(`Connected to RPC: ${rpc}`);
      return p;
    } catch (e) {
      console.warn(`RPC failed: ${rpc}`, e.message);
    }
  }
  throw new Error('Unable to connect to Monad network. Please try again later.');
}

// --- Validate Address ---
function isValidAddress(address) {
  return ethers.isAddress(address);
}

// --- Recent Searches Storage ---
const STORAGE_KEY = 'magma_recent_wallets';
const MAX_RECENT = 4;

function loadRecentWallets() {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

function saveRecentWallet(address) {
  let wallets = loadRecentWallets();
  wallets = wallets.filter(w => w.toLowerCase() !== address.toLowerCase());
  wallets.unshift(address);
  if (wallets.length > MAX_RECENT) wallets.pop();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
  renderRecentWallets();
}

function renderRecentWallets() {
  if (!elements.recentSearches) return;
  const wallets = loadRecentWallets();
  
  if (wallets.length === 0) {
    elements.recentSearches.style.display = 'none';
    return;
  }

  elements.recentSearches.style.display = 'flex';
  let html = '<span class="recent-label">Recent:</span>';
  
  wallets.forEach(w => {
    const short = `${w.slice(0, 6)}...${w.slice(-4)}`;
    html += `<button class="recent-pill" data-address="${w}" title="${w}">${short}</button>`;
  });
  
  elements.recentSearches.innerHTML = html;
  
  elements.recentSearches.querySelectorAll('.recent-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const addr = btn.getAttribute('data-address');
      elements.walletInput.value = addr;
      elements.clearBtn.style.display = 'block';
      lookupWallet(addr);
    });
  });
}

// --- Watchlist Storage ---
const WATCHLIST_KEY = 'magma_watchlist';

function loadWatchlist() {
  const data = localStorage.getItem(WATCHLIST_KEY);
  return data ? JSON.parse(data) : [];
}

function renderWatchlist() {
  if (!elements.watchlist) return;
  const wallets = loadWatchlist();
  
  if (wallets.length === 0) {
    elements.watchlist.style.display = 'none';
    return;
  }

  elements.watchlist.style.display = 'flex';
  let html = '<span class="recent-label" style="color: var(--magma-orange);">Watchlist:</span>';
  
  wallets.forEach(w => {
    const short = `${w.slice(0, 6)}...${w.slice(-4)}`;
    html += `<button class="recent-pill watch-pill" style="border-color: rgba(242, 118, 18, 0.4); color: var(--magma-orange);" data-address="${w}" title="${w}">⭐ ${short}</button>`;
  });
  
  elements.watchlist.innerHTML = html;
  
  elements.watchlist.querySelectorAll('.watch-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const addr = btn.getAttribute('data-address');
      elements.walletInput.value = addr;
      elements.clearBtn.style.display = 'block';
      lookupWallet(addr);
    });
  });
}

function toggleWatchlist(address) {
  let wallets = loadWatchlist();
  const lowerAddr = address.toLowerCase();
  const idx = wallets.findIndex(w => w.toLowerCase() === lowerAddr);
  
  if (idx > -1) {
    wallets.splice(idx, 1);
    elements.starBtn.classList.remove('watched');
  } else {
    wallets.push(address);
    elements.starBtn.classList.add('watched');
  }
  
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(wallets));
  renderWatchlist();
}

function updateStarIcon(address) {
  const wallets = loadWatchlist();
  if (wallets.some(w => w.toLowerCase() === address.toLowerCase())) {
    elements.starBtn.classList.add('watched');
  } else {
    elements.starBtn.classList.remove('watched');
  }
}

// --- Format Balance ---
function formatBalance(value, decimals = 18) {
  const formatted = ethers.formatUnits(value, decimals);
  const num = parseFloat(formatted);
  if (num === 0) return '0';
  if (num < 0.0001) return '< 0.0001';
  if (num < 1) return num.toFixed(4);
  if (num < 1000) return num.toFixed(2);
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// --- Fetch gMON Balance ---
async function fetchGmonBalance(address) {
  const contract = new ethers.Contract(CONFIG.GMON_CONTRACT, CONFIG.ERC20_ABI, provider);
  try {
    const [balance, decimals] = await Promise.all([
      contract.balanceOf(address),
      contract.decimals(),
    ]);
    const num = parseFloat(ethers.formatUnits(balance, decimals));
    return { balance, decimals, formatted: formatBalance(balance, decimals), num };
  } catch (e) {
    console.error('Error fetching gMON balance:', e);
    return { balance: 0n, decimals: 18, formatted: '0', num: 0 };
  }
}

// --- Fetch MON Balance ---
async function fetchMonBalance(address) {
  try {
    const balance = await provider.getBalance(address);
    const num = parseFloat(ethers.formatUnits(balance, 18));
    return { balance, formatted: formatBalance(balance, 18), num };
  } catch (e) {
    console.error('Error fetching MON balance:', e);
    return { balance: 0n, formatted: '0', num: 0 };
  }
}

// --- Fetch MON Price (CoinGecko) ---
let cachedMonPrice = null;
let lastPriceFetch = 0;

async function fetchMonPrice() {
  const now = Date.now();
  if (cachedMonPrice && now - lastPriceFetch < 60000) return cachedMonPrice;
  
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd');
    if (res.ok) {
      const data = await res.json();
      if (data && data.monad && data.monad.usd) {
        cachedMonPrice = data.monad.usd;
        lastPriceFetch = now;
        return cachedMonPrice;
      }
    }
  } catch (e) {
    console.warn('Could not fetch live MON price:', e);
  }
  return 0;
}

// --- Fetch MON Historical Price (Chart) ---
let monChartInstance = null;

async function fetchMonHistoricalPrice() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/monad/market_chart?vs_currency=usd&days=7');
    if (res.ok) {
      const data = await res.json();
      if (data && data.prices) return data.prices;
    }
  } catch (e) {
    console.warn('Could not fetch historical MON price:', e);
  }
  return [];
}

// --- Render Market Chart ---
function renderMonChart(pricesData) {
  if (!elements.monChartCanvas) return;
  const ctx = elements.monChartCanvas.getContext('2d');
  
  if (!pricesData || pricesData.length === 0) return;

  const labels = pricesData.map(p => new Date(p[0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  const dataPoints = pricesData.map(p => p[1]);

  if (monChartInstance) {
    monChartInstance.destroy();
  }

  // Fallback if Chart isn't loaded
  if (typeof Chart === 'undefined') return;

  monChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
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
        tension: 0.3
      }]
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
            label: function(context) {
              return '$' + context.parsed.y.toFixed(3);
            }
          }
        }
      },
      scales: {
        x: { display: false },
        y: { display: false, min: Math.min(...dataPoints) * 0.99 }
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      }
    }
  });
}

// --- Load Global Market Data ---
async function loadMarketData() {
  const monPrice = await fetchMonPrice();
  if (monPrice > 0) {
    const pFormatted = monPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    if (elements.liveMonPrice) elements.liveMonPrice.textContent = `1 MON = 1 gMON = $${pFormatted}`;
  }
  if (!monChartInstance) {
    const histData = await fetchMonHistoricalPrice();
    renderMonChart(histData);
  }
}

// --- Fetch NFTs for a Collection ---
async function fetchNFTs(contractAddress, ownerAddress) {
  const contract = new ethers.Contract(contractAddress, CONFIG.ERC721_ABI, provider);
  const nfts = [];

  try {
    const balanceBN = await contract.balanceOf(ownerAddress);
    const balance = Number(balanceBN);

    if (balance === 0) return nfts;

    let tokenIds = [];
    
    // Attempt 1: ERC721A walletOfOwner
    try {
      const extAbi = ["function walletOfOwner(address) view returns (uint256[])"];
      const extContract = new ethers.Contract(contractAddress, extAbi, provider);
      const ids = await extContract.walletOfOwner(ownerAddress);
      tokenIds = ids.map(id => id.toString());
    } catch (e1) {
      // Attempt 2: tokensOfOwner
      try {
        const extAbi2 = ["function tokensOfOwner(address) view returns (uint256[])"];
        const extContract2 = new ethers.Contract(contractAddress, extAbi2, provider);
        const ids = await extContract2.tokensOfOwner(ownerAddress);
        tokenIds = ids.map(id => id.toString());
      } catch (e2) {
        // Attempt 3: tokenOfOwnerByIndex (ERC721Enumerable)
        try {
          const tokenIdPromises = [];
          for (let i = 0; i < balance; i++) {
            tokenIdPromises.push(contract.tokenOfOwnerByIndex(ownerAddress, i));
          }
          tokenIds = await Promise.all(tokenIdPromises);
        } catch (enumErr) {
          console.warn(`Enumeration not supported for ${contractAddress}, attempting via Transfer logs...`);
          const eventAbi = [
            "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
            "function ownerOf(uint256 tokenId) view returns (address)"
          ];
          const eventContract = new ethers.Contract(contractAddress, eventAbi, provider);
          
          try {
            const filter = eventContract.filters.Transfer(null, ownerAddress);
            const logs = await eventContract.queryFilter(filter, -10000, 'latest'); // Keep range smaller to avoid some errors
            
            const candidateIds = new Set();
            logs.forEach(log => {
              candidateIds.add(log.args[2].toString());
            });

            // Verify ownership
            const ownershipPromises = Array.from(candidateIds).map(async (id) => {
              try {
                const currentOwner = await eventContract.ownerOf(id);
                if (currentOwner.toLowerCase() === ownerAddress.toLowerCase()) return id;
              } catch (e) {}
              return null;
            });

            const verified = await Promise.all(ownershipPromises);
            tokenIds = verified.filter(id => id !== null).slice(0, balance);
          } catch (logErr) {
            console.error("Failed all fallback fetching methods:", logErr);
          }
        }
      }
    }

    // Fetch metadata for each token
    const metadataPromises = tokenIds.map(async (tokenId) => {
      try {
        const tokenURI = await contract.tokenURI(tokenId);
        let metadata = null;

        // Resolve IPFS URIs
        let resolvedURI = tokenURI;
        if (resolvedURI.startsWith('ipfs://')) {
          resolvedURI = resolvedURI.replace('ipfs://', 'https://ipfs.io/ipfs/');
        }

        try {
          const response = await fetch(resolvedURI);
          if (response.ok) {
            metadata = await response.json();
          }
        } catch (fetchErr) {
          console.warn(`Failed to fetch metadata for token ${tokenId}:`, fetchErr);
        }

        let imageUrl = '';
        if (metadata && metadata.image) {
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
      } catch (e) {
        console.warn(`Failed to get metadata for token ${tokenId}:`, e);
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
  } catch (e) {
    console.error(`Error fetching NFTs from ${contractAddress}:`, e);
  }

  return nfts;
}

// --- Render NFT Cards ---
function renderNFTCards(nfts, grid, emptyEl, collectionName) {
  // Clear previous cards (keep empty element)
  const existingCards = grid.querySelectorAll('.nft-card, .nft-skeleton');
  existingCards.forEach(card => card.remove());

  if (nfts.length === 0) {
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';

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

    // Generate accordion traits HTML directly if available
    if (nft.attributes && nft.attributes.length > 0) {
      let pillsHtml = '';
      nft.attributes.forEach(attr => {
        if (attr.trait_type && attr.value) {
          pillsHtml += `<span class="nft-trait-pill">${attr.trait_type}: ${attr.value}</span>`;
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
      infoDiv.insertAdjacentHTML('beforeend', accordionHtml);
      
      const toggleBtn = card.querySelector('.traits-toggle-btn');
      const contentDiv = card.querySelector('.traits-content');
      toggleBtn.addEventListener('click', () => {
        toggleBtn.classList.toggle('expanded');
        contentDiv.classList.toggle('expanded');
      });
    }

    grid.appendChild(card);
  });
}

// --- Render Skeleton NFT Cards ---
function renderSkeletonCards(grid, count = 4) {
  const existing = grid.querySelectorAll('.nft-card, .nft-skeleton');
  existing.forEach(card => card.remove());

  for (let i = 0; i < count; i++) {
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

// --- Show Loading State ---
function showLoading() {
  isLoading = true;
  elements.lookupBtn.disabled = true;
  elements.btnText.style.display = 'none';
  elements.btnLoader.style.display = 'block';

  elements.gmonBalance.classList.add('skeleton-text');
  elements.gmonBalance.textContent = '—';
  elements.monBalance.classList.add('skeleton-text');
  elements.monBalance.textContent = '—';
  elements.totalNfts.classList.add('skeleton-text');
  elements.totalNfts.textContent = '—';

  document.querySelectorAll('.balance-card').forEach(c => c.classList.remove('loaded'));

  elements.scaleEmpty.style.display = 'none';
  elements.roarrrEmpty.style.display = 'none';
  renderSkeletonCards(elements.scaleGrid, 4);
  renderSkeletonCards(elements.roarrrGrid, 4);

  elements.dashboard.style.display = 'block';
  if (elements.exportBtn) elements.exportBtn.style.display = 'inline-flex';
}

// --- Hide Loading State ---
function hideLoading() {
  isLoading = false;
  elements.lookupBtn.disabled = false;
  elements.btnText.style.display = 'inline';
  elements.btnLoader.style.display = 'none';
}

// --- Show Error ---
function showError(message) {
  elements.errorMsg.textContent = message;
  elements.errorMsg.style.opacity = '1';
  setTimeout(() => {
    elements.errorMsg.style.opacity = '0';
    setTimeout(() => {
      elements.errorMsg.textContent = '';
    }, 300);
  }, 5000);
}

// --- Sync Logic ---
let syncInterval = null;

function toggleSync() {
  if (elements.syncCheckbox.checked) {
    elements.syncStatus.textContent = 'Sync On';
    syncInterval = setInterval(() => {
      const addr = elements.walletDisplay.textContent;
      if (addr && isValidAddress(addr)) {
        lookupWallet(addr, true);
      }
    }, 30000);
  } else {
    elements.syncStatus.textContent = 'Sync Off';
    if (syncInterval) clearInterval(syncInterval);
  }
}

// --- Global Activity Feed ---
let globalActivityInterval = null;

async function fetchGlobalActivity() {
  if (!provider) {
    try {
      provider = await initProvider();
    } catch (e) {
      if (elements.globalActivityList) {
        elements.globalActivityList.innerHTML = '<div class="activity-loading">Error connecting to network</div>';
      }
      return;
    }
  }

  try {
    const blockCache = {};
    const getCachedBlockTime = async (bNum) => {
      if (blockCache[bNum]) return blockCache[bNum];
      const b = await provider.getBlock(bNum);
      blockCache[bNum] = b ? b.timestamp * 1000 : Date.now();
      return blockCache[bNum];
    };

    const gmonContract = new ethers.Contract(CONFIG.GMON_CONTRACT, CONFIG.ERC20_ABI, provider);
    const scaleContract = new ethers.Contract(CONFIG.SCALE_CONTRACT, CONFIG.ERC721_ABI, provider);
    const roarrrContract = new ethers.Contract(CONFIG.ROARRR_CONTRACT, CONFIG.ERC721_ABI, provider);

    const currentBlock = await provider.getBlockNumber();
    
    const fetchRecentLogs = async (contract, filter, maxBlocks, limit) => {
      let logs = [];
      let toBlock = currentBlock;
      let fromBlock = currentBlock - 99; // 100 block chunks to satisfy RPC limitations
      let targetOldest = currentBlock - maxBlocks;
      
      while (toBlock > targetOldest && logs.length < limit) {
        if (fromBlock < targetOldest) fromBlock = targetOldest;
        try {
          const chunk = await contract.queryFilter(filter, fromBlock, toBlock);
          logs.push(...chunk);
        } catch (e) {
          console.warn('Chunk query error:', e.message);
          // Break on error to avoid spamming the RPC if it strictly blocks us
          break;
        }
        toBlock = fromBlock - 1;
        fromBlock = toBlock - 99;
      }
      return logs;
    };

    // Fetch chunked to bypass 100-block RPC limit.
    const [gmonLogs, scaleLogs, roarrrLogs] = await Promise.all([
      fetchRecentLogs(gmonContract, gmonContract.filters.Transfer(), 2000, 15),
      fetchRecentLogs(scaleContract, scaleContract.filters.Transfer(), 5000, 15),
      fetchRecentLogs(roarrrContract, roarrrContract.filters.Transfer(), 5000, 15)
    ]);

    const allEvents = [];
    
    gmonLogs.forEach(log => allEvents.push({ 
      ...log, asset: 'gMON', 
      amountStr: parseFloat(ethers.formatUnits(log.args[2], 18)).toFixed(2) + ' gMON' 
    }));
    
    scaleLogs.forEach(log => allEvents.push({ 
      ...log, asset: 'Scale', amountStr: 'Token #' + log.args[2].toString() 
    }));
    
    roarrrLogs.forEach(log => allEvents.push({ 
      ...log, asset: 'Roarrr', amountStr: 'Token #' + log.args[2].toString() 
    }));

    allEvents.sort((a, b) => {
      if (b.blockNumber !== a.blockNumber) return b.blockNumber - a.blockNumber;
      return b.index - a.index;
    });

    const topEvents = allEvents.slice(0, 15);

    // Fetch block times
    for (let ev of topEvents) {
      ev.timestamp = await getCachedBlockTime(ev.blockNumber);
    }

    // Assign action type
    topEvents.forEach(ev => {
      const from = ev.args[0];
      const to = ev.args[1];
      const isGmon = ev.asset === 'gMON';
      
      if (from === '0x0000000000000000000000000000000000000000') {
        ev.actionType = isGmon ? 'Stake' : 'Mint';
      } else if (to === '0x0000000000000000000000000000000000000000') {
        ev.actionType = isGmon ? 'Unstake' : 'Burn';
      } else {
        ev.actionType = 'Transfer';
      }
    });

    renderGlobalActivity(topEvents);

  } catch (e) {
    console.error("Error fetching global activity:", e);
  }
}

function timeAgo(ms) {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 15) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function renderGlobalActivity(events) {
  if (!elements.globalActivityList) return;
  if (events.length === 0) {
    elements.globalActivityList.innerHTML = '<div class="activity-loading">No recent transactions found.</div>';
    return;
  }

  let html = '';
  events.forEach(ev => {
    const from = ev.args[0];
    const to = ev.args[1];
    
    let fromText = from === '0x0000000000000000000000000000000000000000' ? (ev.asset === 'gMON' ? 'Stake' : 'Mint') : `${from.slice(0,5)}...${from.slice(-4)}`;
    let toText = to === '0x0000000000000000000000000000000000000000' ? (ev.asset === 'gMON' ? 'Unstake' : 'Burn') : `${to.slice(0,5)}...${to.slice(-4)}`;
    
    const badgeClass = ev.asset === 'gMON' ? 'badge-gmon' : ev.asset === 'Scale' ? 'badge-scale' : 'badge-roarrr';
    const txLink = `${CONFIG.EXPLORER_URL}/tx/${ev.transactionHash}`;
    
    html += `
      <div class="activity-item">
        <div class="activity-badges" style="display:flex; flex-direction:column; gap:4px; align-items:center;">
          <div class="activity-badge ${badgeClass}">${ev.asset}</div>
          <div class="activity-badge" style="background:var(--navy-lighter); color:var(--text-primary); border:1px solid var(--navy-card-border); font-size:0.6rem; min-width:unset; width:100%;">${ev.actionType}</div>
        </div>
        <div class="activity-details">
          <span class="activity-addr">${fromText}</span>
          <span style="color:var(--text-muted); font-size: 0.7rem;">➔</span>
          <span class="activity-addr">${toText}</span>
          <span style="margin: 0 4px; color:var(--navy-card-border)">|</span>
          <span class="activity-amount">${ev.amountStr}</span>
        </div>
        <span class="activity-time">${timeAgo(ev.timestamp)}</span>
        <a href="${txLink}" target="_blank" rel="noopener" class="activity-link" title="View on Explorer">↗</a>
      </div>
    `;
  });

  elements.globalActivityList.innerHTML = html;
}

// --- Main Lookup Function ---
async function lookupWallet(address, isSilent = false) {
  if (isLoading && !isSilent) return;

  if (!isValidAddress(address)) {
    if (!isSilent) showError('Please enter a valid wallet address (0x...)');
    return;
  }

  if (!provider) {
    try {
      provider = await initProvider();
    } catch (e) {
      if (!isSilent) showError(e.message);
      return;
    }
  }

  if (!isSilent) {
    showLoading();
    elements.errorMsg.textContent = '';
    elements.walletDisplay.textContent = address;
  }

  try {
    // Fetch everything in parallel
    const [gmonData, monData, scaleNfts, roarrrNfts, monPrice] = await Promise.all([
      fetchGmonBalance(address),
      fetchMonBalance(address),
      fetchNFTs(CONFIG.SCALE_CONTRACT, address),
      fetchNFTs(CONFIG.ROARRR_CONTRACT, address),
      fetchMonPrice()
    ]);

    // Update Market Header live price since it's cached anyway
    if (monPrice > 0) {
      const pFormatted = monPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
      elements.liveMonPrice.textContent = `1 MON = 1 gMON = $${pFormatted}`;
    }

    // Update balance cards
    elements.gmonBalance.textContent = gmonData.formatted;
    elements.gmonBalance.classList.remove('skeleton-text');
    
    if (monPrice > 0 && gmonData.num > 0) {
      const usdCard = (gmonData.num * monPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      elements.gmonUsd.textContent = `~$${usdCard}`;
    } else {
      elements.gmonUsd.textContent = '';
    }

    elements.monBalance.textContent = monData.formatted;
    elements.monBalance.classList.remove('skeleton-text');
    
    if (monPrice > 0 && monData.num > 0) {
      const usdCard = (monData.num * monPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      elements.monUsd.textContent = `~$${usdCard}`;
    } else {
      elements.monUsd.textContent = '';
    }

    const totalNftCount = scaleNfts.length + roarrrNfts.length;
    elements.totalNfts.textContent = totalNftCount.toString();
    elements.totalNfts.classList.remove('skeleton-text');

    // Mark cards as loaded
    document.querySelectorAll('.balance-card').forEach(c => c.classList.add('loaded'));

    // Update NFT counts
    elements.scaleCount.textContent = scaleNfts.length.toString();
    elements.roarrrCount.textContent = roarrrNfts.length.toString();

    // Render NFT grids with metadata pills
    renderNFTCards(scaleNfts, elements.scaleGrid, elements.scaleEmpty, 'SCALE');
    renderNFTCards(roarrrNfts, elements.roarrrGrid, elements.roarrrEmpty, 'ROARRR');

    if (!isSilent) {
      // Save to recent searches
      saveRecentWallet(address);
      updateStarIcon(address);
    }

  } catch (e) {
    console.error('Lookup error:', e);
    if (!isSilent) showError('An error occurred while fetching data. Please try again.');
  } finally {
    if (!isSilent) hideLoading();
  }
}

// --- Export CSV ---
function exportToCSV() {
  const addr = elements.walletDisplay.textContent;
  if (!addr) return;

  const gmonBal = elements.gmonBalance.textContent;
  const monBal = elements.monBalance.textContent;
  
  let csv = 'Magma Tracker Export\\n\\n';
  csv += `Wallet Address,${addr}\\n`;
  csv += `gMON Balance,${gmonBal}\\n`;
  csv += `MON Balance,${monBal}\\n\\n`;
  
  csv += 'Collection,Token ID,Name\\n';
  
  const extractItems = (grid, collection) => {
    grid.querySelectorAll('.nft-card').forEach(card => {
      const name = card.querySelector('.nft-card-name')?.textContent || '';
      const idStr = card.querySelector('.nft-card-id')?.textContent || '';
      const id = idStr.replace('Token ', '');
      csv += `"${collection}","${id}","${name}"\\n`;
    });
  };

  extractItems(elements.scaleGrid, 'SCALE');
  extractItems(elements.roarrrGrid, 'ROARRR');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `magma_export_${addr.slice(0,6)}.csv`);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// --- Event Listeners ---
function initApp() {
  // Lookup button
  elements.lookupBtn.addEventListener('click', () => {
    const address = elements.walletInput.value.trim();
    lookupWallet(address);
  });

  // Enter key
  elements.walletInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const address = elements.walletInput.value.trim();
      lookupWallet(address);
    }
  });

  // Input validation, clear button, and auto-fetch
  elements.walletInput.addEventListener('input', () => {
    const val = elements.walletInput.value.trim();
    elements.clearBtn.style.display = val.length > 0 ? 'block' : 'none';
    
    if (val.length > 0 && val.length !== 42) {
      elements.errorMsg.textContent = 'EVM addresses must be exactly 42 characters.';
      elements.errorMsg.style.opacity = '1';
      elements.lookupBtn.disabled = true;
    } else if (val.length === 42) {
      if (isValidAddress(val)) {
        elements.errorMsg.textContent = '';
        elements.errorMsg.style.opacity = '0';
        elements.lookupBtn.disabled = false;
        // Auto-fetch data!
        lookupWallet(val);
      } else {
        elements.errorMsg.textContent = 'Invalid EVM address format.';
        elements.errorMsg.style.opacity = '1';
        elements.lookupBtn.disabled = true;
      }
    } else {
      elements.errorMsg.textContent = '';
      elements.errorMsg.style.opacity = '0';
      elements.lookupBtn.disabled = false;
    }
  });

  // Clear button
  elements.clearBtn.addEventListener('click', () => {
    elements.walletInput.value = '';
    elements.clearBtn.style.display = 'none';
    elements.walletInput.focus();
    elements.dashboard.style.display = 'none';
    elements.errorMsg.textContent = '';
  });

  // Copy address
  elements.copyBtn.addEventListener('click', async () => {
    const addr = elements.walletDisplay.textContent;
    if (addr) {
      try {
        await navigator.clipboard.writeText(addr);
        elements.copyBtn.classList.add('copied');
        setTimeout(() => elements.copyBtn.classList.remove('copied'), 1500);
      } catch (e) {
        console.warn('Failed to copy:', e);
      }
    }
  });

  // Star button
  elements.starBtn.addEventListener('click', () => {
    const addr = elements.walletDisplay.textContent;
    if (addr && isValidAddress(addr)) toggleWatchlist(addr);
  });

  // Sync toggle
  if (elements.syncCheckbox) elements.syncCheckbox.addEventListener('change', toggleSync);

  // Export CSV
  if (elements.exportBtn) elements.exportBtn.addEventListener('click', exportToCSV);

  // Focus input on load
  elements.walletInput.focus();

  // Render recents on load
  renderRecentWallets();
  renderWatchlist();

  // Load global activity
  fetchGlobalActivity();
  globalActivityInterval = setInterval(fetchGlobalActivity, 15000);
  
  // Load market data
  loadMarketData();

  // Check for address in URL hash
  const hashAddr = window.location.hash.slice(1);
  if (hashAddr && isValidAddress(hashAddr)) {
    elements.walletInput.value = hashAddr;
    elements.clearBtn.style.display = 'block';
    lookupWallet(hashAddr);
  }
}

// --- Initialize ---
initApp();
