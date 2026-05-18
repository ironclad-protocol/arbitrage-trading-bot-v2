import base58 from "bs58";
import * as borsh from "@coral-xyz/borsh";
import { sha256 } from "@noble/hashes/sha256";
import type { CopyTradeEvent } from "../../src/core/types";
import { PUMP_FUN_PROGRAM_ID } from "../../src/core/config";

const buyDiscriminator = Buffer.from(sha256("global:buy").slice(0, 8));
const sellDiscriminator = Buffer.from(sha256("global:sell").slice(0, 8));
const tradeSchema = borsh.struct([
  borsh.u64("discriminator"),
  borsh.u64("amount"),
  borsh.u64("solAmount"),
]);

export interface HeliusTxResult {
  signature: string;
  transaction: {
    transaction: { message: any };
    meta: any;
  };
}

/**
 * Parse Pump.fun buy/sell from Helius Geyser result. Returns normalized event or null.
 */
export function parsePumpFunTx(result: HeliusTxResult, copyWalletId: string): CopyTradeEvent | null {
  const message = result.transaction?.transaction?.message;
  const meta = result.transaction?.meta;
  if (!message?.accountKeys || !meta) return null;

  const accountKeys = message.accountKeys;
  const instructions = message.instructions || [];
  const innerInstructions = meta.innerInstructions || [];

  let buySellIxs: any[] = instructions.filter(
    (ix: any) => ix.programId === PUMP_FUN_PROGRAM_ID && ix.data
  );
  if (buySellIxs.length === 0) {
    const inner = innerInstructions.flatMap((i: any) => i.instructions || []);
    const match = inner.find(
      (ix: any) =>
        ix.programId === PUMP_FUN_PROGRAM_ID &&
        ix.accounts?.includes?.("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
    );
    if (match) buySellIxs = [match];
  }

  for (const ix of buySellIxs) {
    try {
      const ixData = base58.decode(ix.data);
      const disc = ixData.subarray(0, 8);
      if (!buyDiscriminator.equals(disc) && !sellDiscriminator.equals(disc)) continue;

      const decoded = tradeSchema.decode(ixData);
      const side = buyDiscriminator.equals(disc) ? "buy" : "sell";
      const mint = ix.accounts?.[2] ?? accountKeys[ix.accounts?.[2]]?.pubkey;
      const trader = ix.accounts?.[6] ?? accountKeys[ix.accounts?.[6]]?.pubkey;
      const bondingCurve = ix.accounts?.[3] ?? accountKeys[ix.accounts?.[3]]?.pubkey;
      if (!mint || !trader) continue;

      const mintStr = typeof mint === "string" ? mint : mint.toString();
      const traderStr = typeof trader === "string" ? trader : trader.toString();
      const bondingCurveStr = bondingCurve ? (typeof bondingCurve === "string" ? bondingCurve : bondingCurve.toString()) : undefined;

      const bondingCurveIndex = accountKeys.findIndex(
        (k: any) => (k.pubkey ?? k) === bondingCurveStr
      );
      const preBalances = meta.preBalances || [];
      const postBalances = meta.postBalances || [];
      const solLamports =
        bondingCurveIndex >= 0
          ? Math.abs((preBalances[bondingCurveIndex] ?? 0) - (postBalances[bondingCurveIndex] ?? 0))
          : 0;
      const decimals = 6;
      const tokenAmountRaw = Number(decoded.amount.toString());
      const tokenAmount = tokenAmountRaw / 10 ** decimals;
      const solAmount = solLamports / 1e9;
      const recentBlockhash = message.recentBlockhash;

      return {
        dex: "pumpfun",
        signature: result.signature,
        trader: traderStr,
        copyWalletId,
        side,
        mint: mintStr,
        solAmount,
        tokenAmount,
        decimals,
        bondingCurve: bondingCurveStr,
        recentBlockhash,
      };
    } catch {
      continue;
    }
  }
  return null;
}
