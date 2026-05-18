/**
 * Normalized trade event from any DEX. Parsers produce this; executors consume it.
 */
export type DexKind = "pumpfun" | "pumpswap" | "raydium-amm" | "raydium-cpmm";

export interface CopyTradeEvent {
  dex: DexKind;
  signature: string;
  /** Wallet we are copying (the one that made the trade) */
  trader: string;
  /** Our copy wallet (executor will use this keypair) */
  copyWalletId: string;
  side: "buy" | "sell";
  mint: string;
  /** SOL amount (lamports / 1e9 for display) */
  solAmount: number;
  /** Token amount (human) */
  tokenAmount: number;
  /** Token decimals */
  decimals: number;
  /** Optional: pool/bonding curve for DEX-specific execution */
  poolId?: string;
  bondingCurve?: string;
  /** Slot / blockhash for faster execution */
  recentBlockhash?: string;
}

export interface CopyWalletConfig {
  /** Public key we watch */
  address: string;
  /** Optional label */
  label?: string;
}

export interface ExecutorResult {
  success: boolean;
  signature?: string;
  error?: string;
}
