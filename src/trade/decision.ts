import chalk from "chalks-log";
import { GLOBAL_TX_PROCESS, TxProcess } from "../constant";
import { Market } from "../types";
import type { Trade } from "./index";
import type { TradePrototype } from "./types";

declare module "./index" {
  interface Trade {
    makeTradingDecision(): Promise<void>;
  }
}

function remainingTimeRatio(marketTime: number, remainingTime: number): number {
  return (marketTime - remainingTime) / marketTime;
}

function upPriceRatio(upBuyPrice: number): number {
  return Math.abs(upBuyPrice - 0.5) / 0.5;
}

function isRatioInRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

async function tryEmergencySwap(
  trade: Trade,
  priceRatio: number,
  targetSide: Market.Up | Market.Down,
): Promise<void> {
  const [emergencyMin, emergencyMax] = globalThis.__CONFIG__.trade_2.emergency_swap_price;
  if (!isRatioInRange(priceRatio, emergencyMin, emergencyMax)) {
    return;
  }

  const label = targetSide === Market.Up ? "UP" : "DOWN";
  console.log(chalk.cyan(`Emergency swap: opening ${label} after successful exit`));

  if (targetSide === Market.Up) {
    await trade.buyUpToken();
  } else {
    await trade.buyDownToken();
  }
}

export function attachDecisionMethods(TradeClass: TradePrototype): void {
  TradeClass.prototype.makeTradingDecision = async function (this: Trade): Promise<void> {
    if (GLOBAL_TX_PROCESS.current === TxProcess.Working) {
      console.log(chalk.gray("Trading engine busy — skipping decision tick"));
      return;
    }

    const timeRatio = remainingTimeRatio(this.marketTime, this.remainingTime);
    const priceRatio = upPriceRatio(this.upBuyPrice);
    const config = globalThis.__CONFIG__;

    switch (config.strategy) {
      case "trade_1": {
        const shouldExit =
          timeRatio > config.trade_1.exit_time_ratio ||
          priceRatio > config.trade_1.exit_price_ratio;

        if (!shouldExit) {
          return;
        }

        if (this.holdingStatus === Market.Up) {
          await this.sellUpToken();
        } else if (this.holdingStatus === Market.Down) {
          await this.sellDownToken();
        }
        break;
      }

      case "trade_2": {
        const inExitRange = config.trade_2.exit_price_ratio_range.some(([min, max]) =>
          isRatioInRange(priceRatio, min, max),
        );
        const [entryMin, entryMax] = config.trade_2.entry_price_ratio;
        const inEntryRange = isRatioInRange(priceRatio, entryMin, entryMax);
        const entryTimeMet = timeRatio > config.trade_2.entry_time_ratio;

        switch (this.holdingStatus) {
          case Market.Up: {
            if (!inExitRange) {
              break;
            }

            const sold = await this.sellUpToken();
            if (!sold) {
              console.warn(chalk.yellow("Sell failed — emergency swap skipped"));
              break;
            }

            await tryEmergencySwap(this, priceRatio, Market.Down);
            break;
          }

          case Market.Down: {
            if (!inExitRange) {
              break;
            }

            const sold = await this.sellDownToken();
            if (!sold) {
              console.warn(chalk.yellow("Sell failed — emergency swap skipped"));
              break;
            }

            await tryEmergencySwap(this, priceRatio, Market.Up);
            break;
          }

          default: {
            if (this.hasBought || !entryTimeMet || !inEntryRange) {
              break;
            }

            if (this.upBuyPrice > this.downBuyPrice) {
              await this.buyUpToken();
            } else {
              await this.buyDownToken();
            }
            break;
          }
        }
        break;
      }

      default:
        break;
    }
  };
}
