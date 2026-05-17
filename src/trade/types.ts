import type { ClobClient } from "@polymarket/clob-client-v2";
import type { Trade } from "./index";

export type TradeConstructor = new (
  usd: number,
  upTokenId: string,
  downTokenId: string,
  clobClient: ClobClient,
) => Trade;

export interface TradePrototype {
  prototype: Trade;
}
