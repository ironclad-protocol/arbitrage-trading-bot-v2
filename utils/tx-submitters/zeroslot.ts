import type { Keypair, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { TransactionMessage, VersionedTransaction as VTx } from "@solana/web3.js";
import {
  ZEROSLOT_API_KEY,
  ZEROSLOT_URL,
  SIMULATION_MODE,
  solConnection,
} from "../../config";
import { solanaRpcSendTransaction } from "./jsonrpc";
import { zeroslotTipIx } from "./tips";

function endpoint(): string {
  if (!ZEROSLOT_API_KEY) {
    throw new Error("ZEROSLOT_API_KEY is not set");
  }
  const u = new URL(ZEROSLOT_URL);
  u.searchParams.set("api-key", ZEROSLOT_API_KEY);
  return u.toString();
}

export async function submitSignedTxZeroslot(tx: VersionedTransaction): Promise<string> {
  if (SIMULATION_MODE) {
    const sim = await solConnection.simulateTransaction(tx, {
      replaceRecentBlockhash: true,
    });
    console.info("[zeroslot][SIM] err=", sim.value.err ?? "ok");
    return "";
  }
  const b64 = Buffer.from(tx.serialize()).toString("base64");
  return solanaRpcSendTransaction(endpoint(), b64, {
    skipPreflight: false,
  });
}

export async function sendInstructionsViaZeroslot(
  payer: Keypair,
  instructions: TransactionInstruction[],
  recentBlockhash: string
): Promise<string> {
  const ixs = [zeroslotTipIx(payer.publicKey), ...instructions];
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VTx(msg);
  tx.sign([payer]);
  return submitSignedTxZeroslot(tx);
}
