import type { Commitment, Connection, Keypair, TransactionInstruction } from "@solana/web3.js";
import type { TxSubmitterId } from "../../config";
import { TX_SUBMITTER } from "../../config";
import { confirmTransactionSignature } from "./types";
import { addFeeIxAndSubmitTxViaNextBlock } from "./nextblock";
import { sendInstructionsViaHeliusSender } from "./helius-sender";
import { sendInstructionsViaAstralane } from "./astralane";
import { sendInstructionsViaZeroslot } from "./zeroslot";

export type { TxSubmitterId };

/**
 * Tip + sign + submit via Helius Sender, NextBlock, Astralane, or Zeroslot.
 * For **Jito**, use `sendBundleTxUsingJito` (bundle + separate tip tx).
 */
export async function submitAndConfirm(
  submitter: Exclude<TxSubmitterId, "jito">,
  payer: Keypair,
  instructions: TransactionInstruction[],
  recentBlockhash: string,
  connection: Connection,
  options?: {
    confirm?: boolean;
    commitment?: Commitment;
    astralaneMevProtect?: boolean;
  }
): Promise<{ signature: string; confirmed: boolean } | null> {
  let signature: string;

  switch (submitter) {
    case "nextblock": {
      const sig = await addFeeIxAndSubmitTxViaNextBlock(payer, instructions, {
        blockhash: recentBlockhash,
      });
      if (!sig) return null;
      signature = sig;
      break;
    }
    case "helius-sender": {
      signature = await sendInstructionsViaHeliusSender(
        payer,
        instructions,
        recentBlockhash
      );
      if (!signature) return null;
      break;
    }
    case "astralane": {
      signature = await sendInstructionsViaAstralane(
        payer,
        instructions,
        recentBlockhash,
        { mevProtect: options?.astralaneMevProtect }
      );
      if (!signature) return null;
      break;
    }
    case "zeroslot": {
      signature = await sendInstructionsViaZeroslot(
        payer,
        instructions,
        recentBlockhash
      );
      if (!signature) return null;
      break;
    }
    default:
      return null;
  }

  let confirmed = false;
  if (options?.confirm !== false) {
    const r = await confirmTransactionSignature(connection, signature, {
      commitment: options?.commitment,
    });
    confirmed = r.ok;
  }
  return { signature, confirmed };
}

/** Uses `TX_SUBMITTER` env when it is not `jito`; otherwise returns null (use Jito bundle API). */
export async function submitWithConfiguredSubmitter(
  payer: Keypair,
  instructions: TransactionInstruction[],
  recentBlockhash: string,
  connection: Connection,
  opts?: Parameters<typeof submitAndConfirm>[5]
): Promise<{ signature: string; confirmed: boolean } | null> {
  if (TX_SUBMITTER === "jito") {
    console.warn(
      "[tx-submitters] TX_SUBMITTER=jito: use sendBundleTxUsingJito from utils/tx-submitters/jito"
    );
    return null;
  }
  return submitAndConfirm(
    TX_SUBMITTER,
    payer,
    instructions,
    recentBlockhash,
    connection,
    opts
  );
}

export { sendBundleTxUsingJito } from "./jito";
export {
  submitSignedTxHeliusSender,
  sendInstructionsViaHeliusSender,
} from "./helius-sender";
export {
  submitSignedTxAstralane,
  sendInstructionsViaAstralane,
} from "./astralane";
export { submitSignedTxZeroslot, sendInstructionsViaZeroslot } from "./zeroslot";
export {
  addFeeIxAndSubmitTxViaNextBlock,
  submitTxViaNextBlock,
} from "./nextblock";
export {
  heliusSenderTipIx,
  astralaneTipIx,
  zeroslotTipIx,
  nextBlockTipIx,
} from "./tips";
export { confirmTransactionSignature } from "./types";
