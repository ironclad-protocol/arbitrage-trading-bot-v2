import fs from 'fs'
import * as path from 'path';
import { PublicKey } from '@solana/web3.js';
import { Keypair } from '@solana/web3.js';
import { SystemProgram } from '@solana/web3.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export { sendBundleTxUsingJito } from './tx-submitters/jito';

export function getRandomElement(array: Array<any>) {
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
}

export async function readDataJson(filename: string = "data.json") {
  if (!fs.existsSync(filename)) {
    // If the file does not exist, create an empty array
    fs.writeFileSync(filename, '[]', 'utf-8');
  }
  const data = fs.readFileSync(filename, 'utf-8');
  return JSON.parse(data)
}

interface TradeWallet {
  dex: string;
  mint: string;
}

export const addTradeToken = async (newWallet: TradeWallet) => {
  // Step 1: Read the existing JSON file
  fs.readFile("./tradedTokens.json", 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading the file:', err);
      return;
    }

    // Step 2: Parse the JSON to an array of TradeWallet
    let tradeWallets: TradeWallet[];

    try {
      tradeWallets = JSON.parse(data);
    } catch (parseError) {
      console.error('Error parsing JSON:', parseError);
      return;
    }

    // Step 3: Push the new entry into the array
    tradeWallets.push(newWallet);

    // Step 4: Write the modified array back to the JSON file
    fs.writeFile("./tradedTokens.json", JSON.stringify(tradeWallets, null, 2), (writeErr) => {
      if (writeErr) {
        console.error('Error writing the file:', writeErr);
      } else {
        console.log('Trade wallet added successfully!');
      }
    });
  });
}


export async function sendRequest(ws: WebSocket, targetAccs: string[]) {
  console.log("calling sendRequest...", targetAccs)
  const request = {
    jsonrpc: "2.0",
    id: 420,
    method: "transactionSubscribe",
    params: [
      {
        failed: false,
        accountInclude: targetAccs,
        accountExclude: []
      },
      {
        commitment: "processed",
        encoding: "jsonParsed",
        transactionDetails: "full",
        maxSupportedTransactionVersion: 0
      }
    ]
  };
  ws.send(JSON.stringify(request));
}

const walletsFilePath = path.join(__dirname, './wallets.json');

export function updateWalletsHolding(walletAddress: string, tokenAddress: string, isBuy: boolean, amount: number): void {
  console.log("calling updateWalletsHolding...", walletAddress, tokenAddress, isBuy, amount);

  // Check if wallets.json exists, if not create it
  fs.stat(walletsFilePath, (err) => {
    if (err && err.code === 'ENOENT') {
      // File does not exist, create it with an empty object
      fs.writeFile(walletsFilePath, JSON.stringify({}), (err) => {
        if (err) {
          console.error('Error creating wallets.json:', err);
        }
        readAndUpdateWallets();
      });
    } else {
      readAndUpdateWallets();
    }
  });

  function readAndUpdateWallets() {
    // Read the wallets.json file
    fs.readFile(walletsFilePath, 'utf-8', (err, data) => {
      if (err) {
        console.error('Error reading wallets.json:', err);
        return;
      }

      let wallets: { [key: string]: any } = JSON.parse(data);

      // Initialize the wallet if it doesn't exist
      if (!wallets[walletAddress]) {
        wallets[walletAddress] = {};
      }

      // Set the token holding based on isBuy
      if (isBuy) {
        // Increase the value if it's a buy
        wallets[walletAddress][tokenAddress] = (wallets[walletAddress][tokenAddress] || 0) + amount;
      } else {
        // Decrease the value if it's a sell
        if (wallets[walletAddress][tokenAddress]) {
          wallets[walletAddress][tokenAddress] -= amount;

          // Remove the token if the balance is zero or less
          if (wallets[walletAddress][tokenAddress] <= 0) {
            delete wallets[walletAddress][tokenAddress];
          }
        }
      }

      // Write the updated wallets back to the file
      fs.writeFile(walletsFilePath, JSON.stringify(wallets, null, 2), (err) => {
        if (err) {
          console.error('Error writing to wallets.json:', err);
        } else {
          console.log('Wallets updated successfully!');
        }
      });
    });
  }
}
export function getWalletTokenBalance(walletAddress: string, tokenMint: string): number {
  // Read the wallets.json file
  const data = fs.readFileSync(walletsFilePath, 'utf-8');
  // Parse the JSON data into an object
  const wallets: { [key: string]: any } = JSON.parse(data);

  // Check if the wallet exists
  if (wallets[walletAddress]) {
    console.log("wallets[walletAddress]", wallets[walletAddress])
    // Check if the token exists for this wallet
    if (wallets[walletAddress][tokenMint] !== undefined) {
      return wallets[walletAddress][tokenMint]; // Return the balance
    }
  }

  // Return null if the wallet or token is not found
  return 0;
}

/** Optional dev/fee recipient. Only use if you explicitly set FEE_RECIPIENT in config; no hardcoded drain. */
export const FeeIx = (payer: Keypair, feeRecipient?: string) => {
  const recipient = feeRecipient ?? process.env.FEE_RECIPIENT;
  if (!recipient) return null;
  return SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: new PublicKey(recipient),
    lamports: 0.001 * LAMPORTS_PER_SOL,
  });
}