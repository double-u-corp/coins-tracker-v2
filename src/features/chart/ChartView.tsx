import dynamic from "next/dynamic";
import Dropdown from "@/components/Dropdown";
import AlertBanner from "@/components/AlertBanner";
import JournalSidebar from "./JournalSidebar";
import { useChartLogic, type Granularity } from "./useChartLogic";

// recharts' ResponsiveContainer needs real DOM measurements, so the chart
// itself is only ever rendered client-side.
const PriceLineChart = dynamic(() => import("./PriceLineChart"), {
  ssr: false,
  loading: () => <div className="flex h-96 items-center justify-center text-sm text-gray-500">Loading chart…</div>,
});

const YEAR_OPTIONS = [1, 2, 3, 4, 5].map((y) => ({ label: `${y} year${y > 1 ? "s" : ""}`, value: String(y) }));
const GRANULARITY_OPTIONS: { label: string; value: Granularity }[] = [
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
  { label: "Yearly", value: "yearly" },
];

export default function ChartView() {
  const {
    coinOptions,
    symbol,
    setSymbol,
    years,
    setYears,
    granularity,
    setGranularity,
    points,
    chartLoading,
    chartError,
    entries,
    journalLoading,
    journalError,
    journalLabelsInView,
    addJournalEntry,
    deleteJournalEntry,
    authenticated,
  } = useChartLogic();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <Dropdown
          label="Coin"
          placeholder="Select a coin"
          value={symbol}
          onChange={setSymbol}
          options={coinOptions.map((c) => ({ label: `${c.name} (${c.symbol})`, value: c.symbol }))}
        />

        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          <span>Range</span>
          <select
            value={years}
            onChange={(e) => setYears(Number(e.target.value))}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {YEAR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          <span>View</span>
          <div className="inline-flex rounded-md border border-gray-200 p-1">
            {GRANULARITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setGranularity(opt.value)}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  granularity === opt.value ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex-1">
          {!symbol && <AlertBanner variant="info" message="Select a coin to see its price history." />}
          {chartError && <AlertBanner variant="error" message={`Failed to load chart: ${chartError}`} />}

          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            {chartLoading ? (
              <div className="flex h-96 items-center justify-center text-sm text-gray-500">Loading chart…</div>
            ) : (
              <PriceLineChart points={points} journalLabels={journalLabelsInView} />
            )}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Each point is the highest and lowest price recorded within that {granularity.replace("ly", "")} —
            not the running all-time high/low shown on Home. 📓 markers show where a journal entry falls.
          </p>
        </div>

        <JournalSidebar
          entries={entries}
          loading={journalLoading}
          error={journalError}
          coinOptions={coinOptions}
          defaultSymbol={symbol}
          authenticated={authenticated}
          onAdd={addJournalEntry}
          onDelete={deleteJournalEntry}
        />
      </div>
    </div>
  );
}
