import { readChartCache, writeChartCache } from "./homeChartCache";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatPhp } from "@/lib/format";
import {
  MoverLineChart,
  fetchPollSeries,
  fetchDailyForSma,
  type PollPoint,
  type DailyPt,
} from "./HomeTwoDayMovers";

type RangeHit = {
  symbol: string;
  name: string;
  positionPct: number; // 0–100+ of 30d range (support = 0)
  price: number;
  support: number;
  resistance: number;
  detail: string;
};

type DailyPtFull = DailyPt & { high?: number; low?: number };

async function fetchDailyPoints(symbol: string, force = false): Promise<DailyPtFull[]> {
  const cacheKey = `daily:${symbol.toUpperCase()}`;
  if (!force) {
    const cached = readChartCache<DailyPtFull[]>(cacheKey);
    if (cached && cached.length > 0) return cached;
  }
  // years=1 so we always have ≥30 daily bars when the coin has history
  const res = await fetch(
    `/api/coins?type=chart&symbol=${encodeURIComponent(symbol)}&years=1.00&granularity=daily`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const pts = (data.points || []) as DailyPtFull[];
  if (pts.length > 0) writeChartCache(cacheKey, pts);
  return pts;
}

function positionIn30d(points: DailyPtFull[]): Omit<RangeHit, "symbol" | "name"> | null {
  if (!points || points.length < 8) return null;
  const slice = points.slice(-30);
  const chartPts = slice
    .map((p) => {
      const high = Number(p.high);
      const low = Number(p.low);
      const closeRaw = p.close != null ? Number(p.close) : NaN;
      const close = Number.isFinite(closeRaw)
        ? closeRaw
        : Number.isFinite(high) && Number.isFinite(low)
          ? (high + low) / 2
          : Number.isFinite(high)
            ? high
            : NaN;
      const hi = Number.isFinite(high) && high > 0 ? high : close;
      const lo = Number.isFinite(low) && low > 0 ? low : close;
      if (!Number.isFinite(close) || close <= 0) return null;
      return { period: p.period, high: hi, low: lo, close };
    })
    .filter((p): p is { period: string; high: number; low: number; close: number } => p != null);

  if (chartPts.length < 8) return null;

  const last = chartPts[chartPts.length - 1];
  const price = last.close;

  // Structural 30d range: support from prior days only so a new low does not
  // force Support === current price (looked broken on the label). Resistance
  // still uses the full window including today.
  const prior = chartPts.length > 1 ? chartPts.slice(0, -1) : chartPts;
  const support = Math.min(...prior.map((p) => p.low));
  const resistance = Math.max(...chartPts.map((p) => p.high));

  // Need a real range (not a flat line of identical prints)
  if (!(support > 0) || !(resistance > support) || !(price > 0)) return null;
  const range = resistance - support;
  if (range / support < 0.002) return null; // <0.2% range → skip

  const position = (price - support) / range;
  const positionPct = position * 100;
  let detail: string;
  if (position < 0) detail = `Below prior support (${Math.abs(positionPct).toFixed(0)}% under · new low)`;
  else if (position <= 0.25) detail = `Near range support (${positionPct.toFixed(0)}% of 30d range)`;
  else if (position >= 0.75) detail = `Near resistance (${positionPct.toFixed(0)}% of 30d range)`;
  else detail = `Mid-range (${positionPct.toFixed(0)}% of 30d range)`;
  return { positionPct, price, support, resistance, detail };
}

/**
 * Top 8 coins closest to 30-day support (lowest % of range).
 * Same 3h + 20 SMA line chart as other Home blocks.
 */
export default function HomeNearSupportCharts({
  universe,
}: {
  /** Prefer full watchlist symbols from Home (symbol + name). */
  universe: { symbol: string; name?: string }[];
}) {
  const [hits, setHits] = useState<RangeHit[]>([]);
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
      const cachedHits = readChartCache<any[]>("scan:nearSupport");
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
          const pts = await fetchDailyPoints(u.symbol);
          const pos = positionIn30d(pts);
          if (!pos) return null;
          return {
            symbol: u.symbol.toUpperCase(),
            name: u.name || u.symbol.replace(/PHP$/i, ""),
            ...pos,
          } as RangeHit;
        })
      );
      const ranked = results
        .filter((r): r is RangeHit => r != null)
        .sort((a, b) => a.positionPct - b.positionPct)
        .slice(0, 8);
      setHits(ranked);
      if (ranked.length > 0) writeChartCache("scan:nearSupport", ranked);
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
      id="near-support-charts"
      className="scroll-mt-20 rounded-xl border-2 border-rose-200 bg-rose-50/30 p-4 shadow-sm"
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-rose-950">
            Near 30-day support · top 8
          </h2>
          <p className="mt-0.5 text-[11px] text-rose-900/80">
            Lowest % of the 30-day range first (near support / discount zone). Same 3h + 20 SMA
            chart. Confirm on Spot — not a buy signal by itself.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {active && (
            <Link
              href={`/chart?symbol=${encodeURIComponent(active.symbol)}`}
              className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-bold text-rose-900 hover:bg-rose-50"
            >
              Spot → {active.name}
            </Link>
          )}
        </div>
      </div>

      {error && <p className="mb-2 text-xs text-rose-700">{error}</p>}
      {loading && hits.length === 0 ? (
        <p className="text-xs text-gray-500">Scanning 30-day range…</p>
      ) : hits.length === 0 ? (
        <p className="text-xs text-gray-500">No range data yet.</p>
      ) : (
        <>
          <div className="mb-3 sm:hidden">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-rose-900">
              Coin
            </label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full rounded-lg border border-rose-300 bg-white px-3 py-2.5 text-sm font-semibold text-rose-950 shadow-sm"
            >
              {hits.map((h, i) => (
                <option key={h.symbol} value={h.symbol}>
                  #{i + 1} {h.name} · {h.positionPct.toFixed(0)}% of range
                </option>
              ))}
            </select>
          </div>
          <div className="mb-3 hidden flex-wrap gap-1.5 sm:flex">
            {hits.map((h, i) => {
              const on = h.symbol === selected;
              const near = h.positionPct <= 25;
              return (
                <button
                  key={h.symbol}
                  type="button"
                  onClick={() => setSelected(h.symbol)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition ${
                    on
                      ? "border-rose-600 bg-rose-600 text-white shadow-sm"
                      : "border-rose-200 bg-white text-rose-950 hover:bg-rose-50"
                  }`}
                >
                  <span className="opacity-70">#{i + 1}</span>
                  <span>{h.name}</span>
                  <span className={on ? "text-rose-100" : near ? "text-emerald-700" : "text-slate-600"}>
                    {h.positionPct.toFixed(0)}%
                  </span>
                </button>
              );
            })}
          </div>

          {active && (
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-rose-950">
              <span className="font-bold">{active.name}</span>
              <span className="font-mono text-[10px] text-rose-800/80">{active.symbol}</span>
              <span className="font-semibold text-slate-700">{active.detail}</span>
              <span className="tabular-nums text-slate-600">
                now {formatPhp(active.price)} · S {formatPhp(active.support)} · R{" "}
                {formatPhp(active.resistance)}
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
