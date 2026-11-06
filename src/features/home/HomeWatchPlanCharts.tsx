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
  /** plan = not held · free = recovered leftover · held = open bag with cost */
  kind?: "plan" | "free" | "held";
};

export type WatchChartVariant = "plan" | "held" | "free";

const VARIANT_UI: Record<
  WatchChartVariant,
  {
    title: string;
    blurb: string;
    border: string;
    bg: string;
    titleCls: string;
    blurbCls: string;
    chipOn: string;
    chipOff: string;
    btn: string;
  }
> = {
  plan: {
    title: "3 · Watch / plan · not held",
    blurb: "Monitored coins with no open holding (plan / rebuy). 3h path + daily 20 SMA.",
    border: "border-indigo-200",
    bg: "bg-indigo-50/40",
    titleCls: "text-indigo-950",
    blurbCls: "text-indigo-900/80",
    chipOn: "border-indigo-600 bg-indigo-600 text-white",
    chipOff: "border-indigo-200 bg-white text-indigo-900 hover:bg-indigo-50",
    btn: "border-indigo-300 bg-white text-indigo-800 hover:bg-indigo-50",
  },
  held: {
    title: "1 · On hold · with cost",
    blurb: "Open bags still carrying average cost (not free yet). Track price vs avg on the 3h line.",
    border: "border-amber-200",
    bg: "bg-amber-50/40",
    titleCls: "text-amber-950",
    blurbCls: "text-amber-900/80",
    chipOn: "border-amber-600 bg-amber-600 text-white",
    chipOff: "border-amber-200 bg-white text-amber-950 hover:bg-amber-50",
    btn: "border-amber-300 bg-white text-amber-900 hover:bg-amber-50",
  },
  free: {
    title: "2 · Free / recovered",
    blurb: "Leftover coins after cost recovered (house money). Same line chart — useful before a rebuy.",
    border: "border-emerald-200",
    bg: "bg-emerald-50/40",
    titleCls: "text-emerald-950",
    blurbCls: "text-emerald-900/80",
    chipOn: "border-emerald-600 bg-emerald-600 text-white",
    chipOff: "border-emerald-200 bg-white text-emerald-950 hover:bg-emerald-50",
    btn: "border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-50",
  },
};

/**
 * One reusable 3h + 20 SMA chart block. Use three instances on Home:
 * plan (no hold) · held (with cost) · free / recovered.
 */
export default function HomeWatchPlanCharts({
  coins,
  variant = "plan",
  emptyHint,
}: {
  coins: WatchPlanCoin[];
  variant?: WatchChartVariant;
  emptyHint?: string;
}) {
  const ui = VARIANT_UI[variant];
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
        kind: c.kind || variant,
      });
    }
    return out;
  }, [coins, variant]);

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
        /* optional */
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
  const openPct = an?.unrealizedPct ?? null;
  const nowPx = an?.currentPrice ?? active?.currentPrice ?? null;
  const holdings = an?.holdings ?? 0;
  const daysHeld = an?.daysSinceFirstBuy ?? null;
  const isFree =
    an?.openCycleCostRecovered === true ||
    (holdings > 0 && (an?.avgCost == null || an.avgCost === 0));

  return (
    <section
      id={`watch-charts-${variant}`}
      className={`scroll-mt-20 rounded-xl border-2 ${ui.border} ${ui.bg} p-4 shadow-sm`}
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className={`text-sm font-extrabold sm:text-base ${ui.titleCls}`}>{ui.title}</h2>
          <p className={`mt-0.5 text-[10px] leading-snug sm:text-[11px] ${ui.blurbCls}`}>{ui.blurb}</p>
        </div>
        {active && (
          <Link
            href={`/chart?symbol=${encodeURIComponent(active.symbol)}`}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-bold ${ui.btn}`}
          >
            Spot → {active.name}
          </Link>
        )}
      </div>

      {list.length === 0 ? (
        <p className={`text-[11px] ${ui.blurbCls}`}>
          {emptyHint || "No coins in this group right now."}
        </p>
      ) : (
      <>
<div className="mb-3 flex flex-wrap gap-1.5">
        {list.map((c) => {
          const on = c.symbol === selected;
          const pct = c.priceChangePct;
          return (
            <button
              key={c.symbol}
              type="button"
              onClick={() => setSelected(c.symbol)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                on ? ui.chipOn : ui.chipOff
              }`}
            >
              <span>{c.name}</span>
              {(() => {
                const row = analyticsBySym[c.symbol];
                const upnlPct = row?.unrealizedPct;
                if ((variant === "held" || variant === "free") && upnlPct != null && Number.isFinite(upnlPct)) {
                  return (
                    <span className={on ? "opacity-90" : upnlPct >= 0 ? "text-emerald-700" : "text-rose-700"}>
                      {upnlPct >= 0 ? "+" : ""}
                      {upnlPct.toFixed(1)}%
                    </span>
                  );
                }
                if (pct != null && Number.isFinite(pct)) {
                  return (
                    <span className={on ? "opacity-90" : pct >= 0 ? "text-emerald-700" : "text-rose-700"}>
                      {pct >= 0 ? "+" : ""}
                      {pct.toFixed(1)}%
                    </span>
                  );
                }
                return null;
              })()}
            </button>
          );
        })}
      </div>

      {active && (
        <div className={`mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs ${ui.titleCls}`}>
          <span className="font-bold">{active.name}</span>
          <span className="font-mono text-[10px] opacity-70">{active.symbol}</span>
          {holdings > 0 && (
            <span className="tabular-nums opacity-90">
              {holdings.toLocaleString(undefined, { maximumFractionDigits: 8 })} coins
              {isFree ? " · Free" : ""}
            </span>
          )}
          {(variant === "held" || variant === "free") && (openPct != null || openPnl != null) && (
            <span
              className={`font-bold tabular-nums ${
                (openPct ?? openPnl ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {openPct != null ? `${openPct >= 0 ? "+" : ""}${openPct.toFixed(2)}%` : ""}
              {openPnl != null && (
                <span className="font-semibold">
                  {openPct != null ? " " : ""}
                  ({openPnl >= 0 ? "+" : ""}
                  {formatPhp(openPnl)})
                </span>
              )}
            </span>
          )}
          {(variant === "held" || variant === "free") && daysHeld != null && (
            <span className="font-semibold text-slate-600">
              Held <span className="tabular-nums text-slate-900">{daysHeld}d</span>
            </span>
          )}
          <span className="font-semibold text-slate-600">
            Avg <span className="tabular-nums text-slate-900">{avg != null ? formatPhp(avg) : "—"}</span>
          </span>
          <span
            className={`font-semibold tabular-nums ${
              openPnl == null ? "text-slate-500" : openPnl >= 0 ? "text-emerald-700" : "text-rose-700"
            }`}
          >
            Open {openPnl != null ? `${openPnl >= 0 ? "+" : ""}${formatPhp(openPnl)}` : "—"}
          </span>
          <span className="font-semibold text-slate-600">
            now <span className="tabular-nums text-slate-900">{nowPx != null ? formatPhp(nowPx) : "—"}</span>
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
