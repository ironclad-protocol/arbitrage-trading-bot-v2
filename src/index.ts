/**
 * Fast multi-wallet copy trading pipeline:
 * Stream (Helius) → Parse (by DEX) → Queue → Executor (non-blocking).
 * Supports: Pump.fun, Pump AMM Swap, Raydium AMM/CPMM (parsers/executors pluggable).
 */
import { subscribeToAccounts } from "./stream/helius-geyser";
import { routeAndParse } from "./parsers/router";
import { enqueue, setExecutor } from "./queue/trade-queue";
import { executeCopyTrade } from "./executors/copy-executor";
import { HELIUS_GEYSER_WS } from "./core/config";
import { readDataJson } from "../utils/utils";
import { jupiterSwapSolForToken, jupiterSwapToken } from "../dex/jupiter";
import { MAIN_KP } from "../config";
import { SIMULATION_MODE } from "../config";
import { PublicKey } from "@solana/web3.js";
import { buyPumpFunTokenByRacing, sellPumpFunTokenByRacing } from "../dex/pumpfun/swap";
import { buyPumpAmmTokenByRacing, sellPumpAmmTokenByRacing } from "../dex/pumpswap";
import chalks from "chalks-log"

async function main() {
  console.log(chalks.green("Running the Bot..."));
  console.log(chalks.green("MAIN_KP wallet:", MAIN_KP.publicKey.toBase58()));

  // In simulation mode, stop after a clean sim run.
  if (SIMULATION_MODE) return;

  const copyWallets: string[] = Object.keys(await readDataJson("copyWallets.json"));
  if (copyWallets.length === 0) {
    console.error("No copy wallets in copyWallets.json. Add addresses as keys.");
    process.exit(1);
  }

  setExecutor(executeCopyTrade);

  const ws = subscribeToAccounts(HELIUS_GEYSER_WS, copyWallets, async (result) => {
    const event = await routeAndParse(result, copyWallets);
    if (event) {
      enqueue(event);
    }
  });

  ws.on("open", () => console.log("[copy] Geyser connected, watching", copyWallets.length, "wallets"));
  ws.on("error", (err) => console.error("[copy] Geyser error", err));
  ws.on("close", () => console.log("[copy] Geyser closed"));

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
