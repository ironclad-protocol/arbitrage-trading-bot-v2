import axios from "axios";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  type TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import type { Keypair } from "@solana/web3.js";
import {
  getNextBlockSubmitEndpoint,
  NEXTBLOCK_AUTH_KEYS,
  NEXTBLOCK_FEE_AMOUNT,
  NEXTBLOCK_TIP_ACCOUNTS,
  SIMULATION_MODE,
  solConnection,
} from "../../config";
import { getRandomElement } from "../utils";

function authHeader(): string {
  return getRandomElement(NEXTBLOCK_AUTH_KEYS);
}

/**
 * Append NextBlock tip, compile v0, sign, POST to NextBlock submit API.
 */
export async function addFeeIxAndSubmitTxViaNextBlock(
  payer: Keypair,
  instructions: TransactionInstruction[],
  latestBlockhash: { blockhash: string }
): Promise<string | null> {
  try {
    const ixs = [
      ...instructions,
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: new PublicKey(NEXTBLOCK_TIP_ACCOUNTS[0]!),
        lamports: NEXTBLOCK_FEE_AMOUNT * LAMPORTS_PER_SOL,
      }),
    ];
    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      instructions: ixs,
      recentBlockhash: latestBlockhash.blockhash,
    }).compileToV0Message();
    const verTx = new VersionedTransaction(messageV0);
    verTx.sign([payer]);
    if (SIMULATION_MODE) {
      const sim = await solConnection.simulateTransaction(verTx, {
        replaceRecentBlockhash: true,
      });
      console.info("[nextblock][SIM] err=", sim.value.err ?? "ok");
      return null;
    }
    return submitTxViaNextBlock(verTx);
  } catch {
    return null;
  }
}

export async function submitTxViaNextBlock(
  verTx: VersionedTransaction
): Promise<string | null> {
  try {
    const txbase64Payload = Buffer.from(verTx.serialize()).toString("base64");
    const res = await axios.post(
      getNextBlockSubmitEndpoint(),
      {
        transaction: { content: txbase64Payload, isCleanup: false },
        frontRunningProtection: false,
        useStakedRPCs: true,
      },
      {
        headers: {
          Authorization: authHeader(),
          "Content-Type": "application/json",
        },
      }
    );
    const txid = res.data.signature as string;
    console.log(`Transaction sent via NextBlock: https://solscan.io/tx/${txid}`);
    return txid;
  } catch (error) {
    console.log("Error sending transaction via NextBlock:", error);
    return null;
  }
}
