import prisma from "@/lib/prisma";
import { chartBucketKey } from "@/lib/chartBucket";
import type { ChartPoint } from "@/validators/recordSchema";
import {
  computeConfluenceSignal,
  isLongExtended,
  isWatchlistBuyLowHit,
  isNearSupportWorthCheck,
  calculateSMAAt,
  getEffectivePrice,
  type ConfluenceResult,
  type LadderLevel,
} from "@/features/chart/Technicals";

const RETENTION_DAYS = 30;
const SCAN_YEARS = 1;
const INTRADAY_HOURS = 336;
const CONCURRENCY = 4;
const LOG_PROMPT_ID = "long-scan-log";
const LOG_CATEGORY = "LongScan";
const MAX_LOG_RUNS = 40;

export type LongScanHitPayload = {
  symbol: string;
  name: string;
  bias: string;
  score: number;
  maxScore: number;
  confidence: number;
  currentPrice: number;
  support: number | null;
  resistance: number | null;
  isExtended: boolean;
  ladder: LadderLevel[];
  invalidation: number | null;
  invalidationNote: string | null;
  target: number | null;
  targetNote: string | null;
  macroTrend: string | null;
  signalsNote: string | null;
  tier: string;
};

export type LongScanRunPayload = {
  id: string;
  scannedAt: string;
  scanned: number;
  saved: number;
  pruned: number;
  message: string;
  hits: LongScanHitPayload[];
};

export type LongScanRunResult = {
  ok: boolean;
  scanned: number;
  saved: number;
  pruned: number;
  errors: string[];
  hits: { symbol: string; bias: string; price: number; extended: boolean }[];
  scannedAt: string;
  runId?: string;
};

/**
 * Long-scan only (does not change Spot score): price near support AND
 * near / just crossing the 20 SMA from below (buy-low + momentum setup).
 */
function isNearSupportAndNear20SmaCross(
  points: ChartPoint[],
  c: ConfluenceResult
): boolean {
  if (points.length < 21) return false;
  if (c.bias.includes("SHORT")) return false;
  if (!isNearSupportWorthCheck(c)) return false;

  const sma20 = calculateSMAAt(points, 20, 0);
  const prevSma20 = calculateSMAAt(points, 20, 1);
  if (sma20 == null || prevSma20 == null || sma20 <= 0) return false;

  const price = c.currentPrice;
  const prevPrice = getEffectivePrice(points[points.length - 2]);
  if (!Number.isFinite(price) || !Number.isFinite(prevPrice)) return false;

  const distPct = Math.abs(price - sma20) / sma20;
  const nearBand =
    c.atr != null && c.atr > 0 ? Math.max(0.012, (0.75 * c.atr) / sma20) : 0.02;
  if (distPct > nearBand) return false;

  const wasBelow = prevPrice <= prevSma20 * 1.002;
  const nowNearOrAbove = price >= sma20 * 0.985;
  const rising = price >= prevPrice * 0.998;

  return wasBelow && nowNearOrAbove && rising;
}

function signalsNote(c: ConfluenceResult): string {
  return c.signals
    .filter((s) => s.available && s.weight !== 0)
    .map((s) => `${s.name}: ${s.detail} (${s.weight > 0 ? "+" : ""}${s.weight})`)
    .join(" · ")
    .slice(0, 500);
}

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

function parseLogStore(raw: string | null | undefined): LongScanRunPayload[] {
  if (!raw) return [];
  try {
    if (raw.startsWith("<!--meta:")) {
      const end = raw.indexOf("-->");
      const meta = JSON.parse(raw.slice(9, end));
      if (Array.isArray(meta.runs)) return meta.runs as LongScanRunPayload[];
    }
    const j = JSON.parse(raw);
    if (Array.isArray(j.runs)) return j.runs as LongScanRunPayload[];
  } catch {
    /* ignore */
  }
  return [];
}

function serializeLogStore(runs: LongScanRunPayload[]): string {
  return `<!--meta:${JSON.stringify({ version: 1, runs })}-->\n`;
}

/** Read all long-scan runs (CatalystLog — always available). */
export async function listLongScanRuns(): Promise<LongScanRunPayload[]> {
  const log = await prisma.catalystLog.findUnique({ where: { promptId: LOG_PROMPT_ID } });
  const runs = parseLogStore(log?.response);
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  return runs
    .filter((r) => {
      const t = Date.parse(r.scannedAt);
      return !Number.isFinite(t) || t >= cutoff;
    })
    .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
}

async function appendRunToLog(run: LongScanRunPayload): Promise<void> {
  const existing = await listLongScanRuns();
  const next = [run, ...existing.filter((r) => r.id !== run.id)].slice(0, MAX_LOG_RUNS);
  await prisma.catalystLog.upsert({
    where: { promptId: LOG_PROMPT_ID },
    create: {
      promptId: LOG_PROMPT_ID,
      category: LOG_CATEGORY,
      response: serializeLogStore(next),
    },
    update: {
      category: LOG_CATEGORY,
      response: serializeLogStore(next),
    },
  });
}

export async function deleteLongScanRun(runId: string): Promise<boolean> {
  const existing = await listLongScanRuns();
  const next = existing.filter((r) => r.id !== runId);
  if (next.length === existing.length) return false;
  await prisma.catalystLog.upsert({
    where: { promptId: LOG_PROMPT_ID },
    create: {
      promptId: LOG_PROMPT_ID,
      category: LOG_CATEGORY,
      response: serializeLogStore(next),
    },
    update: { response: serializeLogStore(next) },
  });
  return true;
}

export async function deleteLongScanHit(runId: string, symbol: string): Promise<boolean> {
  const existing = await listLongScanRuns();
  let changed = false;
  const next = existing.map((r) => {
    if (r.id !== runId) return r;
    const hits = r.hits.filter((h) => h.symbol !== symbol);
    if (hits.length !== r.hits.length) {
      changed = true;
      return { ...r, hits, saved: hits.length };
    }
    return r;
  });
  if (!changed) return false;
  await prisma.catalystLog.upsert({
    where: { promptId: LOG_PROMPT_ID },
    create: {
      promptId: LOG_PROMPT_ID,
      category: LOG_CATEGORY,
      response: serializeLogStore(next),
    },
    update: { response: serializeLogStore(next) },
  });
  return true;
}

/**
 * Full-watchlist confluence scan (server).
 * Always appends a run to CatalystLog (visible on /long-scan even with 0 hits).
 */
export async function runLongScanSnapshot(): Promise<LongScanRunResult> {
  const coins = await prisma.coin.findMany({
    orderBy: { symbol: "asc" },
    select: { id: true, symbol: true, name: true },
  });

  const errors: string[] = [];
  const hitPayloads: LongScanHitPayload[] = [];
  const hits: LongScanRunResult["hits"] = [];
  let saved = 0;
  let cursor = 0;
  const runAt = new Date();
  const runId = `run_${runAt.getTime()}`;

  // Immediate breadcrumb so a timeout still leaves a visible "Running…" row
  await appendRunToLog({
    id: runId,
    scannedAt: runAt.toISOString(),
    scanned: coins.length,
    saved: 0,
    pruned: 0,
    message: "Running…",
    hits: [],
  });

  async function worker() {
    while (cursor < coins.length) {
      const coin = coins[cursor];
      cursor += 1;
      try {
        const [points, intraday] = await Promise.all([
          loadDailyPoints(coin.id),
          loadIntradayPoints(coin.id),
        ]);

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

        const extended = isLongExtended(confluence);
        const isLong = confluence.bias.includes("LONG");
        const buyLow = isWatchlistBuyLowHit(confluence);
        const nearCross = isNearSupportAndNear20SmaCross(points, confluence);

        if (isLong && extended && !nearCross) continue;
        if (!isLong && !nearCross) continue;

        const ladder: LadderLevel[] = confluence.entrySuggestion?.ladder ?? [];
        const tier = nearCross ? "NEAR_CROSS" : buyLow ? "BUY_LOW" : "LONG_WATCH";
        const crossHint = nearCross ? " · near support + 20 SMA cross" : "";
        const note = `[${tier}] ${signalsNote(confluence)}${crossHint}`.slice(0, 500);

        const payload: LongScanHitPayload = {
          symbol: coin.symbol,
          name: coin.name,
          bias: confluence.bias,
          score: confluence.score,
          maxScore: confluence.maxPossibleScore,
          confidence: confluence.confidence,
          currentPrice: confluence.currentPrice,
          support: confluence.support,
          resistance: confluence.resistance,
          isExtended: false,
          ladder,
          invalidation: confluence.invalidationLevel,
          invalidationNote: confluence.invalidationNote,
          target: confluence.exitSuggestion?.price ?? null,
          targetNote: confluence.exitSuggestion?.note ?? null,
          macroTrend: confluence.macroTrend,
          signalsNote: note,
          tier,
        };
        hitPayloads.push(payload);
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

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, Math.max(1, coins.length)) },
    () => worker()
  );
  await Promise.all(workers);

  const msg =
    saved > 0
      ? `Saved ${saved} hit(s).`
      : "No LONG / near-support·20SMA setups this run.";
  const finalMessage = errors.length ? `${msg} Errors: ${errors.length}` : msg;

  await appendRunToLog({
    id: runId,
    scannedAt: runAt.toISOString(),
    scanned: coins.length,
    saved,
    pruned: 0,
    message: finalMessage,
    hits: hitPayloads,
  });

  return {
    ok: true,
    scanned: coins.length,
    saved,
    pruned: 0,
    errors,
    hits,
    scannedAt: runAt.toISOString(),
    runId,
  };
}
