import chalk from "chalks-log";
import { GLOBAL_TX_PROCESS, TxProcess } from "../constant";
import { Market } from "../types";
import { STATUS_LOG_INTERVAL_MS } from "./constants";
import type { TradePrototype } from "./types";

declare module "./index" {
  interface Trade {
    shareInUsd(): number;
    totalValue(): number;
    displayBalance(): void;
    updatePrices(
      remainingSeconds: number,
      upBuyPrice: number,
      upSellPrice: number,
      downBuyPrice: number,
      downSellPrice: number,
    ): void;
    trending(): Market;
  }
}

function toFiniteNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function trendLabel(trend: Market): string {
  if (trend === Market.Up) return "🟢";
  if (trend === Market.Down) return "🔴";
  return "⚪";
}

function trendName(trend: Market): string {
  if (trend === Market.Up) return "UP";
  if (trend === Market.Down) return "DOWN";
  return "FLAT";
}

function positionLabel(position: Market): string {
  if (position === Market.Up) return "🟩";
  if (position === Market.Down) return "🟥";
  return "⬛";
}

function positionName(position: Market): string {
  if (position === Market.Up) return "UP";
  if (position === Market.Down) return "DOWN";
  return "NONE";
}

function formatTrend(trend: Market): string {
  return `${trendName(trend)} ${trendLabel(trend)}`;
}

function formatPosition(position: Market): string {
  return `${positionName(position)} ${positionLabel(position)}`;
}

function engineState(): string {
  return GLOBAL_TX_PROCESS.current === TxProcess.Working ? "BUSY" : "IDLE";
}

export function attachPricesMethods(TradeClass: TradePrototype): void {
  TradeClass.prototype.shareInUsd = function (): number {
    if (this.holdingStatus === Market.Up) {
      return this.share * this.upSellPrice;
    }
    if (this.holdingStatus === Market.Down) {
      return this.share * this.downSellPrice;
    }
    return 0;
  };

  TradeClass.prototype.totalValue = function (): number {
    return this.usd + this.shareInUsd();
  };

  TradeClass.prototype.displayBalance = function (): void {
    const shareValue = this.shareInUsd();
    const total = this.totalValue();

    console.log(
      chalk.gray(
        [
          "Portfolio",
          `cash=$${this.usd.toFixed(2)}`,
          `shares=${this.share.toFixed(2)}`,
          `position=${formatPosition(this.holdingStatus)}`,
          `shareValue=$${shareValue.toFixed(2)}`,
          `total=$${total.toFixed(2)}`,
          `engine=${engineState()}`,
          `trend=${formatTrend(this.trending())}`,
        ].join(" | "),
      ),
    );
  };

  TradeClass.prototype.updatePrices = function (
    remainingSeconds: number,
    upBuyPrice: number,
    upSellPrice: number,
    downBuyPrice: number,
    downSellPrice: number,
  ): void {
    const nextUpBuy = toFiniteNumber(upBuyPrice);
    const nextUpSell = toFiniteNumber(upSellPrice);
    const nextDownBuy = toFiniteNumber(downBuyPrice);
    const nextDownSell = toFiniteNumber(downSellPrice);

    const timeRatio = (this.marketTime - remainingSeconds) / this.marketTime;
    const priceRatio = Math.abs(nextUpBuy - 0.5) / 0.5;

    if (this.upBuyPrice !== this.prevUpBuyPrice[1]) {
      this.prevUpBuyPrice = [this.prevUpBuyPrice[1], this.upBuyPrice];
    }

    if (this.downBuyPrice !== this.prevDownBuyPrice[1]) {
      this.prevDownBuyPrice = [this.prevDownBuyPrice[1], this.downBuyPrice];
    }

    this.upBuyPrice = nextUpBuy;
    this.upSellPrice = nextUpSell;
    this.downBuyPrice = nextDownBuy;
    this.downSellPrice = nextDownSell;
    this.remainingTime = remainingSeconds;

    const now = Date.now();
    if (now - this.lastStatusLogAt < STATUS_LOG_INTERVAL_MS) {
      return;
    }

    const upSpread = this.upSellPrice - this.upBuyPrice;
    const downSpread = this.downSellPrice - this.downBuyPrice;
    const signalScore = timeRatio * priceRatio;

    console.log(
      chalk.white(
        [
          "Market",
          `tMinus=${remainingSeconds}s/${this.marketTime}s`,
          `up=${this.upBuyPrice.toFixed(2)}/${this.upSellPrice.toFixed(2)} spread=${upSpread.toFixed(2)}`,
          `down=${this.downBuyPrice.toFixed(2)}/${this.downSellPrice.toFixed(2)} spread=${downSpread.toFixed(2)}`,
          `upRatio=${priceRatio.toFixed(2)}`,
          `timeRatio=${timeRatio.toFixed(2)}`,
          `score=${signalScore.toFixed(2)}`,
          `trend=${formatTrend(this.trending())}`,
          `position=${formatPosition(this.holdingStatus)}`,
          `engine=${engineState()}`,
        ].join(" | "),
      ),
    );

    this.displayBalance();
    this.lastStatusLogAt = now;
  };

  TradeClass.prototype.trending = function (): Market {
    const threshold = Math.abs(0.5 - this.upBuyPrice) > 0.35 ? 0.02 : 0.03;

    const p0 = Math.floor(this.prevUpBuyPrice[0] / threshold) * threshold;
    const p1 = Math.floor(this.prevUpBuyPrice[1] / threshold) * threshold;
    const p = Math.floor(this.upBuyPrice / threshold) * threshold;

    if (Math.max(p0, p1) < p) return Market.Up;
    if (Math.min(p0, p1) > p) return Market.Down;
    return Market.None;
  };
}
