# Arbitrage Trading Bot V2

**Языки:** [English](README.md) · [Русский](README.ru.md) · [中文](README.zh-CN.md)

---

TypeScript-бот для бинарных крипторынков (исходы UP/DOWN). Находит активный рынок по `trade.toml`, опрашивает цены CLOB, выполняет стратегии `trade_1` или `trade_2` и отправляет FAK-ордера через прокси-кошелёк Gnosis Safe в сети Polygon.

**Поток данных:** `trade.toml` + `.env` → конфиг Zod → движок стратегий → клиент CLOB (подписант + funder) → Gamma (slug), CLOB `/prices`, ончейн-балансы.

## Стратегии

В `trade.toml` укажите `strategy`: `"trade_1"` или `"trade_2"`. Общие сигналы:

| Сигнал | Значение |
| --- | --- |
| `remaining_time_ratio` | `0` в начале окна → `1` в конце |
| `up_price_ratio` | `0`, когда UP ≈ $0.50 → `1`, когда UP ≈ $0 или $1 |

**`trade_1` (только выход)** — продаёт удерживаемую сторону, если `remaining_time_ratio > exit_time_ratio` **или** `up_price_ratio > exit_price_ratio`. Входов нет.

**`trade_2`** — **Вход:** один раз за рынок, без позиции, при выполнении условий по времени/цене → покупка стороны с более высокой ценой. **Выход:** продажа, если `up_price_ratio` попадает в `exit_price_ratio_range`. **Аварийный своп:** после выхода — покупка противоположного токена, если `up_price_ratio` в `emergency_swap_price`.

> Для `trade_1` в `trade.toml` всё ещё нужны неиспользуемые поля схемы (`entry_price_range`, `swap_price_range`, `take_profit`, `stop_loss`) — иначе валидация не пройдёт.

## Требования

- Node.js `>= 20.6.0`
- `PRIVATE_KEY` (EOA-подписант), `FUNDER_ADDRESS` или `PROXY_WALLET_ADDRESS` (Gnosis Safe с USDC в Polygon, chain `137`)

## Быстрый старт

```bash
npm install
cp .env.example .env   # укажите PRIVATE_KEY, FUNDER_ADDRESS
# отредактируйте trade.toml: strategy, trade_usd, [market] coin + period
npm run dev            # или: npm run build && npm start
```

| `trade.toml` | Значения |
| --- | --- |
| `strategy` | `trade_1` \| `trade_2` |
| `trade_usd` | размер сделки в USD |
| `[market].market_coin` | `btc` \| `eth` \| `sol` \| `xrp` |
| `[market].market_period` | `5` \| `15` \| `60` \| `240` \| `1440` (минуты) |

Окно 5 минут: **только BTC**. ETH/SOL/XRP: `15`, `60`, `240`, `1440`.

## Логи

~каждые 3 с: строка рынка (`tMinus`, цены, `upRatio`, `timeRatio`, `trend`, `position`, `engine`) и портфеля (`cash`, `shares`, `total`, …). `trend`: UP/DOWN/FLAT; `position`: UP/DOWN/NONE; `engine`: BUSY (ордер в процессе) / IDLE.

## Безопасность

Не коммитьте `.env` и ключи. Используйте отдельный подписант и прокси с ограниченным балансом. Начните с низкого `trade_usd` ($1–$3). Ордера с типом подписи Gnosis Safe (`SIGNATURE_TYPE = 2`); на funder нужны USDC и approvals. Прибыль не гарантируется — возможна полная потеря.

## Лицензия

ISC — см. `package.json`.
