import { LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { Keypair } from "@solana/web3.js";
import { searcherClient } from "jito-ts/dist/sdk/block-engine/searcher";
import { Bundle } from "jito-ts/dist/sdk/block-engine/types";
import {
  getJitoBlockEngine,
  JITO_FEE_AMOUNT,
  JITO_TIP_ACCOUNTS,
  SIMULATION_MODE,
  solConnection,
} from "../../config";

const searcher = searcherClient(getJitoBlockEngine(), undefined);

export async function sendBundleTxUsingJito(
  latestBlockhash: string,
  vTxs: VersionedTransaction[],
  wallet: Keypair,
  bundleNum: number
): Promise<string | null> {
  try {
    if (SIMULATION_MODE) {
      for (let i = 0; i < vTxs.length; i++) {
        const sim = await solConnection.simulateTransaction(vTxs[i]!);
        console.info(
          `[SIMULATION] Tx ${i + 1}/${vTxs.length}: err=${sim.value.err ?? "ok"} logs=${sim.value.logs?.length ?? 0}`
        );
      }
      return null;
    }
    const tipAccount = new PublicKey(JITO_TIP_ACCOUNTS[1]!);
    const tipAmount = JITO_FEE_AMOUNT * LAMPORTS_PER_SOL;
    const b = new Bundle(vTxs, bundleNum);
    b.addTipTx(wallet, tipAmount, tipAccount, latestBlockhash);
    const bundleResult = await searcher.sendBundle(b);
    const ts = new Date();
    const tf = `${ts.getHours().toString().padStart(2, "0")}:${ts.getMinutes().toString().padStart(2, "0")}:${ts.getSeconds().toString().padStart(2, "0")}.${ts.getMilliseconds().toString().padStart(3, "0")}`;
    if (!bundleResult.ok) {
      console.error("Jito sendBundle error:", bundleResult.error);
      return null;
    }
    const id = bundleResult.value;
    console.info(
      `Transaction sent via Jito - ${tf}: https://explorer.jito.wtf/bundle/${id}`
    );
    return id;
  } catch (error) {
    console.error(error);
    return null;
  }
}
