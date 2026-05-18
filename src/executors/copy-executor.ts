import { PublicKey, Connection } from "@solana/web3.js";
import type { CopyTradeEvent } from "../core/types";
import { getWalletTokenBalance, updateWalletsHolding } from "../../utils/utils";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { MAIN_KP, COPY_PERCENT, Copy_Buy_FixedAmount, solConnection } from "../../config";

import { buyPumpAmmToken_V2, buyPumpAmmTokenByRacing, sellPumpAmmToken_V2, sellPumpAmmTokenByRacing } from "../../dex/pumpswap/swap";
import { buyPumpFunToken_V2, buyPumpFunTokenByRacing, sellPumpFunToken_V2, sellPumpFunTokenByRacing } from "../../dex/pumpfun/swap";
import { buyRaydiumAmmToken_V2, sellRaydiumAmmToken_V2 } from "../../dex/raydium/swap";

const tokenProgramCache = new Map<string, PublicKey>();

/** Resolve token program (Token or Token-2022) from mint; cached per mint. */
async function getTokenProgramForMint(connection: Connection, mint: PublicKey): Promise<PublicKey> {
  const key = mint.toBase58();
  let programId = tokenProgramCache.get(key);
  if (programId) return programId;
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`Mint not found: ${key}`);
  programId = info.owner;
  tokenProgramCache.set(key, programId);
  return programId;
}

/**
 * Execute a single copy trade. Uses existing swap modules (pumpfun, raydium).
 * Non-blocking: enqueue calls this; we run async and don't block the stream.
 */
export async function executeCopyTrade(event: CopyTradeEvent): Promise<void> {
  if (!MAIN_KP) {
    console.warn("[copy] No MAIN_KP, skip execute");
    return;
  }

  console.log("event", event);



  const payer = MAIN_KP;

  // if (event.dex === "pumpfun") {
  //   if (event.side === "buy") {
  //     const amount = Copy_Buy_FixedAmount > 0 ? Copy_Buy_FixedAmount : event.solAmount * COPY_PERCENT;
  //     const tx = await buyPumpFunTokenByRacing(payer, new PublicKey(event.mint), amount, event.recentBlockhash);
  //     if (tx) {
  //       updateWalletsHolding(event.trader, event.mint, true, event.tokenAmount);
  //       console.log(`[copy] BUY ${event.mint.slice(0, 8)}… ${amount} SOL tx=${tx}`);
  //     }
  //     return;
  //   }
  //   // Sell: one program lookup (cached), one balance fetch, single sellAmount calc
  //   const mintPk = new PublicKey(event.mint);
  //   const targetBalance = getWalletTokenBalance(event.trader, event.mint);
  //   let sellAmount = 0;
  //   try {
  //     const tokenProgramId = await getTokenProgramForMint(solConnection, mintPk);
  //     const tokenAcc = getAssociatedTokenAddressSync(mintPk, payer.publicKey, false, tokenProgramId);
  //     const balanceRes = await solConnection.getTokenAccountBalance(tokenAcc);
  //     const botBal = balanceRes?.value?.uiAmount ?? 0;
  //     const ratio = targetBalance > 0 ? event.tokenAmount / targetBalance : 1;
  //     sellAmount = ratio >= 0.95 ? botBal : ratio * botBal;
  //   } catch {
  //     sellAmount = 0;
  //   }
  //   if (sellAmount > 0) {
  //     const tx = await sellPumpFunTokenByRacing(payer, mintPk, sellAmount, event.decimals);
  //     if (tx) {
  //       updateWalletsHolding(event.trader, event.mint, false, event.tokenAmount);
  //       console.log(`[copy] SELL ${event.mint.slice(0, 8)}… tx=${tx}`);
  //     }
  //   }
  //   return;
  // }

  // if (event.dex === "raydium-amm") {
  //   if (event.side === "buy") {
  //     const amount = Copy_Buy_FixedAmount > 0 ? Copy_Buy_FixedAmount : event.solAmount * COPY_PERCENT;
  //     const tx = await buyRaydiumAmmToken_V2(payer, event.mint, "buy", amount, { slippageBps: 100 });
  //     if (tx) {
  //       updateWalletsHolding(event.trader, event.mint, true, event.tokenAmount);
  //       console.log(`[copy] BUY ${event.mint.slice(0, 8)}… ${amount} SOL tx=${tx}`);
  //     }
  //     return;
  //   }
  //   // Sell: one program lookup (cached), one balance fetch, single sellAmount calc
  //   const mintPk = new PublicKey(event.mint);
  //   const targetBalance = getWalletTokenBalance(event.trader, event.mint);
  //   let sellAmount = 0;
  //   try {
  //     const tokenProgramId = await getTokenProgramForMint(solConnection, mintPk);
  //     const tokenAcc = getAssociatedTokenAddressSync(mintPk, payer.publicKey, false, tokenProgramId);
  //     const balanceRes = await solConnection.getTokenAccountBalance(tokenAcc);
  //     const botBal = balanceRes?.value?.uiAmount ?? 0;
  //     const ratio = targetBalance > 0 ? event.tokenAmount / targetBalance : 1;
  //     sellAmount = ratio >= 0.95 ? botBal : ratio * botBal;
  //   } catch {
  //     sellAmount = 0;
  //   }
  //   if (sellAmount > 0) {
  //     const tx = await sellRaydiumAmmToken_V2(payer, event.mint, "sell", sellAmount, { slippageBps: 100 });
  //     if (tx) {
  //       updateWalletsHolding(event.trader, event.mint, false, event.tokenAmount);
  //       console.log(`[copy] SELL ${event.mint.slice(0, 8)}… tx=${tx}`);
  //     }
  //   }
  //   return;
  // }

  if (event.dex === "pumpswap") {
    if (!event.poolId) {
      console.warn("[copy] pumpswap: missing poolId, skip");
      return;
    }
    const poolPk = new PublicKey(event.poolId);
    const mintPk = new PublicKey(event.mint);
    if (event.side === "buy") {
      const amount = Copy_Buy_FixedAmount > 0 ? Copy_Buy_FixedAmount : event.solAmount * COPY_PERCENT;
      const tx = await buyPumpAmmTokenByRacing(payer, mintPk, poolPk, amount, event.recentBlockhash);
      if (tx) {
        updateWalletsHolding(event.trader, event.mint, true, event.tokenAmount);
        console.log(`[copy] BUY ${event.mint.slice(0, 8)}… ${amount} SOL tx=${tx}`);
      }
      return;
    }
    // Sell: one program lookup (cached), one balance fetch, single sellAmount calc
    const targetBalance = getWalletTokenBalance(event.trader, event.mint);
    let sellAmount = 0;
    try {
      const tokenProgramId = await getTokenProgramForMint(solConnection, mintPk);
      const tokenAcc = getAssociatedTokenAddressSync(mintPk, payer.publicKey, false, tokenProgramId);
      const balanceRes = await solConnection.getTokenAccountBalance(tokenAcc);
      const botBal = balanceRes?.value?.uiAmount ?? 0;
      const ratio = targetBalance > 0 ? event.tokenAmount / targetBalance : 1;
      sellAmount = ratio >= 0.95 ? botBal : ratio * botBal;
    } catch {
      sellAmount = 0;
    }
    if (sellAmount > 0) {
      const tx = await sellPumpAmmTokenByRacing(payer, mintPk, poolPk, sellAmount, event.decimals);
      if (tx) {
        updateWalletsHolding(event.trader, event.mint, false, event.tokenAmount);
        console.log(`[copy] SELL ${event.mint.slice(0, 8)}… tx=${tx}`);
      }
    }
    return;
  }
}
