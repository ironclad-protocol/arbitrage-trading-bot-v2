import WebSocket from 'ws';

import { PartiallyDecodedInstruction, PublicKey } from "@solana/web3.js";

import { sha256 } from '@noble/hashes/sha256';
import base58 from "bs58"
import { BorshCoder, EventParser, Idl } from "@coral-xyz/anchor";
import * as borsh from "@coral-xyz/borsh";
import { buyPumpTokenByRacing, sellPumpTokenByRacing } from '../../dex/pumpfun';
import { Copy_Buy_FixedAmount, COPY_PERCENT, MAIN_KP, PUMP_FUN_PROGRAM_ID, solConnection } from '../../config';
import { getAssociatedTokenAddress, getMint } from '@solana/spl-token';
import { getWalletTokenBalance, readDataJson, updateWalletsHolding } from '../utils';

const buyDiscriminator = Buffer.from(sha256('global:buy').slice(0, 8));
const sellDiscriminator = Buffer.from(sha256('global:sell').slice(0, 8));
const tradeSchema = borsh.struct([
  borsh.u64("discriminator"),
  borsh.u64("amount"),
  borsh.u64("solAmount")
]);

let z: number = 0;
export const parsePumpFunHeliusTx = async (result: any) => {
  try {
    console.time("pumpfunParsing");

    let baseMint: any = null; // Initialize to null for clarity
    let quoteMint: any = null;
    let type: string = "";
    let decimals: any;
    // 1. Instruction Filtering and Identification
    const signature = result.signature;
    const accountKeys = result.transaction.transaction.message.accountKeys;

    const slot = result.slot;


    const recentBlockhash: string = result.transaction.transaction.message.recentBlockhash;
    console.log(`Caught signature: https://solscan.io/tx/${signature}`)

    let buySellIxs: any[] = [];
    const pumpIxs = result.transaction.transaction.message.instructions.filter((ix: any) => ix.programId === PUMP_FUN_PROGRAM_ID);

    if (pumpIxs.length > 0) {
      buySellIxs = pumpIxs.filter((ix: any) => {
        const ixData = base58.decode((ix as any).data);  // Directly decode here
        const discriminator = ixData.subarray(0, 8);
        return buyDiscriminator.equals(discriminator) || sellDiscriminator.equals(discriminator);
      });
    } else {
      const innerInstructions = result.transaction.meta.innerInstructions;

      if (innerInstructions) { // check if innerInstructions exists
        const matchingInstruction = innerInstructions
          .flatMap((item: any) => item.instructions)
          .find((instruction: any) =>
            instruction.programId === PUMP_FUN_PROGRAM_ID &&
            instruction.accounts.includes("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
          );

        if (matchingInstruction) {
          buySellIxs.push(matchingInstruction);
        }
      }
    }


    // 2. Trade Data Extraction and Processing

    if (buySellIxs.length > 0) {  // Only proceed if we found relevant instructions
      for (const ix of buySellIxs) { // Use const for immutability where possible

        try {
          const ixDataArray = base58.decode(ix.data);
          const ixData = tradeSchema.decode(ixDataArray);

          type = buyDiscriminator.equals(Buffer.from(ixDataArray.subarray(0, 8))) ? 'buy' : 'sell';
          const tokenAmount = ixData.amount.toString();
          const mint = ix.accounts[2];
          const trader = ix.accounts[6];
          const bondingCurve = ix.accounts[3];



          const bondingCurveIndex = accountKeys.findIndex((accountKey: any) => accountKey.pubkey === bondingCurve);

          if (bondingCurveIndex === -1) {
            console.error("Bonding curve account not found in transaction account keys");
            continue; // Skip to the next instruction
          }

          const preBalances = result.transaction.meta?.preBalances || [];
          const postBalances = result.transaction.meta?.postBalances || [];
          const solAmount = Math.abs(preBalances[bondingCurveIndex] - postBalances[bondingCurveIndex]); // Directly use index
          const preTokenBalances = result.transaction.meta!.preTokenBalances
          const postTokenBalances = result.transaction.meta!.postTokenBalances
          // console.log("preTokenBalances", preTokenBalances)
          // console.log("postTokenBalances", postTokenBalances)
          // 3. Mint Details (Optimize: fetch only once if mint is the same)
          try {
            // const mintAccount = await getMint(solConnection, new PublicKey(mint));
            // decimals = mintAccount.decimals;
            decimals = 6;

            console.log("--------- Trade Data ------------");
            console.log("bondingCurve: ", bondingCurve)
            console.log(`solAmount: ${solAmount}\ntokenAmount: ${tokenAmount}\ntype: ${type}\nmint: ${mint}\ntrader: ${trader}\ndecimals: ${decimals}`);

            const solMint = "So11111111111111111111111111111111111111112";
            if (type === 'buy') {
              baseMint = {
                amount_raw: solAmount.toString(),
                amount: solAmount / 10 ** 9,
                mint: solMint
              };
              quoteMint = {
                amount_raw: tokenAmount.toString(),
                amount: tokenAmount / 10 ** decimals,
                mint: mint
              };
            } else {
              baseMint = {
                amount_raw: solAmount.toString(),
                amount: solAmount / 10 ** 9,
                mint: solMint,
              };
              quoteMint = {
                amount_raw: tokenAmount.toString(),
                amount: tokenAmount / 10 ** decimals,
                mint: mint
              };
            }


          } catch (mintError) {
            console.error("Error fetching mint details:", mintError);
            continue; // Skip if getMint fails
          }
        } catch (ixError) {
          console.error("Error processing instruction:", ixError);
          continue; // Skip to the next instruction on error
        }
        break; // Exit the loop after processing the first valid instruction
      }


      console.log("baseMint, quoteMint", baseMint, quoteMint);

      // 4.  Racing Logic (Conditional Execution)

      if (baseMint && quoteMint) {
        console.timeEnd("pumpfunParsing");

        try {
          if (type === "buy") {
            // const data = await readDataJson("./tradedTokens.json")

            // const isTradedToken = data.some((item: any) => item.mint === quoteMint.mint);
            // console.log("Already Traded Tokens: ", isTradedToken)
            // if (!isTradedToken) {
            const tx = await buyPumpTokenByRacing(
              MAIN_KP,
              new PublicKey(quoteMint.mint),
              Copy_Buy_FixedAmount === 0 ? baseMint.amount * COPY_PERCENT : Copy_Buy_FixedAmount,
              recentBlockhash

            );
            if (tx) {
              updateWalletsHolding(
                accountKeys[0].pubkey,
                quoteMint.mint,
                true,
                quoteMint.amount
              )
            }
            // }
          } else if (type === 'sell') {  // Use else if for clarity and efficiency
            console.time("typesell")
            let botBalance: number = 0;
            const tokenAcc = await getAssociatedTokenAddress(new PublicKey(quoteMint.mint), MAIN_KP.publicKey);
            let sellAmount: number = 0;

            let tokenAmount = await solConnection.getTokenAccountBalance(tokenAcc);
            if (tokenAmount) {
              // @ts-ignore
              botBalance = tokenAmount.value.uiAmount;
            }

            console.log("botBalance", botBalance)
            console.time("targetBalance")
            const targetBalance: number = getWalletTokenBalance(accountKeys[0].pubkey, quoteMint.mint)
            console.timeEnd("targetBalance")
            if (targetBalance === 0) {
              sellAmount = botBalance
            } else {
              const targetSellPercent = quoteMint.amount / targetBalance;
              console.log("targetSellPercent", targetSellPercent)
              sellAmount = targetSellPercent > 0.95 ? botBalance : targetSellPercent * botBalance
            }

            console.timeEnd("typesell")
            const tx = await sellPumpTokenByRacing(
              MAIN_KP,
              new PublicKey(quoteMint.mint),
              sellAmount,
              decimals

            );
            if (tx) {
              updateWalletsHolding(
                accountKeys[0].pubkey,
                quoteMint.mint,
                false,
                quoteMint.amount
              )
            }

          }
        } catch (racingError) {
          console.error("Error in racing functions:", racingError);
        }
      }
    } else {
      console.timeEnd("pumpfunParsing");
      console.log("No buy/sell instructions found.");
    }
  } catch (err) {
    console.log("Err while parsePumpFunHeliusTx...", err)
  }
};

export function convertSignature(signature: Uint8Array): string {
  return base58.encode(Buffer.from(signature));
}

export const parsePumpFunYellowTx = async (meta: any, message: any, accountKeys: string[], signature: string) => {
  // if (z > 0) return;

  if (z === 0) {
    try {

      // const accountKeys = message.accountKeys.map((ak: any) => base58.encode(ak));;

      const pumpProgramIdx = accountKeys.indexOf(PUMP_FUN_PROGRAM_ID);

      // const isLaunch = message?.instructions
      //   .some((item: any) => item.programIdIndex === pumpProgramIdx && item.data[0] === 183) ?? false;
      // if (isLaunch) {
      //   console.log("signature: ", signature)
      //   return;
      // }
      const pumpIxs = message.instructions.filter((ix: any) => {
        const programId = new PublicKey(accountKeys[ix.programIdIndex]).toString();
        return programId === PUMP_FUN_PROGRAM_ID;
      });

      let buySellIxs = pumpIxs.filter((ix: any) => {
        const discriminator = Buffer.from(ix.data).subarray(0, 8);
        return discriminator.equals(buyDiscriminator) || discriminator.equals(sellDiscriminator);
      });

      if (buySellIxs.length === 0 && meta.innerInstructions) {
        const allInstructions = meta.innerInstructions.flatMap((item: any) => item.instructions);
        const matchingInstruction = allInstructions.find((ix: any) => ix.programIdIndex === pumpProgramIdx);
        if (matchingInstruction) buySellIxs.push(matchingInstruction);
      }


      const mintPromises = buySellIxs.map(async (ix: any) => {
        const ixDataArray = base58.decode(base58.encode(Buffer.from(ix.data, 'base64')));
        const ixData = tradeSchema.decode(ixDataArray);
        const type = Buffer.from(ixDataArray.subarray(0, 8)).equals(buyDiscriminator) ? 'buy' : 'sell';
        const tokenAmount = ixData.amount.toString();
        const mintId = ix.accounts[2];
        const mint = accountKeys[mintId]
        return { mint, type, tokenAmount, ix };
      });

      const processedData = await Promise.all(mintPromises);

      let baseMint, quoteMint;

      for (const { mint, type, tokenAmount, ix } of processedData) {
        const bondingCurveIdx = ix.accounts[3];
        const traderIdx = ix.accounts[6];

        const trader = accountKeys[traderIdx]
        const bondingCurve = accountKeys[bondingCurveIdx]
        if (bondingCurveIdx === -1) {
          console.error("Bonding curve account not found in transaction account keys");
          continue;
        }

        let preSolBalance = meta?.preBalances?.[bondingCurveIdx];
        let postSolBalance = meta?.postBalances?.[bondingCurveIdx];

        const swapSolAmount = Math.abs(preSolBalance - postSolBalance);

        let decimals: number = 6;
        const targetSolBalance = meta?.["post" + "Balances"]?.[bondingCurveIdx];
        const tokenBalance = meta?.["post" + 'TokenBalances']?.find((o: any) => o.owner === bondingCurve);
        const progress = Number(postSolBalance) / (10 ** 9) / 85;
        const price = ((Number(targetSolBalance) / (10 ** 9)) + 30 - 0.00123192) / (tokenBalance.uiTokenAmount.uiAmount + 73000000);
        if (swapSolAmount === 0 || tokenAmount === 0) return;
        const baseMintObject = {
          amount_raw: swapSolAmount.toString(),
          amount: swapSolAmount / 10 ** 9,
          mint: "So11111111111111111111111111111111111111112",
        };
        const quoteMintObject = {
          amount_raw: tokenAmount.toString(),
          amount: tokenAmount / 10 ** decimals,
          mint: mint,
        };

        if (type === 'buy') {
          baseMint = baseMintObject;
          quoteMint = quoteMintObject;
        } else {
          baseMint = quoteMintObject;
          quoteMint = baseMintObject;
        }
        if (!baseMint || !quoteMint) return;
        console.log("--------- Trade Data ------------");
        console.log("progress: ", progress)
        console.log("price: ", price)
        console.log("bondingCurve(parsing): ", bondingCurve)
        console.log(`signature: https://solscan.io/tx/${signature}\nsolAmount: ${swapSolAmount}\ntokenAmount: ${tokenAmount}\ntype: ${type}\nmint: ${mint}\ntrader: ${trader}\ndecimals: ${decimals}`);
        console.log("baseMint, quoteMint", baseMint, quoteMint);

        if (type === "buy") {
          const tx = await buyPumpTokenByRacing(
            MAIN_KP,
            new PublicKey(mint),
            baseMint.amount * COPY_PERCENT
          )
          console.log("tx", tx)
          if (tx) {
            updateWalletsHolding(
              accountKeys[0],
              mint,
              true,
              quoteMint.amount
            )
          }
        }
        if (type === 'sell') {
          console.time("calc")
          let botBalance: number = 0;
          const tokenAcc = await getAssociatedTokenAddress(new PublicKey(mint), MAIN_KP.publicKey);
          let sellAmount: number = 0;

          let tokenAmount = await solConnection.getTokenAccountBalance(tokenAcc);
          if (tokenAmount) {
            // @ts-ignore
            botBalance = tokenAmount.value.uiAmount;
          }

          const targetBalance: number = getWalletTokenBalance(accountKeys[0], mint)
          if (targetBalance === 0) {
            sellAmount = botBalance
          } else {
            const targetSellPercent = baseMint.amount / targetBalance;
            console.log("targetSellPercent", targetSellPercent)
            sellAmount = targetSellPercent > 0.95 ? botBalance : targetSellPercent * botBalance
          }
          console.timeEnd("calc")
          const tx = await sellPumpTokenByRacing(
            MAIN_KP,
            new PublicKey(mint),
            sellAmount,
            decimals
          )
          // console.log("tokenBalance", tokenBalance);
          // console.log("sellAmount", sellAmount);

          // const realSellAmount = (tokenBalance < sellAmount ? tokenBalance : sellAmount) * percent;
          // console.log("realSellAmount", realSellAmount);



          console.log("tx", tx)
          if (tx) {
            updateWalletsHolding(
              accountKeys[0],
              mint,
              false,
              baseMint.amount
            )
          }
        }
      }


    } catch (err) {
      console.error("Err while parsing PumpFunYellowTx...", err);
    }
  }
}