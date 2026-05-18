import base58 from "bs58";
import * as borsh from "@coral-xyz/borsh";
import { VersionedTransaction } from "@solana/web3.js";
import type { CopyTradeEvent } from "../../src/core/types";
import { PUMP_AMM_SWAP_PROGRAM_ID, ARBITRAGE_OTHER_DEX_IDS } from "../../src/core/config";

const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
const BUY_EXACT_QUOTE_IN_DISCRIMINATOR = Buffer.from([198, 46, 21, 82, 180, 217, 232, 112]);
const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);
const SELL_EXACT_BASE_IN_DISCRIMINATOR = Buffer.from([116, 232, 182, 230, 194, 174, 30, 95]);

const BUY_DISCRIMINATORS = [BUY_DISCRIMINATOR, BUY_EXACT_QUOTE_IN_DISCRIMINATOR];
const SELL_DISCRIMINATORS = [SELL_DISCRIMINATOR, SELL_EXACT_BASE_IN_DISCRIMINATOR];

function isBuyDiscriminator(disc: Buffer): boolean {
  return BUY_DISCRIMINATORS.some((d) => d.equals(disc));
}
function isSellDiscriminator(disc: Buffer): boolean {
  return SELL_DISCRIMINATORS.some((d) => d.equals(disc));
}

const argsSchema = borsh.struct([borsh.u64("a"), borsh.u64("b")]);

const NATIVE_MINT = "So11111111111111111111111111111111111111112";

function getWsolBalanceChange(meta: any, user: string): number | null {
  const pre = (meta.preTokenBalances || []).find(
    (b: any) => b.owner === user && b.mint === NATIVE_MINT
  );
  const post = (meta.postTokenBalances || []).find(
    (b: any) => b.owner === user && b.mint === NATIVE_MINT
  );
  if (!pre || !post) return null;
  const preVal = pre.uiTokenAmount?.uiAmount ?? Number(pre.uiTokenAmount?.amount ?? 0) / 1e9;
  const postVal = post.uiTokenAmount?.uiAmount ?? Number(post.uiTokenAmount?.amount ?? 0) / 1e9;
  return postVal - preVal;
}

/** Actual SOL received for a sell (user's WSOL balance increase). */
function getSellSolAmountFromBalances(meta: any, user: string): number | null {
  const delta = getWsolBalanceChange(meta, user);
  return delta != null && delta > 0 ? delta : null;
}

/** Actual SOL spent for a buy (user's WSOL balance decrease). */
function getBuySolAmountFromBalances(meta: any, user: string): number | null {
  const delta = getWsolBalanceChange(meta, user);
  return delta != null && delta < 0 ? -delta : null;
}

export interface HeliusTxResult {
  signature: string;
  transaction: {
    transaction: { message: any };
    meta: any;
  };
}

/** Normalize account entry to pubkey string. */
function toPubkeyString(entry: any): string | null {
  if (entry == null) return null;
  if (typeof entry === "string") return entry;
  if (entry.pubkey) return entry.pubkey;
  return null;
}

/** Build full account key list (message.accountKeys + loadedAddresses) for index resolution. */
function getFullAccountKeys(message: any, meta: any): string[] {
  const out: string[] = [];
  const keys = message.accountKeys || [];
  for (const k of keys) {
    const s = toPubkeyString(k);
    if (s) out.push(s);
  }
  const loaded = meta?.loadedAddresses;
  if (loaded) {
    for (const a of loaded.writable || []) out.push(toPubkeyString(a) ?? "");
    for (const a of loaded.readonly || []) out.push(toPubkeyString(a) ?? "");
  }
  return out;
}

function resolveAccountKey(fullAccountKeys: string[], accounts: any[], index: number): string | null {
  if (index < 0 || index >= (accounts?.length ?? 0)) return null;
  const key = accounts[index];
  if (typeof key === "number") {
    if (key < 0 || key >= fullAccountKeys.length) return null;
    return fullAccountKeys[key] || null;
  }
  return toPubkeyString(key);
}

/** Extract raw instruction data. RPC/Geyser use base58 for instruction data; fallback to base64. */
function getInstructionData(ix: any): Buffer | null {
  if (ix.data == null) return null;
  if (typeof ix.data !== "string") return null;
  const s = ix.data;
  try {
    const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(s) && s.length % 4 !== 1;
    let buf: Buffer;
    if (isBase64) {
      buf = Buffer.from(s, "base64");
      if (buf.length < 8) return null;
      const disc = buf.subarray(0, 8);
      if (!isBuyDiscriminator(disc) && !isSellDiscriminator(disc)) {
        try {
          buf = Buffer.from(base58.decode(s));
        } catch {
          return null;
        }
      }
    } else {
      buf = Buffer.from(base58.decode(s));
    }
    return buf.length >= 24 ? buf : null;
  } catch {
    return null;
  }
}

/** Resolve instruction programId to string (handles programIdIndex for unparsed / inner instructions). */
function resolveProgramId(ix: any, fullAccountKeys: string[]): string | null {
  const raw = ix.programId ?? ix.program;
  if (raw !== undefined && raw !== null) {
    if (typeof raw === "number") {
      if (raw >= 0 && raw < fullAccountKeys.length) return fullAccountKeys[raw] ?? null;
      return null;
    }
    return toPubkeyString(raw) ?? null;
  }
  if (typeof ix.programIdIndex === "number") {
    if (ix.programIdIndex >= 0 && ix.programIdIndex < fullAccountKeys.length) {
      return fullAccountKeys[ix.programIdIndex] ?? null;
    }
  }
  return null;
}

/**
 * When Geyser sends encoded tx (transaction.transaction = [base64, "base64"]), deserialize and
 * return { message: { accountKeys, instructions: [] }, meta }. We use meta.innerInstructions for instructions.
 */
function normalizeTransactionPayload(result: HeliusTxResult): { message: any; meta: any } | null {
  const txContainer = result.transaction as {
    transaction?: any;
    message?: any;
    meta?: any;
  };
  const meta = txContainer?.meta;
  let message = txContainer?.message ?? txContainer?.transaction?.message;

  if (message?.accountKeys && meta) return { message, meta };

  const raw = txContainer?.transaction;
  if (Array.isArray(raw) && raw.length >= 1 && meta) {
    try {
      const enc = raw[1] === "base64" ? "base64" : "base58";
      const bytes = enc === "base64" ? Buffer.from(raw[0], "base64") : Buffer.from(base58.decode(raw[0]));
      const vtx = VersionedTransaction.deserialize(bytes);
      const msg = vtx.message;
      const staticKeys = msg.staticAccountKeys.map((k: any) => (typeof k === "string" ? k : k.toBase58?.() ?? String(k)));
      const loaded = meta.loadedAddresses;
      const writable = (loaded?.writable || []).map((a: any) => (typeof a === "string" ? a : a?.pubkey ?? String(a)));
      const readonly_ = (loaded?.readonly || []).map((a: any) => (typeof a === "string" ? a : a?.pubkey ?? String(a)));
      message = {
        accountKeys: [...staticKeys, ...writable, ...readonly_],
        instructions: [],
        recentBlockhash: msg.recentBlockhash,
      };
      return { message, meta };
    } catch {
      return null;
    }
  }
  return message?.accountKeys && meta ? { message, meta } : null;
}

/**
 * Parse Pump AMM (Pump Swap) buy/sell from Helius Geyser result. Returns normalized CopyTradeEvent or null.
 * - Exactly 1 swap instruction → parse and return (copy this trade).
 * - 0 swaps → return null.
 * - 2+ swaps → treat as arbitrage, ignore (return null).
 */
export function parsePumpAmmSwapTx(result: HeliusTxResult, copyWalletId: string): CopyTradeEvent | null {
  const normalized = normalizeTransactionPayload(result);
  if (!normalized) return null;
  const { message, meta } = normalized;

  const fullAccountKeys = getFullAccountKeys(message, meta);
  const instructions = message.instructions || [];
  const innerInstructions = meta.innerInstructions || [];

  const programIdStr =
    typeof PUMP_AMM_SWAP_PROGRAM_ID === "string"
      ? PUMP_AMM_SWAP_PROGRAM_ID
      : (PUMP_AMM_SWAP_PROGRAM_ID as any).toBase58?.() ?? String(PUMP_AMM_SWAP_PROGRAM_ID);

  const allIxs: any[] = [
    ...instructions,
    ...innerInstructions.flatMap((i: any) => i.instructions || []),
  ];

  const swapIxs: { ix: any; rawData: Buffer; decoded: { a: bigint; b: bigint }; side: "buy" | "sell"; accounts: any[] }[] = [];

  for (const ix of allIxs) {
    const resolvedProgramId = resolveProgramId(ix, fullAccountKeys);
    if (resolvedProgramId !== programIdStr) continue;

    const rawData = getInstructionData(ix);
    if (!rawData || rawData.length < 24) continue;

    try {
      const disc = rawData.subarray(0, 8);
      const isBuy = isBuyDiscriminator(disc);
      const isSell = isSellDiscriminator(disc);
      if (!isBuy && !isSell) continue;

      const decoded = argsSchema.decode(rawData.subarray(8));
      const side = isBuy ? "buy" : "sell";
      const accounts = ix.accounts ?? ix.accountKeys ?? [];
      const pool = resolveAccountKey(fullAccountKeys, accounts, 0);
      const user = resolveAccountKey(fullAccountKeys, accounts, 1);
      const baseMint = resolveAccountKey(fullAccountKeys, accounts, 3);
      if (!pool || !user || !baseMint) continue;

      swapIxs.push({ ix, rawData, decoded, side, accounts });
    } catch {
      continue;
    }
  }

  if (swapIxs.length !== 1) return null;

  for (const ix of allIxs) {
    const resolved = resolveProgramId(ix, fullAccountKeys);
    if (resolved && ARBITRAGE_OTHER_DEX_IDS.has(resolved)) {
      return null;
    }
  }

  const { decoded, side, accounts } = swapIxs[0];
  const getAcc = (idx: number) => resolveAccountKey(fullAccountKeys, accounts, idx);
  const pool = getAcc(0)!;
  const user = getAcc(1)!;
  const baseMint = getAcc(3)!;
  const decimals = 6;
  const tokenAmount = Number(decoded.a) / 10 ** decimals;
  let solAmount = Number(decoded.b) / 1e9;
  if (side === "sell") {
    const actualSol = getSellSolAmountFromBalances(meta, user);
    if (actualSol != null) solAmount = actualSol;
  } else {
    const actualSol = getBuySolAmountFromBalances(meta, user);
    if (actualSol != null) solAmount = actualSol;
  }
  const recentBlockhash = message.recentBlockhash;

  const event: CopyTradeEvent = {
    dex: "pumpswap",
    signature: result.signature,
    trader: user,
    copyWalletId,
    side,
    mint: baseMint,
    solAmount,
    tokenAmount,
    decimals,
    poolId: pool,
    recentBlockhash,
  };
  console.log("[pumpswap] parsed", result.signature, side, baseMint, "sol:", solAmount, "tokens:", tokenAmount);
  return event;
}