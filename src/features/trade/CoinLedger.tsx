import { useMemo, useState } from "react";
import { formatPhp, formatCoinAmount } from "@/lib/format";
import type { LedgerKind, LedgerRow } from "./useTradeLogic";

const KIND_STYLE: Record<LedgerKind, { label: string; cls: string }> = {
  first_buy: { label: "First buy", cls: "border-purple-200 bg-purple-100 text-purple-800" },
  add: { label: "Buy more", cls: "border-purple-200 bg-purple-100 text-purple-800" },
  rebuy: { label: "Re-entry", cls: "border-indigo-200 bg-indigo-100 text-indigo-800" },
  trim: { label: "Sell (partial)", cls: "border-rose-200 bg-rose-100 text-rose-800" },
  exit: { label: "Sell (all out)", cls: "border-rose-300 bg-rose-200 text-rose-900" },
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

const PAGE = 20;

export default function CoinLedger({
  symbol,
  name,
  rows,
}: {
  symbol: string;
  name: string;
  rows: LedgerRow[]; // oldest first (from buildCoinLedger)
}) {
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<"all" | "buy" | "sell">("all");

  const summary = useMemo(() => {
    const last = rows[rows.length - 1];
    const lastBuy = [...rows].reverse().find((r) => r.type === "buy") ?? null;
    const lastSell = [...rows].reverse().find((r) => r.type === "sell") ?? null;
    const boughtCoins = rows.filter((r) => r.type === "buy").reduce((s, r) => s + r.coins, 0);
    const soldCoins = rows.filter((r) => r.type === "sell").reduce((s, r) => s + r.coins, 0);
    return {
      holding: last?.balanceAfter ?? 0,
      avgCost: last?.avgCostAfter ?? null,
      lastBuy,
      lastSell,
      boughtCoins,
      soldCoins,
    };
  }, [rows]);

  const shown = useMemo(() => {
    const list = rows.filter((r) => filter === "all" || r.type === filter);
    const newestFirst = [...list].reverse();
    return showAll ? newestFirst : newestFirst.slice(0, PAGE);
  }, [rows, filter, showAll]);

  const totalForFilter = rows.filter((r) => filter === "all" || r.type === filter).length;

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 py-5 text-center text-xs text-slate-400">
        No buys or sells recorded for {name || symbol} yet
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Tile label="Holding now" value={`${formatCoinAmount(summary.holding)}`} sub={symbol} />
        <Tile
          label="Avg cost"
          value={summary.holding > 0 && summary.avgCost != null ? formatPhp(summary.avgCost) : "—"}
          sub={summary.holding > 0 ? "of what you hold" : "flat"}
        />
        <Tile
          label="Had before last buy"
          value={summary.lastBuy ? formatCoinAmount(summary.lastBuy.balanceBefore) : "—"}
          sub={
            summary.lastBuy
              ? `then bought ${formatCoinAmount(summary.lastBuy.coins)} · ${fmtDate(summary.lastBuy.at)}`
              : undefined
          }
        />
        <Tile
          label="Last sell"
          value={summary.lastSell ? formatCoinAmount(summary.lastSell.coins) : "—"}
          sub={
            summary.lastSell
              ? `@ ${formatPhp(summary.lastSell.price)} · ${fmtDate(summary.lastSell.at)}`
              : "no sells yet"
          }
        />
        <Tile
          label="Total bought / sold"
          value={`${formatCoinAmount(summary.boughtCoins)} / ${formatCoinAmount(summary.soldCoins)}`}
          sub="coins, all time"
        />
      </div>

      <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 w-fit">
        {(["all", "buy", "sell"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize ${
              filter === f ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {shown.map((r) => {
          const k = KIND_STYLE[r.kind];
          const isBuy = r.type === "buy";
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${k.cls}`}>{k.label}</span>
                  <span className="text-[11px] text-slate-400">{fmtDate(r.at)}</span>
                  <span className="text-[10px] font-semibold text-slate-300">round {r.round}</span>
                </div>
                <div className="mt-1 text-slate-700">
                  {isBuy ? "Bought" : "Sold"}{" "}
                  <span className="font-semibold tabular-nums">{formatCoinAmount(r.coins)}</span> @{" "}
                  <span className="tabular-nums">{formatPhp(r.price)}</span>{" "}
                  <span className="text-slate-400">({formatPhp(r.php)})</span>
                </div>
                {!isBuy && r.realizedPnl != null && (
                  <div
                    className={`text-[11px] font-semibold tabular-nums ${
                      r.realizedPnl >= 0 ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {r.realizedPnl >= 0 ? "+" : ""}
                    {formatPhp(r.realizedPnl)} realized
                    {r.avgCostBefore != null && (
                      <span className="font-normal text-slate-400"> · avg cost was {formatPhp(r.avgCostBefore)}</span>
                    )}
                  </div>
                )}
                {isBuy && r.balanceBefore > 0 && (
                  <div className="text-[11px] text-slate-500">
                    Still had {formatCoinAmount(r.balanceBefore)} when you bought again
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Coins held</div>
                <div className="text-sm font-bold tabular-nums text-slate-900">
                  <span className="text-slate-400">{formatCoinAmount(r.balanceBefore)}</span>
                  <span className={isBuy ? "text-emerald-600" : "text-rose-600"}> → </span>
                  {formatCoinAmount(r.balanceAfter)}
                </div>
                <div className="text-[10px] tabular-nums text-slate-400">
                  avg {r.avgCostAfter != null ? formatPhp(r.avgCostAfter) : "—"}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {totalForFilter > PAGE && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-xs font-semibold text-violet-700 hover:underline"
        >
          {showAll ? "Show fewer" : `Show all ${totalForFilter}`}
        </button>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-base font-bold tabular-nums text-slate-900">{value}</div>
      {sub && <p className="mt-0.5 truncate text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}
