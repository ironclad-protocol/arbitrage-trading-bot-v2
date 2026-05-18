/**
 * Jupiter aggregator swap: quote via API then build, sign and send swap transaction.
 */
import { Keypair, VersionedTransaction, PublicKey } from "@solana/web3.js";
import { solConnection, SIMULATION_MODE } from "../../config";

// Jupiter Swap API v1
const JUPITER_API_BASE = "https://api.jup.ag/swap/v1";
const JUPITER_API_KEY = "46a30830-a5d3-42dd-98fe-4a84c02542bd";

const WSOL_MINT = "So11111111111111111111111111111111111111112";

const mintDecimalsCache = new Map<string, number>();

async function getTokenDecimals(mint: string): Promise<number> {
  if (mintDecimalsCache.has(mint)) return mintDecimalsCache.get(mint)!;
  const info = await solConnection.getParsedAccountInfo(new PublicKey(mint));
  const data: any = info.value?.data;
  const decimals: number | undefined = (data as any)?.parsed?.info?.decimals;
  if (typeof decimals !== "number") {
    throw new Error(`Unable to fetch token decimals for mint ${mint}`);
  }
  mintDecimalsCache.set(mint, decimals);
  return decimals;
}

export interface JupiterQuoteParams {
  inputMint: string;
  outputMint: string;
  amount: string; // raw units (e.g. lamports for SOL)
  slippageBps?: number;
}

export interface JupiterSwapOptions {
  slippageBps?: number;
  prioritizationFeeLamports?: number;
  skipSend?: boolean;
  /** For sell: if set, numeric amount is treated as human amount (e.g. 200 tokens). Converts to raw using 10^decimals. */
  tokenDecimals?: number;
}

/**
 * Fetch a swap quote from Jupiter.
 */
export async function getJupiterQuote(params: JupiterQuoteParams): Promise<any> {
  const { inputMint, outputMint, amount, slippageBps = 50 } = params;
  const url = `${JUPITER_API_BASE}/quote?` + new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: String(slippageBps),
    restrictIntermediateTokens: "true",
  });
  const res = await fetch(url, {
    headers: {
      "x-api-key": JUPITER_API_KEY,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter quote failed: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * Get serialized swap transaction from Jupiter.
 */
export async function getJupiterSwapTransaction(
  quote: any,
  userPublicKey: string,
  options?: { prioritizationFeeLamports?: number }
): Promise<string> {
  const body: Record<string, unknown> = {
    quoteResponse: quote,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
  };
  if (options?.prioritizationFeeLamports != null) {
    body.prioritizationFeeLamports = options.prioritizationFeeLamports;
  }
  const res = await fetch(`${JUPITER_API_BASE}/swap`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": JUPITER_API_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter swap build failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const swapTransaction = data?.swapTransaction;
  if (!swapTransaction || typeof swapTransaction !== "string") {
    throw new Error("Jupiter swap response missing swapTransaction");
  }
  return swapTransaction;
}

/**
 * Execute a Jupiter swap: quote -> build tx -> sign -> send.
 * @param payer Signer keypair
 * @param inputMint Input token mint (e.g. WSOL for SOL in)
 * @param outputMint Output token mint
 * @param amountRaw Amount in smallest units (e.g. lamports for SOL)
 * @param options Slippage, priority fee, or skip send
 * @returns Transaction signature or null
 */
export async function jupiterSwap(
  payer: Keypair,
  inputMint: string,
  outputMint: string,
  amountRaw: string,
  options?: JupiterSwapOptions
): Promise<string | null> {
  try {
    const slippageBps = options?.slippageBps ?? 50;
    const quote = await getJupiterQuote({
      inputMint,
      outputMint,
      amount: amountRaw,
      slippageBps,
    });
    if (!quote || !quote.inputMint || !quote.routePlan?.length) {
      console.error("[jupiter] No route for swap", { inputMint, outputMint, amountRaw });
      return null;
    }

    const swapTxBase64 = await getJupiterSwapTransaction(
      quote,
      payer.publicKey.toBase58(),
      { prioritizationFeeLamports: options?.prioritizationFeeLamports }
    );

    const swapTxBuf = Buffer.from(swapTxBase64, "base64");
    const tx = VersionedTransaction.deserialize(swapTxBuf);
    tx.sign([payer]);

    if (options?.skipSend) {
      console.log("[jupiter] Skip send requested, tx built and signed");
      return null;
    }

    if (SIMULATION_MODE) {
      const sim = await solConnection.simulateTransaction(tx);
      console.log("[jupiter] [SIMULATION] err=", sim.value.err ?? "ok", "logs=", sim.value.logs?.length ?? 0);
      return null;
    }

    const sig = await solConnection.sendTransaction(tx, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });
    console.log("[jupiter] Swap sent:", sig);
    return sig;
  } catch (err) {
    console.error("[jupiter] Swap error:", err);
    return null;
  }
}

const LAMPORTS_PER_SOL = 1e9;

/**
 * One flexible entry for both buy and sell:
 * - buy: amount = SOL amount (e.g. 0.001)
 * - sell: amount = token amount (human), automatically converted using on-chain mint decimals
 *   (or options.tokenDecimals override).
 */
export async function jupiterSwapToken(
  payer: Keypair,
  tokenMint: string,
  side: "buy" | "sell",
  amount: number | string,
  options?: JupiterSwapOptions
): Promise<string | null> {
  if (side === "buy") {
    const solAmount = typeof amount === "string" ? parseFloat(amount) : amount;
    const amountRaw = String(Math.floor(solAmount * LAMPORTS_PER_SOL));
    return jupiterSwap(payer, WSOL_MINT, tokenMint, amountRaw, options);
  }
  const decimals =
    options?.tokenDecimals != null
      ? options.tokenDecimals
      : await getTokenDecimals(tokenMint);
  const human = typeof amount === "string" ? parseFloat(amount) : amount;
  const amountRaw = String(Math.floor(human * 10 ** decimals));
  return jupiterSwap(payer, tokenMint, WSOL_MINT, amountRaw, options);
}

/**
 * Buy: swap SOL for token. Amount in SOL (e.g. 0.001).
 */
export async function jupiterSwapSolForToken(
  payer: Keypair,
  outputMint: string,
  solAmount: number,
  options?: JupiterSwapOptions
): Promise<string | null> {
  const amountRaw = String(Math.floor(solAmount * LAMPORTS_PER_SOL));
  return jupiterSwap(payer, WSOL_MINT, outputMint, amountRaw, options);
}

/**
 * Sell: swap token for SOL. Amount in token base units (raw string).
 */
export async function jupiterSwapTokenForSol(
  payer: Keypair,
  inputMint: string,
  amountRaw: string,
  options?: JupiterSwapOptions
): Promise<string | null> {
  return jupiterSwap(payer, inputMint, WSOL_MINT, amountRaw, options);
}
