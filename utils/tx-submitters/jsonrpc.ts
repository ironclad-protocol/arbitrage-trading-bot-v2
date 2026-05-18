export interface JsonRpcResponse<T> {
  jsonrpc: string;
  id: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export async function solanaRpcSendTransaction(
  url: string,
  base64Tx: string,
  init: RequestInit & {
    skipPreflight?: boolean;
    maxRetries?: number;
    extraParams?: unknown[];
  } = {}
): Promise<string> {
  const {
    skipPreflight = true,
    maxRetries = 0,
    extraParams = [],
    headers: hdrs,
    ...rest
  } = init;
  const params: unknown[] = [
    base64Tx,
    { encoding: "base64", skipPreflight, maxRetries },
    ...extraParams,
  ];
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: Date.now(),
    method: "sendTransaction",
    params,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(hdrs as Record<string, string>),
    },
    body,
    ...rest,
  });
  const json = (await res.json()) as JsonRpcResponse<string>;
  if (json.error) {
    throw new Error(json.error.message || String(json.error.code));
  }
  if (!json.result) {
    throw new Error("sendTransaction: empty result");
  }
  return json.result;
}
