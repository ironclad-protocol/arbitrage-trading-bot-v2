import { ClobClient, SignatureTypeV2 } from "@polymarket/clob-client-v2";
import logger from "chalks-log";
import { generateMarketSlug } from "./config";
import { loadConfig } from "./config/toml";
import type { Coin, MarketConfig, Minutes } from "./types";
import {
  CHAIN_ID,
  FUNDER,
  getMarket,
  getPrices,
  HOST,
  SIGNATURE_TYPE,
  SIGNER,
} from "./services";
import { Trade } from "./trade";
import { PRICE_POLL_INTERVAL_MS } from "./trade/constants";
import { getCurrentTime, sleep } from "./utils";

const config = loadConfig();

const marketConfig: MarketConfig = {
  coin: config.market.market_coin as Coin,
  minutes: Number.parseInt(config.market.market_period, 10) as Minutes,
};

type ApiCredentials = Awaited<ReturnType<ClobClient["deriveApiKey"]>>;
type ClobClientConfig = ConstructorParameters<typeof ClobClient>[0];

interface AuthSession {
  credentials: ApiCredentials;
  signatureType: SignatureTypeV2;
}

interface OutcomeTokens {
  upTokenId: string;
  downTokenId: string;
}

let shuttingDown = false;

function installShutdownHandlers(): void {
  const onSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(logger.yellow(`Received ${signal}, finishing current work then exiting...`));
  };

  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function buildClobConfig(
  signatureType: SignatureTypeV2,
  credentials?: ApiCredentials,
): ClobClientConfig {
  const clobConfig: ClobClientConfig = {
    host: HOST,
    chain: CHAIN_ID,
    signer: SIGNER,
    signatureType,
    ...(credentials ? { creds: credentials } : {}),
  };

  if (signatureType !== SignatureTypeV2.EOA) {
    clobConfig.funderAddress = FUNDER;
  }

  return clobConfig;
}

function signatureTypeCandidates(): SignatureTypeV2[] {
  const configured = process.env.POLYMARKET_SIGNATURE_TYPE?.trim();
  return configured
    ? [SIGNATURE_TYPE]
    : [SignatureTypeV2.POLY_PROXY, SignatureTypeV2.EOA];
}

function printStartupBanner(signerAddress: string): void {
  const { strategy, trade_usd: tradeUsd } = config;
  const { coin, minutes } = marketConfig;

  console.log(logger.cyan("Starting Polymarket trade bot"));
  console.log(logger.gray(`Public key: ${signerAddress}`));
  console.log(
    logger.gray(
      `Strategy: ${strategy} | Market: ${coin.toUpperCase()} ${minutes}m | Trade USD: $${tradeUsd}`,
    ),
  );
  console.log(logger.gray("Trend legend: UP 🟢 | DOWN 🔴 | FLAT ⚪"));
  console.log(logger.gray("Position legend: UP 🟩 | DOWN 🟥 | NONE ⬛"));
}

async function obtainApiCredentials(client: ClobClient): Promise<ApiCredentials> {
  try {
    return await client.deriveApiKey();
  } catch {
    return await client.createApiKey();
  }
}

async function authenticateClob(): Promise<AuthSession> {
  let lastAuthError: unknown;

  for (const candidate of signatureTypeCandidates()) {
    try {
      const bootstrapClient = new ClobClient(buildClobConfig(candidate));
      const credentials = await obtainApiCredentials(bootstrapClient);

      console.log(
        logger.gray(`Authenticated CLOB with signature type: ${SignatureTypeV2[candidate]}`),
      );

      return { credentials, signatureType: candidate };
    } catch (error) {
      lastAuthError = error;
      console.warn(
        logger.yellow(
          `Auth failed for signature type ${SignatureTypeV2[candidate]}, trying next...`,
        ),
      );
    }
  }

  throw new Error(
    `Unable to create or derive CLOB API key. Last error: ${formatUnknownError(lastAuthError)}`,
  );
}

function createTradingClient(session: AuthSession): ClobClient {
  return new ClobClient(buildClobConfig(session.signatureType, session.credentials));
}

function parseOutcomeTokenIds(clobTokenIds: string): OutcomeTokens {
  const ids: unknown = JSON.parse(clobTokenIds);

  if (!Array.isArray(ids) || ids.length < 2) {
    throw new Error("Market response does not include UP/DOWN clobTokenIds");
  }

  return { upTokenId: String(ids[0]), downTokenId: String(ids[1]) };
}

async function pollMarketOnce(
  trade: Trade,
  upTokenId: string,
  downTokenId: string,
  endTimestamp: number,
): Promise<void> {
  const quotes = await getPrices(upTokenId, downTokenId);
  const now = getCurrentTime();
  const up = quotes[upTokenId];
  const down = quotes[downTokenId];

  trade.updatePrices(
    endTimestamp - now,
    up.BUY,
    up.SELL,
    down.BUY,
    down.SELL,
  );

  await trade.makeTradingDecision();
}

async function runMarketWindow(
  client: ClobClient,
  slug: string,
  endTimestamp: number,
): Promise<void> {
  const market = await getMarket(slug);
  const { upTokenId, downTokenId } = parseOutcomeTokenIds(market.clobTokenIds);
  const trade = new Trade(config.trade_usd, upTokenId, downTokenId, client);

  while (!shuttingDown && getCurrentTime() < endTimestamp) {
    const loopStarted = Date.now();

    try {
      await pollMarketOnce(trade, upTokenId, downTokenId, endTimestamp);
    } catch (error) {
      console.error(logger.red("Market loop error:"), error);
    }

    const elapsed = Date.now() - loopStarted;
    await sleep(Math.max(0, PRICE_POLL_INTERVAL_MS - elapsed));
  }
}

async function main(): Promise<void> {
  installShutdownHandlers();

  const signerAddress = SIGNER?.address ?? "unknown";
  printStartupBanner(signerAddress);

  const session = await authenticateClob();
  const client = createTradingClient(session);

  while (!shuttingDown) {
    const { slug, endTimestamp } = generateMarketSlug(marketConfig.coin, marketConfig.minutes);

    console.log(logger.yellow(`Market selected: ${slug}`));
    console.log(logger.gray(`Window: ${getCurrentTime()} -> ${endTimestamp}`));

    await runMarketWindow(client, slug, endTimestamp);
  }

  console.log(logger.gray("Shutdown complete."));
}

main().catch((error: unknown) => {
  console.error(logger.red("Fatal startup error:"), error);
  process.exit(1);
});
