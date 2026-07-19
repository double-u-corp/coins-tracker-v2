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
    mode,
    setMode,
    symbol,
    setSymbol,
    phpAmount,
    setPhpAmount,
    coinAmount,
    setCoinAmount,
    manualPrice,
    setManualPrice,
    manualDate,
    setManualDate,
    submitting,
    submitError,
    lastTransaction,
    submitTransaction,
    deleteTransaction,
    deletingId,
    editingId,
    editCoinAmount,
    setEditCoinAmount,
    editPrice,
    setEditPrice,
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
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <div className="inline-flex rounded-md border border-gray-200 p-1 text-sm">
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

          <div className="inline-flex rounded-md border border-gray-200 p-1 text-sm">
            <button
              type="button"
              onClick={() => setMode("live")}
              className={`rounded px-3 py-1.5 font-medium transition-colors ${
                mode === "live" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Live price
            </button>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className={`rounded px-3 py-1.5 font-medium transition-colors ${
                mode === "manual" ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Log a past trade
            </button>
          </div>
        </div>

        <form onSubmit={submitTransaction} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:flex-wrap">
          <Dropdown
            label="Coin"
            placeholder="Select a coin"
            value={symbol}
            onChange={setSymbol}
            options={coinOptions.map((c) => ({ label: `${c.name} (${c.symbol})`, value: c.symbol }))}
          />

          {type === "buy" ? (
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              <span>PHP amount to spend</span>
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
          ) : (
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              <span>Coin amount to sell</span>
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
          )}

          {mode === "manual" && (
            <>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                <span>Price {type === "buy" ? "paid" : "sold at"} (PHP per unit)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.00000001"
                  value={manualPrice}
                  onChange={(e) => setManualPrice(e.target.value)}
                  placeholder="e.g. 3500000"
                  className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                <span>Date</span>
                <input
                  type="date"
                  value={manualDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setManualDate(e.target.value)}
                  className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>
            </>
          )}

          <button
            type="submit"
            disabled={submitting}
            className={`rounded-md px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50 ${
              type === "buy" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
            }`}
          >
            {submitting ? "Saving…" : mode === "live" ? (type === "buy" ? "Buy" : "Sell") : "Log trade"}
          </button>
        </form>

        <p className="mt-2 text-xs text-gray-500">
          {mode === "live"
            ? "Uses the live Coins.ph PHP price for the selected coin (not the monitored USDT price used elsewhere in the app)."
            : "For a trade you already made before using this app — enter what you actually paid/received and when. No live price lookup happens in this mode."}
        </p>

        {submitError && <div className="mt-3"><AlertBanner variant="error" message={submitError} /></div>}
        {lastTransaction && !submitError && (
          <div className="mt-3">
            <AlertBanner
              variant="success"
              message={`${lastTransaction.isManual ? "Logged" : lastTransaction.type === "buy" ? "Bought" : "Sold"} ${formatCoinAmount(
                lastTransaction.coinAmount
              )} ${lastTransaction.symbol} for ${formatPhp(lastTransaction.phpAmount)} at ${formatPhp(lastTransaction.price)}/unit.`}
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
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">Avg. Buy Price</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">Current Value</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">Unrealized G/L</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">Realized G/L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {portfolio.map((entry) => (
                  <tr key={entry.symbol}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {entry.name} <span className="text-gray-400">({entry.symbol})</span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-700">
                      {formatCoinAmount(entry.totalCoinAmount)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-700">{formatPhp(entry.averageBuyPrice)}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-700">
                      {entry.currentValue !== null ? formatPhp(entry.currentValue) : "—"}
                    </td>
                    <td
                      className={`px-4 py-3 text-right text-sm font-medium ${
                        entry.unrealizedGainLoss === null
                          ? "text-gray-400"
                          : entry.unrealizedGainLoss >= 0
                          ? "text-green-700"
                          : "text-red-700"
                      }`}
                    >
                      {entry.unrealizedGainLoss !== null
                        ? `${entry.unrealizedGainLoss >= 0 ? "+" : ""}${formatPhp(entry.unrealizedGainLoss)}${
                            entry.unrealizedGainLossPercent !== null ? ` (${entry.unrealizedGainLossPercent.toFixed(1)}%)` : ""
                          }`
                        : "—"}
                    </td>
                    <td className={`px-4 py-3 text-right text-sm font-medium ${entry.realizedGainLoss >= 0 ? "text-green-700" : "text-red-700"}`}>
                      {entry.realizedGainLoss !== 0
                        ? `${entry.realizedGainLoss >= 0 ? "+" : ""}${formatPhp(entry.realizedGainLoss)}`
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
                        <span>Coin amount</span>
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
                        <span>Price (PHP/unit)</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
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
                      {t.isManual && (
                        <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                          Logged manually
                        </span>
                      )}
                      <span className="text-gray-500">
                        {" "}
                        — {formatCoinAmount(t.coinAmount)} for {formatPhp(t.phpAmount)} at {formatPhp(t.price)}/unit
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
