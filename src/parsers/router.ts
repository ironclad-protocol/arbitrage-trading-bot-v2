import type { CopyTradeEvent } from "../core/types";
import { PUMP_FUN_PROGRAM_ID, PUMP_AMM_SWAP_PROGRAM_ID, RAYDIUM_AMM_PROGRAM_ID, RAYDIUM_CPMM_PROGRAM_ID, DFLOW_PROGRAM_ID, OKX_LABS_PROGRAM_ID, JUPITER_AGGREGATOR_PROGRAM_ID } from "../core/config";
import { parsePumpFunTx } from "../../dex/pumpfun";
import { parsePumpAmmSwapTx } from "../../dex/pumpswap";
import { parseRaydiumAmmTx, parseRaydiumCpmmTx } from "../../dex/raydium";

export interface HeliusTxResult {
  signature: string;
  transaction: {
    transaction: { message: any };
    meta: any;
  };
}

/**
 * Route raw Helius result to the right parser by program id. Returns first non-null event.
 * copyWalletId = the wallet address we're copying (that appeared in the tx).
 */
export async function routeAndParse(
  result: HeliusTxResult,
  copyWalletIds: string[]
): Promise<CopyTradeEvent | null> {
  const msgStr = JSON.stringify(result);

  const copyWalletId = copyWalletIds.find((id) => msgStr.includes(id));
  if (!copyWalletId) return null;
  if (msgStr.includes(DFLOW_PROGRAM_ID) || msgStr.includes(OKX_LABS_PROGRAM_ID) || msgStr.includes(JUPITER_AGGREGATOR_PROGRAM_ID)) {
    return null;
  }

  if (msgStr.includes(PUMP_FUN_PROGRAM_ID)) {
    return parsePumpFunTx(result, copyWalletId);
  }

  if (msgStr.includes(PUMP_AMM_SWAP_PROGRAM_ID)) {
    return parsePumpAmmSwapTx(result, copyWalletId);
  }

  if (msgStr.includes(RAYDIUM_AMM_PROGRAM_ID)) {
    return parseRaydiumAmmTx(result, copyWalletId);
  }
  return null;
}
