import { LAMPORTS_PER_SOL, TransactionInstruction } from "@solana/web3.js";
import { TransactionMessage } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import { confirmedSolanaConnection, MAIN_KP, NEXTBLOCK_FEE_AMOUNT, NEXTBLOCK_TIP_ACCOUNTS, PumpSDK, solConnection } from "../../config";
import { ComputeBudgetProgram } from "@solana/web3.js";
import { VersionedTransaction } from "@solana/web3.js";
import { addTradeToken, sendBundleTxUsingJito } from "../../utils/utils";
import { addFeeIxAndSubmitTxViaNextBlock } from "../../utils/executor/nextBlock";
import { SystemProgram } from "@solana/web3.js";
import { JupiterSwapOptions, jupiterSwapToken } from "../jupiter";
import type { BondingCurveAccount } from "./sdk/bondingCurveAccount";
import { SIMULATION_MODE } from "../../config";

/** Build Pump.fun buy ix for spending `solHuman` SOL (uses live bonding curve). */
const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);

/**
 * Mayhem-mode coins MUST use one of MAYHEM_FEE_RECIPIENTS (pump-public-docs).
 * Wrong recipient → often Custom 6024 Overflow after TransferChecked.
 * @see https://github.com/pump-fun/pump-public-docs
 */
const MAYHEM_FEE_RECIPIENTS: PublicKey[] = [
  "GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS",
  "4budycTjhs9fD6xw62VBducVTNgMgJJ5BgtKq7mAZwn6",
  "8SBKzEQU4nLSzcwF4a74F2iaUDQyTfjGndn6qUWBnrpR",
  "4UQeTP1T39KZ9Sfxzo3WR5skgsaP6NZa87BAkuazLEKH",
  "8sNeir4QsLsJdYpc9RZacohhK1Y5FLU3nC5LXgYB4aa6",
  "Fh9HmeLNUMVCvejxCtCL2DbYaRyBFVJ5xrWkLnMH6fdk",
  "463MEnMeGyJekNZFQSTUABBEbLnvMTALbT6ZmsxAbAdq",
  "6AUH3WEHucYZyC61hqpqYUWVto5qA5hjHuNQ32GNnNxA",
].map((s) => new PublicKey(s));

function pickPumpFeeRecipient(
  bonding: BondingCurveAccount,
  globalFeeRecipient: PublicKey
): PublicKey {
  if (bonding.isMayhemMode) {
    const i = Math.floor(Math.random() * MAYHEM_FEE_RECIPIENTS.length);
    return MAYHEM_FEE_RECIPIENTS[i]!;
  }
  // Non-mayhem: use on-chain global fee recipient (rotates).
  return globalFeeRecipient;
}

/** ceil(a/b) for bigint */
function ceilDiv(a: bigint, b: bigint): bigint {
  if (b <= 0n) return 0n;
  return (a + b - 1n) / b;
}

/**
 * IDL `buy_exact_sol_in` steps 1–4 (pfee GetFees: protocol + creator bps).
 */
function expectedTokensBuyExactSolIn(
  spendableLamports: bigint,
  bonding: BondingCurveAccount,
  protocolFeeBps: bigint,
  creatorFeeBps: bigint
): bigint {
  let proto = protocolFeeBps > 0n ? protocolFeeBps : 95n;
  let creat = creatorFeeBps > 0n ? creatorFeeBps : 30n;
  const totalFeeBps = proto + creat;
  let netSol =
    (spendableLamports * 10000n) / (10000n + totalFeeBps);
  const fees =
    ceilDiv(netSol * proto, 10000n) + ceilDiv(netSol * creat, 10000n);
  if (netSol + fees > spendableLamports) {
    netSol -= netSol + fees - spendableLamports;
  }
  if (netSol <= 1n) return 0n;
  const vt = bonding.virtualTokenReserves;
  const vs = bonding.virtualSolReserves;
  let out = ((netSol - 1n) * vt) / (vs + netSol - 1n);
  if (out > bonding.realTokenReserves) out = bonding.realTokenReserves;
  return out;
}

async function pumpFunBuyIxsForSol(
  buyer: PublicKey,
  tokenMint: PublicKey,
  solHuman: number
): Promise<TransactionInstruction[]> {
  const [globalAccount, bonding] = await Promise.all([
    PumpSDK.getGlobalAccount("confirmed"),
    PumpSDK.getBondingCurveAccount(tokenMint, "confirmed"),
  ]);
  if (!bonding || bonding.complete) return [];
  const solLamports = BigInt(Math.floor(solHuman * LAMPORTS_PER_SOL));
  if (solLamports <= 0n) return [];
  const expected = expectedTokensBuyExactSolIn(
    solLamports,
    bonding,
    globalAccount.feeBasisPoints,
    globalAccount.creatorFeeBasisPoints
  );
  if (expected <= 0n) return [];
  // Debug-safe: prove overflow isn't from slippage math.
  const minTokens = 1n;
  const spendableSol = solLamports;
  const feeRecipient = pickPumpFeeRecipient(bonding, globalAccount.feeRecipient);
  if (bonding.isMayhemMode) {
    console.log(
      "[pumpfun] mayhem-mode mint → fee recipient:",
      feeRecipient.toBase58()
    );
  } else {
    console.log("[pumpfun] global fee recipient:", feeRecipient.toBase58());
  }
  const ixs = await PumpSDK.getBuyIxs(
    buyer,
    tokenMint,
    feeRecipient,
    minTokens,
    spendableSol,
    true,
    "confirmed"
  );

  const pumpIx = ixs.find((ix) => ix.programId.equals(PUMP_PROGRAM_ID));
  if (pumpIx) {
    console.log(
      "[pumpfun] built ix discriminator:",
      Array.from(pumpIx.data.subarray(0, 8)),
      "accounts:",
      pumpIx.keys.length,
      "last:",
      pumpIx.keys[pumpIx.keys.length - 1]?.pubkey.toBase58()
    );
  }
  return ixs;
}

export const buyPumpFunTokenByRacing = async (payer: Keypair, tokenMint: PublicKey, buyAmount: number, recentBlockhash?: string) => {
  console.log(`buyPumpFunTokenByRacing amount: ${buyAmount} SOL`);
  const executionStartTime = performance.now();
  try {
    const [maybeLatestBlockHash, buyIxs] = await Promise.all([
      SIMULATION_MODE ? Promise.resolve(null) : solConnection.getLatestBlockhash(),
      pumpFunBuyIxsForSol(payer.publicKey, tokenMint, buyAmount),
    ]);
    if (!buyIxs.length) return null;

    const staticIxs = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
    ];


    // For simulation we don't need a real recent blockhash; RPC simulation will replace it.
    const blockHash =
      recentBlockhash ??
      maybeLatestBlockHash?.blockhash ??
      "11111111111111111111111111111111";
    if (!blockHash) return null;
    const ixs = [...staticIxs, ...buyIxs];

    console.log("ixs length:", ixs.length);

    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      instructions: ixs,
      recentBlockhash: blockHash,
    }).compileToV0Message();

    const verTx = new VersionedTransaction(messageV0);
    verTx.sign([payer]);

    const sim = await confirmedSolanaConnection.simulateTransaction(verTx, {
      replaceRecentBlockhash: true,
      commitment: "processed",
    });
    if (sim.value.err) {
      console.warn(
        "[pumpfun] buy sim:",
        JSON.stringify(sim.value.err),
        sim.value.logs
      );
      // If runtime doesn't give an instruction index, print which Pump accounts are missing.
      try {
        const pumpIx = ixs.find((ix) => ix.programId.equals(PUMP_PROGRAM_ID));
        if (pumpIx) {
          const uniq = Array.from(
            new Set(pumpIx.keys.map((k) => k.pubkey.toBase58()))
          ).map((s) => new PublicKey(s));
          const infos = await confirmedSolanaConnection.getMultipleAccountsInfo(
            uniq,
            "processed"
          );
          const missing = uniq
            .map((pk, idx) => ({ pk, info: infos[idx] }))
            .filter((x) => !x.info)
            .map((x) => x.pk.toBase58());
          if (missing.length) {
            console.warn("[pumpfun] missing pump accounts:", missing);
          }
        }
      } catch (e) {
        console.warn("[pumpfun] missing-account debug failed:", e);
      }
      return null;
    }
    if (SIMULATION_MODE) return "SIM_OK";

    const executionEndTime = performance.now();
    if (executionEndTime - executionStartTime > 300) return null;

    const latestBlockHash = maybeLatestBlockHash ?? (await solConnection.getLatestBlockhash());
    const [res1] = await Promise.all([sendBundleTxUsingJito(latestBlockHash.blockhash, [verTx], payer, 2)]);
    if (res1) {
      await addTradeToken({ dex: "pumpfun", mint: tokenMint.toBase58() });
      return res1;
    }
    return null;
  } catch (err) {
    console.error("Error in buyPumpFunTokenByRacing:", err);
    return null;
  }
};

export const sellPumpFunTokenByRacing = async (payer: Keypair, tokenMint: PublicKey, sellAmount: number, percent: number = 1) => {
  const maxRetries = 2;
  console.log("calling sellPumpFunTokenByRacing...");
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    console.time(`execute-sell-${attempt}`);
    try {
      console.time(`blockhashSell-${attempt}`);
      const [maybeLatestBlockHash, sellTx] = await Promise.all([
        SIMULATION_MODE ? Promise.resolve(null) : solConnection.getLatestBlockhash(),
        PumpSDK.getSellInstructionsByTokenAmount(
          payer.publicKey,
          tokenMint,
          // `getSellInstructionsByTokenAmount` expects the token amount in **base units**.
          // The previous implementation multiplied by 10**6 unconditionally, which caused
          // huge sells (and Anchor 6024 Overflow) for Token-2022 mints / non-6-decimal tokens.
          BigInt(Math.floor(sellAmount * percent))
        ),
      ]);
      console.timeEnd(`blockhashSell-${attempt}`);

      const staticIxs = [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ];
      const nextBlockFeeIx = SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: new PublicKey(NEXTBLOCK_TIP_ACCOUNTS[0]),
        lamports: NEXTBLOCK_FEE_AMOUNT * LAMPORTS_PER_SOL,
      });
      const ixs = [...staticIxs, ...sellTx.instructions, nextBlockFeeIx];
      const blockhash =
        maybeLatestBlockHash?.blockhash ?? "11111111111111111111111111111111";
      const messageV0 = new TransactionMessage({
        payerKey: payer.publicKey,
        instructions: ixs,
        recentBlockhash: blockhash,
      }).compileToV0Message();
      const verTx = new VersionedTransaction(messageV0);
      verTx.sign([payer]);

      const sim = await confirmedSolanaConnection.simulateTransaction(verTx, {
        replaceRecentBlockhash: true,
        commitment: "processed",
      });
      console.log("Simulation", sim);
      if (sim.value.err) return null;

      console.timeEnd(`execute-sell-${attempt}`);
      // const [res1] = await Promise.all([sendBundleTxUsingJito(latestBlockHash.blockhash, [verTx], payer, 2)]);
      // if (res1) return res1;
      if (SIMULATION_MODE) return "SIM_OK";
      return null;
    } catch (err) {
      console.error(`Error in sellPumpFunTokenByRacing, attempt ${attempt + 1}:`, err);
      if (attempt === maxRetries) return null;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  return null;
};

export const buyPumpTokenByBundle = async (kp: Keypair, tokenMint: PublicKey, buyAmount: number) => {
  console.log("calling buyPumpTokenByBundle...");
  try {
    const buyIxs = await pumpFunBuyIxsForSol(kp.publicKey, tokenMint, buyAmount);
    if (!buyIxs.length) return null;
    const instructions: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
    ];
    const latestBlockhash = await solConnection.getLatestBlockhash();
    const msg = new TransactionMessage({
      payerKey: MAIN_KP.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: instructions.concat(buyIxs),
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([MAIN_KP, kp]);
    return await sendBundleTxUsingJito(latestBlockhash.blockhash, [tx], MAIN_KP, 2);
  } catch (err) {
    return null;
  }
};

export const buyPumpTokenByNextBlock = async (kp: Keypair, tokenMint: PublicKey, buyAmount: number) => {
  console.log("calling buyPumpTokenByNextBlock...");
  try {
    const buyIxs = await pumpFunBuyIxsForSol(kp.publicKey, tokenMint, buyAmount);
    if (!buyIxs.length) return null;
    const instructions: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
    ];
    const latestBlockhash = await solConnection.getLatestBlockhash();
    return await addFeeIxAndSubmitTxViaNextBlock(MAIN_KP, instructions.concat(buyIxs), latestBlockhash);
  } catch (err) {
    return null;
  }
};


export const buyPumpFunToken_V2 = async(
  payer: Keypair,
  tokenMint: string,
  side: "buy" | "sell",
  amount: number | string,
  options?: JupiterSwapOptions
): Promise<string | null> => {
  return jupiterSwapToken(payer, tokenMint, side, amount, options);
}

export const sellPumpFunToken_V2 = async(
  payer: Keypair,
  tokenMint: string,
  side: "buy" | "sell",
  amount: number | string,
  options?: JupiterSwapOptions
): Promise<string | null> => {
  return jupiterSwapToken(payer, tokenMint, side, amount, options);
}

/** Aliases for legacy imports */
export const buyPumpTokenByRacing = buyPumpFunTokenByRacing;
export const sellPumpTokenByRacing = sellPumpFunTokenByRacing;