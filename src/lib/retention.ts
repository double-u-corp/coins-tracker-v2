import prisma from "./prisma";

/**
 * How long raw price-history rows (Record) are kept before automatic
 * cleanup. This only applies to Record — the cron-generated price
 * snapshots. It does NOT touch Transaction rows (your buy/sell history),
 * which are kept forever regardless of this setting: that's real
 * financial record-keeping you'll want long after any reasonable
 * price-history window, not disposable operational data.
 *
 * Set to 2 years, down from the previous 3. Note this single window has to
 * satisfy BOTH the daily chart (RSI/SMA/ATR/macro trend, 1Y/3Y range
 * views) and the intraday swing/ladder feature — Record is currently the
 * ONLY store for both; handleChart in coins.ts aggregates these same raw
 * rows into daily/weekly/monthly/yearly bars at request time rather than
 * reading from a separate persisted daily table. That means Record can't
 * safely be pruned down to a short window (e.g. 30 days) the way a
 * "raw intraday checks only" store could — doing so would also delete the
 * only data the daily chart and its indicators have ever had. If tighter
 * retention on the intraday-only granularity is wanted later, it requires
 * first materializing a separate DailyBar table (one row/day/coin,
 * populated by a cron step) that Record's 3h/intraday reads don't depend
 * on — only then can Record itself prune more aggressively without
 * affecting daily history.
 *
 * At 6 snapshots/day per coin that's roughly 4,380 rows per coin over this
 * window — trivial for SQLite either way (it handles millions of rows
 * without strain), so this exists as a long-term hygiene safety net
 * rather than because the app is anywhere near a real storage concern.
 * The tradeoff to know about: Calendar/Chart lose detail beyond this
 * window (the Chart page caps its range selector for exactly this
 * reason) — Home's "Recorded High/Low" is unaffected either way (see
 * pruneOldRecords).
 */
export const RECORD_RETENTION_MONTHS = 24;
export const RECORD_RETENTION_DAYS = RECORD_RETENTION_MONTHS * 30;

/**
 * How long auto-generated NewsItem rows (Home page "Market Signals") are
 * kept. Much shorter than RECORD_RETENTION_DAYS on purpose: signals are
 * timely/contextual by nature ("BTC up 3% this run" isn't useful reference
 * material a year later the way a price data point is), and — unlike
 * Record — NewsItem volume isn't capped by a fixed schedule, only by how
 * often a coin's price moves notably (or, once a real news provider is
 * wired in per newsApi.ts, by how much that provider publishes). A
 * consistently volatile/newsworthy coin could otherwise accumulate
 * unbounded rows over years with no natural ceiling. No "keep the newest
 * row" guard is needed here (unlike Record) — nothing depends on an old
 * NewsItem surviving, so this is a plain age-based delete.
 */
export const NEWS_RETENTION_MONTHS = 1;
export const NEWS_RETENTION_DAYS = NEWS_RETENTION_MONTHS * 30;

/**
 * How long operational CronLog rows are kept. Cron logs are strictly diagnostic 
 * background execution history (success/failure statuses, sync timestamps). 
 * Keeping them for 1 month provides plenty of window for debugging recent 
 * automation issues while preventing the database from bloating with 
 * repetitive operational noise.
 */
export const CRON_LOG_RETENTION_MONTHS = 1;
export const CRON_LOG_RETENTION_DAYS = CRON_LOG_RETENTION_MONTHS * 30;

/**
 * Deletes Record rows older than RECORD_RETENTION_DAYS — except each
 * coin's single most recent row, which is always kept regardless of age.
 * That guard matters: a coin's running high/low lives in whatever its
 * newest Record is (each row carries the prior max/min forward), so if a
 * coin hasn't been monitored recently and its newest row is itself past
 * the cutoff, deleting it would silently lose that coin's tracked
 * high/low entirely. Returns the number of rows deleted.
 */
export async function pruneOldRecords(): Promise<number> {
  const cutoff = new Date(Date.now() - RECORD_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const latestPerCoin = await prisma.record.groupBy({
    by: ["coinId"],
    _max: { id: true },
  });
  const keepIds = latestPerCoin.map((row) => row._max.id).filter((id): id is number => id !== null);

  const result = await prisma.record.deleteMany({
    where: {
      createdAt: { lt: cutoff },
      id: { notIn: keepIds },
    },
  });

  return result.count;
}

/** Deletes NewsItem rows older than NEWS_RETENTION_DAYS. Returns the number of rows deleted. */
export async function pruneOldNews(): Promise<number> {
  const cutoff = new Date(Date.now() - NEWS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.newsItem.deleteMany({ where: { publishedAt: { lt: cutoff } } });
  return result.count;
}

/** 
 * Deletes CronLog rows older than CRON_LOG_RETENTION_DAYS. 
 * Assumes your model is named `cronLog` in Prisma. Adjust the property name 
 * (e.g., `createdAt` or `timestamp`) if your schema uses a different date field.
 * Returns the number of rows deleted.
 */
export async function pruneOldCronLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - CRON_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  
  const result = await prisma.cronLog.deleteMany({ 
    where: { 
      ranAt: { lt: cutoff } 
    } 
  });
  
  return result.count;
}