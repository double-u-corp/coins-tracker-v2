import prisma from "@/lib/prisma";
import { chartBucketKey } from "@/lib/chartBucket";
import type { ChartPoint } from "@/validators/recordSchema";
import {
  computeConfluenceSignal,
  isLongExtended,
  isWatchlistBuyLowHit,
  isNearSupportWorthCheck,
  getEffectivePrice,
  type ConfluenceResult,
  type LadderLevel,
} from "@/features/chart/Technicals";

const RETENTION_DAYS = 30;
const SCAN_YEARS = 1;
const INTRADAY_HOURS = 336;
const CONCURRENCY = 6;
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
  chunk?: number;
  chunks?: number;
  done?: boolean;
  totalSaved?: number;
};

/** Skip majors / gold — speeds scan; focus on alts for buy-low. */
const SKIP_SYMBOLS = new Set([
  "BTCPHP",
  "BTC",
  "ETHPHP",
  "ETH",
  "XAUTPHP",
  "XAUT",
]);

/**
 * Long-scan only (Spot score unchanged): near support / lower range
 * AND short-term price rising (prefer 3h series).
 */
function isPriceRising(series: ChartPoint[] | null | undefined, fallbackDaily: ChartPoint[]): boolean {
  const src =
    series && series.length >= 3
      ? series
      : fallbackDaily.length >= 3
        ? fallbackDaily
        : null;
  if (!src) return false;
  const n = src.length;
  const last = getEffectivePrice(src[n - 1]);
  const prev = getEffectivePrice(src[n - 2]);
  // Look back ~2–4 prints for a clearer uptick (not a one-tick noise bounce)
  const back = getEffectivePrice(src[Math.max(0, n - 4)]);
  if (![last, prev, back].every((x) => Number.isFinite(x) && x > 0)) return false;
  // Rising: last >= prev and last > earlier print by a small margin
  return last >= prev * 0.999 && last > back * 1.002;
}

function isNearSupportAndRising(
  points: ChartPoint[],
  intraday: ChartPoint[] | null | undefined,
  c: ConfluenceResult
): boolean {
  if (c.bias === "INSUFFICIENT DATA") return false;
  if (c.bias.includes("SHORT")) return false; // hold cash — not a buy watch
  if (!isNearSupportWorthCheck(c)) return false;
  // Skip already-run LONGs at the floor that are still "extended" vs ladder/range
  if (c.bias.includes("LONG") && isLongExtended(c)) return false;
  return isPriceRising(intraday, points);
}

function signalsNote(c: ConfluenceResult, points?: ChartPoint[]): string {
  const bits: string[] = [];
  const rsi = c.signals.find((s) => s.name.startsWith("RSI"));
  if (rsi?.available) {
    // e.g. "RSI 36 — leaning oversold"
    const short = rsi.detail.replace(/\s*—\s*/, " — ").split(" · ")[0];
    bits.push(`RSI (14): ${short}`);
  }
  const range = c.signals.find((s) => s.name.startsWith("Position in"));
  if (range?.available) {
    bits.push(range.detail); // "Near range support (3% of range) — discount zone"
  }
  // Gap between 20 SMA and 50 SMA at report time (how far they are from meeting)
  if (points && points.length >= 50) {
    try {
      const closes = points
        .map((pt) => Number(pt.close ?? pt.high ?? pt.low))
        .filter((n) => Number.isFinite(n));
      if (closes.length >= 50) {
        const sma20 =
          closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const sma50 =
          closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
        if (sma50 > 0 && Number.isFinite(sma20) && Number.isFinite(sma50)) {
          const pct = ((sma20 - sma50) / sma50) * 100;
          const abs = Math.abs(pct).toFixed(1);
          const fmt = (v: number) => v.toFixed(v >= 100 ? 0 : 2);
          if (Math.abs(pct) < 0.05) {
            bits.push(`20/50 SMA aligned (~${fmt(sma50)})`);
          } else if (pct < 0) {
            bits.push(
              `20 SMA ${abs}% below 50 SMA (20=${fmt(sma20)}, 50=${fmt(sma50)}) — gap to meet`
            );
          } else {
            bits.push(
              `20 SMA ${abs}% above 50 SMA (20=${fmt(sma20)}, 50=${fmt(sma50)})`
            );
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (bits.length === 0) {
    return c.signals
      .filter((s) => s.available && s.weight !== 0)
      .map((s) => `${s.name}: ${s.detail}`)
      .join(" · ")
      .slice(0, 400);
  }
  return bits.join(" · ").slice(0, 400);
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

/** Runs from CatalystLog (new) + LongScanHit/Run tables (old) so page always matches cron. */
export async function listLongScanRuns(): Promise<LongScanRunPayload[]> {
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  const byId = new Map<string, LongScanRunPayload>();

  // --- New store ---
  try {
    const log = await prisma.catalystLog.findUnique({ where: { promptId: LOG_PROMPT_ID } });
    for (const r of parseLogStore(log?.response)) {
      const ts = Date.parse(r.scannedAt);
      if (Number.isFinite(ts) && ts < cutoff) continue;
      byId.set(r.id, r);
    }
  } catch {
    /* ignore */
  }

  // --- Old Prisma tables (if they exist and still receive writes) ---
  try {
    const db = prisma as typeof prisma & {
      longScanRun?: { findMany: (args: unknown) => Promise<Array<{ id: number; scannedAt: Date; scanned: number; saved: number; pruned: number; message: string | null }>> };
      longScanHit?: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
    };
    if (db.longScanHit?.findMany) {
      const hits = await db.longScanHit.findMany({
        orderBy: [{ scannedAt: "desc" }, { symbol: "asc" }],
        take: 300,
      });
      const groups = new Map<string, LongScanHitPayload[]>();
      const times = new Map<string, string>();
      for (const h of hits) {
        const scannedAt =
          h.scannedAt instanceof Date
            ? h.scannedAt.toISOString()
            : String(h.scannedAt);
        const ts = Date.parse(scannedAt);
        if (Number.isFinite(ts) && ts < cutoff) continue;
        const key = scannedAt;
        times.set(key, scannedAt);
        let ladder: LadderLevel[] = [];
        try {
          ladder = JSON.parse(String(h.ladderJson || "[]"));
        } catch {
          ladder = [];
        }
        const payload: LongScanHitPayload = {
          symbol: String(h.symbol),
          name: String(h.name),
          bias: String(h.bias),
          score: Number(h.score) || 0,
          maxScore: Number(h.maxScore) || 0,
          confidence: Number(h.confidence) || 0,
          currentPrice: Number(h.currentPrice) || 0,
          support: h.support != null ? Number(h.support) : null,
          resistance: h.resistance != null ? Number(h.resistance) : null,
          isExtended: Boolean(h.isExtended),
          ladder,
          invalidation: h.invalidation != null ? Number(h.invalidation) : null,
          invalidationNote: h.invalidationNote != null ? String(h.invalidationNote) : null,
          target: h.target != null ? Number(h.target) : null,
          targetNote: h.targetNote != null ? String(h.targetNote) : null,
          macroTrend: h.macroTrend != null ? String(h.macroTrend) : null,
          signalsNote: h.signalsNote != null ? String(h.signalsNote) : null,
          tier: "BUY_LOW",
        };
        (groups.get(key) || groups.set(key, []).get(key)!).push(payload);
      }
      for (const [key, groupHits] of groups) {
        const id = `prisma_${key}`;
        if (byId.has(id)) continue;
        byId.set(id, {
          id,
          scannedAt: times.get(key) || key,
          scanned: groupHits.length,
          saved: groupHits.length,
          pruned: 0,
          message: groupHits.length
            ? `Saved ${groupHits.length} hit(s) (DB).`
            : "No hits (DB).",
          hits: groupHits,
        });
      }
    }
    if (db.longScanRun?.findMany) {
      const runs = await db.longScanRun.findMany({
        orderBy: { scannedAt: "desc" },
        take: 60,
      });
      for (const r of runs) {
        const scannedAt = r.scannedAt.toISOString();
        const ts = Date.parse(scannedAt);
        if (Number.isFinite(ts) && ts < cutoff) continue;
        const id = `prisma_run_${r.id}`;
        if (byId.has(id)) continue;
        // Prefer hit-grouped rows for same timestamp
        const existing = [...byId.values()].find((x) => x.scannedAt === scannedAt);
        if (existing) continue;
        byId.set(id, {
          id,
          scannedAt,
          scanned: r.scanned,
          saved: r.saved,
          pruned: r.pruned,
          message: r.message || (r.saved ? `Saved ${r.saved}` : "No hits"),
          hits: [],
        });
      }
    }
  } catch {
    /* tables may not exist on this deploy */
  }

  return [...byId.values()].sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
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

export type RunScanOptions = {
  /** 0-based chunk index */
  chunk?: number;
  /** Total chunks (e.g. 4 → ~8 coins each for 33 coins) */
  chunks?: number;
  /** Shared id so multiple chunk calls append to one run */
  runId?: string;
  /** Skip 3h series for speed (daily only) */
  fast?: boolean;
};

/**
 * Full or chunked watchlist scan.
 * Use chunks when host/cron timeout is ~30s — e.g. chunks=4 sequential calls.
 */
export async function runLongScanSnapshot(
  options: RunScanOptions = {}
): Promise<LongScanRunResult> {
  const chunks = Math.max(1, Math.min(12, options.chunks ?? 1));
  const chunk = Math.max(0, Math.min(chunks - 1, options.chunk ?? 0));
  const fast = Boolean(options.fast);

  const allCoins = await prisma.coin.findMany({
    orderBy: { symbol: "asc" },
    select: {
      id: true,
      symbol: true,
      name: true,
      records: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { price: true },
      },
    },
  });

  const coins = allCoins.filter((c) => !SKIP_SYMBOLS.has(c.symbol.toUpperCase()));
  const size = Math.ceil(coins.length / chunks) || 1;
  const slice = coins.slice(chunk * size, chunk * size + size);

  const errors: string[] = [];
  const hitPayloads: LongScanHitPayload[] = [];
  const hits: LongScanRunResult["hits"] = [];
  let saved = 0;
  let cursor = 0;
  const runAt = new Date();
  const runId =
    options.runId ||
    (chunks > 1
      ? `run_${new Date(runAt.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 13)}` // Manila hour
      : `run_${runAt.getTime()}`);

  // Seed / refresh run row
  const existingRuns = await listLongScanRuns();
  const prior = existingRuns.find((r) => r.id === runId);
  const priorHits = prior?.hits ?? [];

  await appendRunToLog({
    id: runId,
    scannedAt: prior?.scannedAt ?? runAt.toISOString(),
    scanned: coins.length,
    saved: priorHits.length,
    pruned: 0,
    message: `Running chunk ${chunk + 1}/${chunks}…`,
    hits: priorHits,
  });

  async function worker() {
    while (cursor < slice.length) {
      const coin = slice[cursor];
      cursor += 1;
      try {
        const points = await loadDailyPoints(coin.id);
        // Always need a short 3h window for "rising"; fast only skips using it in confluence
        const intraday = await loadIntradayPoints(coin.id);
        const currentPrice = coin.records[0]?.price;

        if (points.length < 5) continue;

        const confluence = computeConfluenceSignal(points, {
          currentPrice: currentPrice ?? undefined,
          // Keep Spot-equivalent confluence on daily; 3h only for rising filter
          intradayPoints: fast ? undefined : intraday ?? undefined,
        });

        if (!isNearSupportAndRising(points, intraday, confluence)) continue;

        const buyLow = isWatchlistBuyLowHit(confluence);
        const ladder: LadderLevel[] = confluence.entrySuggestion?.ladder ?? [];
        const tier = buyLow ? "BUY_LOW" : "NEAR_SUPPORT_UP";
        const note = `[${tier}] ${signalsNote(confluence, points)}`.slice(0, 500);
        const extended = isLongExtended(confluence);

        // Dedupe symbol within this run
        if (priorHits.some((h) => h.symbol === coin.symbol) || hitPayloads.some((h) => h.symbol === coin.symbol)) {
          continue;
        }

        hitPayloads.push({
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

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, Math.max(1, slice.length)) },
    () => worker()
  );
  await Promise.all(workers);

  const mergedHits = [...priorHits, ...hitPayloads];
  const isLast = chunk >= chunks - 1;
  const msg = isLast
    ? mergedHits.length > 0
      ? `Saved ${mergedHits.length} hit(s) (${chunks} chunks).`
      : "No near-support + rising setups this run."
    : `Chunk ${chunk + 1}/${chunks} done · ${mergedHits.length} hit(s) so far.`;
  const finalMessage = errors.length ? `${msg} Errors: ${errors.length}` : msg;

  await appendRunToLog({
    id: runId,
    scannedAt: prior?.scannedAt ?? runAt.toISOString(),
    scanned: coins.length,
    saved: mergedHits.length,
    pruned: 0,
    message: finalMessage,
    hits: mergedHits,
  });

  // Dual-write to LongScanHit so old UIs / DB browsers still see rows
  try {
    const db = prisma as typeof prisma & {
      longScanHit?: { create: (args: unknown) => Promise<unknown> };
      coin?: { findFirst: (args: unknown) => Promise<{ id: number } | null> };
    };
    if (db.longScanHit?.create && hitPayloads.length > 0) {
      for (const h of hitPayloads) {
        const coin = await prisma.coin.findFirst({
          where: { symbol: h.symbol },
          select: { id: true },
        });
        if (!coin) continue;
        await db.longScanHit.create({
          data: {
            coinId: coin.id,
            symbol: h.symbol,
            name: h.name,
            scannedAt: runAt,
            bias: h.bias,
            score: h.score,
            maxScore: h.maxScore,
            confidence: h.confidence,
            currentPrice: h.currentPrice,
            support: h.support,
            resistance: h.resistance,
            isExtended: h.isExtended,
            ladderJson: JSON.stringify(h.ladder),
            invalidation: h.invalidation,
            invalidationNote: h.invalidationNote,
            target: h.target,
            targetNote: h.targetNote,
            macroTrend: h.macroTrend,
            signalsNote: h.signalsNote,
          },
        });
      }
    }
  } catch {
    /* optional legacy table */
  }

  return {
    ok: true,
    scanned: coins.length,
    saved: hitPayloads.length,
    pruned: 0,
    errors,
    hits,
    scannedAt: prior?.scannedAt ?? runAt.toISOString(),
    runId,
    chunk,
    chunks,
    done: isLast,
    totalSaved: mergedHits.length,
  };
}
