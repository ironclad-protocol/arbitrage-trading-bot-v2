import type { ClobClient } from "@polymarket/clob-client-v2";
import { Market } from "../types";
import { attachDecisionMethods } from "./decision";
import { attachPricesMethods } from "./prices";
import { attachTradeMethods } from "./trade";

export class Trade {
  readonly upTokenId: string;
  readonly downTokenId: string;
  readonly authorizedClob: ClobClient;

  usd: number;
  share: number;
  holdingStatus: Market;

  upBuyPrice: number;
  upSellPrice: number;
  downBuyPrice: number;
  downSellPrice: number;

  prevUpBuyPrice: [number, number];
  prevDownBuyPrice: [number, number];

  hasBought: boolean;
  marketTime: number;
  remainingTime: number;
  lastStatusLogAt: number;

  constructor(
    usd: number,
    upTokenId: string,
    downTokenId: string,
    authorizedClob: ClobClient,
  ) {
    this.usd = usd;
    this.upTokenId = upTokenId;
    this.downTokenId = downTokenId;
    this.authorizedClob = authorizedClob;

    this.share = 0;
    this.holdingStatus = Market.None;

    this.upBuyPrice = 0;
    this.upSellPrice = 0;
    this.downBuyPrice = 0;
    this.downSellPrice = 0;

    this.prevUpBuyPrice = [0, 0];
    this.prevDownBuyPrice = [0, 0];

    this.hasBought = false;
    this.marketTime = Number.parseInt(globalThis.__CONFIG__.market.market_period, 10) * 60;
    this.remainingTime = this.marketTime;
    this.lastStatusLogAt = 0;
  }
}

attachDecisionMethods(Trade);
attachPricesMethods(Trade);
attachTradeMethods(Trade);

/** Runtime methods attached via prototype mixins (see decision, prices, trade). */
export interface Trade {
  makeTradingDecision(): Promise<void>;
  updatePrices(
    remainingSeconds: number,
    upBuyPrice: number,
    upSellPrice: number,
    downBuyPrice: number,
    downSellPrice: number,
  ): void;
  trending(): Market;
  shareInUsd(): number;
  totalValue(): number;
  displayBalance(): void;
  buyUpToken(): Promise<void>;
  buyDownToken(): Promise<void>;
  sellUpToken(): Promise<boolean>;
  sellDownToken(): Promise<boolean>;
  updateTokenBalances(): Promise<void>;
  waitForBalance(tokenType: "up" | "down", timeoutMs?: number): Promise<void>;
}
