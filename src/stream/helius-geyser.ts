import WebSocket from "ws";

const SUBSCRIPTION_ID = 420;

export interface HeliusTransactionResult {
  signature: string;
  slot: number;
  transaction: {
    transaction: { message: any };
    meta: any;
  };
}

export type GeyserMessageHandler = (result: HeliusTransactionResult) => void;

/**
 * Subscribe to transactions that include any of the given account addresses.
 * Calls handler for each tx; does not block (handler should enqueue, not await).
 */
export function subscribeToAccounts(wsUrl: string, accounts: string[], onTransaction: GeyserMessageHandler): WebSocket {
  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    const request = {
      jsonrpc: "2.0",
      id: SUBSCRIPTION_ID,
      method: "transactionSubscribe",
      params: [
        { failed: false, accountInclude: accounts, accountExclude: [] },
        {
          commitment: "processed",
          encoding: "jsonParsed",
          transactionDetails: "full",
          maxSupportedTransactionVersion: 0,
        },
      ],
    };
    ws.send(JSON.stringify(request));
  });

  ws.on("message", (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString("utf8"));
      const result = msg.params?.result;
      if (!result?.transaction?.meta) return;
      onTransaction(result as HeliusTransactionResult);
    } catch {
      // ignore parse errors
    }
  });

  return ws;
}
