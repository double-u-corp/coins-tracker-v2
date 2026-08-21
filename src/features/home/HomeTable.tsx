import Link from "next/link";
import AlertBanner from "@/components/AlertBanner";
import { formatPhp } from "@/lib/format";
import { useHomeLogic } from "./useHomeLogic";
import NewRecordModal from "./NewRecordModal";
import NewsSection from "./NewsSection";
import PriceUpdateModal from "./PriceUpdateModal";
import type { CoinSummary } from "@/validators/recordSchema";

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

interface CoinCardProps {
  coin: CoinSummary;
  canUpdatePrice: boolean;
  onUpdatePriceClick: (coin: { symbol: string; name: string }) => void;
}

/**
 * One card per coin, replacing the old table. Long/precise prices (a cheap
 * altcoin can be ₱0.0000025) don't fit a table row's fixed-width cells
 * without either truncating the coin name column or forcing horizontal
 * scroll — a card gives each price room to be shown in full, stacked
 * vertically instead of squeezed sideways. High and Low each pair the
 * Recorded value with the Target value directly underneath, so you're
 * comparing "where it's been" against "where you want it" at a glance
 * instead of scanning across separate table columns.
 */
function CoinCard({ coin, canUpdatePrice, onUpdatePriceClick }: CoinCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        {canUpdatePrice ? (
          <button
            type="button"
            onClick={() => onUpdatePriceClick({ symbol: coin.symbol, name: coin.name })}
            className="text-left text-sm font-semibold text-gray-900 underline decoration-dotted hover:text-brand-700"
            title="Update this coin's price"
          >
            {coin.name} <span className="font-normal text-gray-400">({coin.symbol})</span>
          </button>
        ) : (
          <span className="text-sm font-semibold text-gray-900">
            {coin.name} <span className="font-normal text-gray-400">({coin.symbol})</span>
          </span>
        )}
      </div>

      <Link
        href={`/calendar?symbol=${coin.symbol}`}
        className="mb-4 flex items-baseline gap-1.5 hover:text-brand-700"
        title={`See ${coin.symbol}'s calendar`}
      >
        <span className="text-xl font-bold text-gray-900 hover:underline">{formatPhp(coin.currentPrice)}</span>
        <PriceDirectionArrow direction={coin.priceDirection} />
      </Link>

      <div className="grid grid-cols-2 gap-x-3 gap-y-3 border-t border-gray-100 pt-3 text-sm">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">High</div>
          <div className="mt-1 text-green-700">Recorded: {formatPhp(coin.recordedHigh)}</div>
          <div className="text-gray-500">Target: {formatPhp(coin.targetHigh)}</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Low</div>
          <div className="mt-1 text-red-700">Recorded: {formatPhp(coin.recordedLow)}</div>
          <div className="text-gray-500">Target: {formatPhp(coin.targetLow)}</div>
        </div>
      </div>
    </div>
  );
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
    recentManualRecords,
    recentManualLoading,
    recentManualError,
    editingRecordId,
    editRecordValue,
    setEditRecordValue,
    editRecordSaving,
    editRecordError,
    startEditRecord,
    cancelEditRecord,
    saveEditRecord,
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
        recentRecords={recentManualRecords}
        recentLoading={recentManualLoading}
        recentError={recentManualError}
        editingId={editingRecordId}
        editValue={editRecordValue}
        onEditValueChange={setEditRecordValue}
        editSaving={editRecordSaving}
        editError={editRecordError}
        onStartEdit={startEditRecord}
        onCancelEdit={cancelEditRecord}
        onSaveEdit={saveEditRecord}
      />

      <AlertBanner
        variant={error ? "error" : bannerVariant(lastCronStatus)}
        message={error ? `Failed to load data: ${error}` : `Last cron run: ${formatDateTime(lastCronRun)}`}
      />

      {showTargetBanner && (
        <AlertBanner variant="warning" message={targetBannerMessage(reachedTargets)} onDismiss={dismissTargetBanner} />
      )}

      <p className="mb-3 text-xs text-gray-500">
        Click a coin's price to see its calendar.
        {canUpdatePrice && " Click a coin's name to update its price manually."}
      </p>

      {loading ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500 shadow-sm">
          Loading coins…
        </p>
      ) : coins.length === 0 && !error ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500 shadow-sm">
          No coins recorded yet. Add a coin from Manage Coins and wait for the next scheduled cron run.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {coins.map((coin) => (
            <CoinCard key={coin.id} coin={coin} canUpdatePrice={canUpdatePrice} onUpdatePriceClick={openPriceUpdateModal} />
          ))}
        </div>
      )}

      <p className="mt-2 text-xs text-gray-500">Target prices are set from the Manage Coins page.</p>

      <NewsSection />
    </div>
  );
}
