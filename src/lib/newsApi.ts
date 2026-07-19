/**
 * News/signal generation for the Home page's "Market Signals" section.
 * Two independent sources feed this, both writing to the same NewsItem
 * shape:
 *
 * 1. `generateSignalForCoin` — always runs, no setup required. Computes a
 *    bullish/bearish *signal* purely from that cron run's own price
 *    movement (e.g. "BTC is up 4.2% this run"). NOT a real news article —
 *    `source: "System"`, `externalId: null`.
 *
 * 2. `fetchAllRssArticles` + `matchRssArticlesForCoin` — always runs, no
 *    setup required, no API key. Pulls from free public RSS feeds of
 *    established crypto news outlets (Cointelegraph, CryptoSlate, NewsBTC
 *    — see RSS_FEEDS below), matches articles mentioning the coin by
 *    name/symbol, and classifies sentiment with a plain keyword heuristic
 *    (see classifySentiment) since RSS doesn't carry sentiment data the
 *    way a paid API might. This is the "real article" source — genuinely
 *    free, no signup, no paid tier to hit.
 *
 * (A CryptoPanic integration previously lived here as a third, optional
 * source. It was removed — CryptoPanic requires a paid plan as of 2026,
 * and the RSS-based source above covers the same need for free. If you
 * want to re-add a paid provider later, follow the same shape: a function
 * returning GeneratedSignal[], called from cronLogic.ts alongside the two
 * below, with its own try/catch so a failure there never affects price
 * fetching.)
 *
 * Both sources can be active at once — cronLogic.ts calls both per run.
 * Neither ever fabricates a headline or attributes invented content to a
 * real outlet.
 */

import { XMLParser } from "fast-xml-parser";

export type Sentiment = "bullish" | "bearish" | "neutral";

export interface GeneratedSignal {
  headline: string;
  summary: string;
  sentiment: Sentiment;
  source: string;
  url: string | null;
  externalId: string | null;
}

const BULLISH_THRESHOLD_PERCENT = 2;
const BEARISH_THRESHOLD_PERCENT = -2;

/**
 * Computes a signal from one cron run's price movement for a coin.
 * Returns null when the movement isn't notable (avoids flooding the news
 * section with a "no real change" entry every single run).
 */
export function generateSignalForCoin(params: {
  symbol: string;
  name: string;
  price: number;
  previousPrice: number | null;
  isNewHigh: boolean;
  isNewLow: boolean;
  recordedHigh: number;
  recordedLow: number;
}): GeneratedSignal | null {
  const { symbol, name, price, previousPrice, isNewHigh, isNewLow, recordedHigh, recordedLow } = params;

  if (isNewHigh) {
    return {
      headline: `${name} (${symbol}) hits a new recorded high`,
      summary: `${symbol} reached a new all-time recorded high of ${formatPhp(price)} this run.`,
      sentiment: "bullish",
      source: "System",
      url: null,
      externalId: null,
    };
  }

  if (isNewLow) {
    return {
      headline: `${name} (${symbol}) hits a new recorded low`,
      summary: `${symbol} dropped to a new all-time recorded low of ${formatPhp(price)} this run.`,
      sentiment: "bearish",
      source: "System",
      url: null,
      externalId: null,
    };
  }

  if (previousPrice === null || previousPrice === 0) {
    return null; // first-ever data point for this coin — nothing to compare against
  }

  const percentChange = ((price - previousPrice) / previousPrice) * 100;

  if (percentChange >= BULLISH_THRESHOLD_PERCENT) {
    return {
      headline: `${name} (${symbol}) up ${percentChange.toFixed(1)}%`,
      summary: `${symbol} moved from ${formatPhp(previousPrice)} to ${formatPhp(price)} since the last check-in (recorded range: ${formatPhp(
        recordedLow
      )} – ${formatPhp(recordedHigh)}).`,
      sentiment: "bullish",
      source: "System",
      url: null,
      externalId: null,
    };
  }

  if (percentChange <= BEARISH_THRESHOLD_PERCENT) {
    return {
      headline: `${name} (${symbol}) down ${Math.abs(percentChange).toFixed(1)}%`,
      summary: `${symbol} moved from ${formatPhp(previousPrice)} to ${formatPhp(price)} since the last check-in (recorded range: ${formatPhp(
        recordedLow
      )} – ${formatPhp(recordedHigh)}).`,
      sentiment: "bearish",
      source: "System",
      url: null,
      externalId: null,
    };
  }

  return null; // change too small to be worth a signal
}

function formatPhp(value: number): string {
  return value.toLocaleString(undefined, { style: "currency", currency: "PHP", maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Free RSS-based real news (default — no API key required)
// ---------------------------------------------------------------------------

/** Free, public, keyless RSS feeds from established crypto news outlets. */
const RSS_FEEDS: { url: string; source: string }[] = [
  { url: "https://cointelegraph.com/rss", source: "Cointelegraph" },
  { url: "https://cryptoslate.com/feed", source: "CryptoSlate" },
  { url: "https://www.newsbtc.com/feed", source: "NewsBTC" },
];

const BULLISH_KEYWORDS = [
  "surge", "surges", "surged", "rally", "rallies", "rallied", "soar", "soars", "soared",
  "breakout", "bullish", "record high", "all-time high", "ath", "gain", "gains", "gained",
  "jump", "jumps", "jumped", "spike", "spikes", "spiked", "adoption", "upgrade", "upgraded",
  "partnership", "approval", "approved", "inflow", "inflows", "outperform", "rebound", "recovery",
];
const BEARISH_KEYWORDS = [
  "crash", "crashes", "crashed", "plunge", "plunges", "plunged", "dump", "dumps", "dumped",
  "bearish", "sell-off", "selloff", "decline", "declines", "declined", "slump", "slumps",
  "hack", "hacked", "exploit", "exploited", "lawsuit", "sued", "ban", "banned",
  "liquidation", "liquidations", "fear", "outflow", "outflows", "collapse", "fraud", "scam", "plummet",
];

/**
 * Plain keyword-count heuristic — NOT NLP or ML sentiment analysis, and the
 * summary this produces says so. Counts bullish vs. bearish keyword
 * occurrences (case-insensitive) in the given text; more bullish hits wins,
 * more bearish hits wins, a tie (including zero-zero) is neutral.
 */
function classifySentiment(text: string): { sentiment: Sentiment; bullishHits: number; bearishHits: number } {
  const lower = text.toLowerCase();
  const bullishHits = BULLISH_KEYWORDS.filter((kw) => lower.includes(kw)).length;
  const bearishHits = BEARISH_KEYWORDS.filter((kw) => lower.includes(kw)).length;

  let sentiment: Sentiment = "neutral";
  if (bullishHits > bearishHits) sentiment = "bullish";
  else if (bearishHits > bullishHits) sentiment = "bearish";

  return { sentiment, bullishHits, bearishHits };
}

interface RssArticle {
  title: string;
  link: string;
  description: string;
  source: string;
}

const xmlParser = new XMLParser({ ignoreAttributes: true, trimValues: true });

/** Fetches and parses one RSS feed. Returns [] (not a throw) on any failure — one bad feed shouldn't break the others. */
async function fetchOneFeed(feed: { url: string; source: string }): Promise<RssArticle[]> {
  try {
    const res = await fetch(feed.url, {
      cache: "no-store",
      headers: { "User-Agent": "coins-tracker/1.0 (personal price tracker; RSS reader)" },
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const parsed = xmlParser.parse(xml);
    const rawItems = parsed?.rss?.channel?.item;
    if (!rawItems) return [];

    const items = Array.isArray(rawItems) ? rawItems : [rawItems];
    return items
      .map((item): RssArticle | null => {
        const title = typeof item.title === "string" ? item.title : item.title?.["#text"];
        const link = typeof item.link === "string" ? item.link : item.link?.["#text"];
        if (!title || !link) return null;
        const description = typeof item.description === "string" ? item.description : "";
        return { title, link, description: stripHtml(description).slice(0, 300), source: feed.source };
      })
      .filter((item): item is RssArticle => item !== null);
  } catch {
    return []; // network error, malformed XML, etc. — skip this feed for this run
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

const MAX_RSS_ARTICLES_PER_COIN = 3;

/**
 * Fetches all configured RSS feeds ONCE and matches articles for every
 * monitored coin against that single pool — call `fetchAllRssArticles()`
 * once per cron run (not once per coin) and pass the result to this
 * function per coin, to avoid re-fetching the same feeds repeatedly.
 */
export function matchRssArticlesForCoin(
  articles: RssArticle[],
  params: { name: string; baseAsset: string }
): GeneratedSignal[] {
  const nameLower = params.name.toLowerCase();
  const symbolLower = params.baseAsset.toLowerCase();

  const matches = articles.filter((article) => {
    const haystack = `${article.title} ${article.description}`.toLowerCase();
    // Word-boundary-ish match so short symbols (e.g. "SOL") don't match
    // substrings inside unrelated words.
    const symbolPattern = new RegExp(`\\b${escapeRegExp(symbolLower)}\\b`, "i");
    return haystack.includes(nameLower) || symbolPattern.test(haystack);
  });

  return matches.slice(0, MAX_RSS_ARTICLES_PER_COIN).map((article) => {
    const { sentiment, bullishHits, bearishHits } = classifySentiment(`${article.title} ${article.description}`);
    return {
      headline: article.title,
      summary:
        article.description ||
        `Keyword sentiment scan: ${bullishHits} bullish term(s), ${bearishHits} bearish term(s).`,
      sentiment,
      source: article.source,
      url: article.link,
      externalId: `rss:${article.link}`,
    };
  });
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Fetches every configured RSS feed once. Call once per cron run, then pass the result to matchRssArticlesForCoin per coin. */
export async function fetchAllRssArticles(): Promise<RssArticle[]> {
  const results = await Promise.all(RSS_FEEDS.map(fetchOneFeed));
  return results.flat();
}
