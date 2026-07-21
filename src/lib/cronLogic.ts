import prisma from "./prisma";
import { fetchPrice, deriveNameFromSymbol } from "./coinsApi";
import { pruneOldRecords, pruneOldNews } from "./retention";
import { generateSignalForCoin, fetchAllRssArticles, matchRssArticlesForCoin, type GeneratedSignal } from "./newsApi";

export interface CronResult {
  symbol: string;
  price: number;
  high: number;
  low: number;
  isNewHigh: boolean;
  isNewLow: boolean;
}

/**
 * Saves a signal/article to NewsItem. Real fetched articles have an
 * externalId and are upserted on it, so re-fetching the same RSS article
 * on a later run updates it in place instead of creating a duplicate row
 * (feeds resurface recent posts on every request). System-generated
 * signals always have externalId: null and are just created directly —
 * there's nothing to dedupe against.
 */
async function saveNewsItem(coinId: number, cronLogId: number, signal: GeneratedSignal) {
  const data = {
    coinId,
    headline: signal.headline,
    summary: signal.summary,
    sentiment: signal.sentiment,
    source: signal.source,
    url: signal.url,
    cronLogId,
  };

  if (signal.externalId) {
    await prisma.newsItem.upsert({
      where: { externalId: signal.externalId },
      update: data,
      create: { ...data, externalId: signal.externalId },
    });
  } else {
    await prisma.newsItem.create({ data });
  }
}

/**
 * Core cron logic, shared by the /api/cron and /api/cron-manual routes:
 *
 * 1. Create a CronLog row up front (status "running") so every Record this
 *    run produces can be linked to it via cronLogId — that's what lets the
 *    Home page ask "did the most recent run set any new highs/lows".
 * 2. For every coin in the `Coin` table (i.e. every coin added via the
 *    Manage Coins page or the seed script), fetch the current price.
 * 3. Compare it against the most recently recorded high/low.
 * 4. Compare it against the most recently recorded high/low, and persist a
 *    new Record row ONLY if this price is a new high or low for TODAY (or
 *    the coin's first-ever observation) — see the inline comment in the
 *    loop below. This caps storage growth instead of writing 6 rows/day/
 *    coin regardless of whether the price actually moved meaningfully.
 * 5. Generate a bullish/bearish signal from that price movement (see
 *    newsApi.ts — heuristic, always runs) and match it against that run's
 *    RSS pull (free, no key, fetched once for the whole run — see step 0)
 *    for real articles. Both save as NewsItem rows for the Home page's
 *    Market Signals section.
 * 6. Update the CronLog with the final status so the UI can show "last run".
 * 7. Prune Record and NewsItem rows past their retention windows (see
 *    retention.ts) — cheap to run every time since it's a no-op until data
 *    is actually old enough, so no separate schedule is needed for it.
 *
 * Step 0 (before the per-coin loop): fetch all configured RSS feeds ONCE
 * for the whole run, not once per coin — matching against coins happens
 * in-memory from that single pull, which is both faster and more polite
 * to the feeds than N separate requests.
 */
export async function runCronJob(): Promise<CronResult[]> {
  const results: CronResult[] = [];
  const errors: string[] = [];
  const newsWarnings: string[] = [];

  const monitoredCoins = await prisma.coin.findMany({ orderBy: { symbol: "asc" } });

  const cronLog = await prisma.cronLog.create({ data: { status: "running" } });

  if (monitoredCoins.length === 0) {
    await prisma.cronLog.update({
      where: { id: cronLog.id },
      data: { status: "error", message: "No coins are being monitored. Add one from the Manage Coins page." },
    });
    return results;
  }

  // Fetched once for the whole run — see the docstring above for why this
  // isn't inside the per-coin loop.
  let rssArticles: Awaited<ReturnType<typeof fetchAllRssArticles>> = [];
  try {
    rssArticles = await fetchAllRssArticles();
  } catch (err) {
    newsWarnings.push(`RSS feeds: ${(err as Error).message}`);
  }

  for (const coin of monitoredCoins) {
    try {
      const price = await fetchPrice(coin.symbol);

      const lastRecord = await prisma.record.findFirst({
        where: { coinId: coin.id },
        orderBy: { createdAt: "desc" },
      });

      const previousHigh = lastRecord?.high ?? price;
      const previousLow = lastRecord?.low ?? price;

      const high = Math.max(previousHigh, price);
      const low = Math.min(previousLow, price);

      // Only flag as a "new" high/low when there was a prior record to beat —
      // a coin's very first data point isn't a meaningful record yet.
      const isNewHigh = lastRecord !== null && price > previousHigh;
      const isNewLow = lastRecord !== null && price < previousLow;

      // Only persist a new Record row when this price is a new extreme for
      // TODAY (or the coin's very first observation ever) — a price that's
      // "in the middle" of today's already-established range is deliberately
      // NOT stored, to limit database growth (matches what the Calendar page
      // already only cares about: each day's high/low, not every snapshot).
      // This never loses accuracy for the all-time high/low tracked above:
      // any all-time extreme is mathematically also a today's extreme, so
      // it's never the case that a "new high" gets silently skipped.
      const startOfToday = new Date();
      startOfToday.setUTCHours(0, 0, 0, 0);
      const todaysRecords = await prisma.record.findMany({
        where: { coinId: coin.id, createdAt: { gte: startOfToday } },
        select: { price: true },
      });
      const todayHighSoFar = todaysRecords.length > 0 ? Math.max(...todaysRecords.map((r) => r.price)) : null;
      const todayLowSoFar = todaysRecords.length > 0 ? Math.min(...todaysRecords.map((r) => r.price)) : null;
      const isNewDayHigh = todayHighSoFar === null || price > todayHighSoFar;
      const isNewDayLow = todayLowSoFar === null || price < todayLowSoFar;

      if (isNewDayHigh || isNewDayLow) {
        await prisma.record.create({
          data: { coinId: coin.id, price, high, low, isNewHigh, isNewLow, cronLogId: cronLog.id },
        });
      }

      const signal = generateSignalForCoin({
        symbol: coin.symbol,
        name: coin.name,
        price,
        previousPrice: lastRecord?.price ?? null,
        isNewHigh,
        isNewLow,
        recordedHigh: high,
        recordedLow: low,
      });
      if (signal) {
        await saveNewsItem(coin.id, cronLog.id, signal);
      }

      // Free RSS matching — synchronous, no network call (already fetched
      // above for the whole run), so no try/catch needed here.
      const rssMatches = matchRssArticlesForCoin(rssArticles, {
        name: coin.name,
        baseAsset: deriveNameFromSymbol(coin.symbol),
      });
      for (const article of rssMatches) {
        await saveNewsItem(coin.id, cronLog.id, article);
      }

      results.push({ symbol: coin.symbol, price, high, low, isNewHigh, isNewLow });
    } catch (err) {
      errors.push(`${coin.symbol}: ${(err as Error).message}`);
    }
  }

  let prunedRecordCount = 0;
  let prunedNewsCount = 0;
  try {
    prunedRecordCount = await pruneOldRecords();
    prunedNewsCount = await pruneOldNews();
  } catch {
    // Non-fatal — a failed prune shouldn't mark the whole cron run as
    // failed, since the actual price-fetching work already succeeded.
  }

  const pruneNote =
    prunedRecordCount > 0 || prunedNewsCount > 0
      ? ` Pruned ${prunedRecordCount} record(s) and ${prunedNewsCount} news item(s) past retention.`
      : "";
  const newsNote = newsWarnings.length > 0 ? ` News fetch issues: ${newsWarnings.join("; ")}.` : "";

  if (errors.length === 0) {
    await prisma.cronLog.update({
      where: { id: cronLog.id },
      data: { status: "success", message: `Updated ${results.length} coin(s).${pruneNote}${newsNote}` },
    });
  } else {
    await prisma.cronLog.update({
      where: { id: cronLog.id },
      data: {
        status: results.length > 0 ? "partial" : "error",
        message: `${results.length} succeeded, ${errors.length} failed: ${errors.join("; ")}.${pruneNote}${newsNote}`,
      },
    });
  }

  return results;
}
