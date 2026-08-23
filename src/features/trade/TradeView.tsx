import { useMemo, useState  } from "react";
import Dropdown from "@/components/Dropdown";
import AlertBanner from "@/components/AlertBanner";
import { formatPhp, formatCoinAmount } from "@/lib/format";
import { useTradeLogic, TradeType } from "./useTradeLogic";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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
  } = useTradeLogic();

  const isCashFlow = type === "deposit" || type === "withdraw";
  const [txFilter, setTxFilter] = useState<"all" | "buy" | "sell" | "deposit" | "withdraw">("all");

const filteredTransactions = useMemo(() => {
  if (txFilter === "all") return transactions;
  return transactions.filter((t) => t.type === txFilter);
}, [transactions, txFilter]);
const totalDeposited = useMemo(
  () => transactions.reduce((sum, t) => (t.type === "deposit" ? sum + t.phpAmount : sum), 0),
  [transactions]
);

const totalWithdrawn = useMemo(
  () => transactions.reduce((sum, t) => (t.type === "withdraw" ? sum + t.phpAmount : sum), 0),
  [transactions]
);
  // Calculate Available Cash Balance dynamically
  const availableCash = useMemo(() => {
    return transactions.reduce((acc, t) => {
      if (t.type === "deposit" || t.type === "sell") return acc + t.phpAmount;
      if (t.type === "withdraw" || t.type === "buy") return acc - t.phpAmount;
      return acc;
    }, 0);
  }, [transactions]);

  const portfolioTotals = useMemo(() => {
    const totalSpent = portfolio.reduce((sum, p) => sum + p.spent, 0);
    const totalSold = portfolio.reduce((sum, p) => sum + p.sold, 0);
    const withKnownPrice = portfolio.filter((p) => p.currentValue !== null && p.gainLoss !== null);
    const totalCurrentValue =
      withKnownPrice.length > 0 ? withKnownPrice.reduce((sum, p) => sum + (p.currentValue as number), 0) : null;
    const totalGainLoss =
      withKnownPrice.length > 0 ? withKnownPrice.reduce((sum, p) => sum + (p.gainLoss as number), 0) : null;
    const missingPriceCount = portfolio.length - withKnownPrice.length;
    return { totalSpent, totalSold, totalCurrentValue, totalGainLoss, missingPriceCount };
  }, [portfolio]);

  return (
    <div className="flex flex-col gap-8">
      {loadError && <AlertBanner variant="error" message={`Failed to load data: ${loadError}`} />}

      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-4 inline-flex flex-wrap rounded-md border border-gray-200 p-1 text-sm gap-1">
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

        <form onSubmit={submitTransaction} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:flex-wrap">
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
                <span>Number of coins</span>
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

        <p className="mt-2 text-xs text-gray-500">
          Enter actual execution prices or use unit price overrides to correct exchange discrepancies. Cash flows track your available Coins.ph balance.
        </p>

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
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <>
            {/* Top Metric Cards Grid */}
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
              {/* Card 1: Total Net Equity */}
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase text-gray-500">Total Net Equity</div>
                <div className="mt-1 text-xl font-bold text-gray-900">
                  {formatPhp(availableCash + (portfolioTotals.totalCurrentValue ?? 0))}
                </div>
                <p className="mt-1 text-xs text-gray-400">Cash + Crypto Holdings</p>
              </div>

              {/* Card 2: Available Cash */}
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase text-gray-500">Available Cash</div>
                <div className={`mt-1 text-xl font-bold ${availableCash < 0 ? "text-red-600" : "text-blue-600"}`}>
                  {formatPhp(availableCash)}
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  Net Deposited: {formatPhp(totalDeposited - totalWithdrawn)}
                </p>
              </div>

              {/* Card 3: Cash In / Out (Deposits & Withdrawals) */}
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

              {/* Card 4: Crypto Holdings Value */}
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase text-gray-500">Crypto Value</div>
                <div className="mt-1 text-xl font-bold text-gray-900">
                  {portfolioTotals.totalCurrentValue !== null ? formatPhp(portfolioTotals.totalCurrentValue) : "—"}
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  Cost Basis: {formatPhp(portfolioTotals.totalSpent)}
                </p>
              </div>

              {/* Card 5: Total Portfolio Gain / Loss */}
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
                <p className="mt-1 text-xs text-gray-400">Unrealized Coin Return</p>
              </div>
            </div>

            {/* Active Coin Table */}
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Coin</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">Holdings</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">Total Spent</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">Current Value</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">Gain / Loss</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {portfolio.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-center text-sm text-gray-500">
                        No coin holdings active.
                      </td>
                    </tr>
                  ) : (
                    portfolio.map((entry) => (
                      <tr key={entry.symbol}>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {entry.name} <span className="text-gray-400">({entry.symbol})</span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">{formatCoinAmount(entry.holdings)}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">{formatPhp(entry.spent)}</td>
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

<section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Transaction history</h2>

          {/* Filter Pills */}
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

        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : filteredTransactions.length === 0 ? (
          <p className="text-sm text-gray-500">
            {txFilter === "all" ? "No transactions recorded yet." : `No ${txFilter} transactions found.`}
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
                        className={`mr-2 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                          t.type === "buy"
                            ? "bg-green-100 text-green-700"
                            : t.type === "sell"
                            ? "bg-red-100 text-red-700"
                            : t.type === "deposit"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
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