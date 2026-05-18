import { getAssociatedTokenAddress, getMint, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import { confirmedSolanaConnection, heliusSolConnection, MAIN_KP, solConnection } from "../../config";
import {
  jsonInfo2PoolKeys,
  Liquidity,
  LiquidityPoolKeys,
  Percent,
  Token,
  TokenAmount,
  ApiPoolInfoV4,
  LIQUIDITY_STATE_LAYOUT_V4,
  MARKET_STATE_LAYOUT_V3,
  Market,
  SPL_MINT_LAYOUT,
  SPL_ACCOUNT_LAYOUT,
  TokenAccount,
  TxVersion,
  buildSimpleTransaction,
  LOOKUP_TABLE_CACHE,
  CurrencyAmount,
} from "@raydium-io/raydium-sdk";
import { Connection } from "@solana/web3.js";
import { VersionedTransaction } from "@solana/web3.js";
import { sendBundleTxUsingJito } from "../../utils/utils";
import { JupiterSwapOptions, jupiterSwapToken } from "../jupiter";

type WalletTokenAccounts = Awaited<ReturnType<typeof getWalletTokenAccount>>;
type TestTxInputInfo = {
  outputToken: Token;
  targetPool: string;
  inputTokenAmount: TokenAmount;
  slippage: Percent;
  walletTokenAccounts: WalletTokenAccounts;
  wallet: Keypair;
};

async function getWalletTokenAccount(connection: Connection, wallet: PublicKey): Promise<TokenAccount[]> {
  const walletTokenAccount = await heliusSolConnection.getTokenAccountsByOwner(wallet, {
    programId: TOKEN_PROGRAM_ID,
  });
  return walletTokenAccount.value.map((i) => ({
    pubkey: i.pubkey,
    programId: i.account.owner,
    accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
  }));
}

export async function formatAmmKeysById(connection: Connection, poolId: string): Promise<ApiPoolInfoV4> {
  const [account, marketAccount, lpMintAccount] = await Promise.all([
    connection.getAccountInfo(new PublicKey(poolId)),
    connection.getAccountInfo(new PublicKey(poolId)).then((account) => {
      if (account === null) throw Error("get marketAccount info error");
      const info = LIQUIDITY_STATE_LAYOUT_V4.decode(account.data);
      return connection.getAccountInfo(info.marketId);
    }),
    connection.getAccountInfo(new PublicKey(poolId)).then((account) => {
      if (account === null) throw Error("get lpMintAccount info error");
      const info = LIQUIDITY_STATE_LAYOUT_V4.decode(account.data);
      return connection.getAccountInfo(info.lpMint);
    }),
  ]);
  if (account === null || marketAccount === null || lpMintAccount === null) {
    throw Error("get account info error");
  }
  const info = LIQUIDITY_STATE_LAYOUT_V4.decode(account.data);
  const marketInfo = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data);
  const lpMintInfo = SPL_MINT_LAYOUT.decode(lpMintAccount.data);
  return {
    id: poolId,
    baseMint: info.baseMint.toString(),
    quoteMint: info.quoteMint.toString(),
    lpMint: info.lpMint.toString(),
    baseDecimals: info.baseDecimal.toNumber(),
    quoteDecimals: info.quoteDecimal.toNumber(),
    lpDecimals: lpMintInfo.decimals,
    version: 4,
    programId: account.owner.toString(),
    authority: Liquidity.getAssociatedAuthority({ programId: account.owner }).publicKey.toString(),
    openOrders: info.openOrders.toString(),
    targetOrders: info.targetOrders.toString(),
    baseVault: info.baseVault.toString(),
    quoteVault: info.quoteVault.toString(),
    withdrawQueue: info.withdrawQueue.toString(),
    lpVault: info.lpVault.toString(),
    marketVersion: 3,
    marketProgramId: info.marketProgramId.toString(),
    marketId: info.marketId.toString(),
    marketAuthority: Market.getAssociatedAuthority({ programId: info.marketProgramId, marketId: info.marketId }).publicKey.toString(),
    marketBaseVault: marketInfo.baseVault.toString(),
    marketQuoteVault: marketInfo.quoteVault.toString(),
    marketBids: marketInfo.bids.toString(),
    marketAsks: marketInfo.asks.toString(),
    marketEventQueue: marketInfo.eventQueue.toString(),
    lookupTableAccount: PublicKey.default.toString(),
  };
}

async function swapOnlyAmm(connection: Connection, input: TestTxInputInfo, targetPoolInfo: any) {
  try {
    const poolKeys = jsonInfo2PoolKeys(targetPoolInfo) as LiquidityPoolKeys;
    const poolInfo = await Liquidity.fetchInfo({ connection: confirmedSolanaConnection, poolKeys });
    const { amountOut, minAmountOut } = Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn: input.inputTokenAmount,
      currencyOut: input.outputToken,
      slippage: input.slippage,
    });
    const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
      connection,
      poolKeys,
      userKeys: {
        tokenAccounts: input.walletTokenAccounts,
        owner: input.wallet.publicKey,
      },
      amountIn: input.inputTokenAmount,
      amountOut: minAmountOut,
      fixedSide: "in",
      makeTxVersion: TxVersion.V0,
      computeBudgetConfig: {
        microLamports: 150_000 * 10,
        units: 100_000,
      },
    });
    return innerTransactions;
  } catch (err) {
    console.log("Err while calling swapOnlyAmm...", err);
  }
}

export const buyRaydiumTokenByRacing = async (
  payer: Keypair,
  tokenMint: PublicKey,
  tokenDecimal: number,
  poolId: PublicKey,
  buyAmount: number
) => {
  const baseToken = new Token(TOKEN_PROGRAM_ID, tokenMint, tokenDecimal);
  const quoteToken = new Token(TOKEN_PROGRAM_ID, NATIVE_MINT, 9);
  const quoteTokenAmount = new TokenAmount(quoteToken, Math.floor(buyAmount * 10 ** 9).toString());
  const slippage = new Percent(100, 100);

  const [walletTokenAccounts, latestBlockhash, targetPoolInfo] = await Promise.all([
    getWalletTokenAccount(confirmedSolanaConnection, payer.publicKey),
    confirmedSolanaConnection.getLatestBlockhash(),
    formatAmmKeysById(confirmedSolanaConnection, poolId.toBase58()),
  ]);

  const instructions = await swapOnlyAmm(
    solConnection,
    {
      outputToken: baseToken,
      targetPool: poolId.toBase58(),
      inputTokenAmount: quoteTokenAmount,
      slippage,
      walletTokenAccounts,
      wallet: payer,
    },
    targetPoolInfo
  );
  if (!instructions) return;
  const [buyTx] = await buildSimpleTransaction({
    connection: solConnection,
    makeTxVersion: TxVersion.V0,
    payer: MAIN_KP.publicKey,
    innerTransactions: instructions,
    addLookupTableInfo: LOOKUP_TABLE_CACHE,
  });
  if (buyTx instanceof VersionedTransaction) {
    buyTx.sign([MAIN_KP]);
    await sendBundleTxUsingJito(latestBlockhash.blockhash, [buyTx], payer, 2);
  }
};

export const sellRaydiumTokenByRacing = async (
  payer: Keypair,
  tokenMint: PublicKey,
  tokenDecimal: number,
  poolId: PublicKey,
  amount: number
) => {
  let tokenBalance = 0;
  const tokenAcc = await getAssociatedTokenAddress(tokenMint, payer.publicKey);
  const tokenAmount = await solConnection.getTokenAccountBalance(tokenAcc);
  if (tokenAmount) tokenBalance = (tokenAmount.value as any).uiAmount ?? 0;
  const realSellAmount = tokenBalance < amount ? tokenBalance : amount;

  const baseToken = new Token(TOKEN_PROGRAM_ID, tokenMint, tokenDecimal);
  const quoteToken = new Token(TOKEN_PROGRAM_ID, NATIVE_MINT, 9);
  const baseTokenAmount = new TokenAmount(baseToken, Math.floor(realSellAmount * 10 ** tokenDecimal).toString());
  const slippage = new Percent(100, 100);

  const [walletTokenAccounts, latestBlockhash, targetPoolInfo] = await Promise.all([
    getWalletTokenAccount(confirmedSolanaConnection, payer.publicKey),
    confirmedSolanaConnection.getLatestBlockhash(),
    formatAmmKeysById(confirmedSolanaConnection, poolId.toBase58()),
  ]);

  const instructions = await swapOnlyAmm(
    solConnection,
    {
      outputToken: quoteToken,
      targetPool: poolId.toBase58(),
      inputTokenAmount: baseTokenAmount,
      slippage,
      walletTokenAccounts,
      wallet: payer,
    },
    targetPoolInfo
  );
  if (!instructions) return;
  const [sellTx] = await buildSimpleTransaction({
    connection: solConnection,
    makeTxVersion: TxVersion.V0,
    payer: MAIN_KP.publicKey,
    innerTransactions: instructions,
    addLookupTableInfo: LOOKUP_TABLE_CACHE,
  });
  if (sellTx instanceof VersionedTransaction) {
    sellTx.sign([MAIN_KP]);
    await sendBundleTxUsingJito(latestBlockhash.blockhash, [sellTx], payer, 2);
  }
};


export const buyRaydiumAmmToken_V2 = async(
  payer: Keypair,
  tokenMint: string,
  side: "buy" | "sell",
  amount: number | string,
  options?: JupiterSwapOptions
): Promise<string | null> => {
  return jupiterSwapToken(payer, tokenMint, side, amount, options);
}

export const sellRaydiumAmmToken_V2 = async(
  payer: Keypair,
  tokenMint: string,
  side: "buy" | "sell",
  amount: number | string,
  options?: JupiterSwapOptions
): Promise<string | null> => {
  return jupiterSwapToken(payer, tokenMint, side, amount, options);
}