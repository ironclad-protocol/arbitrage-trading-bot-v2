# Arbitrage Trading Bot V2

**Languages:** [English](README.md) · [Русский](README.ru.md) · [中文](README.zh-CN.md)

---

TypeScript bot for binary crypto markets (UP/DOWN). Resolves the active market from `trade.toml`, polls CLOB prices, runs `trade_1` or `trade_2`, and executes FAK orders via a Gnosis Safe proxy wallet on Polygon.

**Flow:** `trade.toml` + `.env` → Zod config → strategy engine → CLOB client (signer + funder) → Gamma (slug), CLOB `/prices`, on-chain balances.

## Strategies

Set `strategy` to `"trade_1"` or `"trade_2"`. Shared signals:

| Signal | Meaning |
| --- | --- |
| `remaining_time_ratio` | `0` at window open → `1` at close |
| `up_price_ratio` | `0` when UP ≈ $0.50 → `1` when UP ≈ $0 or $1 |

**`trade_1` (exit-only)** — Sells the held side when `remaining_time_ratio > exit_time_ratio` **or** `up_price_ratio > exit_price_ratio`. No entries.

**`trade_2`** — **Entry:** once per market, no position, time/price gates met → buy higher-priced side. **Exit:** sell when `up_price_ratio` in `exit_price_ratio_range`. **Emergency swap:** after exit, buy opposite side if `up_price_ratio` in `emergency_swap_price`.

> `trade_1` still requires unused schema fields (`entry_price_range`, `swap_price_range`, `take_profit`, `stop_loss`) in `trade.toml` for validation.

## Requirements

- Node.js `>= 20.6.0`
- `PRIVATE_KEY` (EOA signer), `FUNDER_ADDRESS` or `PROXY_WALLET_ADDRESS` (Gnosis Safe with USDC on Polygon, chain `137`)

## Quick start

```bash
npm install
cp .env.example .env   # set PRIVATE_KEY, FUNDER_ADDRESS
# edit trade.toml: strategy, trade_usd, [market] coin + period
npm run dev            # or: npm run build && npm start
```

| `trade.toml` | Values |
| --- | --- |
| `strategy` | `trade_1` \| `trade_2` |
| `trade_usd` | USD per entry |
| `[market].market_coin` | `btc` \| `eth` \| `sol` \| `xrp` |
| `[market].market_period` | `5` \| `15` \| `60` \| `240` \| `1440` (minutes) |

5-minute windows: **BTC only**. ETH/SOL/XRP: `15`, `60`, `240`, `1440`.

## Logs

~every 3s: market line (`tMinus`, prices, `upRatio`, `timeRatio`, `trend`, `position`, `engine`) and portfolio line (`cash`, `shares`, `total`, …). `trend`: UP/DOWN/FLAT; `position`: UP/DOWN/NONE; `engine`: BUSY (order in flight) / IDLE.

## Security

Do not commit `.env` or keys. Use a dedicated signer and lightly funded proxy. Start with low `trade_usd` ($1–$3). Orders use Gnosis Safe signature type (`SIGNATURE_TYPE = 2`); funder needs USDC and approvals. No profit guarantee — full loss risk.

## License

ISC — see `package.json`.
