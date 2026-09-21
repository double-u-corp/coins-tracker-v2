import { useMemo, useState } from "react";
import Dropdown from "@/components/Dropdown";
import AlertBanner from "@/components/AlertBanner";
import { formatPhp, formatCoinAmount } from "@/lib/format";
import { useTradeLogic, TradeType } from "./useTradeLogic";
import TradeTimelineChart from "./TradeTimelineChart";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from "recharts";

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
  const [analyticsView, setAnalyticsView] = useState<"table" | "chart">("table");
  const [timelineSymbol, setTimelineSymbol] = useState<string>("");

  // Default timeline coin: first analytics row or first portfolio coin
  const timelineCoinOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of coinAnalytics) {
      if (c.totalBoughtPhp > 0 || c.holdings > 0) map.set(c.symbol, c.name);
    }
    for (const t of transactions) {
      if (t.symbol && t.symbol !== "PHP") map.set(t.symbol, t.name || t.symbol);
    }
    return Array.from(map.entries())
      .map(([value, name]) => ({ value, label: `${name} (${value})` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [coinAnalytics, transactions]);

  // Pick default once options exist
  const effectiveTimelineSymbol = timelineSymbol || timelineCoinOptions[0]?.value || "";


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

  /** Cumulative realized P&L over time (from sells) for the line chart. */
  const cumulativePnlSeries = useMemo(() => {
    const sells = transactions
      .filter((t) => t.type.toLowerCase() === "sell" && t.symbol && t.symbol !== "PHP")
      .sort((a, b) => new Date(a.transactedAt).getTime() - new Date(b.transactedAt).getTime());

    // Rebuild running realized using same average-cost idea as analytics
    const lots = new Map<string, { units: number; cost: number }>();
    let cumulative = 0;
    const points: { label: string; cumulativePnl: number; realizedThis: number; symbol: string }[] = [];

    for (const t of sells) {
      const coins = Number(t.coinAmount) || 0;
      const php = Number(t.phpAmount) || 0;
      if (coins <= 0) continue;
      let lot = lots.get(t.symbol);
      if (!lot) {
        lot = { units: 0, cost: 0 };
        lots.set(t.symbol, lot);
      }
      // Apply prior buys up to this sell by scanning all txs is heavy; use analytics realized total shape:
      // Approximate: cost basis from proportional net — better walk all txs once
    }

    // Full chronological walk
    const sorted = [...transactions]
      .filter((t) => t.symbol && t.symbol !== "PHP")
      .sort((a, b) => new Date(a.transactedAt).getTime() - new Date(b.transactedAt).getTime());

    lots.clear();
    cumulative = 0;
    for (const t of sorted) {
      const ty = t.type.toLowerCase();
      if (ty !== "buy" && ty !== "sell") continue;
      const coins = Number(t.coinAmount) || 0;
      const php = Number(t.phpAmount) || 0;
      let lot = lots.get(t.symbol);
      if (!lot) {
        lot = { units: 0, cost: 0 };
        lots.set(t.symbol, lot);
      }
      if (ty === "buy" && coins > 0) {
        lot.units += coins;
        lot.cost += php;
      } else if (ty === "sell" && coins > 0) {
        const avg = lot.units > 0 ? lot.cost / lot.units : 0;
        const sold = Math.min(coins, lot.units > 0 ? lot.units : coins);
        const realized = php - avg * sold;
        lot.units = Math.max(0, lot.units - sold);
        lot.cost = Math.max(0, lot.cost - avg * sold);
        if (lot.units < 1e-12) {
          lot.units = 0;
          lot.cost = 0;
        }
        cumulative += realized;
        const d = new Date(t.transactedAt);
        points.push({
          label: d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }),
          cumulativePnl: Math.round(cumulative * 100) / 100,
          realizedThis: Math.round(realized * 100) / 100,
          symbol: t.symbol,
        });
      }
    }
    return points;
  }, [transactions]);

  /** Per-coin bars: realized + unrealized for chart view. */
  const perCoinChartData = useMemo(() => {
    return coinAnalytics
      .filter((c) => c.totalBoughtPhp > 0 || c.holdings > 0)
      .map((c) => ({
        symbol: c.symbol.replace(/PHP$/i, ""),
        realized: Math.round(c.realizedPnl * 100) / 100,
        unrealized: c.unrealizedPnl != null ? Math.round(c.unrealizedPnl * 100) / 100 : 0,
        daysHeld: c.daysSinceFirstBuy ?? 0,
        daysUnderwater: c.isUnderwater ? c.daysUnderwater ?? 0 : 0,
      }));
  }, [coinAnalytics]);

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

      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Portfolio & Cash Overview</h2>
        {loading ? (
          <OverviewSkeleton />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase text-gray-500">Total Net Equity</div>
                <div className="mt-1 text-xl font-bold text-gray-900">
                  {formatPhp(availableCash + (portfolioTotals.totalCurrentValue ?? 0))}
                </div>
                <p className="mt-1 text-xs text-gray-400">Cash + Crypto Holdings</p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase text-gray-500">Available Cash</div>
                <div className={`mt-1 text-xl font-bold ${availableCash < 0 ? "text-red-600" : "text-blue-600"}`}>
                  {formatPhp(availableCash)}
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  Net Deposited: {formatPhp(totalDeposited - totalWithdrawn)}
                </p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase text-gray-500">Cash Flow</div>
                <div className="mt-1 flex items-baseline justify-between">
                  <div>
                    <span className="text-xs text-gray-400">In: </span>
                    <span className="text-sm font-bold text-emerald-600">{formatPhp(totalDeposited)}</span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400">Out: </span>
                    <span className="text-sm font-bold text-amber-600">{formatPhp(totalWithdrawn)}</span>
                  </div>
                </div>
                <p className="mt-1 text-xs text-gray-400">Total Deposited vs Withdrawn</p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase text-gray-500">Crypto Value</div>
                <div className="mt-1 text-xl font-bold text-gray-900">
                  {portfolioTotals.totalCurrentValue !== null ? formatPhp(portfolioTotals.totalCurrentValue) : "—"}
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  Net Invested: {formatPhp(portfolioTotals.totalSpent)}
                </p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase text-gray-500">Crypto Gain / Loss</div>
                <div
                  className={`mt-1 text-xl font-bold ${
                    portfolioTotals.totalGainLoss === null
                      ? "text-gray-400"
                      : portfolioTotals.totalGainLoss >= 0
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {portfolioTotals.totalGainLoss !== null
                    ? `${portfolioTotals.totalGainLoss >= 0 ? "+" : ""}${formatPhp(portfolioTotals.totalGainLoss)}`
                    : "—"}
                </div>
                <p className="mt-1 text-xs text-gray-400">Net Return (Value - Net Spent)</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Coin</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">Holdings</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">Total Sold</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">Net Spent</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">Current Value</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">Gain / Loss</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {portfolio.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-3 text-center text-sm text-gray-500">
                        No coin holdings active.
                      </td>
                    </tr>
                  ) : (
                    portfolio.map((entry) => {
                      const displaySpent = Math.max(0, entry.spent);
                      return (
                        <tr key={entry.symbol}>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {entry.name} <span className="text-gray-400">({entry.symbol})</span>
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-gray-700">{formatCoinAmount(entry.holdings)}</td>
                          <td className="px-4 py-3 text-right text-sm text-emerald-600 font-medium">{formatPhp(entry.sold)}</td>
                          <td className="px-4 py-3 text-right text-sm font-medium text-gray-700">
                            {formatPhp(displaySpent)}
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-gray-700">
                            {entry.currentValue !== null ? formatPhp(entry.currentValue) : "—"}
                          </td>
                          <td
                            className={`px-4 py-3 text-right text-sm font-medium ${
                              entry.gainLoss === null ? "text-gray-400" : entry.gainLoss >= 0 ? "text-green-600" : "text-red-600"
                            }`}
                          >
                            {entry.gainLoss !== null
                              ? `${entry.gainLoss >= 0 ? "+" : ""}${formatPhp(entry.gainLoss)}`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Profit &amp; patience</h2>
          <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            <button
              type="button"
              onClick={() => setAnalyticsView("table")}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                analyticsView === "table" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Table
            </button>
            <button
              type="button"
              onClick={() => setAnalyticsView("chart")}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                analyticsView === "chart" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Chart
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Realized = locked in on sells. Unrealized = on-hand vs average cost. “Taking long” = days underwater while still holding.
        </p>
        {loading ? (
          <OverviewSkeleton />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase text-gray-500">Realized P&amp;L</div>
                <div
                  className={`mt-1 text-xl font-bold ${
                    analyticsSummary.totalRealizedPnl >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {analyticsSummary.totalRealizedPnl >= 0 ? "+" : ""}
                  {formatPhp(analyticsSummary.totalRealizedPnl)}
                </div>
                <p className="mt-1 text-xs text-gray-400">From sells (average cost)</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase text-gray-500">Unrealized P&amp;L</div>
                <div
                  className={`mt-1 text-xl font-bold ${
                    analyticsSummary.totalUnrealizedPnl == null
                      ? "text-gray-400"
                      : analyticsSummary.totalUnrealizedPnl >= 0
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {analyticsSummary.totalUnrealizedPnl != null
                    ? `${analyticsSummary.totalUnrealizedPnl >= 0 ? "+" : ""}${formatPhp(
                        analyticsSummary.totalUnrealizedPnl
                      )}`
                    : "—"}
                </div>
                <p className="mt-1 text-xs text-gray-400">Open holdings only</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase text-gray-500">Sell win rate</div>
                <div className="mt-1 text-xl font-bold text-gray-900">
                  {analyticsSummary.sellWinRate != null
                    ? `${(analyticsSummary.sellWinRate * 100).toFixed(0)}%`
                    : "—"}
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  {analyticsSummary.winningSells}W / {analyticsSummary.losingSells}L sells
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase text-gray-500">Longest underwater</div>
                <div className="mt-1 text-lg font-bold text-amber-700">
                  {analyticsSummary.longestUnderwater
                    ? `${analyticsSummary.longestUnderwater.symbol}`
                    : "None"}
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  {analyticsSummary.longestUnderwater?.daysUnderwater != null
                    ? `${analyticsSummary.longestUnderwater.daysUnderwater}d · ${analyticsSummary.underwaterCount} coin(s) underwater`
                    : `${analyticsSummary.underwaterCount} coin(s) underwater`}
                </p>
              </div>
            </div>

            {analyticsView === "chart" ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs font-semibold text-gray-600">Timeline coin</label>
                  <select
                    value={effectiveTimelineSymbol}
                    onChange={(e) => setTimelineSymbol(e.target.value)}
                    className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  >
                    {timelineCoinOptions.length === 0 ? (
                      <option value="">No traded coins</option>
                    ) : (
                      timelineCoinOptions.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                {effectiveTimelineSymbol ? (
                  <TradeTimelineChart
                    symbol={effectiveTimelineSymbol}
                    name={timelineCoinOptions.find((c) => c.value === effectiveTimelineSymbol)?.label}
                    transactions={transactions}
                  />
                ) : (
                  <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 py-8 text-center text-sm text-gray-500">
                    Record a buy/sell to see a trade timeline.
                  </p>
                )}

                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                  <h3 className="mb-1 text-sm font-semibold text-gray-900">Cumulative realized P&amp;L</h3>
                  <p className="mb-3 text-[11px] text-gray-400">Running total after each sell (average-cost basis)</p>
                  {cumulativePnlSeries.length === 0 ? (
                    <p className="py-8 text-center text-sm text-gray-500">No sells yet — chart appears after you take profit or cut a position.</p>
                  ) : (
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={cumulativePnlSeries}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#9ca3af" minTickGap={24} />
                          <YAxis
                            tick={{ fontSize: 10 }}
                            stroke="#9ca3af"
                            width={52}
                            tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
                          />
                          <Tooltip
                            formatter={(value: number, name: string) => [
                              formatPhp(value),
                              name === "cumulativePnl" ? "Cumulative realized" : "This sell",
                            ]}
                            labelFormatter={(_, payload) => {
                              const row = payload?.[0]?.payload;
                              return row ? `${row.label} · ${row.symbol}` : "";
                            }}
                          />
                          <ReferenceLine y={0} stroke="#d1d5db" />
                          <Line
                            type="monotone"
                            dataKey="cumulativePnl"
                            name="cumulativePnl"
                            stroke="#059669"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                  <h3 className="mb-1 text-sm font-semibold text-gray-900">Per-coin P&amp;L</h3>
                  <p className="mb-3 text-[11px] text-gray-400">Realized (sells) vs unrealized (on-hand)</p>
                  {perCoinChartData.length === 0 ? (
                    <p className="py-8 text-center text-sm text-gray-500">No coin history yet.</p>
                  ) : (
                    <div className="h-72 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={perCoinChartData} margin={{ bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                          <XAxis dataKey="symbol" tick={{ fontSize: 10 }} stroke="#9ca3af" interval={0} angle={-25} textAnchor="end" height={50} />
                          <YAxis
                            tick={{ fontSize: 10 }}
                            stroke="#9ca3af"
                            width={52}
                            tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
                          />
                          <Tooltip formatter={(value: number, name: string) => [formatPhp(value), name]} />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                          <ReferenceLine y={0} stroke="#d1d5db" />
                          <Bar dataKey="realized" name="Realized" fill="#059669" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="unrealized" name="Unrealized" fill="#2563eb" radius={[4, 4, 0, 0]} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>
            ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase text-gray-500">Coin</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-gray-500">Days held</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-gray-500">Underwater</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-gray-500">Avg cost</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-gray-500">Unrealized</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-gray-500">Realized</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {coinAnalytics.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-3 text-center text-sm text-gray-500">
                        No coin trade history yet.
                      </td>
                    </tr>
                  ) : (
                    coinAnalytics.map((c) => (
                      <tr key={c.symbol} className="hover:bg-gray-50">
                        <td className="px-3 py-2.5 text-sm font-medium text-gray-900">
                          {c.name}{" "}
                          <span className="text-gray-400">({c.symbol})</span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-sm text-gray-700">
                          {c.daysSinceFirstBuy != null ? `${c.daysSinceFirstBuy}d` : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right text-sm font-medium text-amber-700">
                          {c.isUnderwater && c.daysUnderwater != null ? `${c.daysUnderwater}d` : c.holdings > 0 ? "0d" : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right text-sm text-gray-600">
                          {c.avgCost != null ? formatPhp(c.avgCost) : "—"}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right text-sm font-medium ${
                            c.unrealizedPnl == null
                              ? "text-gray-400"
                              : c.unrealizedPnl >= 0
                              ? "text-green-600"
                              : "text-red-600"
                          }`}
                        >
                          {c.unrealizedPnl != null
                            ? `${c.unrealizedPnl >= 0 ? "+" : ""}${formatPhp(c.unrealizedPnl)}${
                                c.unrealizedPct != null ? ` (${c.unrealizedPct >= 0 ? "+" : ""}${c.unrealizedPct.toFixed(1)}%)` : ""
                              }`
                            : "—"}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right text-sm font-medium ${
                            c.realizedPnl >= 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {c.realizedPnl >= 0 ? "+" : ""}
                          {formatPhp(c.realizedPnl)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span
                            className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                              c.status === "in_profit"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : c.status === "underwater"
                                ? "border-amber-200 bg-amber-50 text-amber-800"
                                : "border-gray-200 bg-gray-50 text-gray-600"
                            }`}
                          >
                            {c.status === "in_profit"
                              ? c.holdings > 0
                                ? "In profit"
                                : "Closed +"
                              : c.status === "underwater"
                              ? c.holdings > 0
                                ? "Underwater"
                                : "Closed −"
                              : c.status === "flat_closed"
                              ? "Closed"
                              : c.holdings > 0
                              ? "Flat"
                              : "—"}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            )}
          </>
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