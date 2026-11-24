const TICKER_PRICE_URL = "https://api.pro.coins.ph/openapi/quote/v1/ticker/price";
const CMC_QUOTE_URL = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest";
const FOREX_API_URL = "https://open.er-api.com/v6/latest/USD";

/**
 * Which coins get tracked is now driven by the `Coin` table (see
 * /api/available-coins + the Manage Coins page to add/remove symbols at
 * runtime). This list is only used to seed a *brand new* database via
 * `prisma/seed.ts` — it has no effect once coins already exist in the DB.
 *
 * PHP-quoted pairs (not USDT) — the whole point of tracking on a Philippine
 * exchange is the peso price, so Home/Calendar/Grid/cron all track PHP
 * directly rather than converting from a USD-equivalent quote.
 */
export const DEFAULT_SEED_COINS: { symbol: string; name: string }[] = [
  { symbol: "BTCPHP", name: "Bitcoin" },
  { symbol: "ETHPHP", name: "Ethereum" },
  { symbol: "XRPPHP", name: "Ripple" },
  { symbol: "SOLPHP", name: "Solana" },
  { symbol: "ADAPHP", name: "Cardano" },
  { symbol: "DOGEPHP", name: "Dogecoin" },
];

interface CoinsTickerResponse {
  symbol: string;
  price: string;
}

/**
 * Fetches the current price for a single symbol from the Coins.ph public
 * ticker endpoint, with custom interceptors for CoinMarketCap tokens.
 */
/** CMC symbols that may lack a Coins.ph PHP pair (or pair is unreliable). */
const CMC_FALLBACK_BASES = new Set(["ONDO", "TX", "RENDER", "NEAR", "DOT", "INJ"]);

async function fetchUsdToPhpRate(): Promise<number> {
  const fxRes = await fetch(FOREX_API_URL, { cache: "no-store" });
  if (!fxRes.ok) throw new Error(`Forex API error for USD→PHP (${fxRes.status})`);
  const fxData = (await fxRes.json()) as { rates?: { PHP?: number } };
  const rate = Number(fxData?.rates?.PHP);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Forex API returned invalid PHP rate");
  }
  return rate;
}

async function fetchPriceFromCmc(baseSymbol: string): Promise<number> {
  const key = process.env.CMC_API_KEY || "";
  if (!key) {
    throw new Error(
      `CMC_API_KEY is missing — required for ${baseSymbol} (same path as ONDO/TX)`
    );
  }
  const cmcRes = await fetch(`${CMC_QUOTE_URL}?symbol=${encodeURIComponent(baseSymbol)}`, {
    headers: { "X-CMC_PRO_API_KEY": key },
    cache: "no-store",
  });
  const bodyText = await cmcRes.text();
  let cmcData: {
    status?: { error_message?: string; error_code?: number };
    data?: Record<string, { quote?: { USD?: { price?: number } } }>;
  } = {};
  try {
    cmcData = JSON.parse(bodyText) as typeof cmcData;
  } catch {
    throw new Error(`CoinMarketCap non-JSON for ${baseSymbol}: ${bodyText.slice(0, 120)}`);
  }
  if (!cmcRes.ok) {
    const msg = cmcData?.status?.error_message || cmcRes.statusText;
    throw new Error(`CoinMarketCap HTTP ${cmcRes.status} for ${baseSymbol}: ${msg}`);
  }
  const usdPrice = Number(cmcData?.data?.[baseSymbol]?.quote?.USD?.price);
  if (!Number.isFinite(usdPrice) || usdPrice <= 0) {
    const keys = cmcData?.data ? Object.keys(cmcData.data).join(",") : "none";
    throw new Error(
      `CoinMarketCap has no USD price for ${baseSymbol} (data keys: ${keys}). Check CMC symbol.`
    );
  }
  const usdToPhp = await fetchUsdToPhpRate();
  return usdPrice * usdToPhp;
}

async function fetchPriceFromCoinsPh(phpSymbol: string): Promise<number> {
  const res = await fetch(`${TICKER_PRICE_URL}?symbol=${encodeURIComponent(phpSymbol)}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Coins.ph API error for ${phpSymbol}: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as CoinsTickerResponse;
  const price = parseFloat(data.price);
  if (Number.isNaN(price) || price <= 0) {
    throw new Error(`Coins.ph invalid price for ${phpSymbol}: ${JSON.stringify(data)}`);
  }
  return price;
}

export async function fetchPrice(symbol: string): Promise<number> {
  const raw = (symbol || "").trim().toUpperCase();
  const phpSymbol = raw.endsWith("PHP") ? raw : `${raw}PHP`;
  const baseSymbol = phpSymbol.replace(/PHP$/, "") || raw;

  // Prefer Coins.ph when the pair exists; CMC only for known non-pair / fallback bases
  if (CMC_FALLBACK_BASES.has(baseSymbol)) {
    try {
      return await fetchPriceFromCoinsPh(phpSymbol);
    } catch (coinsErr) {
      try {
        return await fetchPriceFromCmc(baseSymbol);
      } catch (cmcErr) {
        throw new Error(
          `${baseSymbol} price failed. Coins.ph: ${(coinsErr as Error).message}. CMC: ${(cmcErr as Error).message}`
        );
      }
    }
  }

  return fetchPriceFromCoinsPh(phpSymbol);
}

/**
 * Fetches current prices for every symbol the exchange lists. Useful as a
 * fallback / for debugging, but the cron job uses fetchPrice() per symbol so
 * a single failing symbol doesn't block the rest.
 */
export async function fetchAllPrices(): Promise<CoinsTickerResponse[]> {
  const res = await fetch(TICKER_PRICE_URL, { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`Coins.ph API error: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as CoinsTickerResponse[];
}

// Common quote assets Coins.ph pairs base coins against. Stripping these off
// a symbol gives a reasonable default display name, e.g. "BTCUSDT" -> "BTC".
const KNOWN_QUOTE_ASSETS = ["USDT", "USDC", "BUSD", "PHP", "BTC", "ETH", "BNB"];

/** Derives a sensible default display name from a raw ticker symbol. */
export function deriveNameFromSymbol(symbol: string): string {
  const quote = KNOWN_QUOTE_ASSETS.find((q) => symbol.endsWith(q) && symbol.length > q.length);
  return quote ? symbol.slice(0, symbol.length - quote.length) : symbol;
}

/**
 * Derives the PHP-quoted trading pair for a symbol, e.g. "BTCUSDT" -> "BTCPHP".
 * Monitored coins are expected to already be PHP pairs (see DEFAULT_SEED_COINS
 * above), so this is mostly a no-op passthrough — it exists as a safety net
 * for the Trade page in case a coin was added using a non-PHP pair (e.g. a
 * USDT pair, for a base asset with no direct PHP listing at add time).
 * If the symbol is already PHP-quoted, it's returned unchanged.
 */
export function toPhpSymbol(symbol: string): string {
  if (symbol.endsWith("PHP")) return symbol;
  const base = deriveNameFromSymbol(symbol);
  return `${base}PHP`;
}