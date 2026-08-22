import Link from "next/link";
import Dropdown from "@/components/Dropdown";
import AlertBanner from "@/components/AlertBanner";
import { formatPhp } from "@/lib/format";
import { useCalendarLogic } from "./useCalendarLogic";
import type { DailyRecord } from "@/validators/recordSchema";

export default function CalendarView() {
  const {
    coinOptions,
    selectedSymbol,
    setSelectedSymbol,
    monthCursor,
    goToPreviousMonth,
    goToNextMonth,
    days,
    loading,
    error,
  } = useCalendarLogic();

  const monthLabel = monthCursor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  // Filter out days that have no data or missing values
const recordsWithData = days
  .filter(
    (d) =>
      d.high !== undefined &&
      d.low !== undefined &&
      d.high !== null &&
      d.low !== null
  )
  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());


  return (
    <div className="flex flex-col gap-6">
      {/* NEW: Back to Home Button */}
      <div>
        <Link 
          href="/" 
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
        >
          <span>←</span>
          <span>Back to Home</span>
        </Link>
      </div>

      {/* Top Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <Dropdown
          label="Favorite coin"
          placeholder="Select a coin"
          value={selectedSymbol}
          onChange={setSelectedSymbol}
          options={coinOptions.map((c) => ({
            label: `${c.name} (${c.symbol})`,
            value: c.symbol,
          }))}
        />

        <div className="flex items-center justify-between gap-3 sm:justify-start">
          <button
            type="button"
            onClick={goToPreviousMonth}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            ← Prev
          </button>
          <span className="min-w-[8rem] text-center text-sm font-semibold text-gray-900">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={goToNextMonth}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Next →
          </button>
        </div>
      </div>

      {/* Banners */}
      {!loading && coinOptions.length === 0 && (
        <AlertBanner
          variant="info"
          message="No coins are being monitored yet — add one from Manage Coins."
        />
      )}
      {error && (
        <AlertBanner
          variant="error"
          message={`Failed to load data: ${error}`}
        />
      )}
      {loading && <AlertBanner variant="info" message="Loading record data…" />}

      {/* Cards Display */}
      {!loading && !error && recordsWithData.length === 0 && selectedSymbol && (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          No records available for {selectedSymbol} in {monthLabel}.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {recordsWithData.map((record) => {
          const dateObj = new Date(record.date);
          const formattedDate = dateObj.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          });

          return (
            <div
              key={record.date}
              className="flex flex-col justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:border-gray-300 transition-colors"
            >
              <div className="flex items-center justify-between border-b border-gray-100 pb-2 mb-3">
                <span className="text-sm font-semibold text-gray-900">
                  {formattedDate}
                </span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {selectedSymbol}
                </span>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    High
                  </span>
                  <span className="font-semibold text-green-600 break-all text-right font-mono">
                    {formatPhp(record.high)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Low
                  </span>
                  <span className="font-semibold text-red-600 break-all text-right font-mono">
                    {formatPhp(record.low)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}