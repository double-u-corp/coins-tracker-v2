import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Dropdown from "@/components/Dropdown";
import AlertBanner from "@/components/AlertBanner";
import JournalSidebar from "./JournalSidebar";
import TradingInsightCard from "./TradingInsightCard";
import { useChartLogic } from "./useChartLogic";
import { formatPhp } from "@/lib/format";
import type { ChartGranularity } from "@/lib/chartBucket";

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
  const [showBreakEven, setShowBreakEven] = useState(true);

  // Manual or quick-set average buy price input (PHP)
  const [avgEntryInput, setAvgEntryInput] = useState<string>("");

// Auto-compute average entry from journal notes/titles
const breakEvenPrice = useMemo(() => {
  if (!symbol || !entries || entries.length === 0) return null;

  // Filter entries for current active coin
  const coinEntries = entries.filter((e) => e.symbol === symbol);
  if (coinEntries.length === 0) return null;

  let totalQuantity = 0;
  let totalCost = 0;

  // Regex matches formats like: "10 @ 7350", "10 at 7350", "Qty: 10 Price: 7350"
  const buyPattern = /(?:bought|buy)?\s*([\d.]+)\s*(?:@|at|coins?|tokens?)\s*₱?\s*([\d.,]+)/i;

  for (const entry of coinEntries) {
    const text = `${entry.title} ${entry.notes}`;
    const match = text.match(buyPattern);

    if (match) {
      const qty = parseFloat(match[1]);
      const price = parseFloat(match[2].replace(/,/g, ""));

      if (!isNaN(qty) && !isNaN(price) && qty > 0 && price > 0) {
        totalQuantity += qty;
        totalCost += qty * price;
      }
    }
  }

  return totalQuantity > 0 ? totalCost / totalQuantity : null;
}, [entries, symbol]);

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

 {/* Display Toggles for Support, Resistance, SMA, & Auto Break-Even */}
<div className="flex flex-col gap-1 text-sm font-medium text-gray-700">
  <span>Analysis Overlays</span>
  <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-gray-200 p-1 bg-white">
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

    {/* Toggle button appears automatically whenever journal buy entries exist for the coin */}
    {breakEvenPrice !== null && (
      <button
        type="button"
        onClick={() => setShowBreakEven(!showBreakEven)}
        className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
          showBreakEven ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
        }`}
      >
        Avg Entry ({formatPhp(breakEvenPrice)})
      </button>
    )}
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
                showBreakEven={showBreakEven}
                breakEvenPrice={breakEvenPrice}
              />
            )}
          </div>

          <p className="text-xs text-gray-500">
            Each point represents prices recorded within that {granularity} period.
            {breakEvenPrice !== null && (
              <span> Blue dashed line indicates your target average entry price.</span>
            )}
          </p>

          <TradingInsightCard points={points} symbol={symbol} />
        </div>

<JournalSidebar
  entries={entries}
  loading={journalLoading}
  error={journalError}
  defaultSymbol={symbol}
  authenticated={authenticated}
  onAdd={addJournalEntry}
  onDelete={deleteJournalEntry}
/>
      </div>
    </div>
  );
}