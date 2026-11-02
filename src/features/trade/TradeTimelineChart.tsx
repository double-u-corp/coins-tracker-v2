import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Legend,
} from "recharts";
import { formatPhp, formatCoinAmount } from "@/lib/format";

type ChartPoint = {
  period?: string;
  label: string;
  high?: number;
  low?: number;
  close?: number;
};

/** Structural types — pass buildCoinLedger() rows and the coin's CoinAnalytics straight in. */
export interface TimelineLedgerRow {
  at: string;
  type: "buy" | "sell";
  coins: number;
  php: number;
  balanceAfter: number;
}

export interface TimelineAnalytics {
  holdings: number;
  avgCost: number | null;
  closedCycles: { cycleIndex: number; startAt: string; endAt: string; realizedPnl: number }[];
  openCycleStartAt: string | null;
  openCycleIndex: number;
  openCycleRealizedPnl: number;
}

export interface TradeTimelineChartProps {
  symbol: string;
  name?: string;
  ledger: TimelineLedgerRow[]; // oldest first
  analytics: TimelineAnalytics | null;
}

type CycleInfo = {
  index: number;
  startAt: string;
  endAt: string | null; // null = still open
  realizedPnl: number;
  status: "open" | "closed";
};

type DayRow = {
  day: string;
  label: string;
  price: number | null;
  buy: number | null;
  sell: number | null;
  buyMeta?: string;
  sellMeta?: string;
  held: number;
};

function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function formatDayLabel(isoOrKey: string): string {
  const d = new Date(isoOrKey.length <= 10 ? isoOrKey + "T12:00:00" : isoOrKey);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

/** Round up so a trade older than a year still gets a price line behind it (max 5y). */
function yearsToFetch(firstTradeAt: string | undefined): string {
  if (!firstTradeAt) return "1.00";
  const days = (Date.now() - new Date(firstTradeAt).getTime()) / 86_400_000;
  return Math.min(5, Math.max(1, Math.ceil(((days + 14) / 365) * 4) / 4)).toFixed(2);
}

function markerDot(color: string) {
  // eslint-disable-next-line react/display-name
  return (props: any) => {
    const { cx, cy, value, index } = props;
    if (value == null || cx == null || cy == null) return <g key={`m-${index}`} />;
    return <circle key={`m-${index}`} cx={cx} cy={cy} r={5} fill={color} stroke="#fff" strokeWidth={1.5} />;
  };
}

export default function TradeTimelineChart({ symbol, name, ledger, analytics }: TradeTimelineChartProps) {
  const [pricePoints, setPricePoints] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const years = yearsToFetch(ledger[0]?.at);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/coins?type=chart&symbol=${encodeURIComponent(symbol)}&years=${years}&granularity=daily`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load price history (${res.status})`);
        return res.json();
      })
      .then((data: { points: ChartPoint[] }) => {
        if (!cancelled) setPricePoints(data.points ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, years]);

  // Cycles come from the same replay as the cards (no second, slightly different walk here)
  const cycles = useMemo<CycleInfo[]>(() => {
    if (!analytics) return [];
    const out: CycleInfo[] = analytics.closedCycles.map((c) => ({
      index: c.cycleIndex,
      startAt: c.startAt,
      endAt: c.endAt,
      realizedPnl: c.realizedPnl,
      status: "closed",
    }));
    if (analytics.holdings > 0 && analytics.openCycleStartAt) {
      out.push({
        index: analytics.openCycleIndex,
        startAt: analytics.openCycleStartAt,
        endAt: null,
        realizedPnl: analytics.openCycleRealizedPnl,
        status: "open",
      });
    }
    return out;
  }, [analytics]);

  const holdings = analytics?.holdings ?? 0;
  const openAvgCost = holdings > 0 ? (analytics?.avgCost ?? null) : null;
  const lastSellRow = useMemo(() => [...ledger].reverse().find((r) => r.type === "sell") ?? null, [ledger]);
  const lastSellPrice = lastSellRow && lastSellRow.coins > 0 ? lastSellRow.php / lastSellRow.coins : null;

  const chartData = useMemo<DayRow[]>(() => {
    const byDay = new Map<string, DayRow>();

    for (const p of pricePoints) {
      const key = dayKey(p.period || p.label);
      const mid =
        typeof p.close === "number"
          ? p.close
          : p.high != null && p.low != null
            ? (Number(p.high) + Number(p.low)) / 2
            : null;
      byDay.set(key, { day: key, label: formatDayLabel(key), price: mid, buy: null, sell: null, held: 0 });
    }
    for (const r of ledger) {
      const key = dayKey(r.at);
      if (!byDay.has(key)) {
        byDay.set(key, { day: key, label: formatDayLabel(key), price: null, buy: null, sell: null, held: 0 });
      }
    }

    // Several trades on one day → one marker at the weighted average, with the total size
    const agg = new Map<string, { buyCoins: number; buyPhp: number; buyN: number; sellCoins: number; sellPhp: number; sellN: number; heldAfter: number }>();
    for (const r of ledger) {
      const key = dayKey(r.at);
      const a = agg.get(key) ?? { buyCoins: 0, buyPhp: 0, buyN: 0, sellCoins: 0, sellPhp: 0, sellN: 0, heldAfter: 0 };
      if (r.type === "buy") {
        a.buyCoins += r.coins;
        a.buyPhp += r.php;
        a.buyN += 1;
      } else {
        a.sellCoins += r.coins;
        a.sellPhp += r.php;
        a.sellN += 1;
      }
      a.heldAfter = r.balanceAfter; // ledger is chronological → last write wins
      agg.set(key, a);
    }
    for (const [key, a] of agg) {
      const row = byDay.get(key)!;
      if (a.buyCoins > 0) {
        row.buy = a.buyPhp / a.buyCoins;
        row.buyMeta = `Buy ${formatCoinAmount(a.buyCoins)} @ ${formatPhp(row.buy)}${a.buyN > 1 ? ` (${a.buyN} buys)` : ""}`;
        if (row.price == null) row.price = row.buy;
      }
      if (a.sellCoins > 0) {
        row.sell = a.sellPhp / a.sellCoins;
        row.sellMeta = `Sell ${formatCoinAmount(a.sellCoins)} @ ${formatPhp(row.sell)}${a.sellN > 1 ? ` (${a.sellN} sells)` : ""}`;
        if (row.price == null) row.price = row.sell;
      }
    }

    // Coins held over time: carry the balance forward between trades
    const rows = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
    let held = 0;
    for (const row of rows) {
      const a = agg.get(row.day);
      if (a) held = a.heldAfter;
      row.held = held;
    }
    return rows;
  }, [pricePoints, ledger]);

  const openCycle = cycles.find((c) => c.status === "open");
  const lastClosed = [...cycles].reverse().find((c) => c.status === "closed");

  if (!symbol) {
    return <p className="py-6 text-center text-sm text-gray-500">Select a coin to view its trade timeline.</p>;
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Trade timeline — {name || symbol}</h3>
          <p className="text-[11px] text-gray-400">
            Price line with 🟢 buy and 🔴 sell markers. The grey step line is how many coins you held (right axis).
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          {openCycle && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">
              Cycle {openCycle.index} open
              {openAvgCost != null ? ` · avg ${formatPhp(openAvgCost)}` : ""}
              {holdings > 0 ? ` · ${formatCoinAmount(holdings)} held` : ""}
            </span>
          )}
          {!openCycle && lastClosed && (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-semibold text-gray-700">
              Flat — last cycle {lastClosed.realizedPnl >= 0 ? "+" : ""}
              {formatPhp(lastClosed.realizedPnl)} realized
            </span>
          )}
          {lastSellPrice != null && !openCycle && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
              Re-entry watch · last exit {formatPhp(lastSellPrice)}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-sm text-gray-400">Loading price history…</div>
      ) : error ? (
        <p className="py-6 text-center text-sm text-red-600">{error}</p>
      ) : chartData.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">No price or trade data for this coin.</p>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#9ca3af" minTickGap={28} />
              <YAxis
                yAxisId="price"
                tick={{ fontSize: 10 }}
                stroke="#9ca3af"
                width={52}
                domain={["auto", "auto"]}
                tickFormatter={(v) =>
                  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : Number(v).toFixed(v < 10 ? 2 : 0)
                }
              />
              <YAxis
                yAxisId="held"
                orientation="right"
                tick={{ fontSize: 10 }}
                stroke="#cbd5e1"
                width={40}
                domain={[0, "auto"]}
                allowDecimals
                tickFormatter={(v) => formatCoinAmount(Number(v))}
              />
              <Tooltip content={<TimelineTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                payload={[
                  { value: "Price", type: "line", color: "#6366f1" },
                  { value: "Buy", type: "circle", color: "#16a34a" },
                  { value: "Sell", type: "circle", color: "#dc2626" },
                  { value: "Coins held", type: "line", color: "#94a3b8" },
                ]}
              />
              <Line
                yAxisId="held"
                type="stepAfter"
                dataKey="held"
                name="Coins held"
                stroke="#94a3b8"
                strokeWidth={1.25}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="price"
                name="Price"
                stroke="#6366f1"
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
              <Line
                yAxisId="price"
                dataKey="buy"
                name="Buy"
                stroke="none"
                dot={markerDot("#16a34a")}
                activeDot={false}
                isAnimationActive={false}
                legendType="none"
              />
              <Line
                yAxisId="price"
                dataKey="sell"
                name="Sell"
                stroke="none"
                dot={markerDot("#dc2626")}
                activeDot={false}
                isAnimationActive={false}
                legendType="none"
              />
              {openAvgCost != null && (
                <ReferenceLine
                  yAxisId="price"
                  y={openAvgCost}
                  stroke="#f59e0b"
                  strokeDasharray="4 4"
                  label={{ value: "Avg cost", fill: "#d97706", fontSize: 10, position: "insideTopLeft" }}
                />
              )}
              {lastSellPrice != null && !openCycle && (
                <ReferenceLine
                  yAxisId="price"
                  y={lastSellPrice}
                  stroke="#f97316"
                  strokeDasharray="4 4"
                  label={{ value: "Last exit (re-entry)", fill: "#ea580c", fontSize: 10, position: "insideTopLeft" }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {cycles.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
          {cycles.map((c) => (
            <div
              key={`${c.index}-${c.startAt}`}
              className={`rounded-md border px-2.5 py-1.5 text-[11px] ${
                c.status === "open"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-gray-200 bg-gray-50 text-gray-700"
              }`}
            >
              <span className="font-bold">Cycle {c.index}</span>
              {" · "}
              {formatDayLabel(c.startAt)}
              {c.endAt ? ` → ${formatDayLabel(c.endAt)}` : " → now"}
              {c.status === "closed" && (
                <span className={c.realizedPnl >= 0 ? " font-semibold text-green-700" : " font-semibold text-red-700"}>
                  {" "}
                  · {c.realizedPnl >= 0 ? "+" : ""}
                  {formatPhp(c.realizedPnl)}
                </span>
              )}
              {c.status === "open" && <span className="font-semibold"> · open</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TimelineTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as DayRow | undefined;
  if (!row) return null;
  return (
    <div className="max-w-[220px] rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1 border-b border-gray-100 pb-1 font-semibold text-gray-700">{row.label}</div>
      {row.price != null && (
        <div className="flex justify-between gap-3 text-gray-600">
          <span>Price</span>
          <span className="font-semibold text-gray-900">{formatPhp(row.price)}</span>
        </div>
      )}
      <div className="flex justify-between gap-3 text-gray-600">
        <span>Holding</span>
        <span className="font-semibold text-gray-900">{formatCoinAmount(row.held)}</span>
      </div>
      {row.buy != null && <div className="mt-1 font-medium text-emerald-700">{row.buyMeta}</div>}
      {row.sell != null && <div className="mt-1 font-medium text-red-700">{row.sellMeta}</div>}
    </div>
  );
}
