import AlertBanner from "@/components/AlertBanner";
import { formatPhp } from "@/lib/format";
import { useHomeLogic } from "./useHomeLogic";
import NewRecordModal from "./NewRecordModal";
import NewsSection from "./NewsSection";
import PriceUpdateModal from "./PriceUpdateModal";

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
    priceUpdateCoin,
    priceUpdateModalOpen,
    priceUpdateValue,
    setPriceUpdateValue,
    priceUpdateSubmitting,
    priceUpdateError,
    openPriceUpdateModal,
    closePriceUpdateModal,
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
      <PriceUpdateModal
        open={priceUpdateModalOpen}
        coin={priceUpdateCoin}
        value={priceUpdateValue}
        onValueChange={setPriceUpdateValue}
        onSave={submitPriceUpdate}
        saving={priceUpdateSubmitting}
        error={priceUpdateError}
        onClose={closePriceUpdateModal}
      />

      <AlertBanner
        variant={error ? "error" : bannerVariant(lastCronStatus)}
        message={error ? `Failed to load data: ${error}` : `Last cron run: ${formatDateTime(lastCronRun)}`}
      />

      {showTargetBanner && (
        <AlertBanner variant="warning" message={targetBannerMessage(reachedTargets)} onDismiss={dismissTargetBanner} />
      )}

      {canUpdatePrice && (
        <p className="mb-2 text-xs text-gray-500">Click a coin's name to update its price manually.</p>
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
                  {canUpdatePrice ? (
                    <button
                      type="button"
                      onClick={() => openPriceUpdateModal({ symbol: coin.symbol, name: coin.name })}
                      className="underline decoration-dotted hover:text-brand-700"
                      title="Update this coin's price"
                    >
                      {coin.name} <span className="text-gray-400">({coin.symbol})</span>
                    </button>
                  ) : (
                    <span>
                      {coin.name} <span className="text-gray-400">({coin.symbol})</span>
                    </span>
                  )}
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
