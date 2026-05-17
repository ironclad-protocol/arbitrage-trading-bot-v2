import { ClobClient, SignatureTypeV2 } from "@polymarket/clob-client-v2";
import chalk from "chalks-log";
import { generateMarketSlug } from "./config";
import type { Coin, MarketConfig, Minutes } from "./types";
import { CHAIN_ID, FUNDER, getMarket, getPrices, HOST, SIGNATURE_TYPE, SIGNER } from "./services";
import { getCurrentTime } from "./utils";
import { loadConfig } from "./config/toml";
import { Trade } from "./trade";

loadConfig();

const marketConfig: MarketConfig = {
  coin: globalThis.__CONFIG__.market.market_coin as Coin, // btc / eth / sol / xrp
  minutes: parseInt(globalThis.__CONFIG__.market.market_period) as Minutes, // 15 / 60 / 240 / 1440
};

async function main() {
  const signerAddress = SIGNER?.address ?? "unknown";

  console.log(chalk.cyan("Starting Polymarket trade bot"));
  console.log(chalk.gray(`Public key: ${signerAddress}`));
  console.log(chalk.gray(`Strategy: ${globalThis.__CONFIG__.strategy} | Market: ${marketConfig.coin.toUpperCase()} ${marketConfig.minutes}m | Trade USD: $${globalThis.__CONFIG__.trade_usd}`));
  console.log(chalk.gray("Trend legend: UP 🟢 | DOWN 🔴 | FLAT ⚪"));
  console.log(chalk.gray("Position legend: UP 🟩 | DOWN 🟥 | NONE ⬛"));
  const configuredSignatureType = process.env.POLYMARKET_SIGNATURE_TYPE?.trim();
  const signatureCandidates = configuredSignatureType
    ? [SIGNATURE_TYPE]
    : [SignatureTypeV2.POLY_PROXY, SignatureTypeV2.EOA];

  let apiKey: Awaited<ReturnType<ClobClient["createOrDeriveApiKey"]>> | null = null;
  let activeSignatureType: SignatureTypeV2 = SIGNATURE_TYPE;
  let lastAuthError: unknown = null;

  for (const candidate of signatureCandidates) {
    try {
      const clientConfig: ConstructorParameters<typeof ClobClient>[0] = {
        host: HOST,
        chain: CHAIN_ID,
        signer: SIGNER,
        signatureType: candidate,
      };
      // For proxy/safe-style setups the funded wallet is required; for EOA it should be omitted.
      if (candidate !== SignatureTypeV2.EOA) {
        clientConfig.funderAddress = FUNDER;
      }
      const clobClient = new ClobClient(clientConfig);
      try {
        // Prefer derive first to avoid noisy 400 logs when a key already exists.
        apiKey = await clobClient.deriveApiKey();
      } catch {
        apiKey = await clobClient.createApiKey();
      }
      activeSignatureType = candidate;
      console.log(chalk.gray(`Authenticated CLOB with signature type: ${SignatureTypeV2[candidate]}`));
      break;
    } catch (error) {
      lastAuthError = error;
      console.warn(chalk.yellow(`Auth failed for signature type ${SignatureTypeV2[candidate]}, trying next...`));
    }
  }

  if (!apiKey) {
    throw new Error(
      `Unable to create or derive CLOB API key for any supported signature type. Last error: ${String(lastAuthError)}`
    );
  }

  while (true) {
    const client = new ClobClient(
      {
        host: HOST,
        chain: CHAIN_ID,
        signer: SIGNER,
        creds: apiKey, // Generated from L1 auth, API credentials enable L2 methods
        signatureType: activeSignatureType,
        ...(activeSignatureType !== SignatureTypeV2.EOA ? { funderAddress: FUNDER } : {}),
      }
    );
    const { slug, endTimestamp } = generateMarketSlug(marketConfig.coin, marketConfig.minutes);

    console.log(chalk.yellow(`Market selected: ${slug}`));
    console.log(chalk.gray(`Window: ${getCurrentTime()} -> ${endTimestamp}`));

    const market = await getMarket(slug);

    const upTokenId = JSON.parse(market.clobTokenIds)[0];
    const downTokenId = JSON.parse(market.clobTokenIds)[1];
    const usd = globalThis.__CONFIG__.trade_usd;

    const trade = new Trade
      (
        usd,
        upTokenId,
        downTokenId,
        client
      );

    while (true) {

      getPrices(upTokenId, downTokenId)
        .then(async e => {

          trade.updatePrices(endTimestamp - getCurrentTime(), e[upTokenId].BUY, e[upTokenId].SELL, e[downTokenId].BUY, e[downTokenId].SELL);
          await trade.make_trading_decision();
        })
        .catch(e => console.error(chalk.red("Market loop error:"), e));

      await new Promise(resolve => setTimeout(resolve, 1000));


      if (endTimestamp - getCurrentTime() <= 0) {
        break;
      }
    }
  }

}

main().catch(async (error) => {
  console.error(chalk.red("Fatal startup error:"), error);
  process.exit(1);
});
