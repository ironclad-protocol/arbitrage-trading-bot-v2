import type { Keypair, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { TransactionMessage, VersionedTransaction as VTx } from "@solana/web3.js";
import {
  ASTRALANE_API_KEY,
  ASTRALANE_IRIS_BASE,
  SIMULATION_MODE,
  solConnection,
} from "../../config";
import { solanaRpcSendTransaction } from "./jsonrpc";
import { astralaneTipIx } from "./tips";

function irisUrl(mevProtect = false, swqosOnly = false): string {
  const u = new URL(ASTRALANE_IRIS_BASE);
  u.searchParams.set("api-key", ASTRALANE_API_KEY);
  if (mevProtect) u.searchParams.set("mev-protect", "true");
  if (swqosOnly) u.searchParams.set("swqos-only", "true");
  return u.toString();
}

export async function submitSignedTxAstralane(
  tx: VersionedTransaction,
  options?: { mevProtect?: boolean }
): Promise<string> {
  if (!ASTRALANE_API_KEY) {
    throw new Error("ASTRALANE_API_KEY is not set");
  }
  if (SIMULATION_MODE) {
    const sim = await solConnection.simulateTransaction(tx, {
      replaceRecentBlockhash: true,
    });
    console.info("[astralane][SIM] err=", sim.value.err ?? "ok");
    return "";
  }
  const b64 = Buffer.from(tx.serialize()).toString("base64");
  const mevProtect = options?.mevProtect ?? false;
  return solanaRpcSendTransaction(irisUrl(mevProtect), b64, {
    skipPreflight: true,
    extraParams: [{ mevProtect }],
  });
}

export async function sendInstructionsViaAstralane(
  payer: Keypair,
  instructions: TransactionInstruction[],
  recentBlockhash: string,
  options?: { mevProtect?: boolean }
): Promise<string> {
  const ixs = [...instructions, astralaneTipIx(payer.publicKey)];
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VTx(msg);
  tx.sign([payer]);
  return submitSignedTxAstralane(tx, options);
}
