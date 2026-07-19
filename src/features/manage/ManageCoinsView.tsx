import { useState } from "react";
import AlertBanner from "@/components/AlertBanner";
import TargetEditor from "@/components/TargetEditor";
import { formatPhp } from "@/lib/format";
import { useManageCoinsLogic } from "./useManageCoinsLogic";

// Search results can be ANY quote asset (USDT, BTC, PHP, ...), not just PHP,
// so they're shown as a plain number rather than formatted as PHP currency —
// the symbol itself (e.g. "BTCUSDT") tells you what it's quoted in.
function formatRawPrice(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

export default function ManageCoinsView() {
  const {
    monitored,
    monitoredLoading,
    query,
    setQuery,
    searchResults,
    searchLoading,
    searchError,
    actionError,
    pendingSymbol,
    addCoin,
    setStartingPrice,
    removeCoin,
    updateTarget,
  } = useManageCoinsLogic();

  // Tracks the editable "name" field per search result before it's added.
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});

  // Manual "add by typing the symbol" form state.
  const [manualSymbol, setManualSymbol] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [manualFormError, setManualFormError] = useState<string | null>(null);

  async function submitManualAdd() {
    setManualFormError(null);
    const symbol = manualSymbol.trim().toUpperCase();
    const name = manualName.trim();
    if (!symbol) {
      setManualFormError("Enter a symbol");
      return;
    }
    if (!name) {
      setManualFormError("Enter a display name");
      return;
    }

    let startingPrice: number | null = null;
    if (manualPrice.trim() !== "") {
      const parsed = Number(manualPrice);
      if (Number.isNaN(parsed) || parsed <= 0) {
        setManualFormError("Starting price must be a number greater than 0 (or leave it blank)");
        return;
      }
      startingPrice = parsed;
    }

    await addCoin(symbol, name);
    if (startingPrice !== null) {
      await setStartingPrice(symbol, startingPrice);
    }
    setManualSymbol("");
    setManualName("");
    setManualPrice("");
  }

  return (
    <div className="flex flex-col gap-8">
      {actionError && <AlertBanner variant="error" message={actionError} />}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Currently monitored</h2>
        {monitoredLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : monitored.length === 0 ? (
          <p className="text-sm text-gray-500">No coins yet — add one below.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white shadow-sm">
            {monitored.map((coin) => (
              <li key={coin.symbol} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    {coin.name} <span className="text-gray-400">({coin.symbol})</span>
                  </span>
                  <div className="mt-0.5 text-xs text-gray-500">
                    Current price: {formatPhp(coin.currentPrice)}
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-4">
                  <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
                    <span>Target High</span>
                    <TargetEditor
                      value={coin.targetHigh}
                      placeholder="—"
                      onSave={(newHigh) => updateTarget(coin.symbol, newHigh, coin.targetLow)}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
                    <span>Target Low</span>
                    <TargetEditor
                      value={coin.targetLow}
                      placeholder="—"
                      onSave={(newLow) => updateTarget(coin.symbol, coin.targetHigh, newLow)}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => removeCoin(coin.symbol)}
                    disabled={pendingSymbol === coin.symbol}
                    className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {pendingSymbol === coin.symbol ? "…" : "Remove"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Add a coin manually</h2>
        <p className="mb-3 text-xs text-gray-500">
          Already hold a coin that didn't show up in the search below? Type its exact Coins.ph ticker symbol
          (e.g. <span className="font-mono">TXPHP</span>) directly — it doesn't need to appear in search first, and
          no live price lookup is attempted (coins added this way are often exactly the ones the live search can't
          reach). Optionally set a starting price now, since nothing will fetch one automatically for a coin like
          this — you can run this same form again anytime with the same symbol to update the price later.
        </p>
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
            <span>Symbol</span>
            <input
              type="text"
              value={manualSymbol}
              onChange={(e) => setManualSymbol(e.target.value)}
              placeholder="e.g. TXPHP"
              className="w-32 rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
            <span>Display name</span>
            <input
              type="text"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder="e.g. TX"
              className="w-32 rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
            <span>Starting price (optional)</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={manualPrice}
              onChange={(e) => setManualPrice(e.target.value)}
              placeholder="PHP, e.g. 5.20"
              className="w-32 rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </label>
          <button
            type="button"
            onClick={submitManualAdd}
            disabled={pendingSymbol !== null}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {pendingSymbol !== null ? "Adding…" : "Add Coin"}
          </button>
        </div>
        {manualFormError && <p className="mt-2 text-xs font-medium text-red-700">{manualFormError}</p>}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Browse Coins.ph symbols</h2>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search e.g. BTC, ETH, PHP…"
          className="mb-1 w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <p className="mb-4 text-xs text-gray-500">
          Pick the symbol ending in <span className="font-mono">PHP</span> (e.g. <span className="font-mono">BTCPHP</span>) to
          track the peso price — other suffixes like <span className="font-mono">USDT</span> track a different quote
          currency.
        </p>

        {searchError && <AlertBanner variant="error" message={`Search failed: ${searchError}`} />}
        {searchLoading && <p className="text-sm text-gray-500">Searching…</p>}

        {!searchLoading && searchResults.length === 0 && (
          <p className="text-sm text-gray-500">
            {query ? "No matching symbols found." : "Type to search the full list of Coins.ph ticker symbols."}
          </p>
        )}

        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white shadow-sm">
          {searchResults.map((result, idx) => (
            <li key={`${result.symbol}-${idx}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-gray-900">{result.symbol}</div>
                <div className="text-xs text-gray-500">Price: {formatRawPrice(result.price)}</div>
              </div>

              {result.alreadyMonitored ? (
                <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                  Monitored
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={nameOverrides[result.symbol] ?? result.suggestedName}
                    onChange={(e) =>
                      setNameOverrides((prev) => ({ ...prev, [result.symbol]: e.target.value }))
                    }
                    className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-xs shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    aria-label={`Display name for ${result.symbol}`}
                  />
                  <button
                    type="button"
                    onClick={() => addCoin(result.symbol, nameOverrides[result.symbol] ?? result.suggestedName)}
                    disabled={pendingSymbol === result.symbol}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {pendingSymbol === result.symbol ? "Adding…" : "Add"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
