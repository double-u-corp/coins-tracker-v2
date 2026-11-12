import { readChartCache, writeChartCache } from "./homeChartCache";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatPhp } from "@/lib/format";
import { calculateRSIAt, calculateSMAAt } from "@/features/chart/Technicals";
import {
  HomeCoinChartCarousel,
  fetchPollSeries,
  fetchDailyForSma,
  type PollPoint,
  type DailyPt,
} from "./HomeTwoDayMovers";

export type RsiOversoldHit = {
  symbol: string;
  name: string;
  price: number;
  rsi: number;
  sma20: number | null;
  /** positive = price below SMA20 as % */
  pctBelowSma20: number | null;
  detail: string;
  score: number;
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

function scoreRsiOversold(points: DailyBar[]): Omit<RsiOversoldHit, "symbol" | "name"> | null {
  if (!points || points.length < 20) return null;
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

  if (chartPts.length < 20) return null;

  const rsi = calculateRSIAt(chartPts as any, 14, 0);
  if (rsi == null || !Number.isFinite(rsi)) return null;
  // Oversold / leaning oversold — monitor zone (not automatic buy)
  if (rsi > 40) return null;

  const price = chartPts[chartPts.length - 1].close;
  const sma20 = calculateSMAAt(chartPts as any, 20, 0);
  const pctBelowSma20 =
    sma20 != null && sma20 > 0 ? ((sma20 - price) / sma20) * 100 : null;

  // Lower RSI = higher priority; slight boost if also under 20 SMA
  let score = 40 - rsi;
  if (pctBelowSma20 != null && pctBelowSma20 > 0) score += Math.min(pctBelowSma20, 8) * 0.15;

  const zone = rsi <= 30 ? "oversold" : "leaning oversold";
  const detail =
    pctBelowSma20 != null
      ? `RSI ${rsi.toFixed(0)} — ${zone}${price < (sma20 || 0) ? ` · ${pctBelowSma20.toFixed(1)}% below 20 SMA` : ""}`
      : `RSI ${rsi.toFixed(0)} — ${zone}`;

  return {
    price,
    rsi,
    sma20,
    pctBelowSma20,
    detail,
    score,
  };
}

/**
 * Top 8 daily RSI-14 ≤ 40 — monitor for possible pullback entries (not a buy signal).
 */
export default function HomeRsiOversold({
  universe,
}: {
  universe: { symbol: string; name?: string }[];
}) {
  const [hits, setHits] = useState<RsiOversoldHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [series, setSeries] = useState<PollPoint[]>([]);
  const [dailyPoints, setDailyPoints] = useState<DailyPt[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);

  const scan = useCallback(
    async (force = false) => {
      const list = universe.filter((u) => u.symbol && !/^(BTC|ETH|XAUT)PHP$/i.test(u.symbol));
      if (list.length === 0) {
        setHits([]);
        return;
      }
      setLoading(true);
      setError(null);
      if (!force) {
        const cachedHits = readChartCache<RsiOversoldHit[]>("scan:rsiOversold:v1");
        if (cachedHits && cachedHits.length > 0) {
          setHits(cachedHits);
          setSelected((prev) =>
            prev && cachedHits.some((h) => h.symbol === prev) ? prev : cachedHits[0]?.symbol || ""
          );
          setLoading(false);
          return;
        }
      }
      try {
        const results = await Promise.all(
          list.map(async (u) => {
            const pts = await fetchDaily(u.symbol);
            const scored = scoreRsiOversold(pts);
            if (!scored) return null;
            return {
              symbol: u.symbol.toUpperCase(),
              name: u.name || u.symbol.replace(/PHP$/i, ""),
              ...scored,
            } as RsiOversoldHit;
          })
        );
        const ranked = results
          .filter((r): r is RsiOversoldHit => r != null)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8);
        setHits(ranked);
        if (ranked.length > 0) writeChartCache("scan:rsiOversold:v1", ranked);
        setSelected((prev) =>
          prev && ranked.some((h) => h.symbol === prev) ? prev : ranked[0]?.symbol || ""
        );
      } catch (e) {
        setError((e as Error).message || "Scan failed");
      } finally {
        setLoading(false);
      }
    },
    [universe]
  );

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
      id="rsi-oversold"
      className="scroll-mt-20 rounded-xl border-2 border-cyan-200 bg-cyan-50/30 p-4 shadow-sm"
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-cyan-950">RSI oversold · top 8</h2>
          <p className="mt-0.5 text-[11px] text-cyan-900/80">
            Daily RSI-14 ≤ 40 (leaning oversold → oversold). Monitor for pullbacks —{" "}
            <span className="font-semibold">not a buy signal</span>. Confirm on Spot.
          </p>
        </div>
        {active && (
          <Link
            href={`/chart?symbol=${encodeURIComponent(active.symbol)}`}
            className="rounded-md border border-cyan-300 bg-white px-2.5 py-1 text-[11px] font-bold text-cyan-900 hover:bg-cyan-50"
          >
            Spot → {active.name}
          </Link>
        )}
      </div>

      {error && <p className="mb-2 text-xs text-rose-700">{error}</p>}
      {loading && hits.length === 0 ? (
        <p className="text-xs text-gray-500">Scanning RSI…</p>
      ) : hits.length === 0 ? (
        <p className="text-xs text-gray-500">No RSI ≤ 40 alts right now.</p>
      ) : (
        <>
          {/* Mobile carousel · desktop wrap pills */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {hits.map((h, i) => {
              const on = h.symbol === selected;
              return (
                <button
                  key={h.symbol}
                  type="button"
                  onClick={() => setSelected(h.symbol)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition ${
                    on
                      ? "border-cyan-700 bg-cyan-700 text-white shadow-sm"
                      : "border-cyan-200 bg-white text-cyan-950 hover:bg-cyan-50"
                  }`}
                >
                  <span className="opacity-70">#{i + 1}</span>
                  <span>{h.name}</span>
                  <span className={on ? "text-cyan-100" : "text-cyan-800"}>
                    RSI {h.rsi.toFixed(0)}
                  </span>
                </button>
              );
            })}
          </div>

          <HomeCoinChartCarousel
            items={hits.map((h) => ({
              symbol: h.symbol,
              name: h.name,
              caption: h.detail,
            }))}
            selected={selected}
            onSelect={setSelected}
          />
        </>
      )}
    </section>
  );
}

/** Expose scan helper for entry-monitor prompt consumers */
export async function scanRsiOversoldHits(
  universe: { symbol: string; name?: string }[]
): Promise<RsiOversoldHit[]> {
  const list = universe.filter((u) => u.symbol && !/^(BTC|ETH|XAUT)PHP$/i.test(u.symbol));
  const cached = readChartCache<RsiOversoldHit[]>("scan:rsiOversold:v1");
  if (cached && cached.length > 0) return cached;
  const results = await Promise.all(
    list.map(async (u) => {
      const pts = await fetchDaily(u.symbol);
      const scored = scoreRsiOversold(pts);
      if (!scored) return null;
      return {
        symbol: u.symbol.toUpperCase(),
        name: u.name || u.symbol.replace(/PHP$/i, ""),
        ...scored,
      } as RsiOversoldHit;
    })
  );
  const ranked = results
    .filter((r): r is RsiOversoldHit => r != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  if (ranked.length > 0) writeChartCache("scan:rsiOversold:v1", ranked);
  return ranked;
}
