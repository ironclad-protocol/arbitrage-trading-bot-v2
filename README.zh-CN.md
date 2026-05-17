# Arbitrage Trading Bot V2

**语言：** [English](README.md) · [Русский](README.ru.md) · [中文](README.zh-CN.md)

---

用于二元加密市场（UP/DOWN）的 TypeScript 交易机器人。根据 `trade.toml` 解析当前市场，轮询 CLOB 价格，执行 `trade_1` 或 `trade_2` 策略，并通过 Polygon 上的 Gnosis Safe 代理钱包提交 FAK 订单。

**数据流：** `trade.toml` + `.env` → Zod 配置 → 策略引擎 → CLOB 客户端（签名者 + funder）→ Gamma（slug）、CLOB `/prices`、链上余额。

## 策略

在 `trade.toml` 中设置 `strategy` 为 `"trade_1"` 或 `"trade_2"`。共用信号：

| 信号 | 含义 |
| --- | --- |
| `remaining_time_ratio` | 窗口开始时为 `0` → 结束时为 `1` |
| `up_price_ratio` | UP ≈ $0.50 时为 `0` → UP ≈ $0 或 $1 时为 `1` |

**`trade_1`（仅平仓）** — 当 `remaining_time_ratio > exit_time_ratio` **或** `up_price_ratio > exit_price_ratio` 时卖出持仓方向。不开新仓。

**`trade_2`** — **开仓：** 每个市场仅一次，无持仓且满足时间/价格条件 → 买入价格更高的一侧。**平仓：** 当 `up_price_ratio` 落在 `exit_price_ratio_range` 内时卖出。**紧急换边：** 平仓成功后，若 `up_price_ratio` 在 `emergency_swap_price` 内，立即买入相反代币。

> `trade_1` 仍须在 `trade.toml` 中保留未使用的 schema 字段（`entry_price_range`、`swap_price_range`、`take_profit`、`stop_loss`），否则校验无法通过。

## 环境要求

- Node.js `>= 20.6.0`
- `PRIVATE_KEY`（EOA 签名者）、`FUNDER_ADDRESS` 或 `PROXY_WALLET_ADDRESS`（Polygon 上持有 USDC 的 Gnosis Safe，链 ID `137`）

## 快速开始

```bash
npm install
cp .env.example .env   # 设置 PRIVATE_KEY、FUNDER_ADDRESS
# 编辑 trade.toml：strategy、trade_usd、[market] 币种与周期
npm run dev            # 或：npm run build && npm start
```

| `trade.toml` | 取值 |
| --- | --- |
| `strategy` | `trade_1` \| `trade_2` |
| `trade_usd` | 每笔开仓美元金额 |
| `[market].market_coin` | `btc` \| `eth` \| `sol` \| `xrp` |
| `[market].market_period` | `5` \| `15` \| `60` \| `240` \| `1440`（分钟） |

5 分钟窗口：**仅支持 BTC**。ETH/SOL/XRP：`15`、`60`、`240`、`1440`。

## 日志

约每 3 秒：行情行（`tMinus`、价格、`upRatio`、`timeRatio`、`trend`、`position`、`engine`）与组合行（`cash`、`shares`、`total` 等）。`trend`：UP/DOWN/FLAT；`position`：UP/DOWN/NONE；`engine`：BUSY（订单进行中）/ IDLE。

## 安全说明

勿提交 `.env` 或私钥。使用独立签名者与小额代理钱包。先用较低的 `trade_usd`（约 $1–$3）。订单使用 Gnosis Safe 签名类型（`SIGNATURE_TYPE = 2`）；funder 需持有 USDC 并完成授权。不保证盈利，二元市场存在全部亏损风险。

## 许可证

ISC — 见 `package.json`。
