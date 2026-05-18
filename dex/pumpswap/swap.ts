import { BN } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createSyncNativeInstruction,
} from "@solana/spl-token";
import { ASSOCIATED_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import {
  confirmedSolanaConnection,
  MAIN_KP,
  NEXTBLOCK_FEE_AMOUNT,
  NEXTBLOCK_TIP_ACCOUNTS,
  PUMP_AMM_SWAP_FEE_ACCOUNT,
  PUMP_AMM_SWAP_PROGRAM_ID,
  pumpSwapProgram,
  solConnection,
} from "../../config";
import { sendBundleTxUsingJito } from "../../utils/utils";
import { connection } from "mongoose";
import { JupiterSwapOptions, jupiterSwapToken } from "../jupiter";

/**
 * Buy token on Pump AMM (Pump Swap): spend solAmountSol SOL, get as much base token as possible.
 */
export async function buyPumpAmmTokenByRacing(
  payer: Keypair,
  baseMint: PublicKey,
  pool: PublicKey,
  solAmountSol: number,
  recentBlockhash?: string
): Promise<string | null> {
  console.log("calling buyPumpAmmTokenByRacing...")
  try {
    const [latestBlockHash, globalConfig] = await Promise.all([
      solConnection.getLatestBlockhash(),
      PublicKey.findProgramAddressSync([Buffer.from("global_config")], PUMP_AMM_SWAP_PROGRAM_ID),
    ]);
    const [eventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      PUMP_AMM_SWAP_PROGRAM_ID
    );
    const blockhash = recentBlockhash ?? latestBlockHash.blockhash;
    if (!blockhash) return null;

    const globalConfigPda = globalConfig[0];
    const [poolInfo, globalConfigInfo] = await Promise.all([
      solConnection.getAccountInfo(pool),
      solConnection.getAccountInfo(globalConfigPda),
    ]);
    if (!poolInfo) {
      throw new Error(`Pool account not found: ${pool.toBase58()}. Pool may be closed or wrong address.`);
    }
    if (!globalConfigInfo) {
      throw new Error(`Pump AMM global_config not found. Program may not be initialized.`);
    }

    const baseTokenProgram = TOKEN_2022_PROGRAM_ID;
    const poolBaseTokenAccount = getAssociatedTokenAddressSync(baseMint, pool, true, baseTokenProgram);
    console.log("poolBaseTokenAccount", poolBaseTokenAccount.toBase58())
    const poolQuoteTokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, pool, true);
    console.log("poolQuoteTokenAccount", poolQuoteTokenAccount.toBase58())
    const userBaseTokenAccount = getAssociatedTokenAddressSync(baseMint, payer.publicKey, false, baseTokenProgram);
    console.log("userBaseTokenAccount", userBaseTokenAccount.toBase58())
    const userQuoteTokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, payer.publicKey);
    console.log("userQuoteTokenAccount", userQuoteTokenAccount.toBase58())
    const protocolFeeRecipient = PUMP_AMM_SWAP_FEE_ACCOUNT;
    console.log("protocolFeeRecipient", protocolFeeRecipient.toBase58())
    const protocolFeeRecipientTokenAccount = getAssociatedTokenAddressSync(
      NATIVE_MINT,
      protocolFeeRecipient,
      true
    );

    console.log("protocolFeeRecipientTokenAccount", protocolFeeRecipientTokenAccount.toBase58())

    const maxQuoteAmountIn = new BN(Math.floor(solAmountSol * LAMPORTS_PER_SOL));
    const baseAmountOut = new BN(1);

    // Match reference tx: SetComputeUnitLimit first (200k), then SetComputeUnitPrice (5 lamports/CU)
    const wrapAndBuyIxs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000_000 }),
      // createAssociatedTokenAccountIdempotentInstruction(
      //   payer.publicKey,
      //   userQuoteTokenAccount,
      //   payer.publicKey,
      //   NATIVE_MINT
      // ),
      // SystemProgram.transfer({
      //   fromPubkey: payer.publicKey,
      //   toPubkey: userQuoteTokenAccount,
      //   lamports: Math.floor(solAmountSol * LAMPORTS_PER_SOL),
      // }),
      // createSyncNativeInstruction(userQuoteTokenAccount),
      // createAssociatedTokenAccountIdempotentInstruction(
      //   payer.publicKey,
      //   userBaseTokenAccount,
      //   payer.publicKey,
      //   baseMint,
      //   baseTokenProgram
      // ),
      // createAssociatedTokenAccountIdempotentInstruction(
      //   payer.publicKey,
      //   protocolFeeRecipientTokenAccount,
      //   protocolFeeRecipient,
      //   NATIVE_MINT
      // ),
      // await pumpSwapProgram.methods
      //   .buy(baseAmountOut, maxQuoteAmountIn)
      //   .accountsStrict({
      //     globalConfig: globalConfigPda,
      //     baseMint,
      //     protocolFeeRecipientTokenAccount,
      //     poolBaseTokenAccount,
      //     poolQuoteTokenAccount,
      //     quoteMint: NATIVE_MINT,
      //     pool,
      //     protocolFeeRecipient,
      //     baseTokenProgram,
      //     quoteTokenProgram: TOKEN_PROGRAM_ID,
      //     userBaseTokenAccount,
      //     userQuoteTokenAccount,
      //     user: payer.publicKey,
      //     eventAuthority,
      //     program: PUMP_AMM_SWAP_PROGRAM_ID,
      //     associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
      //     systemProgram: SystemProgram.programId,
      //   })
      //   .signers([payer])
      //   .instruction(),
    ];

    console.log("wrapAndBuyIxs.length", wrapAndBuyIxs.length)

    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      instructions: wrapAndBuyIxs,
      recentBlockhash: blockhash,
    }).compileToV0Message();
    const verTx = new VersionedTransaction(messageV0);
    verTx.sign([payer]);

    try {
      const sim = await solConnection.simulateTransaction(verTx, {
        replaceRecentBlockhash: true,
        commitment: "confirmed",
      });
      if (sim.value.err) {
        console.warn("[pumpswap] Simulation failed (best-effort):", sim.value);
      } else {
        console.log("[pumpswap] Simulation OK, units:", sim.value.unitsConsumed ?? "—");
      }
    } catch (e) {
      console.warn("[pumpswap] Simulation error (continuing to send):", (e as Error).message);
    }

    const sig = await sendBundleTxUsingJito(blockhash, [verTx], payer, 2);
    return sig ?? null;
  } catch (err) {
    console.error("buyPumpAmmTokenByRacing:", err);
    return null;
  }
}

/**
 * Sell token on Pump AMM.
 */
export async function sellPumpAmmTokenByRacing(
  payer: Keypair,
  baseMint: PublicKey,
  pool: PublicKey,
  tokenAmount: number,
  decimals: number
): Promise<string | null> {
  console.log("calling sellPumpAmmTokenByRacing...")
  try {
    const [latestBlockHash, globalConfig] = await Promise.all([
      solConnection.getLatestBlockhash(),
      PublicKey.findProgramAddressSync([Buffer.from("global_config")], PUMP_AMM_SWAP_PROGRAM_ID),
    ]);
    const [eventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      PUMP_AMM_SWAP_PROGRAM_ID
    );
    const blockhash = latestBlockHash.blockhash;
    if (!blockhash) return null;

    const baseTokenProgram = TOKEN_2022_PROGRAM_ID;
    const poolBaseTokenAccount = getAssociatedTokenAddressSync(baseMint, pool, true, baseTokenProgram);
    const poolQuoteTokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, pool, true);
    const userBaseTokenAccount = getAssociatedTokenAddressSync(baseMint, payer.publicKey, false, baseTokenProgram);
    const userQuoteTokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, payer.publicKey);
    const protocolFeeRecipient = PUMP_AMM_SWAP_FEE_ACCOUNT;
    const protocolFeeRecipientTokenAccount = getAssociatedTokenAddressSync(
      NATIVE_MINT,
      protocolFeeRecipient,
      true
    );

    const baseAmountIn = new BN(Math.floor(tokenAmount * 10 ** decimals));
    const minQuoteAmountOut = new BN(0);

    const sellIxs = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      await pumpSwapProgram.methods
        .sell(baseAmountIn, minQuoteAmountOut)
        .accountsStrict({
          globalConfig: globalConfig[0],
          baseMint,
          protocolFeeRecipientTokenAccount,
          poolBaseTokenAccount,
          poolQuoteTokenAccount,
          quoteMint: NATIVE_MINT,
          pool,
          protocolFeeRecipient,
          baseTokenProgram,
          quoteTokenProgram: TOKEN_PROGRAM_ID,
          userBaseTokenAccount,
          userQuoteTokenAccount,
          user: payer.publicKey,
          eventAuthority,
          program: PUMP_AMM_SWAP_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .instruction(),

    ];

    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      instructions: sellIxs,
      recentBlockhash: blockhash,
    }).compileToV0Message();
    const verTx = new VersionedTransaction(messageV0);
    verTx.sign([payer]);
    console.log("Simulation:", await confirmedSolanaConnection.simulateTransaction(verTx, {
      replaceRecentBlockhash: true,
      commitment: "processed",
    }));
    // const sig = await sendBundleTxUsingJito(blockhash, [verTx], payer, 2);
    let sig;
    return sig ?? null;
  } catch (err) {
    console.error("sellPumpAmmTokenByRacing:", err);
    return null;
  }
}


export const buyPumpAmmToken_V2 = async(
  payer: Keypair,
  tokenMint: string,
  side: "buy" | "sell",
  amount: number | string,
  options?: JupiterSwapOptions
): Promise<string | null> => {
  return jupiterSwapToken(payer, tokenMint, side, amount, options);
}

export const sellPumpAmmToken_V2 = async(
  payer: Keypair,
  tokenMint: string,
  side: "buy" | "sell",
  amount: number | string,
  options?: JupiterSwapOptions
): Promise<string | null> => {
  return jupiterSwapToken(payer, tokenMint, side, amount, options);
}