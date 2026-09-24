import { useMemo, useState } from "react";
import Link from "next/link";
import Dropdown from "@/components/Dropdown";
import AlertBanner from "@/components/AlertBanner";
import { formatPhp, formatCoinAmount } from "@/lib/format";
import { useTradeLogic, TradeType } from "./useTradeLogic";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function OverviewSkeleton() {
  return (
    <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 animate-pulse">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-24 rounded-lg border border-gray-200 bg-gray-100 p-4" />
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="animate-pulse space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="h-4 w-1/4 rounded bg-gray-200" />
      <div className="h-10 w-full rounded bg-gray-100" />
      <div className="h-10 w-full rounded bg-gray-100" />
    </div>
  );
}

export default function TradeView() {
  const {
    coinOptions,
    transactions,
    portfolio,
    loading,
    loadError,
    type,
    setType,
    symbol,
    setSymbol,
    phpAmount,
    setPhpAmount,
    coinAmount,
    setCoinAmount,
    customPrice,
    setCustomPrice,
    date,
    setDate,
    submitting,
    submitError,
    lastTransaction,
    submitTransaction,
    deleteTransaction,
    deletingId,
    editingId,
    editCoinAmount,
    setEditCoinAmount,
    editPhpAmount,
    setEditPhpAmount,
    editPrice,
    setEditPrice,
    editError,
    editSaving,
    startEdit,
    cancelEdit,
    saveEdit,
    coinAnalytics,
    analyticsSummary,
  } = useTradeLogic();

  const isCashFlow = type === "deposit" || type === "withdraw";
  const [txFilter, setTxFilter] = useState<"all" | "buy" | "sell" | "deposit" | "withdraw">("all");
  const [txCoinFilter, setTxCoinFilter] = useState<string>("all");
  const [analyticsFilter, setAnalyticsFilter] = useState<"all" | "underwater" | "in_profit" | "holdings">("all");
  const [analyticsSort, setAnalyticsSort] = useState<"underwater" | "unrealized_pct" | "realized">("underwater");

  const filteredAnalytics = useMemo(() => {
    let rows = [...coinAnalytics];
    if (analyticsFilter === "underwater") rows = rows.filter((c) => c.isUnderwater);
    else if (analyticsFilter === "in_profit")
      rows = rows.filter((c) => c.isInProfitOpen || (c.holdings <= 0 && c.realizedPnl > 0));
    else if (analyticsFilter === "holdings") rows = rows.filter((c) => c.holdings > 0);

    rows.sort((a, b) => {
      if (analyticsSort === "underwater") {
        const au = a.daysUnderwater ?? -1;
        const bu = b.daysUnderwater ?? -1;
        if (bu !== au) return bu - au;
        return (b.daysSinceFirstBuy ?? 0) - (a.daysSinceFirstBuy ?? 0);
      }
      if (analyticsSort === "unrealized_pct") {
        const ap = a.unrealizedPct ?? -9999;
        const bp = b.unrealizedPct ?? -9999;
        return ap - bp; // most negative first (pain first)
      }
      // realized
      return b.realizedPnl - a.realizedPnl;
    });
    return rows;
  }, [coinAnalytics, analyticsFilter, analyticsSort]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      const typeOk = txFilter === "all" || t.type.toLowerCase() === txFilter;
      if (!typeOk) return false;
      if (txCoinFilter === "all") return true;
      if (txCoinFilter === "PHP") {
        const ty = t.type.toLowerCase();
        return ty === "deposit" || ty === "withdraw" || t.symbol === "PHP";
      }
      return t.symbol === txCoinFilter;
    });
  }, [transactions, txFilter, txCoinFilter]);

  const txCoinOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const t of transactions) {
      if (!t.symbol || t.symbol === "PHP") continue;
      set.set(t.symbol, t.name || t.symbol);
    }
    return Array.from(set.entries())
      .map(([value, name]) => ({ value, label: `${name} (${value})` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [transactions]);

  // Combined single-pass calculation for cash and flow stats
  const { totalDeposited, totalWithdrawn, availableCash } = useMemo(() => {
    let dep = 0;
    let wit = 0;
    let cash = 0;

    for (const t of transactions) {
      const amt = Number(t.phpAmount) || 0;
      const tType = String(t.type).toLowerCase();

      if (tType === "deposit") {
        dep += amt;
        cash += amt;
      } else if (tType === "sell") {
        cash += amt;
      } else if (tType === "withdraw" || tType === "withdrawal") {
        wit += amt;
        cash -= amt;
      } else if (tType === "buy") {
        cash -= amt;
      }
    }

    return { totalDeposited: dep, totalWithdrawn: wit, availableCash: cash };
  }, [transactions]);

  const selectedCoinOnHand = useMemo(() => {
    if (isCashFlow || !symbol) return 0;
    const found = portfolio.find((p) => p.symbol === symbol);
    return found ? found.holdings : 0;
  }, [portfolio, symbol, isCashFlow]);

  const portfolioTotals = useMemo(() => {
    const totalSpent = portfolio.reduce((sum, p) => sum + Math.max(0, p.spent), 0);
    const totalSold = portfolio.reduce((sum, p) => sum + p.sold, 0);
    const withKnownPrice = portfolio.filter((p) => p.currentValue !== null && p.gainLoss !== null);
    
    const totalCurrentValue =
      withKnownPrice.length > 0 ? withKnownPrice.reduce((sum, p) => sum + (p.currentValue as number), 0) : null;
    
    const totalGainLoss =
      withKnownPrice.length > 0 ? withKnownPrice.reduce((sum, p) => sum + (p.gainLoss as number), 0) : null;

    return { totalSpent, totalSold, totalCurrentValue, totalGainLoss };
  }, [portfolio]);

  return (
    <div className="flex flex-col gap-8">
      {loadError && <AlertBanner variant="error" message={`Failed to load data: ${loadError}`} />}

      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-4 inline-flex flex-wrap gap-1 rounded-md border border-gray-200 p-1 text-sm">
          {(["buy", "sell", "deposit", "withdraw"] as TradeType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded px-4 py-1.5 font-semibold capitalize transition-colors ${
                type === t
                  ? t === "buy"
                    ? "bg-green-600 text-white"
                    : t === "sell"
                    ? "bg-red-600 text-white"
                    : "bg-blue-600 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <form onSubmit={submitTransaction} className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          {!isCashFlow && (
            <Dropdown
              label="Coin"
              placeholder="Select a coin"
              value={symbol}
              onChange={setSymbol}
              options={coinOptions.map((c) => ({ label: `${c.name} (${c.symbol})`, value: c.symbol }))}
            />
          )}

          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            <span>
              {type === "buy"
                ? "PHP amount spent"
                : type === "sell"
                ? "PHP amount received"
                : type === "deposit"
                ? "PHP Deposited"
                : "PHP Withdrawn"}
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={phpAmount}
              onChange={(e) => setPhpAmount(e.target.value)}
              placeholder="e.g. 1000"
              className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </label>

          {!isCashFlow && (
            <>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                <div className="flex w-full max-w-xs items-end justify-between">
                  <span>Number of coins</span>
                  {symbol &&
                    (type === "sell" ? (
                      <button
                        type="button"
                        onClick={() => setCoinAmount(selectedCoinOnHand.toString())}
                        className="text-xs font-semibold text-blue-600 hover:underline"
                      >
                        Max: {formatCoinAmount(selectedCoinOnHand)}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-500">
                        On-hand: {formatCoinAmount(selectedCoinOnHand)}
                      </span>
                    ))}
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={coinAmount}
                  onChange={(e) => setCoinAmount(e.target.value)}
                  placeholder="e.g. 0.005"
                  className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                <span>Price / Unit Override (Optional)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  placeholder="Fix inaccurate API price"
                  className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>
            </>
          )}

          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            <span>Date</span>
            <input
              type="date"
              value={date}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDate(e.target.value)}
              className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className={`rounded-md px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50 ${
              type === "buy"
                ? "bg-green-600 hover:bg-green-700"
                : type === "sell"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {submitting ? "Saving…" : `Confirm ${type}`}
          </button>
        </form>

        {submitError && (
          <div className="mt-3">
            <AlertBanner variant="error" message={submitError} />
          </div>
        )}
        {lastTransaction && !submitError && (
          <div className="mt-3">
            <AlertBanner
              variant="success"
              message={`Successfully recorded ${lastTransaction.type} of ${formatPhp(lastTransaction.phpAmount)}.`}
            />
          </div>
        )}
      </section>

      {/* —— Snapshot: cash + live holdings —— */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <h2 className="text-base font-bold tracking-tight text-slate-900">Portfolio &amp; cash</h2>
            <p className="text-[11px] text-slate-500">Live mark · open holdings only</p>
          </div>
        </div>
        {loading ? (
          <OverviewSkeleton />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 shadow-sm">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Net equity</div>
                <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900 leading-tight">
                  {formatPhp(availableCash + (portfolioTotals.totalCurrentValue ?? 0))}
                </div>
                <p className="mt-0.5 text-[10px] text-slate-400">Cash + crypto</p>
              </div>
              <div className="rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white px-3 py-2.5 shadow-sm">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Cash</div>
                <div className={`mt-0.5 text-base font-bold tabular-nums leading-tight ${availableCash < 0 ? "text-rose-600" : "text-sky-600"}`}>
                  {formatPhp(availableCash)}
                </div>
                <p className="mt-0.5 text-[10px] text-slate-400 truncate">Net in {formatPhp(totalDeposited - totalWithdrawn)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 px-3 py-2.5 shadow-sm">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Cash flow</div>
                <div className="mt-1 flex items-center gap-2 text-xs font-bold">
                  <span className="text-emerald-600">↑ {formatPhp(totalDeposited)}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-amber-600">↓ {formatPhp(totalWithdrawn)}</span>
                </div>
              </div>
              <div className="rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50 to-white px-3 py-2.5 shadow-sm">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Crypto</div>
                <div className="mt-0.5 text-base font-bold tabular-nums text-violet-700 leading-tight">
                  {portfolioTotals.totalCurrentValue !== null ? formatPhp(portfolioTotals.totalCurrentValue) : "—"}
                </div>
                <p className="mt-0.5 text-[10px] text-slate-400">In {formatPhp(portfolioTotals.totalSpent)}</p>
              </div>
              <div
                className={`rounded-xl border bg-gradient-to-br to-white px-3 py-2.5 shadow-sm col-span-2 sm:col-span-1 ${
                  portfolioTotals.totalGainLoss != null && portfolioTotals.totalGainLoss >= 0
                    ? "border-emerald-100 from-emerald-50"
                    : portfolioTotals.totalGainLoss != null
                    ? "border-rose-100 from-rose-50"
                    : "border-slate-200 from-slate-50"
                }`}
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Open G/L</div>
                <div
                  className={`mt-0.5 text-base font-bold tabular-nums leading-tight ${
                    portfolioTotals.totalGainLoss === null
                      ? "text-slate-400"
                      : portfolioTotals.totalGainLoss >= 0
                      ? "text-emerald-600"
                      : "text-rose-600"
                  }`}
                >
                  {portfolioTotals.totalGainLoss !== null
                    ? `${portfolioTotals.totalGainLoss >= 0 ? "+" : ""}${formatPhp(portfolioTotals.totalGainLoss)}`
                    : "—"}
                </div>
                <p className="mt-0.5 text-[10px] text-slate-400">Vs net spent</p>
              </div>
            </div>

            {portfolio.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 py-5 text-center text-xs text-slate-400">
                No open holdings
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {portfolio.map((entry) => {
                  const displaySpent = Math.max(0, entry.spent);
                  const gl = entry.gainLoss;
                  return (
                    <div
                      key={entry.symbol}
                      className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:shadow-md"
                    >
                      <div
                        className={`absolute inset-y-0 left-0 w-1 ${
                          gl == null ? "bg-slate-200" : gl >= 0 ? "bg-emerald-400" : "bg-rose-400"
                        }`}
                      />
                      <div className="pl-3.5 pr-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-slate-900">{entry.name}</div>
                            <div className="text-[10px] font-medium text-slate-400">{entry.symbol}</div>
                          </div>
                          <Link
                            href={`/chart?symbol=${encodeURIComponent(entry.symbol)}`}
                            className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 hover:bg-violet-100"
                          >
                            Chart
                          </Link>
                        </div>
                        <div className="mt-2.5 flex items-end justify-between gap-2">
                          <div>
                            <div className="text-[10px] text-slate-400">Holdings</div>
                            <div className="text-xs font-semibold tabular-nums text-slate-800">
                              {formatCoinAmount(entry.holdings)}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-slate-400">Mark</div>
                            <div className="text-xs font-semibold tabular-nums text-slate-800">
                              {entry.currentValue !== null ? formatPhp(entry.currentValue) : "—"}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-slate-400">G/L</div>
                            <div
                              className={`text-sm font-bold tabular-nums ${
                                gl == null ? "text-slate-300" : gl >= 0 ? "text-emerald-600" : "text-rose-600"
                              }`}
                            >
                              {gl != null ? `${gl >= 0 ? "+" : ""}${formatPhp(gl)}` : "—"}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      {/* —— Open patience —— */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold tracking-tight text-slate-900">Profit &amp; patience</h2>
          <p className="text-[11px] text-slate-500">Open cycle · hold clock · house money = Free</p>
        </div>
        {loading ? (
          <OverviewSkeleton />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white px-3 py-2.5 shadow-sm">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700/70">Realized</div>
                <div
                  className={`mt-0.5 text-base font-bold tabular-nums ${
                    analyticsSummary.totalRealizedPnl >= 0 ? "text-emerald-700" : "text-rose-600"
                  }`}
                >
                  {analyticsSummary.totalRealizedPnl >= 0 ? "+" : ""}
                  {formatPhp(analyticsSummary.totalRealizedPnl)}
                </div>
              </div>
              <div className="rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white px-3 py-2.5 shadow-sm">
                <div className="text-[10px] font-bold uppercase tracking-wider text-sky-700/70">Unrealized</div>
                <div
                  className={`mt-0.5 text-base font-bold tabular-nums ${
                    analyticsSummary.totalUnrealizedPnl == null
                      ? "text-slate-300"
                      : analyticsSummary.totalUnrealizedPnl >= 0
                      ? "text-emerald-700"
                      : "text-rose-600"
                  }`}
                >
                  {analyticsSummary.totalUnrealizedPnl != null
                    ? `${analyticsSummary.totalUnrealizedPnl >= 0 ? "+" : ""}${formatPhp(
                        analyticsSummary.totalUnrealizedPnl
                      )}`
                    : "—"}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 shadow-sm">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Win rate</div>
                <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">
                  {analyticsSummary.sellWinRate != null
                    ? `${(analyticsSummary.sellWinRate * 100).toFixed(0)}%`
                    : "—"}
                </div>
                <p className="text-[10px] text-slate-400">
                  {analyticsSummary.winningSells}W · {analyticsSummary.losingSells}L
                </p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white px-3 py-2.5 shadow-sm">
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700/70">Longest under</div>
                <div className="mt-0.5 text-sm font-bold text-amber-900 truncate">
                  {analyticsSummary.longestUnderwater
                    ? `${analyticsSummary.longestUnderwater.symbol}`
                    : "None"}
                  {analyticsSummary.longestUnderwater?.daysUnderwater != null && (
                    <span className="text-amber-700 font-semibold">
                      {" "}
                      · {analyticsSummary.longestUnderwater.daysUnderwater}d
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ["all", "All"],
                  ["holdings", "Holding"],
                  ["underwater", "Under"],
                  ["in_profit", "Profit"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAnalyticsFilter(value)}
                  className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${
                    analyticsFilter === value
                      ? "bg-slate-900 text-white shadow-sm"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
              <select
                value={analyticsSort}
                onChange={(e) => setAnalyticsSort(e.target.value as typeof analyticsSort)}
                className="ml-auto rounded-full border-0 bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-700"
              >
                <option value="underwater">Days under</option>
                <option value="unrealized_pct">Unrealized %</option>
                <option value="realized">Realized</option>
              </select>
            </div>

            {filteredAnalytics.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 py-5 text-center text-xs text-slate-400">
                {coinAnalytics.length === 0 ? "No trades yet" : "No match"}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {filteredAnalytics.map((c) => {
         const badge =
  c.holdings > 0 && c.openCycleCostRecovered
    ? { t: "Recovered", c: "bg-emerald-500 text-white" }
    : c.status === "in_profit"
    ? { t: c.holdings > 0 ? "Profit" : "Closed +", c: "bg-emerald-100 text-emerald-800" }
    : c.status === "underwater"
    ? { t: c.holdings > 0 ? "Under" : "Closed -", c: "bg-amber-400 text-amber-950" }
    : { t: c.holdings > 0 ? "Flat" : "Closed", c: "bg-slate-100 text-slate-600" };
                  return (
                    <div
                      key={c.symbol}
                      className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2">
                        <div className="min-w-0">
                          <span className="text-sm font-bold text-slate-900 truncate block">{c.name}</span>
                          <span className="text-[10px] font-medium text-slate-400">{c.symbol}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.c}`}>
                            {badge.t}
                          </span>
                          <Link
                            href={`/chart?symbol=${encodeURIComponent(c.symbol)}`}
                            className="text-[10px] font-bold text-violet-600 hover:underline"
                          >
                            Chart
                          </Link>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-px bg-slate-100 text-center">
                        <div className="bg-white px-1.5 py-2">
                          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Held</div>
                          <div className="mt-0.5 text-xs font-bold tabular-nums text-slate-900">
                            {c.holdings > 0 && c.openCycleCostRecovered
                              ? "Free"
                              : c.holdings > 0 && c.daysSinceFirstBuy != null
                              ? `${c.daysSinceFirstBuy}d`
                              : "—"}
                          </div>
                        </div>
                        <div className="bg-white px-1.5 py-2">
                          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Under</div>
                          <div className="mt-0.5 text-xs font-bold tabular-nums text-amber-700">
                            {c.openCycleCostRecovered
                              ? "—"
                              : c.isUnderwater && c.daysUnderwater != null
                              ? `${c.daysUnderwater}d`
                              : c.holdings > 0
                              ? "0d"
                              : "—"}
                          </div>
                        </div>
                        <div className="bg-white px-1.5 py-2">
                          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Avg</div>
                          <div className="mt-0.5 text-[11px] font-bold tabular-nums text-slate-800 truncate">
                            {c.holdings > 0 && c.avgCost != null ? formatPhp(c.avgCost) : "—"}
                          </div>
                        </div>
                        <div className="bg-white px-1.5 py-2">
                          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Open</div>
                          <div
                            className={`mt-0.5 text-[11px] font-bold tabular-nums truncate ${
                              c.unrealizedPnl == null
                                ? "text-slate-300"
                                : c.unrealizedPnl >= 0
                                ? "text-emerald-600"
                                : "text-rose-600"
                            }`}
                          >
                            {c.unrealizedPnl != null
                              ? `${c.unrealizedPnl >= 0 ? "+" : ""}${formatPhp(c.unrealizedPnl)}`
                              : "—"}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between px-3 py-1.5 text-[10px]">
                        <span className="text-slate-400">
                          Locked{" "}
                          <span
                            className={`font-bold ${
                              c.realizedPnl >= 0 ? "text-emerald-600" : "text-rose-600"
                            }`}
                          >
                            {c.realizedPnl >= 0 ? "+" : ""}
                            {formatPhp(c.realizedPnl)}
                          </span>
                        </span>
                        {(c.closedCycles?.length ?? 0) > 0 && (
                          <span className="font-medium text-slate-400">{c.closedCycles.length}× closed</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      {/* —— Closed history —— */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold tracking-tight text-slate-900">Closed cycle history</h2>
          <p className="text-[11px] text-slate-500">Past rounds · no live price</p>
        </div>
        {loading ? (
          <TableSkeleton />
        ) : (
          (() => {
            const historyRows = coinAnalytics.flatMap((c) =>
              (c.closedCycles ?? []).map((cy) => ({
                symbol: c.symbol,
                name: c.name,
                ...cy,
              }))
            );
            if (historyRows.length === 0) {
              return (
                <p className="rounded-xl border border-dashed border-slate-200 py-5 text-center text-xs text-slate-400">
                  No closed cycles yet
                </p>
              );
            }
            historyRows.sort((a, b) => new Date(b.endAt).getTime() - new Date(a.endAt).getTime());
            return (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {historyRows.map((cy) => (
                  <div
                    key={`${cy.symbol}-c${cy.cycleIndex}-${cy.endAt}`}
                    className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden"
                  >
                    <div className="flex items-center justify-between gap-2 bg-slate-900 px-3 py-2 text-white">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold">
                          {cy.name}{" "}
                          <span className="font-medium text-slate-400">#{cy.cycleIndex}</span>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {new Date(cy.startAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                          {" → "}
                          {new Date(cy.endAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "2-digit",
                          })}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                          cy.closeReason === "recovered_reentry"
                            ? "bg-emerald-400/20 text-emerald-300"
                            : "bg-white/10 text-slate-300"
                        }`}
                      >
                        {cy.closeReason === "recovered_reentry" ? "Recovered" : "Exit"}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-px bg-slate-100 text-center">
                      <div className="bg-white px-2 py-2">
                        <div className="text-[9px] font-bold uppercase text-slate-400">Held</div>
                        <div className="text-xs font-bold text-slate-900">{cy.daysHeld}d</div>
                      </div>
                      <div className="bg-white px-2 py-2">
                        <div className="text-[9px] font-bold uppercase text-slate-400">Buy</div>
                        <div className="text-[11px] font-bold tabular-nums text-slate-800 truncate">
                          {cy.avgBuyPrice != null ? formatPhp(cy.avgBuyPrice) : "—"}
                        </div>
                      </div>
                      <div className="bg-white px-2 py-2">
                        <div className="text-[9px] font-bold uppercase text-slate-400">Sell</div>
                        <div className="text-[11px] font-bold tabular-nums text-slate-800 truncate">
                          {cy.avgSellPrice != null ? formatPhp(cy.avgSellPrice) : "—"}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between px-3 py-2">
                      <span
                        className={`text-sm font-bold tabular-nums ${
                          cy.realizedPnl >= 0 ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {cy.realizedPnl >= 0 ? "+" : ""}
                        {formatPhp(cy.realizedPnl)}
                      </span>
                      {cy.freeCoinsCarried > 0 && (
                        <span className="text-[10px] font-semibold text-emerald-700">
                          Free {formatCoinAmount(cy.freeCoinsCarried)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Transaction history</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={txCoinFilter}
              onChange={(e) => setTxCoinFilter(e.target.value)}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="all">All coins</option>
              <option value="PHP">PHP cash only</option>
              {txCoinOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
              {(["all", "deposit", "withdraw", "buy", "sell"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setTxFilter(type)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                    txFilter === type
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <TableSkeleton />
        ) : filteredTransactions.length === 0 ? (
          <p className="text-sm text-gray-500">
            {txFilter === "all" && txCoinFilter === "all"
              ? "No transactions recorded yet."
              : `No transactions found for this filter.`}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white shadow-sm">
            {filteredTransactions.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                {editingId === t.id ? (
                  <div className="flex w-full flex-col gap-2">
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
                        <span>Coin Amount</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={editCoinAmount}
                          onChange={(e) => setEditCoinAmount(e.target.value)}
                          className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-xs shadow-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
                        <span>PHP Amount</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={editPhpAmount}
                          onChange={(e) => setEditPhpAmount(e.target.value)}
                          className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-xs shadow-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
                        <span>Price/Unit</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-xs shadow-sm"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={editSaving}
                        className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                      >
                        {editSaving ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                    {editError && <p className="text-xs font-medium text-red-700">{editError}</p>}
                  </div>
                ) : (
                  <>
                    <div className="text-sm">
                      <span
                        className={`mr-2 rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${
                          t.type.toLowerCase() === "deposit"
                            ? "border-cyan-200 bg-cyan-100 text-cyan-800"
                            : t.type.toLowerCase() === "withdraw"
                            ? "border-amber-200 bg-amber-100 text-amber-800"
                            : t.type.toLowerCase() === "buy"
                            ? "border-purple-200 bg-purple-100 text-purple-800"
                            : "border-rose-200 bg-rose-100 text-rose-800"
                        }`}
                      >
                        {t.type}
                      </span>
                      <span className="font-medium text-gray-900">
                        {t.symbol !== "PHP" ? `${t.name} (${t.symbol})` : "PHP Cash Flow"}
                      </span>
                      <span className="text-gray-500">
                        {t.coinAmount > 0
                          ? ` — ${formatCoinAmount(t.coinAmount)} for ${formatPhp(t.phpAmount)} (${formatPhp(
                              t.price
                            )}/coin)`
                          : ` — ${formatPhp(t.phpAmount)}`}
                      </span>
                      <div className="text-xs text-gray-400">{formatDateTime(t.transactedAt)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(t)}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteTransaction(t.id)}
                        disabled={deletingId === t.id}
                        className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        {deletingId === t.id ? "Removing…" : "Remove"}
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}