/**
 * In-memory copy-wallet holdings for fast sell sizing. No file I/O in hot path.
 */
const holdings = new Map<string, Map<string, number>>();

export function getHolding(wallet: string, mint: string): number {
  return holdings.get(wallet)?.get(mint) ?? 0;
}

export function updateHolding(wallet: string, mint: string, isBuy: boolean, amount: number): void {
  let walletMap = holdings.get(wallet);
  if (!walletMap) {
    walletMap = new Map();
    holdings.set(wallet, walletMap);
  }
  const current = walletMap.get(mint) ?? 0;
  if (isBuy) {
    walletMap.set(mint, current + amount);
  } else {
    const next = current - amount;
    if (next <= 0) walletMap.delete(mint);
    else walletMap.set(mint, next);
  }
}

export function clearHoldings(): void {
  holdings.clear();
}
