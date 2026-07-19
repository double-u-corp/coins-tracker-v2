import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { isAuthenticatedRequest } from "@/lib/auth";
import { chartBucketKey } from "@/lib/chartBucket";
import {
  addCoinSchema,
  chartGranularitySchema,
  chartYearsQuerySchema,
  coinSymbolQuerySchema,
  monthQuerySchema,
  removeCoinSchema,
} from "@/validators/coinSchema";
import type { ChartPoint, CoinSummary, DailyRecord, NewRecordAlert } from "@/validators/recordSchema";

type SummaryResponse = { coins: CoinSummary[]; lastCronRun: string | null; lastCronStatus: string | null };
type CalendarResponse = { days: DailyRecord[] };
type ChartResponse = { points: ChartPoint[] };
type AlertsResponse = { cronLogId: number | null; ranAt: string | null; newRecords: NewRecordAlert[] };
type MutationResponse = { coin: { id: number; symbol: string; name: string } };
type DeleteResponse = { ok: true };
type ErrorResponse = { error: string };

/** Groups a list of Records into one high/low entry per calendar day (UTC date). Used by the Calendar page. */
function toDailyRecords(records: { price: number; high: number; low: number; createdAt: Date }[]): DailyRecord[] {
  const byDate = new Map<string, { high: number; low: number }>();

  for (const record of records) {
    const dateKey = record.createdAt.toISOString().slice(0, 10); // YYYY-MM-DD
    const existing = byDate.get(dateKey);
    if (!existing) {
      byDate.set(dateKey, { high: record.high, low: record.low });
    } else {
      existing.high = Math.max(existing.high, record.high);
      existing.low = Math.min(existing.low, record.low);
    }
  }

  return Array.from(byDate.entries())
    .map(([date, { high, low }]) => ({ date, high, low }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function handleSummary(res: NextApiResponse<SummaryResponse>) {
  const coins = await prisma.coin.findMany({
    include: {
      records: { orderBy: { createdAt: "desc" }, take: 1 },
      priceTarget: true,
    },
    orderBy: { name: "asc" },
  });

  // Overall recorded high/low is the max/min across every record ever saved,
  // not just the latest row, since "high"/"low" on the latest row already
  // reflects the running max/min at that point in time.
  const summaries: CoinSummary[] = coins.map((coin) => {
    const latest = coin.records[0];
    const currentPrice = latest?.price ?? null;
    const targetHigh = coin.priceTarget?.targetHigh ?? null;
    const targetLow = coin.priceTarget?.targetLow ?? null;

    return {
      id: coin.id,
      name: coin.name,
      symbol: coin.symbol,
      currentPrice,
      recordedHigh: latest?.high ?? null,
      recordedLow: latest?.low ?? null,
      targetHigh,
      targetLow,
      targetHighReached: targetHigh !== null && currentPrice !== null && currentPrice >= targetHigh,
      targetLowReached: targetLow !== null && currentPrice !== null && currentPrice <= targetLow,
    };
  });

  const lastLog = await prisma.cronLog.findFirst({ orderBy: { ranAt: "desc" } });

  res.status(200).json({
    coins: summaries,
    lastCronRun: lastLog?.ranAt.toISOString() ?? null,
    lastCronStatus: lastLog?.status ?? null,
  });
}

/** GET /api/coins?type=alerts — new highs/lows set by the most recent cron run, for the Home page modal. */
async function handleAlerts(res: NextApiResponse<AlertsResponse>) {
  const lastLog = await prisma.cronLog.findFirst({ orderBy: { ranAt: "desc" } });
  if (!lastLog) {
    return res.status(200).json({ cronLogId: null, ranAt: null, newRecords: [] });
  }

  const records = await prisma.record.findMany({
    where: { cronLogId: lastLog.id, OR: [{ isNewHigh: true }, { isNewLow: true }] },
    include: { coin: true },
  });

  const newRecords: NewRecordAlert[] = records.flatMap((r) => {
    const entries: NewRecordAlert[] = [];
    if (r.isNewHigh) entries.push({ symbol: r.coin.symbol, name: r.coin.name, type: "high", value: r.high });
    if (r.isNewLow) entries.push({ symbol: r.coin.symbol, name: r.coin.name, type: "low", value: r.low });
    return entries;
  });

  res.status(200).json({ cronLogId: lastLog.id, ranAt: lastLog.ranAt.toISOString(), newRecords });
}

async function handleCalendar(
  res: NextApiResponse<CalendarResponse | ErrorResponse>,
  symbolRaw: string,
  monthRaw: string
) {
  const symbolResult = coinSymbolQuerySchema.safeParse(symbolRaw);
  const monthResult = monthQuerySchema.safeParse(monthRaw);

  if (!symbolResult.success || !symbolResult.data) {
    return res.status(400).json({ error: "A valid `symbol` query param is required" });
  }
  if (!monthResult.success) {
    return res.status(400).json({ error: monthResult.error.errors[0]?.message ?? "Invalid month" });
  }

  const coin = await prisma.coin.findUnique({ where: { symbol: symbolResult.data } });
  if (!coin) {
    return res.status(200).json({ days: [] });
  }

  const [year, month] = monthResult.data.split("-").map(Number);
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const startOfNextMonth = new Date(Date.UTC(year, month, 1));

  const records = await prisma.record.findMany({
    where: { coinId: coin.id, createdAt: { gte: startOfMonth, lt: startOfNextMonth } },
    select: { price: true, high: true, low: true, createdAt: true },
  });

  res.status(200).json({ days: toDailyRecords(records) });
}

/**
 * GET /api/coins?type=chart&symbol=X&years=1-5&granularity=weekly|monthly|yearly
 * Returns period-bucketed high/low (the actual price range within each
 * bucket, not the cumulative all-time Record.high/low) for the line chart.
 */
async function handleChart(
  res: NextApiResponse<ChartResponse | ErrorResponse>,
  symbolRaw: string,
  yearsRaw: string,
  granularityRaw: string
) {
  const symbolResult = coinSymbolQuerySchema.safeParse(symbolRaw);
  const yearsResult = chartYearsQuerySchema.safeParse(yearsRaw || "1");
  const granularityResult = chartGranularitySchema.safeParse(granularityRaw || "weekly");

  if (!symbolResult.success || !symbolResult.data) {
    return res.status(400).json({ error: "A valid `symbol` query param is required" });
  }
  if (!yearsResult.success) {
    return res.status(400).json({ error: "`years` must be a number between 1 and 5" });
  }
  if (!granularityResult.success) {
    return res.status(400).json({ error: "`granularity` must be weekly, monthly, or yearly" });
  }

  const coin = await prisma.coin.findUnique({ where: { symbol: symbolResult.data } });
  if (!coin) {
    return res.status(200).json({ points: [] });
  }

  const cutoff = new Date(Date.now() - yearsResult.data * 365 * 24 * 60 * 60 * 1000);

  const records = await prisma.record.findMany({
    where: { coinId: coin.id, createdAt: { gte: cutoff } },
    select: { price: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const buckets = new Map<string, { label: string; high: number; low: number }>();
  for (const record of records) {
    const { period, label } = chartBucketKey(record.createdAt, granularityResult.data);
    const existing = buckets.get(period);
    if (!existing) {
      buckets.set(period, { label, high: record.price, low: record.price });
    } else {
      existing.high = Math.max(existing.high, record.price);
      existing.low = Math.min(existing.low, record.price);
    }
  }

  const points: ChartPoint[] = Array.from(buckets.entries())
    .map(([period, { label, high, low }]) => ({ period, label, high, low }))
    .sort((a, b) => a.period.localeCompare(b.period));

  res.status(200).json({ points });
}

/**
 * POST /api/coins — add a new coin to monitor. Body: { symbol, name }. Requires login.
 * This is also how a coin gets added manually (typed in directly, not picked from
 * search) — the endpoint doesn't require the symbol to have shown up in
 * /api/available-coins first, and deliberately does NOT attempt a live price
 * check: a manually-added coin is often exactly one that isn't reachable via
 * the live ticker, so probing it here would just produce a guaranteed error.
 * If it needs a starting price, that's set separately via POST /api/records.
 */
async function handleAddCoin(req: NextApiRequest, res: NextApiResponse<MutationResponse | ErrorResponse>) {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: "Login required" });
  }

  const parsed = addCoinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid coin payload" });
  }

  const { symbol, name } = parsed.data;

  const coin = await prisma.coin.upsert({
    where: { symbol },
    update: { name },
    create: { symbol, name },
  });

  return res.status(201).json({ coin: { id: coin.id, symbol: coin.symbol, name: coin.name } });
}

/**
 * DELETE /api/coins — stop monitoring a coin. Body: { symbol }. Requires login.
 * Removes its recorded price/transaction/target history and auto-generated
 * news, but preserves journal entries by detaching them (coinId -> null,
 * becoming general entries) rather than deleting user-authored content.
 */
async function handleRemoveCoin(req: NextApiRequest, res: NextApiResponse<DeleteResponse | ErrorResponse>) {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: "Login required" });
  }

  const parsed = removeCoinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid payload" });
  }

  const coin = await prisma.coin.findUnique({ where: { symbol: parsed.data.symbol } });
  if (!coin) {
    return res.status(404).json({ error: `No monitored coin with symbol ${parsed.data.symbol}` });
  }

  await prisma.record.deleteMany({ where: { coinId: coin.id } });
  await prisma.transaction.deleteMany({ where: { coinId: coin.id } });
  await prisma.priceTarget.deleteMany({ where: { coinId: coin.id } });
  await prisma.newsItem.deleteMany({ where: { coinId: coin.id } });
  await prisma.journalEntry.updateMany({ where: { coinId: coin.id }, data: { coinId: null } });
  await prisma.coin.delete({ where: { id: coin.id } });

  return res.status(200).json({ ok: true });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    SummaryResponse | CalendarResponse | ChartResponse | AlertsResponse | MutationResponse | DeleteResponse | ErrorResponse
  >
) {
  try {
    if (req.method === "POST") {
      return await handleAddCoin(req, res as NextApiResponse<MutationResponse | ErrorResponse>);
    }
    if (req.method === "DELETE") {
      return await handleRemoveCoin(req, res as NextApiResponse<DeleteResponse | ErrorResponse>);
    }
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET, POST, DELETE");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { type, symbol, month, years, granularity } = req.query;

    if (type === "calendar") {
      return await handleCalendar(res, String(symbol ?? ""), String(month ?? ""));
    }
    if (type === "chart") {
      return await handleChart(res, String(symbol ?? ""), String(years ?? ""), String(granularity ?? ""));
    }
    if (type === "alerts") {
      return await handleAlerts(res as NextApiResponse<AlertsResponse>);
    }
    return await handleSummary(res as NextApiResponse<SummaryResponse>);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
