import type { CopyTradeEvent } from "../../src/core/types";

export interface HeliusTxResult {
  signature: string;
  transaction: { transaction: { message: any }; meta: any };
}

/**
 * Parse Raydium CPMM buy/sell from Helius result. Returns CopyTradeEvent or null.
 * TODO: implement full parsing.
 */
export function parseRaydiumCpmmTx(_result: HeliusTxResult, _copyWalletId: string): CopyTradeEvent | null {
  return null;
}
