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

export default function HomeTable() {
  const {
    coins,
    lastCronRun,
    lastCronStatus,
    loading,
    error,
    cronRun,
    runCronNow,
    canRunCron,
    alertRecords,
    alertModalOpen,
    closeAlertModal,
    reachedTargets,
    showTargetBanner,
    dismissTargetBanner,
    newsRefreshTick,
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
        {canRunCron && (
          <button
            type="button"
            onClick={runCronNow}
            disabled={cronRun.running}
            className="shrink-0 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {cronRun.running ? "Running cron…" : "Run Cron Now"}
          </button>
        )}
      </div>

      {showTargetBanner && (
        <AlertBanner variant="warning" message={targetBannerMessage(reachedTargets)} onDismiss={dismissTargetBanner} />
      )}

      {cronRun.error && <AlertBanner variant="error" message={`Cron run failed: ${cronRun.error}`} />}

      {cronRun.results && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Cron run results</h2>
          {cronRun.results.length === 0 ? (
            <p className="text-sm text-gray-500">No coins are being monitored yet — add one from Manage Coins.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {cronRun.results.map((r) => (
                <li key={r.symbol} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900">{r.symbol}</span>
                  <span className="text-gray-600">price {formatPhp(r.price)}</span>
                  {r.isNewHigh && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                      New high
                    </span>
                  )}
                  {r.isNewLow && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                      New low
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
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
                  No coins recorded yet. Add a coin from Manage Coins, then use "Run Cron Now" or wait for the next
                  scheduled run.
                </td>
              </tr>
            )}
            {coins.map((coin) => (
              <tr key={coin.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">
                  {coin.name} <span className="text-gray-400">({coin.symbol})</span>
                </td>
                <td className="px-4 py-3 text-right text-sm text-gray-700">{formatPhp(coin.currentPrice)}</td>
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

      <NewsSection refreshSignal={newsRefreshTick} />
    </div>
  );
}
