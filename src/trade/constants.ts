/** Interval between CLOB price polls during an active market window. */
export const PRICE_POLL_INTERVAL_MS = 1_000;

/** Minimum spacing between market/portfolio status log lines. */
export const STATUS_LOG_INTERVAL_MS = 3_000;

/** Delay after a sell order before re-reading on-chain balances. */
export const POST_SELL_SETTLE_DELAY_MS = 2_000;

/** Default timeout while waiting for conditional token settlement. */
export const BALANCE_POLL_TIMEOUT_MS = 60_000;
