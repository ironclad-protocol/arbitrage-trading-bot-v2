import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  HELIUS_SENDER_TIP_ACCOUNTS,
  HELIUS_SENDER_TIP_SOL,
  ASTRALANE_TIP_ACCOUNTS,
  ASTRALANE_TIP_SOL,
  ZEROSLOT_TIP_ACCOUNTS,
  ZEROSLOT_TIP_SOL,
  NEXTBLOCK_TIP_ACCOUNTS,
  NEXTBLOCK_FEE_AMOUNT,
} from "../../config";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function heliusSenderTipIx(
  payer: PublicKey,
  tipSol: number = HELIUS_SENDER_TIP_SOL
): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: new PublicKey(pick(HELIUS_SENDER_TIP_ACCOUNTS)),
    lamports: Math.floor(tipSol * LAMPORTS_PER_SOL),
  });
}

export function astralaneTipIx(
  payer: PublicKey,
  tipSol: number = ASTRALANE_TIP_SOL
): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: new PublicKey(pick(ASTRALANE_TIP_ACCOUNTS)),
    lamports: Math.max(10_000, Math.floor(tipSol * LAMPORTS_PER_SOL)),
  });
}

export function zeroslotTipIx(
  payer: PublicKey,
  tipSol: number = ZEROSLOT_TIP_SOL
): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: new PublicKey(pick(ZEROSLOT_TIP_ACCOUNTS)),
    lamports: Math.floor(tipSol * LAMPORTS_PER_SOL),
  });
}

export function nextBlockTipIx(payer: PublicKey): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: new PublicKey(NEXTBLOCK_TIP_ACCOUNTS[0]!),
    lamports: NEXTBLOCK_FEE_AMOUNT * LAMPORTS_PER_SOL,
  });
}
