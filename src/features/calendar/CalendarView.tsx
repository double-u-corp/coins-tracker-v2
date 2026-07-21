import Dropdown from "@/components/Dropdown";
import AlertBanner from "@/components/AlertBanner";
import { formatPhp } from "@/lib/format";
import { useCalendarLogic } from "./useCalendarLogic";
import type { DailyRecord } from "@/validators/recordSchema";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildMonthGrid(monthCursor: Date): (Date | null)[] {
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = firstDay.getDay();

  const cells: (Date | null)[] = Array(leadingBlanks).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(year, month, d));
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

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

  const daysByDate = new Map<string, DailyRecord>(days.map((d) => [d.date, d]));
  const cells = buildMonthGrid(monthCursor);
  const monthLabel = monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <Dropdown
          label="Favorite coin"
          placeholder="Select a coin"
          value={selectedSymbol}
          onChange={setSelectedSymbol}
          options={coinOptions.map((c) => ({ label: `${c.name} (${c.symbol})`, value: c.symbol }))}
        />

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={goToPreviousMonth}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            ← Prev
          </button>
          <span className="min-w-[10rem] text-center text-sm font-semibold text-gray-900">{monthLabel}</span>
          <button
            type="button"
            onClick={goToNextMonth}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Next →
          </button>
        </div>
      </div>

      {!loading && coinOptions.length === 0 && (
        <AlertBanner variant="info" message="No coins are being monitored yet — add one from Manage Coins." />
      )}
      {error && <AlertBanner variant="error" message={`Failed to load calendar data: ${error}`} />}
      {loading && <AlertBanner variant="info" message="Loading calendar data…" />}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="px-2 py-2 text-center text-xs font-semibold uppercase text-gray-500">
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((date, idx) => {
            if (!date) {
              return <div key={idx} className="min-h-[90px] border-b border-r border-gray-100 bg-gray-50" />;
            }
            const record = daysByDate.get(toDateKey(date));
            return (
              <div key={idx} className="min-h-[90px] border-b border-r border-gray-100 p-2">
                <div className="text-xs font-semibold text-gray-500">{date.getDate()}</div>
                {record && selectedSymbol && (
                  <div className="mt-1 space-y-0.5 text-[11px] leading-tight">
                    <div className="font-medium text-green-700">H {formatPhp(record.high)}</div>
                    <div className="font-medium text-red-700">L {formatPhp(record.low)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
