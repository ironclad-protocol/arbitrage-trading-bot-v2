import type { Keypair, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { TransactionMessage, VersionedTransaction as VTx } from "@solana/web3.js";
import { HELIUS_SENDER_URL, SIMULATION_MODE, solConnection } from "../../config";
import { solanaRpcSendTransaction } from "./jsonrpc";
import { heliusSenderTipIx } from "./tips";

/**
 * Submit a **signed** tx that already includes Helius Sender tip + compute budget (per docs).
 */
export async function submitSignedTxHeliusSender(
  tx: VersionedTransaction
): Promise<string> {
  if (SIMULATION_MODE) {
    const sim = await solConnection.simulateTransaction(tx, {
      replaceRecentBlockhash: true,
    });
    console.info("[helius-sender][SIM] err=", sim.value.err ?? "ok");
    return "";
  }
  const b64 = Buffer.from(tx.serialize()).toString("base64");
  return solanaRpcSendTransaction(HELIUS_SENDER_URL, b64, {
    skipPreflight: true,
    maxRetries: 0,
  });
}

/**
 * Append Sender tip ix, build v0, sign, submit via `https://sender.helius-rpc.com/fast`.
 * Your `instructions` should already include compute budget (CU limit + price) per Helius docs.
 */
export async function sendInstructionsViaHeliusSender(
  payer: Keypair,
  instructions: TransactionInstruction[],
  recentBlockhash: string
): Promise<string> {
  const ixs = [...instructions, heliusSenderTipIx(payer.publicKey)];
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VTx(msg);
  tx.sign([payer]);
  return submitSignedTxHeliusSender(tx);
}
