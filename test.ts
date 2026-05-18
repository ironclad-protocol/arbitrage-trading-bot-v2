
import Client, {
  CommitmentLevel,
  SubscribeRequest,
  SubscribeUpdate,
  SubscribeUpdateTransaction,
} from "@triton-one/yellowstone-grpc";
import { CompiledInstruction } from "@triton-one/yellowstone-grpc/dist/grpc/solana-storage";
import { ClientDuplexStream } from '@grpc/grpc-js';
import { readDataJson } from "./utils/utils";
import { PUMP_FUN_MINT_AUTHORITY, PUMP_FUN_PROGRAM_ID, RAYDIUM_AMM_PROGRAM_ID } from "./config";
import { convertSignature, parsePumpFunYellowTx } from "./utils/parse/pumpfun";
import { parseRaydiumAmmYellowTx } from "./utils/parse/raydiumAmm";
import base58 from "bs58"


const COMMITMENT = CommitmentLevel.PROCESSED;

// Configuration
const FILTER_CONFIG = {
  programIds: [PUMP_FUN_PROGRAM_ID],
  instructionDiscriminators: [],
  requiredAccounts: [PUMP_FUN_PROGRAM_ID, PUMP_FUN_MINT_AUTHORITY],
};

const ACCOUNTS_TO_INCLUDE = [{
  name: "mint",
  index: 0
}];

// Type definitions
interface FormattedTransactionData {
  signature: string;
  slot: string;
  mint: string;
}
export const client = new Client('http://grpc.solanavibestation.com:10000', undefined, undefined);
export async function runGeyser(): Promise<void> {
  console.log("calling runGeyser...")

  const stream = await client.subscribe();
  const copyWallets: string[] = Object.keys(await readDataJson("copyWallets.json"));
  console.log("copyWallets", copyWallets)
  const request = createSubscribeRequest(copyWallets);

  try {
    await sendSubscribeRequest(stream, request);
    console.log('Geyser connection established - watching copy trading wallets. \n');
    await handleStreamEvents(stream, copyWallets);
  } catch (error) {
    console.error('Error in subscription process:', error);
    // stream.end();
  }
}

// Helper functions
function createSubscribeRequest(wallets: string[]): SubscribeRequest {
  console.log("calling createSubscribeRequest...")
  return {
    accounts: {},
    slots: {},
    transactions: {
      pumpFun: {
        accountInclude: ['b7wjEmnrAoioYEKGGfTiPqabGtDaGpUo5zM111ckZaU'],
        accountExclude: [],
        accountRequired: []
      }
    },
    transactionsStatus: {},
    entry: {},
    blocks: {},
    blocksMeta: {},
    commitment: COMMITMENT,
    accountsDataSlice: [],
    ping: undefined,
  };
}

function sendSubscribeRequest(
  stream: ClientDuplexStream<SubscribeRequest, SubscribeUpdate>,
  request: SubscribeRequest
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.write(request, (err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

let k = 0;
function handleStreamEvents(stream: ClientDuplexStream<SubscribeRequest, SubscribeUpdate>, wallets: string[]): Promise<void> {

  return new Promise<void>((resolve, reject) => {

    stream.on('data', async (data) => {
      // console.log("data", data)
      if (!data.transaction) return;
  
      const result = await handleData(data, wallets)
    });
    stream.on("error", (error: Error) => {
      console.error('Stream error:', error);
      reject(error);
      stream.end();
    });
    stream.on("end", () => {
      console.log('Stream ended');
      resolve();
    });
    stream.on("close", () => {
      console.log('Stream closed');
      resolve();
    });
  });
}

async function handleData(data: SubscribeUpdate, wallets: string[]) {
  // if (!isSubscribeUpdateTransaction(data) || !data.filters.includes('pumpFun') || !data.filters.includes('raydium')) {
  //   return;
  // }
  
  const transaction = data.transaction?.transaction;
  const message = transaction?.transaction?.message;
  const meta = transaction?.meta;
  if (!transaction || !message) {
    return;
  }
  const signature = convertSignature(transaction.signature);
  console.log("signature", signature)
  const accountKeys = message.accountKeys.map((ak: any) => base58.encode(ak));

  if (accountKeys.indexOf(PUMP_FUN_PROGRAM_ID) >= 0) {
    await parsePumpFunYellowTx(meta, message, accountKeys, signature)
  } else if (accountKeys.indexOf(RAYDIUM_AMM_PROGRAM_ID) >= 0) {

    // await parseRaydiumAmmYellowTx(meta, message, accountKeys, signature)
  }

}

export function formatDate() {
  const options: any = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short'
  };

  const now = new Date();
  return now.toLocaleString('en-US', options);
}

function isSubscribeUpdateTransaction(data: SubscribeUpdate): data is SubscribeUpdate & { transaction: SubscribeUpdateTransaction } {
  return (
    'transaction' in data &&
    typeof data.transaction === 'object' &&
    data.transaction !== null &&
    'slot' in data.transaction &&
    'transaction' in data.transaction
  );
}


function matchesInstructionDiscriminator(ix: CompiledInstruction): boolean {
  return ix?.data && FILTER_CONFIG.instructionDiscriminators.some(discriminator =>
    Buffer.from(discriminator).equals(ix.data.slice(0, 8))
  );
}

runGeyser()