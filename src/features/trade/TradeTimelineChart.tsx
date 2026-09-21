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
  Scatter,
  Legend,
} from "recharts";
import type { TransactionView } from "@/validators/transactionSchema";
import { formatPhp, formatCoinAmount } from "@/lib/format";

type ChartPoint = {
  period?: string;
  label: string;
  high?: number;
  low?: number;
  close?: number;
};

export interface TradeTimelineChartProps {
  symbol: string;
  name?: string;
  transactions: TransactionView[];
}

type CycleInfo = {
  index: number;
  startAt: string;
  endAt: string | null; // null = still open
  realizedPnl: number;
  status: "open" | "closed";
};

function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function formatDayLabel(isoOrKey: string): string {
  const d = new Date(isoOrKey.length <= 10 ? isoOrKey + "T12:00:00" : isoOrKey);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

export default function TradeTimelineChart({ symbol, name, transactions }: TradeTimelineChartProps) {
  const [pricePoints, setPricePoints] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // ~1 year daily is enough for trade markers without a huge payload
    fetch(`/api/coins?type=chart&symbol=${encodeURIComponent(symbol)}&years=1.00&granularity=daily`)
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
  }, [symbol]);

  const coinTxs = useMemo(() => {
    return transactions
      .filter((t) => t.symbol === symbol)
      .filter((t) => {
        const ty = t.type.toLowerCase();
        return ty === "buy" || ty === "sell";
      })
      .sort((a, b) => new Date(a.transactedAt).getTime() - new Date(b.transactedAt).getTime());
  }, [transactions, symbol]);

  const { cycles, lastSellPrice, openAvgCost, currentUnits } = useMemo(() => {
    let units = 0;
    let cost = 0;
    let realizedInCycle = 0;
    let cycleStart: string | null = null;
    const cyclesOut: CycleInfo[] = [];
    let cycleIdx = 0;
    let lastSell: number | null = null;

    for (const t of coinTxs) {
      const ty = t.type.toLowerCase();
      const coins = Number(t.coinAmount) || 0;
      const php = Number(t.phpAmount) || 0;
      const price = coins > 0 ? php / coins : Number(t.price) || 0;

      if (ty === "buy" && coins > 0) {
        if (units <= 0) {
          cycleStart = t.transactedAt;
          realizedInCycle = 0;
          cycleIdx += 1;
        }
        units += coins;
        cost += php;
      } else if (ty === "sell" && coins > 0) {
        const avg = units > 0 ? cost / units : 0;
        const sold = Math.min(coins, units > 0 ? units : coins);
        const realized = php - avg * sold;
        realizedInCycle += realized;
        units = Math.max(0, units - sold);
        cost = Math.max(0, cost - avg * sold);
        if (units < 1e-12) {
          units = 0;
          cost = 0;
        }
        lastSell = price;
        if (units <= 0 && cycleStart) {
          cyclesOut.push({
            index: cycleIdx,
            startAt: cycleStart,
            endAt: t.transactedAt,
            realizedPnl: realizedInCycle,
            status: "closed",
          });
          cycleStart = null;
          realizedInCycle = 0;
        }
      }
    }

    if (units > 0 && cycleStart) {
      cyclesOut.push({
        index: cycleIdx,
        startAt: cycleStart,
        endAt: null,
        realizedPnl: realizedInCycle,
        status: "open",
      });
    }

    return {
      cycles: cyclesOut,
      lastSellPrice: lastSell,
      openAvgCost: units > 0 && cost > 0 ? cost / units : null,
      currentUnits: units,
    };
  }, [coinTxs]);

  const chartData = useMemo(() => {
    // Map price by calendar day
    const byDay = new Map<
      string,
      {
        day: string;
        label: string;
        price: number | null;
        buy: number | null;
        sell: number | null;
        buyMeta?: string;
        sellMeta?: string;
      }
    >();

    for (const p of pricePoints) {
      const raw = p.period || p.label;
      const key = dayKey(raw);
      const mid =
        typeof p.close === "number"
          ? p.close
          : p.high != null && p.low != null
            ? (Number(p.high) + Number(p.low)) / 2
            : null;
      byDay.set(key, {
        day: key,
        label: formatDayLabel(key),
        price: mid,
        buy: null,
        sell: null,
      });
    }

    // Ensure trade days exist even if price series missed that day
    for (const t of coinTxs) {
      const key = dayKey(t.transactedAt);
      if (!byDay.has(key)) {
        byDay.set(key, {
          day: key,
          label: formatDayLabel(key),
          price: null,
          buy: null,
          sell: null,
        });
      }
    }

    for (const t of coinTxs) {
      const key = dayKey(t.transactedAt);
      const row = byDay.get(key)!;
      const coins = Number(t.coinAmount) || 0;
      const php = Number(t.phpAmount) || 0;
      const px = coins > 0 ? php / coins : Number(t.price) || 0;
      const ty = t.type.toLowerCase();
      if (ty === "buy") {
        row.buy = px;
        row.buyMeta = `Buy ${formatCoinAmount(coins)} @ ${formatPhp(px)}`;
        if (row.price == null) row.price = px;
      } else if (ty === "sell") {
        row.sell = px;
        row.sellMeta = `Sell ${formatCoinAmount(coins)} @ ${formatPhp(px)}`;
        if (row.price == null) row.price = px;
      }
    }

    return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [pricePoints, coinTxs]);

  const openCycle = cycles.find((c) => c.status === "open");
  const lastClosed = [...cycles].reverse().find((c) => c.status === "closed");

  if (!symbol) {
    return (
      <p className="py-6 text-center text-sm text-gray-500">Select a coin to view its trade timeline.</p>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Trade timeline — {name || symbol}
          </h3>
          <p className="text-[11px] text-gray-400">
            Price line with 🟢 buy and 🔴 sell markers. Full exit starts a new cycle when you buy again.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          {openCycle && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">
              Cycle {openCycle.index} open
              {openAvgCost != null ? ` · avg ${formatPhp(openAvgCost)}` : ""}
              {currentUnits > 0 ? ` · ${formatCoinAmount(currentUnits)} held` : ""}
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
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#9ca3af" minTickGap={28} />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="#9ca3af"
                width={52}
                domain={["auto", "auto"]}
                tickFormatter={(v) =>
                  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : Number(v).toFixed(v < 10 ? 2 : 0)
                }
              />
              <Tooltip content={<TimelineTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                payload={[
                  { value: "Price", type: "line", color: "#6366f1" },
                  { value: "Buy", type: "circle", color: "#16a34a" },
                  { value: "Sell", type: "circle", color: "#dc2626" },
                ]}
              />
              <Line
                type="monotone"
                dataKey="price"
                name="Price"
                stroke="#6366f1"
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
              <Scatter dataKey="buy" name="Buy" fill="#16a34a" line={false} shape="circle" />
              <Scatter dataKey="sell" name="Sell" fill="#dc2626" line={false} shape="circle" />
              {openAvgCost != null && (
                <ReferenceLine
                  y={openAvgCost}
                  stroke="#f59e0b"
                  strokeDasharray="4 4"
                  label={{ value: "Avg cost", fill: "#d97706", fontSize: 10, position: "insideTopLeft" }}
                />
              )}
              {lastSellPrice != null && !openCycle && (
                <ReferenceLine
                  y={lastSellPrice}
                  stroke="#f97316"
                  strokeDasharray="4 4"
                  label={{
                    value: "Last exit (re-entry)",
                    fill: "#ea580c",
                    fontSize: 10,
                    position: "insideTopLeft",
                  }}
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
              key={c.index}
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
                <span className={c.realizedPnl >= 0 ? " text-green-700 font-semibold" : " text-red-700 font-semibold"}>
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
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs shadow-md max-w-[220px]">
      <div className="mb-1 font-semibold text-gray-700 border-b border-gray-100 pb-1">{row.label}</div>
      {row.price != null && (
        <div className="flex justify-between gap-3 text-gray-600">
          <span>Price</span>
          <span className="font-semibold text-gray-900">{formatPhp(row.price)}</span>
        </div>
      )}
      {row.buy != null && (
        <div className="mt-1 text-emerald-700 font-medium">{row.buyMeta ?? `Buy @ ${formatPhp(row.buy)}`}</div>
      )}
      {row.sell != null && (
        <div className="mt-1 text-red-700 font-medium">{row.sellMeta ?? `Sell @ ${formatPhp(row.sell)}`}</div>
      )}
    </div>
  );
}
