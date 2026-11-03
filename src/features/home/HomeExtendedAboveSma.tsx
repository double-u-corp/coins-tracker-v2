import { readChartCache, writeChartCache } from "./homeChartCache";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatPhp } from "@/lib/format";
import { calculateSMASeries } from "@/features/chart/Technicals";
import {
  MoverLineChart,
  fetchPollSeries,
  fetchDailyForSma,
  type PollPoint,
  type DailyPt,
} from "./HomeTwoDayMovers";

type Hit = {
  symbol: string;
  name: string;
  price: number;
  sma20: number;
  /** (price - sma20) / sma20 * 100 */
  extensionPct: number;
  /** Was below SMA within last 3 daily bars → “fresh” pop above */
  freshCross: boolean;
  /** ~3-session lift % — primary “instant up” signal */
  quickLiftPct: number;
  score: number;
  detail: string;
};

type DailyBar = DailyPt & { high?: number; low?: number };

async function fetchDaily(symbol: string, force = false): Promise<DailyBar[]> {
  const cacheKey = `daily:${symbol.toUpperCase()}`;
  if (!force) {
    const cached = readChartCache<DailyBar[]>(cacheKey);
    if (cached && cached.length > 0) return cached;
  }
  const res = await fetch(
    `/api/coins?type=chart&symbol=${encodeURIComponent(symbol)}&years=1.00&granularity=daily`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const pts = (data.points || []) as DailyBar[];
  if (pts.length > 0) writeChartCache(cacheKey, pts);
  return pts;
}

function closeOf(p: DailyBar): number | null {
  if (p.close != null && Number.isFinite(Number(p.close)) && Number(p.close) > 0) return Number(p.close);
  const h = Number(p.high);
  const l = Number(p.low);
  if (Number.isFinite(h) && Number.isFinite(l) && h > 0 && l > 0) return (h + l) / 2;
  if (Number.isFinite(h) && h > 0) return h;
  return null;
}

function scoreExtended(points: DailyBar[]): Omit<Hit, "symbol" | "name"> | null {
  if (!points || points.length < 22) return null;
  const chartPts = points
    .map((p) => {
      const c = closeOf(p);
      const h = Number(p.high);
      const l = Number(p.low);
      const close = c ?? (Number.isFinite(h) ? h : 0);
      return {
        period: p.period,
        label: p.period,
        high: Number.isFinite(h) && h > 0 ? h : close,
        low: Number.isFinite(l) && l > 0 ? l : close,
        close,
      };
    })
    .filter((p) => p.close > 0);

  if (chartPts.length < 22) return null;

  const smaSeries = calculateSMASeries(chartPts as any, 20);
  const i = chartPts.length - 1;
  const price = chartPts[i].close;
  const sma20 = smaSeries[i];
  if (sma20 == null || !(sma20 > 0) || !(price > 0)) return null;
  // Must be above 20 SMA — pump already printed above the average
  if (price <= sma20) return null;

  const extensionPct = ((price - sma20) / sma20) * 100;

  // 1-day and ~3-day lifts (instant / quick run)
  const prev1 = chartPts[Math.max(0, i - 1)].close;
  const prev3 = chartPts[Math.max(0, i - 3)].close;
  const oneDayLiftPct = prev1 > 0 ? ((price - prev1) / prev1) * 100 : 0;
  const quickLiftPct = prev3 > 0 ? ((price - prev3) / prev3) * 100 : 0;

  // Fresh cross: was at/below SMA in last 3 prior closes
  let freshCross = false;
  for (let k = 1; k <= 3; k++) {
    const j = i - k;
    if (j < 0) break;
    const s = smaSeries[j];
    if (s != null && chartPts[j].close <= s) {
      freshCross = true;
      break;
    }
  }

  // Goal: coins that *just* ran up — monitor for when price cools / goes down.
  // Skip slow grinds that are merely "above SMA" with no recent impulse.
  const hasImpulse = oneDayLiftPct >= 1.2 || quickLiftPct >= 2.5 || freshCross;
  if (!hasImpulse) return null;

  // Rank by speed of the pump first, then modest extension (not max stretch)
  let score = oneDayLiftPct * 4 + Math.max(0, quickLiftPct) * 1.5;
  if (freshCross) score += 6;
  // Cap extension contribution so a 30% stretch doesn't beat a sharp 1-day pop
  score += Math.min(Math.max(extensionPct, 0), 8) * 0.4;

  let detail: string;
  if (oneDayLiftPct >= 2 && freshCross) {
    detail = `Sharp +${oneDayLiftPct.toFixed(1)}% day · just above 20 SMA — watch for pullback`;
  } else if (oneDayLiftPct >= 2) {
    detail = `Fast +${oneDayLiftPct.toFixed(1)}% day above 20 SMA — monitor for cool-down`;
  } else if (freshCross) {
    detail = `Fresh cross above 20 SMA · 3d ${quickLiftPct >= 0 ? "+" : ""}${quickLiftPct.toFixed(1)}% — pullback watch`;
  } else {
    detail = `Quick lift ${quickLiftPct >= 0 ? "+" : ""}${quickLiftPct.toFixed(1)}% (3d) · +${extensionPct.toFixed(1)}% vs SMA`;
  }

  return { price, sma20, extensionPct, freshCross, quickLiftPct, score, detail };
}

/**
 * Top 3 coins that just pumped above 20 SMA — watch for cool-down / pullback.
 * Spot only (not a short signal).
 */
export default function HomeExtendedAboveSma({
  universe,
}: {
  universe: { symbol: string; name?: string }[];
}) {
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [series, setSeries] = useState<PollPoint[]>([]);
  const [dailyPoints, setDailyPoints] = useState<DailyPt[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);

  const scan = useCallback(async (force = false) => {
    const list = universe.filter((u) => u.symbol && !/^(BTC|ETH|XAUT)PHP$/i.test(u.symbol));
    if (list.length === 0) {
      setHits([]);
      return;
    }
    setLoading(true);
    setError(null);
    if (!force) {
      const cachedHits = readChartCache<any[]>("scan:fastPumpSma:v2");
      if (cachedHits && cachedHits.length > 0) {
        setHits(cachedHits as any);
        setSelected((prev) =>
          prev && cachedHits.some((h: any) => h.symbol === prev) ? prev : cachedHits[0]?.symbol || ""
        );
        setLoading(false);
        return;
      }
    }
    try {
      const results = await Promise.all(
        list.map(async (u) => {
          const pts = await fetchDaily(u.symbol);
          const scored = scoreExtended(pts);
          if (!scored) return null;
          return {
            symbol: u.symbol.toUpperCase(),
            name: u.name || u.symbol.replace(/PHP$/i, ""),
            ...scored,
          } as Hit;
        })
      );
      const ranked = results
        .filter((r): r is Hit => r != null)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      setHits(ranked);
      if (ranked.length > 0) writeChartCache("scan:fastPumpSma:v2", ranked);
      setSelected((prev) =>
        prev && ranked.some((h) => h.symbol === prev) ? prev : ranked[0]?.symbol || ""
      );
    } catch (e) {
      setError((e as Error).message || "Scan failed");
    } finally {
      setLoading(false);
    }
  }, [universe]);

  useEffect(() => {
    void scan();
  }, [scan]);

  useEffect(() => {
    if (!selected) {
      setSeries([]);
      setDailyPoints([]);
      return;
    }
    let cancelled = false;
    setSeriesLoading(true);
    Promise.all([fetchPollSeries(selected), fetchDailyForSma(selected)])
      .then(([pts, daily]) => {
        if (!cancelled) {
          setSeries(pts);
          setDailyPoints(daily);
        }
      })
      .finally(() => {
        if (!cancelled) setSeriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const active = hits.find((h) => h.symbol === selected) || null;

  return (
    <section
      id="extended-above-sma"
      className="scroll-mt-20 rounded-xl border-2 border-orange-200 bg-orange-50/30 p-4 shadow-sm"
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-orange-950">
            Fast pump above 20 SMA · top 3
          </h2>
          <p className="mt-0.5 text-[11px] text-orange-900/80">
            Coins that <span className="font-semibold">just ran up</span> through / above the daily
            20 SMA — so you can watch for a cool-down or pullback. Spot only: not a short.
            Confirm on Spot before selling.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {active && (
            <Link
              href={`/chart?symbol=${encodeURIComponent(active.symbol)}`}
              className="rounded-md border border-orange-300 bg-white px-2.5 py-1 text-[11px] font-bold text-orange-900 hover:bg-orange-50"
            >
              Spot → {active.name}
            </Link>
          )}
        </div>
      </div>

      {error && <p className="mb-2 text-xs text-rose-700">{error}</p>}
      {loading && hits.length === 0 ? (
        <p className="text-xs text-gray-500">Scanning vs 20 SMA…</p>
      ) : hits.length === 0 ? (
        <p className="text-xs text-gray-500">No sharp pumps above 20 SMA right now.</p>
      ) : (
        <>
          <div className="mb-3 sm:hidden">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-orange-900">
              Coin
            </label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full rounded-lg border border-orange-300 bg-white px-3 py-2.5 text-sm font-semibold text-orange-950 shadow-sm"
            >
              {hits.map((h, i) => (
                <option key={h.symbol} value={h.symbol}>
                  #{i + 1} {h.name} · {h.quickLiftPct >= 0 ? "+" : ""}
                  {h.quickLiftPct.toFixed(1)}% 3d
                  {h.freshCross ? " · cross" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-3 hidden flex-wrap gap-1.5 sm:flex">
            {hits.map((h, i) => {
              const on = h.symbol === selected;
              return (
                <button
                  key={h.symbol}
                  type="button"
                  onClick={() => setSelected(h.symbol)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition ${
                    on
                      ? "border-orange-600 bg-orange-600 text-white shadow-sm"
                      : "border-orange-200 bg-white text-orange-950 hover:bg-orange-50"
                  }`}
                >
                  <span className="opacity-70">#{i + 1}</span>
                  <span>{h.name}</span>
                  <span className={on ? "text-orange-100" : "text-orange-800"}>
                    {h.quickLiftPct >= 0 ? "+" : ""}
                    {h.quickLiftPct.toFixed(1)}% 3d
                  </span>
                  {h.freshCross && (
                    <span className={on ? "text-amber-100" : "text-amber-700"}>cross</span>
                  )}
                </button>
              );
            })}
          </div>

          {active && (
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-orange-950">
              <span className="font-bold">{active.name}</span>
              <span className="font-mono text-[10px] opacity-70">{active.symbol}</span>
              <span className="font-semibold text-slate-700">{active.detail}</span>
              <span className="tabular-nums text-slate-600">
                now {formatPhp(active.price)} · 20 SMA {formatPhp(active.sma20)} · 3d{" "}
                {active.quickLiftPct >= 0 ? "+" : ""}
                {active.quickLiftPct.toFixed(1)}% · vs SMA +{active.extensionPct.toFixed(1)}%
              </span>
            </div>
          )}

          {seriesLoading ? (
            <p className="text-xs text-gray-500">Loading 3h path…</p>
          ) : (
            <MoverLineChart points={series} symbol={selected} dailyPoints={dailyPoints} />
          )}
        </>
      )}
    </section>
  );
}
