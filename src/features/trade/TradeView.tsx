import { useMemo, useState } from "react";
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
  } = useTradeLogic();

  const isCashFlow = type === "deposit" || type === "withdraw";
  const [txFilter, setTxFilter] = useState<"all" | "buy" | "sell" | "deposit" | "withdraw">("all");

  const filteredTransactions = useMemo(() => {
    if (txFilter === "all") return transactions;
    return transactions.filter((t) => t.type.toLowerCase() === txFilter);
  }, [transactions, txFilter]);

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
    const totalSpent = portfolio.reduce((sum, p) => sum + p.spent, 0);
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
                    portfolio.map((entry) => (
                      <tr key={entry.symbol}>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {entry.name} <span className="text-gray-400">({entry.symbol})</span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">{formatCoinAmount(entry.holdings)}</td>
                        <td className="px-4 py-3 text-right text-sm text-emerald-600 font-medium">{formatPhp(entry.sold)}</td>
                        <td className={`px-4 py-3 text-right text-sm font-medium ${entry.spent < 0 ? "text-emerald-600" : "text-gray-700"}`}>
                          {formatPhp(entry.spent)}
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
          <TableSkeleton />
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