# Solana Copy Trading Bot (TypeScript)

TypeScript copy-trading stack built for **speed**: stream a leader wallet’s swaps as early as your Geyser feed allows, build a follow-on transaction with aggressive compute settings, and land it through **private / MEV-aware submission rails** instead of only a slow public `sendRawTransaction` path.

## Fast 0→1 block copy trading

The goal is to **minimize slots between “they traded” and “we’re in the same neighborhood of the ledger.”** In practice that means:

- **Low-latency observation** — Helius Atlas-style `transactionSubscribe` on the wallets you mirror (`src/stream/helius-geyser.ts`), so you react from full transaction payloads rather than polling.
- **Fast path to inclusion** — Swaps are wired to a **transaction landing layer** under `utils/tx-submitters/`: the same class of infra traders use to chase **next-block** or **0–1 slot** inclusion after a signal (tips + direct paths to validators / relays).

### Multi-engine landing (Jito, NextBlock, Helius Sender, Astralane, Zeroslot)

This repo integrates **multiple high-speed submitters** so you are not locked to one RPC:

| Engine | Role |
|--------|------|
| **Jito** | Block-engine **bundles** + dedicated tip accounts (`utils/tx-submitters/jito.ts`, `sendBundleTxUsingJito`). |
| **NextBlock** | Relay submission with fee / tip flow (`utils/tx-submitters/nextblock.ts`). |
| **Helius Sender** | Helius “fast” sender path with tip requirements (`utils/tx-submitters/helius-sender.ts`). |
| **Astralane** | Iris gateway + API key + tip lamports (`utils/tx-submitters/astralane.ts`). |
| **Zeroslot** | Staked-conn style endpoint + API key (`utils/tx-submitters/zeroslot.ts`). |

Shared **tip instruction** helpers live in `utils/tx-submitters/tips.ts`. Instruction-based flows can go through `submitAndConfirm` / `submitWithConfiguredSubmitter` in `utils/tx-submitters/dispatch.ts`, which switches on `TX_SUBMITTER`. **Jito** uses the bundle API separately (see dispatch comments). Some `*ByRacing` swap helpers call Jito bundles directly—check the DEX module you use.

**Operating for maximum speed:** set `TX_SUBMITTER` to the provider that fits your region, tip budget, and success rate, tune `CU_PRICE` / slippage in `src/core/config.ts` and `config/index.ts`, and fund tips per provider docs. **Going further:** you can **race** the same signed transaction (or parallel builds) across several of these backends—for example by firing `submitSignedTxHeliusSender`, Astralane, Zeroslot, and NextBlock in a `Promise.race` or controlled multi-submit wrapper—so the first successful landing wins; that pattern is a small extension on top of the existing clients.

## How it works

1. **`copyWallets.json`** — Object whose **keys** are base58 wallet addresses to mirror (values can be anything). This file is gitignored; create it at the repo root.
2. **`src/stream/helius-geyser.ts`** — Subscribes to successful transactions that touch any of those accounts.
3. **`src/parsers/router.ts`** — Detects DEX program IDs and parses txs into `CopyTradeEvent` (`src/core/types.ts`). Trades that go through Jupiter, OKX, or DFlow aggregators are **ignored** so the bot does not chase routed bundles blindly.
4. **`src/queue/trade-queue.ts`** — Queues events; **`src/executors/copy-executor.ts`** runs the actual buys/sells.

**Supported venues (parsing):** Pump.fun, PumpSwap (pAMM), Raydium AMM. Raydium CPMM helpers exist under `dex/raydium/` but are not wired in the router’s main branch.

**Copy execution today:** `copy-executor.ts` only executes **PumpSwap** (`buyPumpAmmTokenByRacing` / `sellPumpAmmTokenByRacing`). Pump.fun and Raydium AMM branches are present but **commented out**; uncomment and test before relying on them.

**Note:** `src/index.ts` currently includes a **direct `buyPumpAmmTokenByRacing` test call** before the stream starts. Remove or guard that if you only want the Geyser → copy pipeline.

## Requirements

- Node.js (LTS recommended)
- A **mainnet RPC** URL and a **Helius Geyser / Atlas** WebSocket URL that supports `transactionSubscribe` with `accountInclude` (see `.env.example`)
- Funded signer keypair for the bot

## Setup

```bash
npm install
cp .env.example .env
# Edit .env: PRIVATE_KEY, RPC_MAINNET_URL, HELIUS_GEYSER_URL
```

Create `copyWallets.json` at the project root, for example:

```json
{
  "SoMeWaLlEt1111111111111111111111111111111111": true
}
```

## Configuration

| Source | Purpose |
|--------|---------|
| `.env` | Keys, RPC, Geyser URL, optional `SIMULATION_MODE`, `TX_SUBMITTER`, tip URLs/amounts (see `.env.example`) |
| `config/index.ts` | Slippage, `COPY_PERCENT`, `Copy_Buy_FixedAmount`, `TX_SUBMITTER`, connection defaults, Jito/NextBlock/etc. constants |
| `src/core/config.ts` | Program IDs, optional env-based `COPY_PERCENT` / `COPY_FIXED_SOL` (executor currently reads `config/index.ts`) |

**Transaction landing:** default selection is `TX_SUBMITTER` in `.env` (`jito` | `nextblock` | `helius-sender` | `astralane` | `zeroslot`). Non-Jito values route through `submitAndConfirm` in `utils/tx-submitters/dispatch.ts`. Jito bundle sends use the Jito helpers directly. Env knobs for tips and endpoints are documented in `.env.example`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run `node dist/index.js` (build first) |
| `npm run dev` | Run `src/index.ts` with `ts-node-dev` |
| `npm run sell` | Interactive menu to manually sell from `tradedTokens.json` (Pump.fun racing sell) |
| `npm run yellow` / `npm run vibe` | Run `test.ts` (Yellowstone gRPC sample / experiments) |

## Project layout (high level)

- `src/` — Entry (`index.ts`), Geyser client, parsers, queue, copy executor, types
- `dex/` — Pump.fun, PumpSwap, Raydium, Jupiter swap and parse logic
- `config/` — Shared runtime config and Anchor programs (e.g. PumpSwap IDL)
- `utils/` — JSON helpers, holdings, tx submitters, parsers

## Disclaimer

Copy trading is high risk (slippage, MEV, failed txs, and total loss of funds). This repository is provided as-is; audit behavior and costs before using real money.
