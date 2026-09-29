import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "@/features/auth/useAuth";
import type { CoinSummary, ChartPoint } from "@/validators/recordSchema";
import type { JournalEntryView } from "@/validators/journalSchema";
import { getSupportResistance, type SupportResistance } from "../../features/chart/Technicals";

export interface CoinOption {
  symbol: string;
  name: string;
  currentPrice?: number | null;
}

// --- 3h-candle window -------------------------------------------------------
// This page's ENTIRE technical read (RSI-14, SMA-20/50/200, support/
// resistance, swing structure) runs on these intraday points, not daily
// bars — that was the explicit ask ("using the 3hrs data price").
//
// WHAT THIS DATA ACTUALLY IS: /api/coins?type=chart&granularity=3h does NOT
// return fixed-width 3-hour OHLC candles. Per handleIntradayChart's own
// comment in coins.ts, it returns one point per raw Record row, and a
// Record is written on every successful poll (after the every-poll cron change).
// Older history may still be extremes-only. So this is a sparse, event-driven series of "new extreme" prices —
// naturally close to the ~3h cron cadence on a volatile coin, but with real
// gaps on a quiet one. That's a deliberate, pre-existing choice in this
// codebase (it's exactly what swing/entry-ladder detection wants: genuine
// observed turning points, not synthetic buckets) — not something to "fix"
// here. It does mean a "200 SMA" is really "average of the last 200
// recorded extremes," which can span very different amounts of real time
// depending on how often a coin is actually moving. `seriesDensity` below
// surfaces exactly that, so the page can be honest about it per-coin
// instead of presenting every coin as equally "fast."
//
// A 200-period SMA needs 200 of these points just to produce its first
// value. The API's chartHoursQuerySchema caps `hours` at 24*180 (180 days)
// — raised from its original 24*30 specifically so this page's 200 SMA has
// room to populate; the daily chart's own hardcoded 336-hour intraday call
// is completely unaffected by this (this only raises the ceiling, existing
// smaller requests are untouched).
export const PAST_TRADE_GRANULARITY = "3h";
export const PAST_TRADE_HOURS = 24 * 60; // 60 days — enough for density/ladder; keeps scan payloads smaller

// Support/resistance + "position in range" lookback, in POINTS (not fixed
// hours, since points aren't evenly spaced — see above). 56 points is
// deliberately much shorter than the daily chart's 30-DAY lookback, matching
// the fact that this page is for hours-to-a-few-days trades (leverage/
// margin/short), not the 15-30 day spot swings the main chart is tuned for.
// 56 also isn't an arbitrary pick: the existing PriceLineChart swing
// sub-chart already uses this exact "last 7 days / ~56 x 3h points" window
// for its own intraday view, so this stays consistent with a convention
// already baked into this codebase — though on a quiet coin, 56 *points*
// here can span meaningfully more than 7 *days*.
export const PAST_TRADE_SR_LOOKBACK = 56;
export const PAST_TRADE_RANGE_LABEL = "recent poll-print range";

export interface SeriesDensity {
  pointCount: number;
  spanDays: number | null; // real calendar days covered by the returned points
  avgRecentGapHours: number | null; // avg spacing between the most recent points
  lastObservedAgoMs: number | null; // how long ago the latest point was recorded
  /** True when this coin is actually printing new extremes often/recently
   * enough to be worth fast-trading off this feed — not a hard rule, just a
   * flag so a quiet coin doesn't get presented with the same confidence as
   * a genuinely active one. */
  isFastEnough: boolean;
}

const FAST_TRADE_GAP_THRESHOLD_HOURS = 12; // recent prints averaging slower than this = thin
const FAST_TRADE_STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 2 days since last print = stale

/** Reads the real spacing/recency out of a sparse, event-driven points
 * series — this IS the "can I actually fast-trade this coin" signal, since
 * the SMA/RSI numbers alone can't tell you that (see the big comment
 * above). Uses each point's `period` ISO timestamp (falls back to `label`),
 * same convention as the journal-matching logic below and PriceLineChart's
 * own intraday handling. */
export function computeSeriesDensity(points: ChartPoint[]): SeriesDensity {
  if (points.length < 2) {
    return { pointCount: points.length, spanDays: null, avgRecentGapHours: null, lastObservedAgoMs: null, isFastEnough: false };
  }

  const times = points
    .map((p) => new Date((p as ChartPoint & { period?: string }).period || p.label).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  if (times.length < 2) {
    return { pointCount: points.length, spanDays: null, avgRecentGapHours: null, lastObservedAgoMs: null, isFastEnough: false };
  }

  const spanMs = times[times.length - 1] - times[0];
  const spanDays = spanMs / (24 * 60 * 60 * 1000);

  const recentTimes = times.slice(-Math.min(20, times.length));
  const gaps: number[] = [];
  for (let i = 1; i < recentTimes.length; i++) gaps.push(recentTimes[i] - recentTimes[i - 1]);
  const avgRecentGapHours =
    gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length / (60 * 60 * 1000) : null;

  const lastObservedAgoMs = Date.now() - times[times.length - 1];

  const isFastEnough =
    avgRecentGapHours != null &&
    avgRecentGapHours <= FAST_TRADE_GAP_THRESHOLD_HOURS &&
    lastObservedAgoMs <= FAST_TRADE_STALE_THRESHOLD_MS;

  return { pointCount: points.length, spanDays, avgRecentGapHours, lastObservedAgoMs, isFastEnough };
}

export function usePastTradeLogic() {
  const router = useRouter();
  const { authenticated } = useAuth();

  const [coinOptions, setCoinOptions] = useState<CoinOption[]>([]);
  const [allCoins, setAllCoins] = useState<CoinSummary[]>([]);
  const [symbol, setSymbol] = useState("");
  const [hasAppliedInitialSymbol, setHasAppliedInitialSymbol] = useState(false);

  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [insufficientData, setInsufficientData] = useState(false);

  const [entries, setEntries] = useState<JournalEntryView[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/coins")
      .then((res) => res.json())
      .then((data: { coins: CoinSummary[] }) => {
        if (!cancelled) {
          setAllCoins(data.coins);
          setCoinOptions(
            data.coins.map((c) => ({
              symbol: c.symbol,
              name: c.name,
              currentPrice: c.currentPrice,
            }))
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hasAppliedInitialSymbol) return;
    if (!router.isReady) return;
    if (coinOptions.length === 0) return;

    const queriedSymbol =
      typeof router.query.symbol === "string" ? router.query.symbol.toUpperCase() : "";
    const matched = coinOptions.find((c) => c.symbol === queriedSymbol);

    setSymbol(matched?.symbol ?? "");
    setHasAppliedInitialSymbol(true);
  }, [router.isReady, router.query.symbol, coinOptions, hasAppliedInitialSymbol]);

  const loadChart = useCallback(() => {
    if (!symbol) return;
    setChartLoading(true);
    setChartError(null);
    setInsufficientData(false);

    fetch(
      `/api/coins?type=chart&symbol=${symbol}&granularity=${PAST_TRADE_GRANULARITY}&hours=${PAST_TRADE_HOURS}`
    )
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load 3h chart data (${res.status})`);
        return res.json();
      })
      .then((data: { points: ChartPoint[] }) => {
        setPoints(data.points || []);
        // Same floor computeConfluenceSignal uses before issuing any
        // directional bias — surfaced here too so the page can show a plain
        // "not enough data yet" state instead of a half-broken chart.
        setInsufficientData((data.points?.length ?? 0) < 20);
      })
      .catch((err) => setChartError((err as Error).message))
      .finally(() => setChartLoading(false));
  }, [symbol]);

  const loadJournal = useCallback(() => {
    setJournalLoading(true);
    setJournalError(null);
    // No symbol → list recent notes (incl. general). With symbol → that coin (+ general null-coin notes from API).
    const url = symbol
      ? `/api/journal?symbol=${encodeURIComponent(symbol)}`
      : `/api/journal`;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load journal (${res.status})`);
        return res.json();
      })
      .then((data: { entries: JournalEntryView[] }) => {
        // Trust API filter — do not drop null-symbol (general) notes
        setEntries(data.entries || []);
      })
      .catch((err) => setJournalError((err as Error).message))
      .finally(() => setJournalLoading(false));
  }, [symbol]);

  useEffect(() => {
    loadChart();
  }, [loadChart]);

  useEffect(() => {
    loadJournal();
  }, [loadJournal]);

  // Matches each journal entry to the nearest 3h candle by timestamp,
  // instead of `chartBucketKey` (its `ChartGranularity` type only covers
  // "daily" — there's no "3h" member to pass here). Each ChartPoint may
  // carry an optional `period` ISO timestamp for intraday data (the same
  // `period ?? label` fallback PriceLineChart.tsx already uses for its own
  // 3h swing sub-chart), so we reuse that instead of introducing a second,
  // divergent way of reading candle time.
  const journalLabelsInView = useMemo(() => {
    const labels = new Set<string>();
    if (points.length === 0) return labels;

    const HALF_BUCKET_MS = 90 * 60 * 1000; // half of a 3h candle

    for (const entry of entries) {
      const entryTime = new Date(entry.entryDate).getTime();
      if (!Number.isFinite(entryTime)) continue;

      let closest: ChartPoint | null = null;
      let closestDiff = Infinity;
      for (const p of points) {
        const raw = (p as ChartPoint & { period?: string }).period || p.label;
        const t = new Date(raw).getTime();
        if (!Number.isFinite(t)) continue;
        const diff = Math.abs(t - entryTime);
        if (diff < closestDiff) {
          closestDiff = diff;
          closest = p;
        }
      }
      // Only tag the candle it actually falls within — otherwise a stale
      // journal entry would get smeared onto whichever candle happens to
      // be nearest, even if that's hours away.
      if (closest && closestDiff <= HALF_BUCKET_MS) {
        labels.add(closest.label);
      }
    }
    return labels;
  }, [entries, points]);

  const technicals: SupportResistance | { support: null; resistance: null } = useMemo(() => {
    if (points.length === 0) return { support: null, resistance: null };
    return getSupportResistance(points, PAST_TRADE_SR_LOOKBACK);
  }, [points]);

  const seriesDensity = useMemo(() => computeSeriesDensity(points), [points]);

  async function addJournalEntry(input: {
    symbol: string | null;
    entryDate: string;
    title: string;
    notes: string;
  }) {
    const res = await fetch("/api/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(
        (errData as { error?: string; message?: string }).error ||
          (errData as { message?: string }).message ||
          "Failed to save journal entry"
      );
    }
    loadJournal();
  }

  async function updateJournalEntry(id: number, input: { title?: string; notes?: string }) {
    const res = await fetch("/api/journal", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...input }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(
        (errData as { error?: string; message?: string }).error ||
          (errData as { message?: string }).message ||
          "Failed to update entry"
      );
    }
    loadJournal();
  }

  async function deleteJournalEntry(id: number) {
    const res = await fetch("/api/journal", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error("Failed to delete journal entry");
    loadJournal();
  }

  return {
    coinOptions,
    allCoins,
    symbol,
    setSymbol,
    points,
    chartLoading,
    chartError,
    insufficientData,
    technicals,
    seriesDensity,
    entries,
    journalLoading,
    journalError,
    journalLabelsInView,
    addJournalEntry,
    deleteJournalEntry,
    updateJournalEntry,
    authenticated,
  };
}
