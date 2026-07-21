import Dropdown from "@/components/Dropdown";
import AlertBanner from "@/components/AlertBanner";
import { formatPhp, formatCoinAmount } from "@/lib/format";
import { useTradeLogic } from "./useTradeLogic";

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
    editError,
    editSaving,
    startEdit,
    cancelEdit,
    saveEdit,
  } = useTradeLogic();

  return (
    <div className="flex flex-col gap-8">
      {loadError && <AlertBanner variant="error" message={`Failed to load data: ${loadError}`} />}

      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-4 inline-flex rounded-md border border-gray-200 p-1 text-sm">
          <button
            type="button"
            onClick={() => setType("buy")}
            className={`rounded px-4 py-1.5 font-semibold transition-colors ${
              type === "buy" ? "bg-green-600 text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => setType("sell")}
            className={`rounded px-4 py-1.5 font-semibold transition-colors ${
              type === "sell" ? "bg-red-600 text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            Sell
          </button>
        </div>

        <form onSubmit={submitTransaction} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:flex-wrap">
          <Dropdown
            label="Coin"
            placeholder="Select a coin"
            value={symbol}
            onChange={setSymbol}
            options={coinOptions.map((c) => ({ label: `${c.name} (${c.symbol})`, value: c.symbol }))}
          />

          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            <span>{type === "buy" ? "PHP amount spent" : "PHP amount received"}</span>
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
              type === "buy" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
            }`}
          >
            {submitting ? "Saving…" : type === "buy" ? "Buy" : "Sell"}
          </button>
        </form>

        <p className="mt-2 text-xs text-gray-500">
          Enter what you actually spent/received and how many coins — no per-unit price needed, since the exact
          execution price doesn't always match a live ticker lookup.
        </p>

        {submitError && <div className="mt-3"><AlertBanner variant="error" message={submitError} /></div>}
        {lastTransaction && !submitError && (
          <div className="mt-3">
            <AlertBanner
              variant="success"
              message={`${lastTransaction.type === "buy" ? "Bought" : "Sold"} ${formatCoinAmount(
                lastTransaction.coinAmount
              )} ${lastTransaction.symbol} for ${formatPhp(lastTransaction.phpAmount)}.`}
            />
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Portfolio</h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : portfolio.length === 0 ? (
          <p className="text-sm text-gray-500">No trades yet.</p>
        ) : (
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
                {portfolio.map((entry) => (
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
                        entry.gainLoss === null ? "text-gray-400" : entry.gainLoss >= 0 ? "text-green-700" : "text-red-700"
                      }`}
                    >
                      {entry.gainLoss !== null
                        ? `${entry.gainLoss >= 0 ? "+" : ""}${formatPhp(entry.gainLoss)}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Transaction history</h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : transactions.length === 0 ? (
          <p className="text-sm text-gray-500">No trades recorded yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white shadow-sm">
            {transactions.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                {editingId === t.id ? (
                  <div className="flex w-full flex-col gap-2">
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
                        <span>Number of coins</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={editCoinAmount}
                          onChange={(e) => setEditCoinAmount(e.target.value)}
                          className="w-32 rounded-md border border-gray-300 px-2 py-1.5 text-xs shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
                        <span>PHP amount</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={editPhpAmount}
                          onChange={(e) => setEditPhpAmount(e.target.value)}
                          className="w-32 rounded-md border border-gray-300 px-2 py-1.5 text-xs shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
                        className={`mr-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          t.type === "buy" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        }`}
                      >
                        {t.type === "buy" ? "Buy" : "Sell"}
                      </span>
                      <span className="font-medium text-gray-900">
                        {t.name} ({t.symbol})
                      </span>
                      <span className="text-gray-500">
                        {" "}
                        — {formatCoinAmount(t.coinAmount)} for {formatPhp(t.phpAmount)}
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
