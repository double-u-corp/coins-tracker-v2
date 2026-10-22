import prisma from "@/lib/prisma";
import { chartBucketKey } from "@/lib/chartBucket";
import type { ChartPoint } from "@/validators/recordSchema";
import {
  computeConfluenceSignal,
  isLongExtended,
  isWatchlistBuyLowHit,
  type ConfluenceResult,
  type LadderLevel,
} from "@/features/chart/Technicals";

const RETENTION_DAYS = 30;
const SCAN_YEARS = 1;
const INTRADAY_HOURS = 336;
const CONCURRENCY = 4;

export type LongScanRunResult = {
  scanned: number;
  saved: number;
  pruned: number;
  errors: string[];
  hits: { symbol: string; bias: string; price: number; extended: boolean }[];
};

async function loadDailyPoints(coinId: number): Promise<ChartPoint[]> {
  const cutoff = new Date(Date.now() - SCAN_YEARS * 365 * 24 * 60 * 60 * 1000);
  const records = await prisma.record.findMany({
    where: { coinId, createdAt: { gte: cutoff } },
    select: { price: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const buckets = new Map<
    string,
    { label: string; high: number; low: number; close: number }
  >();
  for (const record of records) {
    const { period, label } = chartBucketKey(record.createdAt, "daily");
    const existing = buckets.get(period);
    if (!existing) {
      buckets.set(period, {
        label,
        high: record.price,
        low: record.price,
        close: record.price,
      });
    } else {
      existing.high = Math.max(existing.high, record.price);
      existing.low = Math.min(existing.low, record.price);
      existing.close = record.price;
    }
  }

  return Array.from(buckets.entries())
    .map(([period, { label, high, low, close }]) => ({
      period,
      label,
      high,
      low,
      close,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

async function loadIntradayPoints(coinId: number): Promise<ChartPoint[] | null> {
  const cutoff = new Date(Date.now() - INTRADAY_HOURS * 60 * 60 * 1000);
  const records = await prisma.record.findMany({
    where: { coinId, createdAt: { gte: cutoff } },
    select: { price: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (records.length === 0) return null;

  return records.map((record) => ({
    period: record.createdAt.toISOString(),
    label: record.createdAt.toLocaleString("en-US", {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
    high: record.price,
    low: record.price,
    close: record.price,
  }));
}

function signalsNote(c: ConfluenceResult): string {
  return c.signals
    .filter((s) => s.available && s.weight !== 0)
    .map((s) => `${s.name}: ${s.detail} (${s.weight > 0 ? "+" : ""}${s.weight})`)
    .join(" · ")
    .slice(0, 500);
}

/**
 * Full-watchlist confluence scan (server).
 * Saves LONG / STRONG LONG that pass isWatchlistBuyLowHit (same filter as
 * /chart "Scan all coins" default — not every LONG on the book).
 * Prunes rows older than 30 days.
 */
export async function runLongScanSnapshot(): Promise<LongScanRunResult> {
  const coins = await prisma.coin.findMany({
    orderBy: { symbol: "asc" },
    select: { id: true, symbol: true, name: true },
  });

  const errors: string[] = [];
  const hits: LongScanRunResult["hits"] = [];
  let saved = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < coins.length) {
      const coin = coins[cursor];
      cursor += 1;
      try {
        const [points, intraday] = await Promise.all([
          loadDailyPoints(coin.id),
          loadIntradayPoints(coin.id),
        ]);

        // Latest price from last record if any
        const lastRec = await prisma.record.findFirst({
          where: { coinId: coin.id },
          orderBy: { createdAt: "desc" },
          select: { price: true },
        });
        const currentPrice = lastRec?.price;

        if (points.length < 5) continue;

        const confluence = computeConfluenceSignal(points, {
          currentPrice: currentPrice ?? undefined,
          intradayPoints: intraday ?? undefined,
        });

        // Match /chart "Scan all coins" default list: buy-low hits only
        // (LONG/STRONG LONG near support / lower third, not extended).
        // Raw LONG mid-range or extended coins are hidden on chart unless
        // "Show all coins" — do not save those here either.
        if (!confluence.bias.includes("LONG")) continue;
        if (!isWatchlistBuyLowHit(confluence)) continue;

        const extended = isLongExtended(confluence);
        const ladder: LadderLevel[] = confluence.entrySuggestion?.ladder ?? [];

        await prisma.longScanHit.create({
          data: {
            coinId: coin.id,
            symbol: coin.symbol,
            name: coin.name,
            bias: confluence.bias,
            score: confluence.score,
            maxScore: confluence.maxPossibleScore,
            confidence: confluence.confidence,
            currentPrice: confluence.currentPrice,
            support: confluence.support,
            resistance: confluence.resistance,
            isExtended: extended,
            ladderJson: JSON.stringify(ladder),
            invalidation: confluence.invalidationLevel,
            invalidationNote: confluence.invalidationNote,
            target: confluence.exitSuggestion?.price ?? null,
            targetNote: confluence.exitSuggestion?.note ?? null,
            macroTrend: confluence.macroTrend,
            signalsNote: signalsNote(confluence),
          },
        });

        saved += 1;
        hits.push({
          symbol: coin.symbol,
          bias: confluence.bias,
          price: confluence.currentPrice,
          extended,
        });
      } catch (err) {
        errors.push(`${coin.symbol}: ${(err as Error).message}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, Math.max(1, coins.length)) }, () =>
    worker()
  );
  await Promise.all(workers);

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const pruned = (
    await prisma.longScanHit.deleteMany({ where: { scannedAt: { lt: cutoff } } })
  ).count;

  return {
    scanned: coins.length,
    saved,
    pruned,
    errors,
    hits,
  };
}
