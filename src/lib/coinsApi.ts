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
export async function fetchPrice(symbol: string): Promise<number> {
  // 1. Intercept custom coins to use CoinMarketCap
  if (["ONDOPHP", "ONDO", "TXPHP", "TX"].includes(symbol)) {
    const baseSymbol = symbol.replace("PHP", ""); // Extracts exactly "ONDO" or "TX"

    // A. Fetch price in USD from CoinMarketCap
    const cmcRes = await fetch(
      `${CMC_QUOTE_URL}?symbol=${baseSymbol}`,
      {
        headers: {
          "X-CMC_PRO_API_KEY": process.env.CMC_API_KEY || "", 
        },
        cache: "no-store",
      }
    );
    if (!cmcRes.ok) throw new Error(`CoinMarketCap API error for ${symbol}`);
    const cmcData = await cmcRes.json();
    const usdPrice = cmcData.data[baseSymbol].quote.USD.price;

    // B. Fetch live USD to PHP exchange rate (Free, no API key)
    const fxRes = await fetch(FOREX_API_URL, { cache: "no-store" });
    if (!fxRes.ok) throw new Error(`Forex API error for USD to PHP conversion`);
    const fxData = await fxRes.json();
    const usdToPhpRate = fxData.rates.PHP;

    // C. Calculate final PHP price
    return usdPrice * usdToPhpRate;
  }

  // 2. Default behavior for all other coins (Coins.ph)
  const res = await fetch(`${TICKER_PRICE_URL}?symbol=${encodeURIComponent(symbol)}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Coins.ph API error for ${symbol}: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as CoinsTickerResponse;
  const price = parseFloat(data.price);

  if (Number.isNaN(price)) {
    throw new Error(`Coins.ph API returned an invalid price for ${symbol}: ${JSON.stringify(data)}`);
  }

  return price;
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