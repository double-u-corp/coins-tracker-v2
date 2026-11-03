import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatPhp } from "@/lib/format";
import { buildCoinAnalytics, type CoinAnalytics } from "@/features/trade/useTradeLogic";
import type { PortfolioEntry, TransactionView } from "@/validators/transactionSchema";
import {
  MoverLineChart,
  fetchPollSeries,
  fetchDailyForSma,
  type PollPoint,
  type DailyPt,
} from "./HomeTwoDayMovers";

export type WatchPlanCoin = {
  symbol: string;
  name?: string;
  currentPrice?: number | null;
  priceChangePct?: number | null;
  /** plan = not held · free = recovered leftover · held = open bag on monitor */
  kind?: "plan" | "free" | "held";
};

/**
 * 3h price + daily 20 SMA for Watch/plan (not held) and free/recovered bags
 * you still want to monitor for a rebuy.
 */
export default function HomeWatchPlanCharts({ coins }: { coins: WatchPlanCoin[] }) {
  const list = useMemo(() => {
    const seen = new Set<string>();
    const out: WatchPlanCoin[] = [];
    for (const c of coins) {
      const sym = (c.symbol || "").toUpperCase();
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      out.push({
        ...c,
        symbol: sym,
        name: c.name || sym.replace(/PHP$/i, ""),
        kind: c.kind || "plan",
      });
    }
    return out;
  }, [coins]);

  const [selected, setSelected] = useState("");
  const [series, setSeries] = useState<PollPoint[]>([]);
  const [dailyPoints, setDailyPoints] = useState<DailyPt[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [analyticsBySym, setAnalyticsBySym] = useState<Record<string, CoinAnalytics>>({});

  useEffect(() => {
    if (list.length === 0) {
      setSelected("");
      return;
    }
    setSelected((prev) => (prev && list.some((c) => c.symbol === prev) ? prev : list[0].symbol));
  }, [list]);

  // Cost basis / open P&L from the same tx replay as Buy/Sell page
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/transactions", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          transactions: TransactionView[];
          portfolio: PortfolioEntry[];
        };
        if (cancelled) return;
        const rows = buildCoinAnalytics(data.portfolio || [], data.transactions || []);
        const map: Record<string, CoinAnalytics> = {};
        for (const r of rows) map[r.symbol.toUpperCase()] = r;
        setAnalyticsBySym(map);
      } catch {
        /* optional enrichment */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const active = list.find((c) => c.symbol === selected) || null;
  const an = selected ? analyticsBySym[selected] : undefined;
  const avg = an?.avgCost ?? null;
  const openPnl = an?.unrealizedPnl ?? null;
  const nowPx =
    an?.currentPrice ??
    active?.currentPrice ??
    null;
  const holdings = an?.holdings ?? 0;
  const isFree = an?.openCycleCostRecovered === true || (holdings > 0 && (an?.avgCost == null || an.avgCost === 0));

  if (list.length === 0) return null;

  return (
    <section
      id="watch-plan-charts"
      className="scroll-mt-20 rounded-xl border-2 border-indigo-200 bg-indigo-50/40 p-4 shadow-sm"
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-indigo-950">Watch / plan · price &amp; 20 SMA</h2>
          <p className="mt-0.5 text-[11px] text-indigo-900/80">
            Not held (plan / rebuy) and <span className="font-semibold">free / recovered</span> bags
            you still monitor. 3h path + daily 20 SMA. Confirm on Spot before buying.
          </p>
        </div>
        {active && (
          <Link
            href={`/chart?symbol=${encodeURIComponent(active.symbol)}`}
            className="rounded-md border border-indigo-300 bg-white px-2.5 py-1 text-[11px] font-bold text-indigo-800 hover:bg-indigo-50"
          >
            Spot → {active.name}
          </Link>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {list.map((c) => {
          const on = c.symbol === selected;
          const pct = c.priceChangePct;
          const row = analyticsBySym[c.symbol];
          const free =
            c.kind === "free" ||
            row?.openCycleCostRecovered ||
            ((row?.holdings ?? 0) > 0 && (row?.avgCost == null || row.avgCost === 0));
          return (
            <button
              key={c.symbol}
              type="button"
              onClick={() => setSelected(c.symbol)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition ${
                on
                  ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                  : "border-indigo-200 bg-white text-indigo-900 hover:bg-indigo-50"
              }`}
            >
              <span>{c.name}</span>
              {free && (
                <span className={`rounded px-1 text-[9px] font-bold ${on ? "bg-white/20" : "bg-emerald-100 text-emerald-800"}`}>
                  Free
                </span>
              )}
              {c.kind === "plan" && !free && (
                <span className={`rounded px-1 text-[9px] font-bold ${on ? "bg-white/20" : "bg-sky-100 text-sky-800"}`}>
                  Plan
                </span>
              )}
              {pct != null && Number.isFinite(pct) && (
                <span className={on ? "text-indigo-100" : pct >= 0 ? "text-emerald-700" : "text-rose-700"}>
                  {pct >= 0 ? "+" : ""}
                  {pct.toFixed(1)}%
                </span>
              )}
            </button>
          );
        })}
      </div>

      {active && (
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-indigo-950">
          <span className="font-bold">{active.name}</span>
          <span className="font-mono text-[10px] text-indigo-700/80">{active.symbol}</span>
          {holdings > 0 && (
            <span className="tabular-nums text-indigo-800/90">
              {holdings.toLocaleString(undefined, { maximumFractionDigits: 8 })} coins
              {isFree ? " · Free" : ""}
            </span>
          )}
          <span className="font-semibold text-slate-600">
            Avg{" "}
            <span className="tabular-nums text-slate-900">{avg != null ? formatPhp(avg) : "—"}</span>
          </span>
          <span
            className={`font-semibold tabular-nums ${
              openPnl == null ? "text-slate-500" : openPnl >= 0 ? "text-emerald-700" : "text-rose-700"
            }`}
          >
            Open {openPnl != null ? `${openPnl >= 0 ? "+" : ""}${formatPhp(openPnl)}` : "—"}
          </span>
          <span className="font-semibold text-slate-600">
            now{" "}
            <span className="tabular-nums text-slate-900">{nowPx != null ? formatPhp(nowPx) : "—"}</span>
          </span>
        </div>
      )}

      {seriesLoading ? (
        <p className="text-xs text-gray-500">Loading 3h path…</p>
      ) : (
        <MoverLineChart points={series} symbol={selected} dailyPoints={dailyPoints} />
      )}
    </section>
  );
}
