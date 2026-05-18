import { Connection } from "@solana/web3.js";
import dotenv from 'dotenv';
import base58 from 'bs58'
import { Keypair } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { PumpFunSDK } from "../dex/pumpfun/sdk/pumpfun";
import { PublicKey } from "@solana/web3.js";
import pumpSwapIdl from "../dex/pumpswap/idl/pump-swap.json";
import type { PumpAmmIDL } from "../dex/pumpswap/idl/pump-swap";

dotenv.config();

export const PRIVATE_KEY = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY : ''
export const MAIN_KP = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))


// Default to Helius in this environment (public Solana RPC can be blocked by sandbox policy).
export const RPC_MAINNET_URL = process.env.RPC_MAINNET_URL
  ? process.env.RPC_MAINNET_URL
  : "https://mainnet.helius-rpc.com/?api-key=cf0c20ed-123f-4bb3-9118-7a1a3ad0022c";
export const RPC_DEVNET_URL = process.env.RPC_DEVNET_URL ? process.env.RPC_DEVNET_URL : 'https://devnet.helius-rpc.com/?api-key=cf0c20ed-123f-4bb3-9118-7a1a3ad0022c'
export const HELIUS_GEYSER_URL = process.env.HELIUS_GEYSER_URL ? process.env.HELIUS_GEYSER_URL : ''

export const solConnection = new Connection(RPC_MAINNET_URL, { commitment: "processed" })
export const heliusSolConnection = new Connection(RPC_MAINNET_URL, { commitment: "processed" })

export const confirmedSolanaConnection = new Connection(RPC_MAINNET_URL, { commitment: "confirmed" })

// copy trading
export const IS_BUY_ONCE: boolean = true;
export const COPY_PERCENT = 0.1;
export const Copy_Buy_FixedAmount: number = 0;

/** When true, transactions are only simulated and never sent/confirmed on-chain. */
// export const SIMULATION_MODE: boolean = process.env.SIMULATION_MODE === "true" || process.env.SIMULATION_MODE === "1"; 
export const SIMULATION_MODE: boolean = false; 

// fee setting
export const NEXTBLOCK_FEE_AMOUNT = 0.001
export const JITO_FEE_AMOUNT = 0.0001

export const BUY_SLIPPAGE = 7
export const SELL_SLIPPAGE = 100

export const NEXTBLOCK_AUTH_KEYS = [
  'trial1742460478-LAcNVE7T0LE5kDhfUZCsBRBoZoB0YSG8SgkGGy9byG8%3D',
  'trial1738256584-RWugVM0ngucwVUiV%2FPKnoawB0yPkjS6%2FN20%2F7Ve96DI%3D',
  'trial1738471262-gw5wX5BbNdOjXPMcBcjh9uFR4XcDebzWi5J3tqTiMvM%3D',
  'trial1738477022-mRxhsmwnqTtkZlKT5kATeY0Fl1%2BTa78yvQEwi287448%3D',
  'trial1738477162-5cDjld3M7PfWo1dbDIDVUk1RgEHT5CO8vzKelgXYxng%3D',
  'trial1738477265-yu5aHHIqLiv5ltZnJnF4KPlNPwfy%2Bfl4n4k%2BBSu%2FoAI%3D',
  'trial1738477365-ehr28E5VGw1E6JdIcwIY7qtnCLMf6Ee46m1dtm0hMKc%3D',
  'trial1738477617-BKkIIir2srb43QfB1w3LMgRcx0eGFyaTFC2qeJXEGWQ%3D',
  'trial1738477799-G%2F4FF1TRQwe7oQM30OeZtMUQ6NLjYDjOXMIengowvTw%3D',
  'trial1738478361-Uuwek9sEI9a2r5QU7vMm9XN6VQmS33uELQQIbQajnJE%3D',
  'trial1738478793-jRhL2NO%2Bu056b%2F6Fcgi6fADCkKHJXE7%2BE9OJVrd0%2FU4%3D',
  'trial1738478939-ytR%2FP%2F%2F%2F1WsWiwQQiTOjGKQf4bkkGc8b0vyxNacK4UU%3D',
  'trial1738479295-It6w%2B%2BZ5XNg6pZPFsrdXBtjjRMuoBI74i1KFED0yAVk%3D',
  'trial1738479467-gngbaBX2aDz0BLq0bboWW36mI2IKgKZLbbEEsBD%2F45E%3D',
  'trial1738479736-dG5Z%2BB3lDJB%2BPmTHnCjqbetxzPUhwVafg2BK8XOUg9I%3D'
]


export const NEXTBLOCK_TIP_ACCOUNTS = [
  'NextbLoCkVtMGcV47JzewQdvBpLqT9TxQFozQkN98pE',
  'NexTbLoCkWykbLuB1NkjXgFWkX9oAtcoagQegygXXA2',
  'NeXTBLoCKs9F1y5PJS9CKrFNNLU1keHW71rfh7KgA1X',
  'NexTBLockJYZ7QD7p2byrUa6df8ndV2WSd8GkbWqfbb',
  'neXtBLock1LeC67jYd1QdAa32kbVeubsfPNTJC1V5At',
  'nEXTBLockYgngeRmRrjDV31mGSekVPqZoMGhQEZtPVG',
  'NEXTbLoCkB51HpLBLojQfpyVAMorm3zzKg7w9NFdqid',
  'nextBLoCkPMgmG8ZgJtABeScP35qLa2AMCNKntAP7Xc',
]

export const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
]

export const cluster = 'mainnet'

export const JitoEndpoints = {
  mainnet: 'https://mainnet.block-engine.jito.wtf/api/v1/transactions',
  amsterdam: 'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/transactions',
  frankfurt: 'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/transactions',
  ny: 'https://ny.mainnet.block-engine.jito.wtf/api/v1/transactions',
  tokyo: 'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/transactions',
};

export const JitoBlockEngineUrls = {
  mainnet: {
    amsterdam: 'amsterdam.mainnet.block-engine.jito.wtf',
    frankfurt: 'frankfurt.mainnet.block-engine.jito.wtf',
    ny: 'ny.mainnet.block-engine.jito.wtf',
    tokyo: 'tokyo.mainnet.block-engine.jito.wtf',
    saltlake: 'slc.mainnet.block-engine.jito.wtf'
  },
  testnet: {
    dallas: 'dallas.testnet.block-engine.jito.wtf',
    ny: 'ny.testnet.block-engine.jito.wtf',
  }
}

export type JitoRegion = 'saltlake' | 'amsterdam' | 'frankfurt' | 'ny' | 'tokyo';
export function getJitoBlockEngine(region: JitoRegion = 'frankfurt') {
  return JitoBlockEngineUrls[cluster][region];
}

export const NEXTBLOCK_SUBMIT_ENDPOINTS: any = {
  ny: 'https://ny.nextblock.io/api/v2/submit',
  frankfurt: 'https://fra.nextblock.io/api/v2/submit'
}
export function getNextBlockSubmitEndpoint(region: string = 'frankfurt') {
  return NEXTBLOCK_SUBMIT_ENDPOINTS[region]
}

export const commitment = "processed"

// PumpFun
export const PumpSDK = new PumpFunSDK(new AnchorProvider(heliusSolConnection, new NodeWallet(new Keypair()), { commitment }));
export const global_mint = new PublicKey("p89evAyzjd9fphjJx7G3RFA48sbZdpGEppRcfRNpump")
export const PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_FUN_MINT_AUTHORITY = 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM'
export const PUMP_FUN_CREATE_IX_DISCRIMINATOR = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);


// PumpAmmSwap
export const PUMP_AMM_SWAP_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA')
export const PUMP_AMM_SWAP_FEE_ACCOUNT = new PublicKey("12e2F4DKkD3Lff6WPYsU7Xd76SHPEyN9T8XSsTJNF8oT")
export const PUMP_FEE_MAIN_ACCOUNT = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM")
export const PUMP_FEE_ACCOUNT = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM")

const wallet = new NodeWallet(MAIN_KP)
const provider = new AnchorProvider(solConnection,
  wallet,
  { commitment: "processed" });

export const pumpSwapProgram = new Program(pumpSwapIdl as PumpAmmIDL,
  provider);

// Raydium
export const RAYDIUM_AMM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'
export const RAYDIUM_CPMM_PROGRAM_ID = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C'

export const WSOL = 'So11111111111111111111111111111111111111112'

/** Transaction landing: Jito | NextBlock | Helius Sender | Astralane | Zeroslot */
export type TxSubmitterId =
  | "jito"
  | "nextblock"
  | "helius-sender"
  | "astralane"
  | "zeroslot";

export const TX_SUBMITTER: TxSubmitterId =
  (process.env.TX_SUBMITTER as TxSubmitterId) || "jito";

/** Helius Sender — dual validator + Jito routing; min tip 0.0002 SOL (docs) */
export const HELIUS_SENDER_URL =
  process.env.HELIUS_SENDER_URL ?? "https://sender.helius-rpc.com/fast";
export const HELIUS_SENDER_TIP_SOL = Number(
  process.env.HELIUS_SENDER_TIP_SOL ?? 0.0002
);
export const HELIUS_SENDER_TIP_ACCOUNTS: string[] = [
  "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
  "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
  "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
  "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
  "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
  "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
  "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
  "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
  "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
  "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or",
];

/** Astralane Iris — api-key required; min tip 0.00001 SOL */
export const ASTRALANE_API_KEY = process.env.ASTRALANE_API_KEY ?? "";
export const ASTRALANE_IRIS_BASE =
  process.env.ASTRALANE_IRIS_BASE ?? "https://fr.gateway.astralane.io/iris";
export const ASTRALANE_TIP_SOL = Number(process.env.ASTRALANE_TIP_SOL ?? 0.00002);
export const ASTRALANE_TIP_ACCOUNTS: string[] = [
  "astrawVNP4xDBKT7rAdxrLYiTSTdqtUr63fSMduivXK",
  "astraZW5GLFefxNPAatceHhYjfA1ciq9gvfEg2S47xk",
  "astraubkDw81n4LuutzSQ8uzHCv4BhPVhfvTcYv8SKC",
  "astraEJ2fEj8Xmy6KLG7B3VfbKfsHXhHrNdCQx7iGJK",
  "astraRVUuTHjpwEVvNBeQEgwYx9w9CFyfxjYoobCZhL",
  "astra9xWY93QyfG6yM8zwsKsRodscjQ2uU2HKNL5prk",
  "astra4uejePWneqNaJKuFFA8oonqCE1sqF6b45kDMZm",
  "astrazznxsGUhWShqgNtAdfrzP2G83DzcWVJDxwV9bF",
];

/** Zeroslot staked_conn — api-key as query param */
export const ZEROSLOT_API_KEY = process.env.ZEROSLOT_API_KEY ?? "";
export const ZEROSLOT_URL =
  process.env.ZEROSLOT_URL ?? "https://de.0slot.trade";
export const ZEROSLOT_TIP_SOL = Number(process.env.ZEROSLOT_TIP_SOL ?? 0.001);
export const ZEROSLOT_TIP_ACCOUNTS: string[] = [
  "6fQaVhYZA4w3MBSXjJ81Vf6W1EDYeUPXpgVQ6UQyU1Av",
  "3Rz8uD83QsU8wKvZbgWAPvCNDU6Fy8TSZTMcPm3RB6zt",
  "4iUgjMT8q2hNZnLuhpqZ1QtiV8deFPy2ajvvjEpKKgsS",
  "Ey2JEr8hDkgN8qKJGrLf2yFjRhW7rab99HVxwi5rcvJE",
  "GQPFicsy3P3NXxB5piJohoxACqTvWE9fKpLgdsMduoHE",
  "D8f3WkQu6dCF33cZxuAsrKHrGsqGP2yvAHf8mX6RXnwf",
  "TpdxgNJBWZRL8UXF5mrEsyWxDWx9HQexA9P1eTWQ42p",
  "6SiVU5WEwqfFapRuYCndomztEwDjvS5xgtEof3PLEGm9",
];