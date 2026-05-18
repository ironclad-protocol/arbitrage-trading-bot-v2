import dotenv from "dotenv";
import { Keypair } from "@solana/web3.js";
import base58 from "bs58";
import { Connection } from "@solana/web3.js";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
export const MAIN_KEYPAIR = PRIVATE_KEY ? Keypair.fromSecretKey(base58.decode(PRIVATE_KEY)) : null;

export const RPC_URL = process.env.RPC_MAINNET_URL ?? "";
export const HELIUS_GEYSER_WS = process.env.HELIUS_GEYSER_URL ?? "";

/** Copy trading: ratio of copied wallet's trade size (e.g. 0.1 = 10%). */
export const COPY_PERCENT = Number(process.env.COPY_PERCENT ?? "0.1");
/** Fixed SOL amount per copy buy (if > 0, overrides COPY_PERCENT for buys). */
export const COPY_FIXED_SOL = Number(process.env.COPY_FIXED_SOL ?? "0");

export const COMMITMENT = "processed" as const;
export const solConnection = new Connection(RPC_URL, { commitment: COMMITMENT });

// DEX program IDs
export const PUMP_FUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMP_AMM_SWAP_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const RAYDIUM_AMM_PROGRAM_ID = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
export const RAYDIUM_CPMM_PROGRAM_ID = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
/** Meteora DLMM - used to detect Pump AMM + other DEX arbitrage (WSOL -> token -> WSOL). */
export const METEORA_DLMM_PROGRAM_ID = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";

/** Program IDs that indicate a second swap leg (e.g. token -> WSOL). If tx has 1 Pump AMM swap + any of these, treat as arbitrage. */
export const ARBITRAGE_OTHER_DEX_IDS = new Set([
  METEORA_DLMM_PROGRAM_ID,
  RAYDIUM_AMM_PROGRAM_ID,
  RAYDIUM_CPMM_PROGRAM_ID,
]);


// Aggregator Program IDs
export const DFLOW_PROGRAM_ID = "DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH"
export const JUPITER_AGGREGATOR_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
export const OKX_LABS_PROGRAM_ID = "proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u"

// Execution
export const JITO_TIP_LAMPORTS = Number(process.env.JITO_TIP_SOL ?? "0.0001") * 1e9;
export const COMPUTE_UNIT_PRICE = Number(process.env.CU_PRICE ?? "500000");
export const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS ?? "500");

if (!MAIN_KEYPAIR || !RPC_URL || !HELIUS_GEYSER_WS) {
  console.warn("Missing PRIVATE_KEY, RPC_MAINNET_URL, or HELIUS_GEYSER_URL. Copy execution will be disabled.");
}
