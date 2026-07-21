import AlertBanner from "@/components/AlertBanner";
import { formatPhp } from "@/lib/format";
import { useHomeLogic } from "./useHomeLogic";
import NewRecordModal from "./NewRecordModal";
import NewsSection from "./NewsSection";

function formatDateTime(iso: string | null): string {
  if (!iso) return "No cron runs recorded yet";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function bannerVariant(status: string | null): "info" | "success" | "warning" | "error" {
  if (status === "success") return "success";
  if (status === "partial") return "warning";
  if (status === "error") return "error";
  return "info";
}

function targetBannerMessage(reachedTargets: { symbol: string; type: "high" | "low" }[]): string {
  const parts = reachedTargets.map((t) => `${t.symbol} (${t.type === "high" ? "high" : "low"})`);
  return `🎯 Target reached: ${parts.join(", ")}`;
}

function PriceDirectionArrow({ direction }: { direction: "up" | "down" | "flat" | null }) {
  if (direction === "up") return <span className="text-green-600">▲</span>;
  if (direction === "down") return <span className="text-red-600">▼</span>;
  return null; // flat or unknown — no arrow
}

export default function HomeTable() {
  const {
    coins,
    lastCronRun,
    lastCronStatus,
    loading,
    error,
    canUpdatePrice,
    priceUpdateSymbol,
    setPriceUpdateSymbol,
    priceUpdateValue,
    setPriceUpdateValue,
    priceUpdateSubmitting,
    priceUpdateError,
    priceUpdateSuccess,
    submitPriceUpdate,
    alertRecords,
    alertModalOpen,
    closeAlertModal,
    reachedTargets,
    showTargetBanner,
    dismissTargetBanner,
  } = useHomeLogic();

  return (
    <div>
      <NewRecordModal open={alertModalOpen} records={alertRecords} onClose={closeAlertModal} />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1">
          <AlertBanner
            variant={error ? "error" : bannerVariant(lastCronStatus)}
            message={error ? `Failed to load data: ${error}` : `Last cron run: ${formatDateTime(lastCronRun)}`}
          />
        </div>

        {canUpdatePrice && (
          <div className="shrink-0 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <div className="mb-1 text-xs font-semibold text-gray-600">Update price manually</div>
            <div className="flex items-center gap-2">
              <select
                value={priceUpdateSymbol}
                onChange={(e) => setPriceUpdateSymbol(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {coins.map((c) =>
                  c.symbol === "TXPHP" ? (
                    <option key={c.symbol} value={c.symbol}>
                      {c.symbol}
                    </option>
                  ) : null
                )}
              </select>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={priceUpdateValue}
                onChange={(e) => setPriceUpdateValue(e.target.value)}
                placeholder="Price"
                className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="button"
                onClick={submitPriceUpdate}
                disabled={priceUpdateSubmitting}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {priceUpdateSubmitting ? "…" : "Update"}
              </button>
            </div>
            {priceUpdateError && <p className="mt-1 text-xs font-medium text-red-700">{priceUpdateError}</p>}
            {priceUpdateSuccess && !priceUpdateError && (
              <p className="mt-1 text-xs font-medium text-green-700">{priceUpdateSuccess}</p>
            )}
          </div>
        )}
      </div>

      {showTargetBanner && (
        <AlertBanner variant="warning" message={targetBannerMessage(reachedTargets)} onDismiss={dismissTargetBanner} />
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Coin
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                Current Price
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                Recorded High
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                Recorded Low
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                Target High
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                Target Low
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                  Loading coins…
                </td>
              </tr>
            )}
            {!loading && coins.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                  No coins recorded yet. Add a coin from Manage Coins and wait for the next scheduled cron run.
                </td>
              </tr>
            )}
            {coins.map((coin) => (
              <tr key={coin.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">
                  {coin.name} <span className="text-gray-400">({coin.symbol})</span>
                </td>
                <td className="px-4 py-3 text-right text-sm text-gray-700">
                  <span className="inline-flex items-center gap-1">
                    <PriceDirectionArrow direction={coin.priceDirection} />
                    {formatPhp(coin.currentPrice)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-sm text-green-700">{formatPhp(coin.recordedHigh)}</td>
                <td className="px-4 py-3 text-right text-sm text-red-700">{formatPhp(coin.recordedLow)}</td>
                <td className="px-4 py-3 text-right text-sm text-gray-500">{formatPhp(coin.targetHigh)}</td>
                <td className="px-4 py-3 text-right text-sm text-gray-500">{formatPhp(coin.targetLow)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Target prices are set from the Manage Coins page.
      </p>

      <NewsSection />
    </div>
  );
}
