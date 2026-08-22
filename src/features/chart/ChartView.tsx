import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Dropdown from "@/components/Dropdown";
import AlertBanner from "@/components/AlertBanner";
import JournalSidebar from "./JournalSidebar";
import { useChartLogic } from "./useChartLogic";
import type { ChartGranularity } from "@/lib/chartBucket";
import TradingInsightCard from "./TradingInsightCard";

const PriceLineChart = dynamic(() => import("./PriceLineChart"), {
  ssr: false,
  loading: () => <div className="flex h-96 items-center justify-center text-sm text-gray-500">Loading chart…</div>,
});

const YEAR_OPTIONS = [1, 2, 3, 4, 5].map((y) => ({ label: `${y} year${y > 1 ? "s" : ""}`, value: String(y) }));
const GRANULARITY_OPTIONS: { label: string; value: ChartGranularity }[] = [
  { label: "Daily", value: "daily" },
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

  // Display toggles
  const [showHigh, setShowHigh] = useState(true);
  const [showLow, setShowLow] = useState(true);
  const [showSma, setShowSma] = useState(false);
  const [showKeyLevels, setShowKeyLevels] = useState(true);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link 
          href="/" 
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
        >
          <span>←</span>
          <span>Back to Home</span>
        </Link>
      </div>

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

        {/* Display Toggles for Support, Resistance, & Indicators */}
        <div className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          <span>Analysis Overlays</span>
          <div className="inline-flex rounded-md border border-gray-200 p-1 gap-1">
            <button
              type="button"
              onClick={() => setShowHigh(!showHigh)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                showHigh ? "bg-green-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              High
            </button>
            <button
              type="button"
              onClick={() => setShowLow(!showLow)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                showLow ? "bg-red-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              Low
            </button>
            <button
              type="button"
              onClick={() => setShowKeyLevels(!showKeyLevels)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                showKeyLevels ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              Key Levels
            </button>
            <button
              type="button"
              onClick={() => setShowSma(!showSma)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                showSma ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              20 SMA
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex-1 space-y-4">
          {!symbol && <AlertBanner variant="info" message="Select a coin to see its price history." />}
          {chartError && <AlertBanner variant="error" message={`Failed to load chart: ${chartError}`} />}

          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            {chartLoading ? (
              <div className="flex h-96 items-center justify-center text-sm text-gray-500">Loading chart…</div>
            ) : (
              <PriceLineChart
                points={points}
                journalLabels={journalLabelsInView}
                showHigh={showHigh}
                showLow={showLow}
                showSma={showSma}
                showKeyLevels={showKeyLevels}
              />
            )}
          </div>

          <p className="text-xs text-gray-500">
            Each point represents prices recorded within that {granularity} period. Toggle <strong>Key Levels</strong> to see timeframe support/resistance floors, or <strong>20 SMA</strong> for dynamic trend support.
          </p>

          <TradingInsightCard points={points} symbol={symbol} />

          {/* How-to Trading Entry Decision Guide */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-700 shadow-sm">
            <h4 className="font-semibold text-gray-900 mb-2 text-sm">How These Additions Help Your Entry Decisions</h4>
            <ul className="space-y-2 list-disc list-inside text-gray-600">
              <li>
                <strong className="text-gray-800">Key Support &amp; Resistance Lines:</strong> Automatically finds and draws horizontal reference lines for the overall low (Support Floor) and overall high (Resistance Ceiling) in your selected timeframe. When daily price dips close to the lower green line, it signals potential value for ladder buys.
              </li>
              <li>
                <strong className="text-gray-800">20 SMA (Moving Average):</strong> Calculates a rolling average of price action. When the low price tests the 20 SMA line during an uptrend, it often acts as dynamic support.
              </li>
            </ul>
          </div>
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