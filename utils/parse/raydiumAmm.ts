import { PublicKey } from "@solana/web3.js";
import { COPY_PERCENT, MAIN_KP, RAYDIUM_AMM_PROGRAM_ID, RAYDIUM_CPMM_PROGRAM_ID, solConnection, WSOL } from "../../config";
import { AccountLayout } from "@solana/spl-token";
import { buyRaydiumTokenByRacing, sellRaydiumTokenByRacing } from "../../dex/raydium";
import { convertSignature } from "./pumpfun";
import base58 from "bs58"
import * as borsh from "@coral-xyz/borsh";
import { sha256 } from '@noble/hashes/sha256';
const tradeSchema = borsh.struct([
  borsh.u64("discriminator"),
  borsh.u64("amount"),
  borsh.u64("solAmount")
]);

const buyDiscriminator = Buffer.from(sha256('global:buy').slice(0, 8));
const sellDiscriminator = Buffer.from(sha256('global:sell').slice(0, 8));

export async function getTokenAddressAndOwnerFromTokenAccount(tokenAccountAddress: string) {
  try {

    const tokenAccountPubkey = new PublicKey(tokenAccountAddress);
    const accountInfo = await solConnection.getAccountInfo(tokenAccountPubkey);

    if (accountInfo === null) {
      return null;
    }

    const accountData = AccountLayout.decode(accountInfo.data);
    const mintAddress = new PublicKey(accountData.mint);

    const tokenAddress = mintAddress.toBase58();
    const ownerAddress = new PublicKey(accountData.owner).toBase58();

    return { tokenAddress, ownerAddress };

  } catch (error) {
    console.error('Error fetching token address:', error);
    return null;
  }
}


export const parseRaydiumAmmHeliusTx = async (meta: any, accountKeys: any[], signature: string) => {
  try {
    let type;
    let baseMint: any = {};
    let quoteMint: any = {};
    console.time("parseRaydiumAmmHeliusTx")


    console.time("parsing")
    // console.log("message", message)
    // console.log("meta", meta)
    // console.log("preTokenBalances", meta.preTokenBalances)
    // console.log("postTokenBalances", meta.postTokenBalances)

    // Find the desired element
    const __preSolAmount = meta.preTokenBalances.find((item: any) =>
      item.mint === WSOL &&
      item.owner === '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'
    );
    const __postSolAmount = meta.postTokenBalances.find((item: any) =>
      item.mint === WSOL &&
      item.owner === '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'
    );

   let poolId;
    // console.time("owner2")
    // const accountInfo_ = await solConnection.getParsedAccountInfo(new PublicKey(accountKeys[2].pubkey));
    // console.log("owner:", accountInfo_?.value?.owner);
    // console.timeEnd("owner2")

    // if(accountInfo_?.value?.owner.toBase58() === RAYDIUM_AMM_PROGRAM_ID){
    //   poolId = new PublicKey(accountKeys[2].pubkey)
    // }else{
    //   poolId = new PublicKey(accountKeys[3].pubkey)
    // }

    poolId = new PublicKey(accountKeys[2].pubkey === 'So11111111111111111111111111111111111111112' ? accountKeys[3].pubkey : accountKeys[2].pubkey)

    
    // Get the amount if the token was found
    const preSolAmount = __preSolAmount ? __preSolAmount.uiTokenAmount.uiAmount : null;
    const postSolAmount = __postSolAmount ? __postSolAmount.uiTokenAmount.uiAmount : null;


    // console.log("preSolAmount", preSolAmount)
    // console.log("postSolAmount", postSolAmount)

    let matchingPreTokenBalance: any = meta.preTokenBalances.find((item: any) => item.owner !== '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1' && item.uiTokenAmount.uiAmount !== 0) as any;
    console.log("matchingPreTokenBalance", matchingPreTokenBalance)
    if (matchingPreTokenBalance === undefined) {
      matchingPreTokenBalance = {
        mint: '',
        uiTokenAmount: {
          uiAmount: 0,
          decimals: 0,
          amount: '0',
          uiAmountString: '0'
        }
      }
    }

    let matchingPostTokenBalance = meta.postTokenBalances.find((item: any) => item.owner !== '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1' && item.uiTokenAmount.uiAmount !== 0) as any;

    console.log("matchingPostTokenBalance", matchingPostTokenBalance)
    if (matchingPostTokenBalance === undefined) {
      matchingPostTokenBalance = {
        mint: '',
        uiTokenAmount: {
          uiAmount: 0,
          decimals: 0,
          amount: '0',
          uiAmountString: '0'
        }
      }
    }
    console.log("signature:", signature)
    if (matchingPostTokenBalance.mint === WSOL && matchingPreTokenBalance.mint === WSOL) {
      console.log("Failed Tx")
      return;
    }

    if (matchingPreTokenBalance.uiTokenAmount.uiAmount > matchingPostTokenBalance.uiTokenAmount.uiAmount) {
      type = 'sell'
      baseMint['mint'] = matchingPreTokenBalance.mint;
      baseMint['amount_raw'] = ((matchingPreTokenBalance.uiTokenAmount.uiAmount - matchingPostTokenBalance.uiTokenAmount.uiAmount) * 10 ** matchingPreTokenBalance.uiTokenAmount.decimals).toString()
      baseMint['amount'] = matchingPreTokenBalance.uiTokenAmount.uiAmount - matchingPostTokenBalance.uiTokenAmount.uiAmount
      baseMint['decimals'] = matchingPreTokenBalance.uiTokenAmount.decimals
      quoteMint['mint'] = WSOL;
      quoteMint['amount'] = preSolAmount - postSolAmount
    } else if (matchingPreTokenBalance.uiTokenAmount.uiAmount < matchingPostTokenBalance.uiTokenAmount.uiAmount) {
      type = 'buy'
      baseMint['mint'] = WSOL;
      baseMint['amount'] = postSolAmount - preSolAmount

      quoteMint['mint'] = matchingPostTokenBalance.mint;
      quoteMint['decimals'] = matchingPostTokenBalance.uiTokenAmount.decimals
      quoteMint['amount_raw'] = ((matchingPostTokenBalance.uiTokenAmount.uiAmount - matchingPreTokenBalance.uiTokenAmount.uiAmount) * 10 ** matchingPreTokenBalance.uiTokenAmount.decimals).toString()
      quoteMint['amount'] = matchingPostTokenBalance.uiTokenAmount.uiAmount - matchingPreTokenBalance.uiTokenAmount.uiAmount
    } else {
      type = 'sell'
      baseMint['mint'] = matchingPreTokenBalance.mint;
      baseMint['amount_raw'] = (matchingPreTokenBalance.uiTokenAmount.uiAmount * 10 ** matchingPreTokenBalance.uiTokenAmount.decimals).toString()
      baseMint['amount'] = matchingPreTokenBalance.uiTokenAmount.uiAmount
      baseMint['decimals'] = matchingPreTokenBalance.uiTokenAmount.decimals
      quoteMint['mint'] = WSOL;
      quoteMint['amount'] = preSolAmount - postSolAmount
    }

    console.log("baseMint", baseMint)
    console.log("quoteMint", quoteMint)
    console.log("type", type)
    console.log("poolId", poolId.toBase58())
    console.timeEnd("parsing")
    if (baseMint.mint !== '' && baseMint.amount !== 0 && quoteMint.mint !== '' && quoteMint.amount !== 0) {
      // await sellRaydiumTokenByRacing(MAIN_KP, new PublicKey("7Bj9cswhqYLXTNX51dT4vjkt6XwhwuS5bNQ9YGriRm6w"), 9, new PublicKey("7m9xrShvHccir4JzBzHTRUHjVUSKTbLMz1bejeCLGTEC"), 2201)
      if (type === 'buy') {
        await buyRaydiumTokenByRacing(MAIN_KP, new PublicKey(quoteMint.mint), quoteMint.decimals, poolId, baseMint.amount * COPY_PERCENT)

      } else {
        await sellRaydiumTokenByRacing(MAIN_KP, new PublicKey(baseMint.mint), baseMint.decimals, poolId, baseMint.amount * COPY_PERCENT)

      }
    }

    console.timeEnd("parseRaydiumAmmHeliusTx")
  } catch (err) {
    console.log("Err while parseRaydiumHeliusTx: ", err)
  }
}




export const parseRaydiumAmmYellowTx = async (meta: any, message: any, accountKeys: string[], signature: string) => {

  try {
    let type;
    let baseMint: any = {};
    let quoteMint: any = {};
    console.time("parseRaydiumAmmYellowTx")


    console.time("parsing")
    // console.log("message", message)
    // console.log("meta", meta)
    // console.log("preTokenBalances", meta.preTokenBalances)
    // console.log("postTokenBalances", meta.postTokenBalances)

    // Find the desired element
    const __preSolAmount = meta.preTokenBalances.find((item: any) =>
      item.mint === WSOL &&
      item.owner === '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'
    );
    const __postSolAmount = meta.postTokenBalances.find((item: any) =>
      item.mint === WSOL &&
      item.owner === '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'
    );


    // console.log("accountKeys", accountKeys)
    // console.time("owner")
    // const accountInfo = await solConnection.getAccountInfo(new PublicKey(accountKeys[2]));
    // console.log("owner:", accountInfo?.owner)
    // console.timeEnd("owner")
    console.time("owner2")
    const accountInfo_ = await solConnection.getParsedAccountInfo(new PublicKey(accountKeys[2]));
    console.log("owner:", accountInfo_?.value?.owner);
    console.timeEnd("owner2")
    let poolId;
    if(accountInfo_?.value?.owner.toBase58() === RAYDIUM_AMM_PROGRAM_ID){
      poolId = new PublicKey(accountKeys[2])
    }else{
      poolId = new PublicKey(accountKeys[3])
    }

    
    // Get the amount if the token was found
    const preSolAmount = __preSolAmount ? __preSolAmount.uiTokenAmount.uiAmount : null;
    const postSolAmount = __postSolAmount ? __postSolAmount.uiTokenAmount.uiAmount : null;


    console.log("preSolAmount", preSolAmount)
    console.log("postSolAmount", postSolAmount)

    let matchingPreTokenBalance: any = meta.preTokenBalances.find((item: any) => item.owner !== '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1' && item.uiTokenAmount.uiAmount !== 0) as any;


    console.log("matchingPreTokenBalance", matchingPreTokenBalance)
    if (matchingPreTokenBalance === undefined) {
      matchingPreTokenBalance = {
        mint: '',
        uiTokenAmount: {
          uiAmount: 0,
          decimals: 0,
          amount: '0',
          uiAmountString: '0'
        }
      }
    }

    let matchingPostTokenBalance = meta.postTokenBalances.find((item: any) => item.owner !== '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1' && item.uiTokenAmount.uiAmount !== 0) as any;

    console.log("matchingPostTokenBalance", matchingPostTokenBalance)
    if (matchingPostTokenBalance === undefined) {
      matchingPostTokenBalance = {
        mint: '',
        uiTokenAmount: {
          uiAmount: 0,
          decimals: 0,
          amount: '0',
          uiAmountString: '0'
        }
      }
    }
    console.log("signature:", signature)
    if (matchingPostTokenBalance.mint === WSOL && matchingPreTokenBalance.mint === WSOL) {
      console.log("Failed Tx")
      return;
    }

    if (matchingPreTokenBalance.uiTokenAmount.uiAmount > matchingPostTokenBalance.uiTokenAmount.uiAmount) {
      type = 'sell'
      baseMint['mint'] = matchingPreTokenBalance.mint;
      baseMint['amount_raw'] = ((matchingPreTokenBalance.uiTokenAmount.uiAmount - matchingPostTokenBalance.uiTokenAmount.uiAmount) * 10 ** matchingPreTokenBalance.uiTokenAmount.decimals).toString()
      baseMint['amount'] = matchingPreTokenBalance.uiTokenAmount.uiAmount - matchingPostTokenBalance.uiTokenAmount.uiAmount
      baseMint['decimals'] = matchingPreTokenBalance.uiTokenAmount.decimals
      quoteMint['mint'] = WSOL;
      quoteMint['amount'] = preSolAmount - postSolAmount
    } else if (matchingPreTokenBalance.uiTokenAmount.uiAmount < matchingPostTokenBalance.uiTokenAmount.uiAmount) {
      type = 'buy'
      baseMint['mint'] = WSOL;
      baseMint['amount'] = postSolAmount - preSolAmount

      quoteMint['mint'] = matchingPostTokenBalance.mint;
      quoteMint['decimals'] = matchingPostTokenBalance.uiTokenAmount.decimals
      quoteMint['amount_raw'] = ((matchingPostTokenBalance.uiTokenAmount.uiAmount - matchingPreTokenBalance.uiTokenAmount.uiAmount) * 10 ** matchingPreTokenBalance.uiTokenAmount.decimals).toString()
      quoteMint['amount'] = matchingPostTokenBalance.uiTokenAmount.uiAmount - matchingPreTokenBalance.uiTokenAmount.uiAmount
    } else {
      type = 'sell'
      baseMint['mint'] = matchingPreTokenBalance.mint;
      baseMint['amount_raw'] = (matchingPreTokenBalance.uiTokenAmount.uiAmount * 10 ** matchingPreTokenBalance.uiTokenAmount.decimals).toString()
      baseMint['amount'] = matchingPreTokenBalance.uiTokenAmount.uiAmount
      baseMint['decimals'] = matchingPreTokenBalance.uiTokenAmount.decimals
      quoteMint['mint'] = WSOL;
      quoteMint['amount'] = preSolAmount - postSolAmount
    }

    console.log("baseMint", baseMint)
    console.log("quoteMint", quoteMint)
    console.log("type", type)
    console.log("poolId", poolId.toBase58())
    console.timeEnd("parsing")
    if (baseMint.mint !== '' && baseMint.amount !== 0 && quoteMint.mint !== '' && quoteMint.amount !== 0) {
      if (type === 'buy') {
        await buyRaydiumTokenByRacing(MAIN_KP, new PublicKey(quoteMint.mint), quoteMint.decimals, poolId, baseMint.amount * COPY_PERCENT)

      } else {
        // await sellRaydiumTokenByRacing(MAIN_KP, new PublicKey(baseMint.mint), baseMint.decimals, poolId, baseMint.amount * COPY_PERCENT)
      }
    }

    console.timeEnd("parseRaydiumAmmYellowTx")
  } catch (err) {
    console.log("Err while parseRaydiumYellowTx: ", err)
  }
}