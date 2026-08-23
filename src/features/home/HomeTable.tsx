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

function PriceDirectionArrow({ direction, inverse = false }: { direction: "up" | "down" | "flat" | null; inverse?: boolean }) {
  if (direction === "up") return <span className={inverse ? "text-green-300" : "text-green-600"}>▲</span>;
  if (direction === "down") return <span className={inverse ? "text-red-300" : "text-red-600"}>▼</span>;
  return null; 
}

interface CoinCardProps {
  coin: CoinSummary;
  canUpdatePrice: boolean;
  onUpdatePriceClick: (coin: { symbol: string; name: string }) => void;
}

function CoinCard({ coin, canUpdatePrice, onUpdatePriceClick }: CoinCardProps) {
  return (
    <div id={`coin-card-${coin.symbol}`} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900">
          {coin.name} <span className="font-normal text-gray-400">({coin.symbol})</span>
        </span>

        <div className="flex items-center gap-1.5">
          {canUpdatePrice && (
            <button
              type="button"
              onClick={() => onUpdatePriceClick({ symbol: coin.symbol, name: coin.name })}
              className="rounded bg-brand-50 border border-brand-200 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 transition-colors"
              title="Update this coin's price manually"
            >
              Update
            </button>
          )}
          <Link
            href={`/calendar?symbol=${coin.symbol}`}
            className="rounded bg-gray-100 border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
            title={`See ${coin.symbol}'s calendar`}
          >
            Calendar
          </Link>
          <Link
            href={`/chart?symbol=${coin.symbol}`}
            className="rounded bg-gray-100 border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
            title={`See ${coin.symbol}'s chart`}
          >
            Chart
          </Link>
        </div>
      </div>

      <div className="mb-4 flex items-baseline gap-1.5">
        <span className="text-xl font-bold text-gray-900">{formatPhp(coin.currentPrice)}</span>
        <PriceDirectionArrow direction={coin.priceDirection} />
      </div>

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
    allCoins,
    selectedCoins,
    setSelectedCoins,
    portfolio,
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

      {/* Automatically visible mobile chip filter */}
      {!loading && allCoins.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              Filter Coins {selectedCoins.length > 0 ? `(${selectedCoins.length} selected)` : ""}
            </span>
            {selectedCoins.length > 0 && (
              <button
                onClick={() => setSelectedCoins([])}
                className="text-xs font-medium text-gray-500 hover:text-gray-900 underline"
              >
                Clear All
              </button>
            )}
          </div>
          
          <div className="flex flex-wrap gap-2">
            {allCoins.map((coin) => {
              const isSelected = selectedCoins.includes(coin.symbol);
              
              const activePortfolio = portfolio?.find((p) => p.symbol === coin.symbol);
              const hasHoldings = activePortfolio && activePortfolio.holdings > 0;

              let chipClasses = "";
              if (isSelected) {
                chipClasses = "bg-brand-600 border-brand-600 text-white";
              } else if (hasHoldings) {
                chipClasses = "bg-indigo-50 border-indigo-300 text-indigo-800 hover:bg-indigo-100 shadow-sm font-bold";
              } else {
                chipClasses = "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 shadow-sm";
              }

              return (
                <button
                  key={coin.symbol}
                  onClick={() => {
                    if (isSelected) {
                      setSelectedCoins(selectedCoins.filter((c) => c !== coin.symbol));
                    } else {
                      setSelectedCoins([...selectedCoins, coin.symbol]);
                      
                      setTimeout(() => {
                        document.getElementById(`coin-card-${coin.symbol}`)?.scrollIntoView({ 
                          behavior: "smooth", 
                          block: "start" 
                        });
                      }, 150); 
                    }
                  }}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors border ${chipClasses}`}
                >
                  {hasHoldings && !isSelected && <span className="text-indigo-500">●</span>}
                  
                  <span>{coin.symbol}</span>
                  <span className={isSelected ? "text-brand-300" : hasHoldings ? "text-indigo-300" : "text-gray-300"}>|</span>
                  <span>{formatPhp(coin.currentPrice)}</span>
                  
                  <PriceDirectionArrow 
                    direction={coin.priceDirection} 
                    inverse={isSelected} 
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500 shadow-sm">
          Loading coins…
        </p>
      ) : coins.length === 0 && !error ? (
          <>
          {selectedCoins.length > 0 && (<p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500 shadow-sm">No coins match your filter.</p> )}
          </>
      ) : (
        <>      
          <p className="mb-3 text-xs text-gray-500">
            Use the card action buttons to view calendar schedules, interactive charts, or manually log coin prices.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {coins.map((coin) => (
              <CoinCard key={coin.id} coin={coin} canUpdatePrice={canUpdatePrice} onUpdatePriceClick={openPriceUpdateModal} />
            ))}
          </div>
        </>
      )}

      <p className="mt-2 text-xs text-gray-500">Target prices are set from the Manage Coins page.</p>

      <NewsSection />
    </div>
  );
}