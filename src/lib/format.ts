import { ethers } from 'ethers';

export function isValidAddress(address: string) {
  return ethers.isAddress(address);
}

export function formatBalance(value: bigint, decimals = 18) {
  const formatted = ethers.formatUnits(value, decimals);
  const num = Number.parseFloat(formatted);

  if (num === 0) return '0';
  if (num < 0.0001) return '< 0.0001';
  if (num < 1) return num.toFixed(4);
  if (num < 1000) return num.toFixed(2);

  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function timeAgo(timestampMs: number) {
  const seconds = Math.floor((Date.now() - timestampMs) / 1000);

  if (seconds < 15) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function formatPercent(value: number | null, fractionDigits = 2) {
  if (value === null || !Number.isFinite(value)) {
    return 'Unavailable';
  }

  return `${(value * 100).toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}%`;
}

export function formatDurationCompact(totalSeconds: number | null) {
  if (totalSeconds === null || totalSeconds <= 0) {
    return 'Unavailable';
  }

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}
