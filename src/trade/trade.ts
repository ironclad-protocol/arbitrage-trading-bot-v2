import { AssetType, OrderType, Side } from "@polymarket/clob-client-v2";
import chalk from "chalks-log";
import { GLOBAL_TX_PROCESS, TxProcess } from "../constant";
import { Market } from "../types";
import { sleep } from "../utils";
import { retryWithInstantRetry } from "../utils/retry";
import {
  BALANCE_POLL_TIMEOUT_MS,
  POST_SELL_SETTLE_DELAY_MS,
  PRICE_POLL_INTERVAL_MS,
} from "./constants";
import type { Trade } from "./index";
import type { TradePrototype } from "./types";

declare module "./index" {
  interface Trade {
    buyUpToken(): Promise<void>;
    buyDownToken(): Promise<void>;
    sellUpToken(): Promise<boolean>;
    sellDownToken(): Promise<boolean>;
    updateTokenBalances(): Promise<void>;
    waitForBalance(tokenType: "up" | "down", timeoutMs?: number): Promise<void>;
  }
}

const COLLATERAL_DECIMALS = 1e6;

type OutcomeSide = "up" | "down";

function parseCollateralBalance(raw: string): number {
  return Number.parseFloat(raw) / COLLATERAL_DECIMALS;
}

function isUnauthorizedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const err = error as { status?: number; data?: { error?: string } };
  return err.status === 401 || Boolean(err.data?.error?.includes("Unauthorized"));
}

function logAuthFailure(context: string): void {
  console.error(
    chalk.red(
      `${context}: API authentication failed. Verify signer/funder configuration and API credentials.`,
    ),
  );
}

function roundUsd(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function attachTradeMethods(TradeClass: TradePrototype): void {
  TradeClass.prototype.updateTokenBalances = async function (this: Trade): Promise<void> {
    try {
      const [upBalance, downBalance, usdBalance] = await Promise.all([
        this.authorizedClob.getBalanceAllowance({
          asset_type: AssetType.CONDITIONAL,
          token_id: this.upTokenId,
        }),
        this.authorizedClob.getBalanceAllowance({
          asset_type: AssetType.CONDITIONAL,
          token_id: this.downTokenId,
        }),
        this.authorizedClob.getBalanceAllowance({
          asset_type: AssetType.COLLATERAL,
        }),
      ]);

      const upShares = parseCollateralBalance(upBalance.balance);
      const downShares = parseCollateralBalance(downBalance.balance);
      const cashUsd = parseCollateralBalance(usdBalance.balance);

      if (upShares > 0) {
        this.share = upShares;
        this.holdingStatus = Market.Up;
      } else if (downShares > 0) {
        this.share = downShares;
        this.holdingStatus = Market.Down;
      } else {
        this.share = 0;
        this.holdingStatus = Market.None;
      }

      this.usd = cashUsd;

      console.log(
        chalk.gray(
          `Balances | UP=${upShares.toFixed(4)} | DOWN=${downShares.toFixed(4)} | USD=$${cashUsd.toFixed(2)}`,
        ),
      );
    } catch (error) {
      console.error(chalk.red("Failed to refresh token balances:"), error);
    }
  };

  TradeClass.prototype.waitForBalance = async function (
    this: Trade,
    tokenType: OutcomeSide,
    timeoutMs: number = BALANCE_POLL_TIMEOUT_MS,
  ): Promise<void> {
    const startedAt = Date.now();
    console.log(chalk.gray(`Waiting for ${tokenType.toUpperCase()} token settlement...`));

    while (Date.now() - startedAt < timeoutMs) {
      try {
        await this.updateTokenBalances();

        const settled =
          tokenType === "up"
            ? this.holdingStatus === Market.Up && this.share > 0
            : this.holdingStatus === Market.Down && this.share > 0;

        if (settled) {
          console.log(chalk.green(`${tokenType.toUpperCase()} position confirmed on-chain`));
          return;
        }
      } catch (error) {
        console.error(chalk.red("Balance poll error:"), error);
      }

      await sleep(PRICE_POLL_INTERVAL_MS);
    }

    throw new Error(
      `${tokenType.toUpperCase()} token balance not received within ${timeoutMs / 1000}s`,
    );
  };

  TradeClass.prototype.buyUpToken = async function (this: Trade): Promise<void> {
    await executeBuy(this, {
      label: "UP",
      tokenId: this.upTokenId,
      buyPrice: this.upBuyPrice,
    });
  };

  TradeClass.prototype.buyDownToken = async function (this: Trade): Promise<void> {
    await executeBuy(this, {
      label: "DOWN",
      tokenId: this.downTokenId,
      buyPrice: this.downBuyPrice,
    });
  };

  TradeClass.prototype.sellUpToken = async function (this: Trade): Promise<boolean> {
    return executeSell(this, {
      label: "UP",
      tokenId: this.upTokenId,
      sellPrice: this.upSellPrice,
      expectedHolding: Market.Up,
    });
  };

  TradeClass.prototype.sellDownToken = async function (this: Trade): Promise<boolean> {
    return executeSell(this, {
      label: "DOWN",
      tokenId: this.downTokenId,
      sellPrice: this.downSellPrice,
      expectedHolding: Market.Down,
    });
  };
}

interface BuyParams {
  label: string;
  tokenId: string;
  buyPrice: number;
}

async function executeBuy(trade: Trade, params: BuyParams): Promise<void> {
  const { label, tokenId, buyPrice } = params;

  if (trade.hasBought) {
    console.log(chalk.gray(`Entry skipped — position already opened this market (${label})`));
    return;
  }

  if (!tokenId || !Number.isFinite(buyPrice) || buyPrice <= 0) {
    console.error(chalk.red(`Cannot buy ${label}: missing token id or invalid price`));
    return;
  }

  const tradeAmount = roundUsd(globalThis.__CONFIG__.trade_usd ?? trade.usd);
  if (!Number.isFinite(tradeAmount) || tradeAmount <= 0) {
    console.error(chalk.red(`Cannot buy ${label}: invalid trade amount`));
    return;
  }

  const shareSize = Math.floor(tradeAmount / buyPrice);
  if (shareSize <= 0) {
    console.error(chalk.red(`Cannot buy ${label}: trade size resolves to zero shares`));
    return;
  }

  try {
    GLOBAL_TX_PROCESS.current = TxProcess.Working;
    const maxRetries = globalThis.__CONFIG__.max_retries ?? 3;

    const order = await retryWithInstantRetry(
      async () => {
        const result = await trade.authorizedClob.createAndPostMarketOrder(
          {
            tokenID: tokenId,
            amount: tradeAmount,
            price: buyPrice,
            side: Side.BUY,
          },
          undefined,
          OrderType.FAK,
        );

        if (!result.success) {
          throw new Error(`Buy ${label} rejected: ${result.error}`);
        }

        return result;
      },
      maxRetries,
      `Buy ${label}`,
    );

    console.log(chalk.green(`Buy ${label} order posted`), order);
    trade.hasBought = true;
    await trade.waitForBalance(label.toLowerCase() as OutcomeSide);
  } catch (error) {
    console.error(chalk.red(`Buy ${label} failed:`), error);
    if (isUnauthorizedError(error)) {
      logAuthFailure(`Buy ${label}`);
    }
  } finally {
    GLOBAL_TX_PROCESS.current = TxProcess.Idle;
  }
}

interface SellParams {
  label: string;
  tokenId: string;
  sellPrice: number;
  expectedHolding: Market.Up | Market.Down;
}

async function executeSell(trade: Trade, params: SellParams): Promise<boolean> {
  const { label, tokenId, sellPrice, expectedHolding } = params;

  if (!tokenId || !Number.isFinite(sellPrice) || sellPrice <= 0) {
    console.error(chalk.red(`Cannot sell ${label}: missing token id or invalid price`));
    return false;
  }

  await trade.updateTokenBalances();

  if (trade.holdingStatus !== expectedHolding || trade.share <= 0) {
    console.error(chalk.red(`Cannot sell ${label}: no open position`));
    return false;
  }

  const balance = await trade.authorizedClob.getBalanceAllowance({
    asset_type: AssetType.CONDITIONAL,
    token_id: tokenId,
  });

  const shares = parseCollateralBalance(balance.balance);
  const rawAmount = Number.parseFloat(balance.balance);

  if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(rawAmount) || rawAmount <= 0) {
    console.error(chalk.red(`Cannot sell ${label}: invalid on-chain balance`));
    return false;
  }

  console.log(
    chalk.gray(
      `Selling ${label} | price=${sellPrice.toFixed(4)} | shares=${shares.toFixed(4)} | raw=${balance.balance}`,
    ),
  );

  try {
    GLOBAL_TX_PROCESS.current = TxProcess.Working;
    const maxRetries = globalThis.__CONFIG__.max_retries ?? 3;

    const order = await retryWithInstantRetry(
      async () => {
        const result = await trade.authorizedClob.createAndPostMarketOrder(
          {
            tokenID: tokenId,
            amount: rawAmount,
            side: Side.SELL,
          },
          undefined,
          OrderType.FAK,
        );

        if (!result.success) {
          throw new Error(`Sell ${label} rejected: ${result.error}`);
        }

        return result;
      },
      maxRetries,
      `Sell ${label}`,
    );

    console.log(chalk.green(`Sell ${label} order posted`), order);

    await sleep(POST_SELL_SETTLE_DELAY_MS);
    await trade.updateTokenBalances();

    const stillHolding =
      expectedHolding === Market.Up
        ? trade.holdingStatus === Market.Up && trade.share > 0
        : trade.holdingStatus === Market.Down && trade.share > 0;

    if (stillHolding) {
      console.warn(chalk.yellow(`Sell ${label} posted but position may still be settling`));
    } else {
      console.log(chalk.green(`Sell ${label} confirmed`));
    }

    return true;
  } catch (error) {
    console.error(chalk.red(`Sell ${label} failed:`), error);
    if (isUnauthorizedError(error)) {
      logAuthFailure(`Sell ${label}`);
    }
    return false;
  } finally {
    GLOBAL_TX_PROCESS.current = TxProcess.Idle;
  }
}
