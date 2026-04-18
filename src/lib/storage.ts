import { CONFIG } from '../config/contracts';

function loadStringList(storageKey: string) {
  const data = localStorage.getItem(storageKey);
  return data ? (JSON.parse(data) as string[]) : [];
}

function saveStringList(storageKey: string, values: string[]) {
  localStorage.setItem(storageKey, JSON.stringify(values));
}

export function loadRecentWallets() {
  return loadStringList(CONFIG.recentWalletStorageKey);
}

export function saveRecentWallet(address: string) {
  let wallets = loadRecentWallets();

  wallets = wallets.filter((wallet) => wallet.toLowerCase() !== address.toLowerCase());
  wallets.unshift(address);

  if (wallets.length > CONFIG.maxRecentWallets) {
    wallets = wallets.slice(0, CONFIG.maxRecentWallets);
  }

  saveStringList(CONFIG.recentWalletStorageKey, wallets);
}

export function loadWatchlist() {
  return loadStringList(CONFIG.watchlistStorageKey);
}

export function toggleWatchlistEntry(address: string) {
  const wallets = loadWatchlist();
  const existingIndex = wallets.findIndex((wallet) => wallet.toLowerCase() === address.toLowerCase());

  if (existingIndex >= 0) {
    wallets.splice(existingIndex, 1);
  } else {
    wallets.push(address);
  }

  saveStringList(CONFIG.watchlistStorageKey, wallets);
}

export function isWatchlisted(address: string) {
  return loadWatchlist().some((wallet) => wallet.toLowerCase() === address.toLowerCase());
}
