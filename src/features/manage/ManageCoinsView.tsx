import { useState, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import AlertBanner from "@/components/AlertBanner";
import { formatPhp } from "@/lib/format";
import { useManageCoinsLogic } from "./useManageCoinsLogic";

function formatRawPrice(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

// --- ISOLATED CARD COMPONENT (Zero-Flicker Target Editor) ---
function MonitoredCoinCard({
  coin,
  removeCoin,
  pendingSymbol,
}: {
  coin: any;
  removeCoin: (symbol: string) => void;
  pendingSymbol: string | null;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Local Display State
  const [savedHigh, setSavedHigh] = useState<number | null>(coin.targetHigh);
  const [savedLow, setSavedLow] = useState<number | null>(coin.targetLow);

  // Buffer Edit State
  const [inputHigh, setInputHigh] = useState<string>(savedHigh?.toString() ?? "");
  const [inputLow, setInputLow] = useState<string>(savedLow?.toString() ?? "");

  const handleCancel = () => {
    setInputHigh(savedHigh?.toString() ?? "");
    setInputLow(savedLow?.toString() ?? "");
    setIsEditing(false);
  };

  const handleSave = async () => {
    const h = parseFloat(inputHigh);
    const l = parseFloat(inputLow);
    const validHigh = isNaN(h) ? null : h;
    const validLow = isNaN(l) ? null : l;

    setIsSaving(true);
    try {
      // Direct API call bypassing the parent's global loadMonitored refresh
      const res = await fetch("/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: coin.symbol,
          targetHigh: validHigh,
          targetLow: validLow,
        }),
      });

      if (!res.ok) throw new Error("Failed to save targets");

      setSavedHigh(validHigh);
      setSavedLow(validLow);
      setIsEditing(false);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2500);
    } catch (err) {
      alert("Failed to save target ranges.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
      
      {/* Top Header Block */}
      <div className="flex items-start justify-between border-b border-gray-100 pb-4 mb-3">
        <div className="flex flex-col gap-1.5">
          
          {/* 1. Name & Symbol Inline */}
          <div className="flex items-baseline gap-2">
            <h3 className="text-base font-bold text-gray-900">{coin.name}</h3>
            <span className="text-xs font-semibold text-gray-500 font-mono tracking-tight bg-gray-100 px-1.5 py-0.5 rounded">
              {coin.symbol}
            </span>
          </div>

          {/* 2. Current Price Inline */}
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">
              Current Price
            </span>
            <span className="text-base font-extrabold text-gray-900">
              {formatPhp(coin.currentPrice)}
            </span>
          </div>

        </div>

        {/* <button
          type="button"
          onClick={() => removeCoin(coin.symbol)}
          disabled={pendingSymbol === coin.symbol}
          className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {pendingSymbol === coin.symbol ? "…" : "Remove"}
        </button> */}
      </div>

      {/* Target Ranges: Edit / Cancel / Save */}
      <div className="flex flex-col pt-2 bg-gray-50/50 p-3 rounded-lg gap-3 border border-gray-100">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
            Target Ranges
          </span>
          <div className="flex items-center gap-2">
            {showSuccess && (
              <span className="text-[10px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded border border-green-200">
                ✓ Saved
              </span>
            )}
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="text-[11px] font-semibold text-brand-600 hover:text-brand-800 transition-colors bg-white border border-gray-200 px-2 py-0.5 rounded shadow-sm"
              >
                ✏️ Edit
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleCancel}
                  disabled={isSaving}
                  className="text-[11px] px-2 py-1 bg-gray-200 text-gray-700 rounded font-medium hover:bg-gray-300 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="text-[11px] px-2 py-1 bg-brand-600 text-white rounded font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Target High */}
          <div className="flex flex-col text-xs font-medium gap-1">
            <span className="text-green-700 font-bold">Target High</span>
            {isEditing ? (
              <input
                type="number"
                value={inputHigh}
                onChange={(e) => setInputHigh(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            ) : (
              <span className="font-mono text-sm text-gray-900 font-bold">
                {savedHigh != null ? formatPhp(savedHigh) : "—"}
              </span>
            )}
          </div>
          
          {/* Target Low */}
          <div className="flex flex-col text-xs font-medium gap-1">
            <span className="text-red-700 font-bold">Target Low</span>
            {isEditing ? (
              <input
                type="number"
                value={inputLow}
                onChange={(e) => setInputLow(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            ) : (
              <span className="font-mono text-sm text-gray-900 font-bold">
                {savedLow != null ? formatPhp(savedLow) : "—"}
              </span>
            )}
          </div>
        </div>
      </div>
      
    </div>
  );
}

export default function ManageCoinsView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // 1. Updated to check "symbol" first from searchParams
  const activeCoinFilter =
    searchParams?.get("symbol") ||
    searchParams?.get("coin") ||
    searchParams?.get("id");

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
  } = useManageCoinsLogic();

  // Mode state for adding coins: "manual" | "browse" | null
  const [activeAddMode, setActiveAddMode] = useState<"manual" | "browse" | null>(null);

  // Manual add state
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});
  const [manualSymbol, setManualSymbol] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [manualFormError, setManualFormError] = useState<string | null>(null);

  // Filter monitored list based on URL coin parameter
  const filteredMonitored = useMemo(() => {
    if (!activeCoinFilter) return monitored;
    return monitored.filter(
      (c) =>
        c.symbol.toLowerCase() === activeCoinFilter.toLowerCase() ||
        c.name.toLowerCase() === activeCoinFilter.toLowerCase()
    );
  }, [monitored, activeCoinFilter]);

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
    setActiveAddMode(null);
  }

  function clearCoinFilter() {
    router.push(window.location.pathname);
  }

  return (
    <div className="flex flex-col gap-8">
      {actionError && <AlertBanner variant="error" message={actionError} />}
      
      {/* Navigation Header in Manage View */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <Link 
          href="/" 
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
        >
          <span>←</span>
          <span>Back to Home</span>
        </Link>

        {/* 2. Dynamically forward active symbol to View Chart and View Calendar buttons */}
        <div className="flex items-center gap-2">
          <Link
            href={
              activeCoinFilter
                ? `/chart?symbol=${encodeURIComponent(activeCoinFilter.toUpperCase())}`
                : "/chart"
            }
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-md hover:bg-blue-100 transition-colors"
          >
            <span>📈</span>
            <span>View Chart</span>
          </Link>
          <Link
            href={
              activeCoinFilter
                ? `/calendar?symbol=${encodeURIComponent(activeCoinFilter.toUpperCase())}`
                : "/calendar"
            }
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-md hover:bg-purple-100 transition-colors"
          >
            <span>📅</span>
            <span>View Calendar</span>
          </Link>
        </div>
      </div>
      
      {/* Currently Monitored Cards Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Currently Monitored</h2>
          {activeCoinFilter && (
            <div className="flex items-center gap-2">
              <span className="text-xs bg-brand-50 text-brand-700 px-2.5 py-1 rounded-md font-medium border border-brand-200">
                Filtered: <strong>{activeCoinFilter.toUpperCase()}</strong>
              </span>
              <button
                type="button"
                onClick={clearCoinFilter}
                className="text-xs text-gray-500 hover:text-gray-800 underline"
              >
                Show All Coins
              </button>
            </div>
          )}
        </div>

        {monitoredLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : filteredMonitored.length === 0 ? (
          <p className="text-sm text-gray-500">
            {activeCoinFilter
              ? `No monitored coin matching "${activeCoinFilter}".`
              : "No coins yet — select an option below to add one."}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMonitored.map((coin) => (
              <MonitoredCoinCard
                key={coin.symbol}
                coin={coin}
                removeCoin={removeCoin}
                pendingSymbol={pendingSymbol}
              />
            ))}
          </div>
        )}
      </section>

      {/* Action Choice Buttons */}
      <section className="border-t border-gray-200 pt-6">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Add Coins</p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setActiveAddMode(activeAddMode === "manual" ? null : "manual")}
            className={`px-4 py-2.5 rounded-lg text-xs font-bold transition border ${
              activeAddMode === "manual"
                ? "bg-brand-600 border-brand-600 text-white shadow-sm"
                : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 shadow-sm"
            }`}
          >
            ➕ Add a coin manually
          </button>
          <button
            type="button"
            onClick={() => setActiveAddMode(activeAddMode === "browse" ? null : "browse")}
            className={`px-4 py-2.5 rounded-lg text-xs font-bold transition border ${
              activeAddMode === "browse"
                ? "bg-brand-600 border-brand-600 text-white shadow-sm"
                : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 shadow-sm"
            }`}
          >
            🔍 Browse Coins.ph symbols
          </button>
        </div>
      </section>

      {/* Manual Add Panel */}
      {activeAddMode === "manual" && (
        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <h2 className="text-base font-bold text-gray-900">Add a coin manually</h2>
            <button
              type="button"
              onClick={() => setActiveAddMode(null)}
              className="rounded-md border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Type its exact Coins.ph ticker symbol (e.g. <span className="font-mono">TXPHP</span>).
          </p>

          <div className="flex flex-wrap items-end gap-3 pt-2">
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
              className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 shadow-sm"
            >
              {pendingSymbol !== null ? "Adding…" : "Add Coin"}
            </button>
          </div>
          {manualFormError && <p className="text-xs font-medium text-red-700">{manualFormError}</p>}
        </section>
      )}

      {/* Browse Symbols Panel */}
      {activeAddMode === "browse" && (
        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <h2 className="text-base font-bold text-gray-900">Browse Coins.ph symbols</h2>
            <button
              type="button"
              onClick={() => setActiveAddMode(null)}
              className="rounded-md border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search e.g. BTC, ETH, PHP…"
            className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />

          {searchError && <AlertBanner variant="error" message={`Search failed: ${searchError}`} />}
          {searchLoading && <p className="text-sm text-gray-500">Searching…</p>}

          {!searchLoading && searchResults.length === 0 && (
            <p className="text-sm text-gray-500">
              {query ? "No matching symbols found." : "Type to search the full list of Coins.ph ticker symbols."}
            </p>
          )}

          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-gray-50 shadow-sm max-h-96 overflow-y-auto">
            {searchResults.map((result, idx) => (
              <li
                key={`${result.symbol}-${idx}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-white"
              >
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
      )}
    </div>
  );
}