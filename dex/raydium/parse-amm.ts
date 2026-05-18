import base58 from "bs58";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { AccountLayout } from "@solana/spl-token";
import type { CopyTradeEvent } from "../../src/core/types";
import { RAYDIUM_AMM_PROGRAM_ID, solConnection } from "../../src/core/config";

const WSOL = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export interface HeliusTxResult {
  signature: string;
  transaction: { transaction: { message?: any }; meta: any };
}

function toPubkeyString(entry: any): string | null {
  if (entry == null) return null;
  if (typeof entry === "string") return entry;
  if (entry.pubkey) return entry.pubkey;
  return null;
}

function getFullAccountKeys(message: any, meta: any): string[] {
  const out: string[] = [];
  const keys = message?.accountKeys || [];
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

function resolveProgramId(ix: any, fullAccountKeys: string[]): string | null {
  const raw = ix.programId ?? ix.program;
  if (raw != null) {
    if (typeof raw === "number")
      return raw >= 0 && raw < fullAccountKeys.length ? fullAccountKeys[raw] ?? null : null;
    return toPubkeyString(raw) ?? null;
  }
  if (typeof ix.programIdIndex === "number")
    return ix.programIdIndex >= 0 && ix.programIdIndex < fullAccountKeys.length
      ? fullAccountKeys[ix.programIdIndex] ?? null
      : null;
  return null;
}

function resolveAccountKey(fullAccountKeys: string[], accounts: any[], index: number): string | null {
  if (accounts == null || index < 0 || index >= accounts.length) return null;
  const key = accounts[index];
  if (typeof key === "number")
    return key >= 0 && key < fullAccountKeys.length ? fullAccountKeys[key] ?? null : null;
  return toPubkeyString(key) ?? null;
}

function resolveKey(fullAccountKeys: string[], value: any): string | null {
  if (value == null) return null;
  if (typeof value === "number")
    return value >= 0 && value < fullAccountKeys.length ? fullAccountKeys[value] ?? null : null;
  return String(value);
}

function uiAmount(b: any): number {
  const u = b?.uiTokenAmount?.uiAmount;
  if (typeof u === "number") return u;
  const amt = b?.uiTokenAmount?.amount ?? b?.tokenAmount?.amount;
  if (amt == null) return 0;
  const dec = b?.uiTokenAmount?.decimals ?? b?.tokenAmount?.decimals ?? 6;
  return Number(amt) / Math.pow(10, dec);
}

async function getTokenAddressAndOwnerFromTokenAccount(
  tokenAccountAddress: string
): Promise<{ tokenAddress: string; ownerAddress: string } | null> {
  try {
    const accountInfo = await solConnection.getAccountInfo(new PublicKey(tokenAccountAddress));
    if (accountInfo == null) return null;
    const data = AccountLayout.decode(accountInfo.data);
    return {
      tokenAddress: new PublicKey(data.mint).toBase58(),
      ownerAddress: new PublicKey(data.owner).toBase58(),
    };
  } catch {
    return null;
  }
}

/** Normalize result: support encoded tx (base64) like pumpswap so message/accountKeys exist. */
function normalizePayload(result: HeliusTxResult): { message: any; meta: any } | null {
  const txContainer = result.transaction as { transaction?: any; message?: any; meta?: any };
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

function getDecimalsForMint(meta: any, mint: string): number {
  const pre = (meta.preTokenBalances || []).find((b: any) => b.mint === mint);
  const post = (meta.postTokenBalances || []).find((b: any) => b.mint === mint);
  return pre?.uiTokenAmount?.decimals ?? post?.uiTokenAmount?.decimals ?? 6;
}

/**
 * Try to parse swap from inner instructions (Token transfers). Matches parseRaydiumTransaction logic:
 * - Find Raydium AMM instruction, then inner block with matching index; or find Raydium ix inside an inner block.
 * - Use parsed Token transfer instructions for send/receive mints and amounts.
 */
async function parseFromInnerInstructions(
  result: HeliusTxResult,
  normalized: { message: any; meta: any },
  fullAccountKeys: string[],
  poolId: string
): Promise<CopyTradeEvent | null> {
  const { message, meta } = normalized;
  const instructions = message.instructions || [];
  const innerBlocks = meta.innerInstructions || [];

  const tryBlock = (instrs: any[]) => {
    if (instrs.length < 2) return null;
    const i0 = instrs[0];
    const i1 = instrs[1];
    const info0 = i0?.parsed?.info;
    const info1 = i1?.parsed?.info;
    if (!info0?.source || info0.destination == null || info0.amount == null) return null;
    if (!info1?.source || info1.destination == null || info1.amount == null) return null;
    return { info0, info1 };
  };

  for (let i = 0; i < instructions.length; i++) {
    if (resolveProgramId(instructions[i], fullAccountKeys) !== RAYDIUM_AMM_PROGRAM_ID) continue;
    for (let j = 0; j < innerBlocks.length; j++) {
      const block = innerBlocks[j];
      if (block.index !== i) continue;
      const instrs = block.instructions || [];
      const out = tryBlock(instrs);
      if (!out) continue;
      const { info0: i0, info1: i1 } = out;
      const sendAccount = resolveKey(fullAccountKeys, i0.destination);
      const receiveAccount = resolveKey(fullAccountKeys, i1.source);
      const sourceAccount = resolveKey(fullAccountKeys, i0.source);
      if (!sendAccount || !receiveAccount || !sourceAccount) continue;
      const [sendData, receiveData, source0Data] = await Promise.all([
        getTokenAddressAndOwnerFromTokenAccount(sendAccount),
        getTokenAddressAndOwnerFromTokenAccount(receiveAccount),
        getTokenAddressAndOwnerFromTokenAccount(sourceAccount),
      ]);
      if (!sendData || !receiveData || !source0Data) continue;
      const owner0 = source0Data.ownerAddress;
      const owner1 = receiveData.ownerAddress;
      const feePayer = fullAccountKeys[0] ?? "";
      const instr0IsUserSend = owner0 === feePayer;
      const instr1IsUserSend = owner1 === feePayer;
      if (instr0IsUserSend === instr1IsUserSend) continue;
      const trader = instr0IsUserSend ? owner0 : owner1;
      const sendToken = instr0IsUserSend ? sendData.tokenAddress : receiveData.tokenAddress;
      const receiveToken = instr0IsUserSend ? receiveData.tokenAddress : sendData.tokenAddress;
      const sendAmountRaw = instr0IsUserSend ? Number(i0.amount) : Number(i1.amount);
      const receiveAmountRaw = instr0IsUserSend ? Number(i1.amount) : Number(i0.amount);
      const sendDecimals = sendToken === WSOL ? 9 : getDecimalsForMint(meta, sendToken);
      const receiveDecimals = receiveToken === WSOL ? 9 : getDecimalsForMint(meta, receiveToken);
      let side: "buy" | "sell";
      let mint: string;
      let solAmount: number;
      let tokenAmount: number;
      let decimals: number;
      if (sendToken === WSOL) {
        side = "buy";
        mint = receiveToken;
        solAmount = sendAmountRaw / 1e9;
        tokenAmount = receiveAmountRaw / Math.pow(10, receiveDecimals);
        decimals = receiveDecimals;
      } else if (receiveToken === WSOL) {
        side = "sell";
        mint = sendToken;
        solAmount = receiveAmountRaw / 1e9;
        tokenAmount = sendAmountRaw / Math.pow(10, sendDecimals);
        decimals = sendDecimals;
      } else {
        continue;
      }
      if (solAmount <= 0 || tokenAmount <= 0) continue;
      return {
        dex: "raydium-amm",
        signature: result.signature,
        trader,
        copyWalletId: trader,
        side,
        mint,
        solAmount,
        tokenAmount,
        decimals,
        poolId,
        recentBlockhash: message.recentBlockhash,
      };
    }
  }

  for (let i = 0; i < innerBlocks.length; i++) {
    const instrs = innerBlocks[i].instructions || [];
    for (let j = 0; j < instrs.length; j++) {
      if (resolveProgramId(instrs[j], fullAccountKeys) !== RAYDIUM_AMM_PROGRAM_ID) continue;
      if (j + 2 >= instrs.length) continue;
      const next0 = instrs[j + 1];
      const next1 = instrs[j + 2];
      const info0 = next0?.parsed?.info;
      const info1 = next1?.parsed?.info;
      if (!info0?.destination || !info1?.source || info0.amount == null || info1.amount == null) continue;
      const sendAccount = resolveKey(fullAccountKeys, info0.destination);
      const receiveAccount = resolveKey(fullAccountKeys, info1.source);
      const sourceAccount = resolveKey(fullAccountKeys, info0.source);
      if (!sendAccount || !receiveAccount || !sourceAccount) continue;
      const [sendData, receiveData, source0Data] = await Promise.all([
        getTokenAddressAndOwnerFromTokenAccount(sendAccount),
        getTokenAddressAndOwnerFromTokenAccount(receiveAccount),
        getTokenAddressAndOwnerFromTokenAccount(sourceAccount),
      ]);
      if (!sendData || !receiveData || !source0Data) continue;
      const owner0 = source0Data.ownerAddress;
      const owner1 = receiveData.ownerAddress;
      const feePayer = fullAccountKeys[0] ?? "";
      const instr0IsUserSend = owner0 === feePayer;
      const instr1IsUserSend = owner1 === feePayer;
      if (instr0IsUserSend === instr1IsUserSend) continue;
      const trader = instr0IsUserSend ? owner0 : owner1;
      const sendToken = instr0IsUserSend ? sendData.tokenAddress : receiveData.tokenAddress;
      const receiveToken = instr0IsUserSend ? receiveData.tokenAddress : sendData.tokenAddress;
      const sendAmountRaw = instr0IsUserSend ? Number(info0.amount) : Number(info1.amount);
      const receiveAmountRaw = instr0IsUserSend ? Number(info1.amount) : Number(info0.amount);
      const sendDecimals = sendToken === WSOL ? 9 : getDecimalsForMint(meta, sendToken);
      const receiveDecimals = receiveToken === WSOL ? 9 : getDecimalsForMint(meta, receiveToken);
      let side: "buy" | "sell";
      let mint: string;
      let solAmount: number;
      let tokenAmount: number;
      let decimals: number;
      if (sendToken === WSOL) {
        side = "buy";
        mint = receiveToken;
        solAmount = sendAmountRaw / 1e9;
        tokenAmount = receiveAmountRaw / Math.pow(10, receiveDecimals);
        decimals = receiveDecimals;
      } else if (receiveToken === WSOL) {
        side = "sell";
        mint = sendToken;
        solAmount = receiveAmountRaw / 1e9;
        tokenAmount = sendAmountRaw / Math.pow(10, sendDecimals);
        decimals = sendDecimals;
      } else {
        continue;
      }
      if (solAmount <= 0 || tokenAmount <= 0) continue;
      return {
        dex: "raydium-amm",
        signature: result.signature,
        trader,
        copyWalletId: trader,
        side,
        mint,
        solAmount,
        tokenAmount,
        decimals,
        poolId,
        recentBlockhash: message.recentBlockhash,
      };
    }
  }
  return null;
}

/** Fallback: derive swap from pre/post token balance deltas. */
function parseFromBalanceDeltas(
  result: HeliusTxResult,
  normalized: { message: any; meta: any },
  fullAccountKeys: string[],
  poolId: string
): CopyTradeEvent | null {
  const { message, meta } = normalized;
  const preBalances = meta.preTokenBalances || [];
  const postBalances = meta.postTokenBalances || [];

  function ownerStr(b: any): string | null {
    const o = b.owner ?? b.accountOwner;
    if (o == null) return null;
    if (typeof o === "number")
      return o >= 0 && o < fullAccountKeys.length ? fullAccountKeys[o] ?? null : null;
    return String(o);
  }

  const ownerSet = new Set<string>();
  for (const b of preBalances) {
    const o = ownerStr(b);
    if (o) ownerSet.add(o);
  }
  for (const b of postBalances) {
    const o = ownerStr(b);
    if (o) ownerSet.add(o);
  }

  for (const owner of ownerSet) {
    const preWsol = preBalances.find((b: any) => ownerStr(b) === owner && b.mint === WSOL);
    const postWsol = postBalances.find((b: any) => ownerStr(b) === owner && b.mint === WSOL);
    const preOther = preBalances.filter((b: any) => ownerStr(b) === owner && b.mint !== WSOL);
    const postOther = postBalances.filter((b: any) => ownerStr(b) === owner && b.mint !== WSOL);

    const wsolPre = preWsol != null ? uiAmount(preWsol) : 0;
    const wsolPost = postWsol != null ? uiAmount(postWsol) : 0;
    const wsolDelta = wsolPost - wsolPre;

    const otherMints = new Set<string>([...preOther.map((b: any) => b.mint), ...postOther.map((b: any) => b.mint)]);
    if (otherMints.size === 0) continue;

    for (const nonWsolMint of otherMints) {
      if (nonWsolMint === WSOL) continue;
      const preO = preOther.find((b: any) => b.mint === nonWsolMint);
      const postO = postOther.find((b: any) => b.mint === nonWsolMint);
      const otherPre = preO != null ? uiAmount(preO) : 0;
      const otherPost = postO != null ? uiAmount(postO) : 0;
      const otherDelta = otherPost - otherPre;
      const decimals = preO?.uiTokenAmount?.decimals ?? postO?.uiTokenAmount?.decimals ?? 6;

      let side: "buy" | "sell";
      let solAmount: number;
      let tokenAmount: number;

      if (otherDelta > 0 && wsolDelta < 0) {
        side = "sell";
        solAmount = Math.abs(wsolDelta);
        tokenAmount = otherDelta;
      } else if (otherDelta < 0 && wsolDelta > 0) {
        side = "buy";
        solAmount = wsolDelta;
        tokenAmount = Math.abs(otherDelta);
      } else {
        continue;
      }

      if (solAmount <= 0 || tokenAmount <= 0) continue;

      return {
        dex: "raydium-amm",
        signature: result.signature,
        trader: owner,
        copyWalletId: owner,
        side,
        mint: nonWsolMint,
        solAmount,
        tokenAmount,
        decimals,
        poolId,
        recentBlockhash: message.recentBlockhash,
      };
    }
  }
  return null;
}

/**
 * Parse Raydium AMM swap (buy/sell). Uses inner-instruction Token transfers (parsed) when available,
 * then falls back to pre/post token balance deltas. Returns CopyTradeEvent or null.
 */
export async function parseRaydiumAmmTx(
  result: HeliusTxResult,
  _copyWalletId: string
): Promise<CopyTradeEvent | null> {
  try {
    const normalized = normalizePayload(result);
    if (!normalized) return null;
    const { message, meta } = normalized;

    const fullAccountKeys = getFullAccountKeys(message, meta);
    if (fullAccountKeys.length === 0) return null;

    const instructions = message.instructions || [];
    const innerFlat = (meta.innerInstructions || []).flatMap((i: any) => i.instructions || []);
    const allIxs = [...instructions, ...innerFlat];

    const raydiumIxs = allIxs.filter(
      (ix: any) => resolveProgramId(ix, fullAccountKeys) === RAYDIUM_AMM_PROGRAM_ID
    );
    if (raydiumIxs.length === 0) return null;

    const raydiumIx = raydiumIxs[0];
    const accounts = raydiumIx.accounts ?? raydiumIx.accountKeys ?? [];
    const poolId = resolveAccountKey(fullAccountKeys, accounts, 0) ?? null;
    if (!poolId) return null;

    const fromInner = await parseFromInnerInstructions(result, normalized, fullAccountKeys, poolId);
    if (fromInner) return fromInner;

    return parseFromBalanceDeltas(result, normalized, fullAccountKeys, poolId);
  } catch {
    return null;
  }
}
