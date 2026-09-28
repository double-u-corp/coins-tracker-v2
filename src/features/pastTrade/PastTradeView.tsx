import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Dropdown from "@/components/Dropdown";
import AlertBanner from "@/components/AlertBanner";
import JournalSidebar from "../../features/chart/JournalSidebar";
import PastTradeInsightCard from "./PastTradeInsightCard";
import PastTradeScanPanel from "./PastTradeScanPanel";
import { usePastTradeLogic } from "./usePastTradeLogic";
import { formatPhp } from "@/lib/format";

const PriceLineChart = dynamic(() => import("../../features/chart/PriceLineChart"), {
  ssr: false,
  loading: () => (
    <div className="flex h-96 items-center justify-center text-sm text-gray-500">
      Loading chart…
    </div>
  ),
});

export default function PastTradeView() {
  const {
    coinOptions,
    allCoins,
    symbol,
    setSymbol,
    points,
    chartLoading,
    chartError,
    insufficientData,
    technicals,
    seriesDensity,
    entries,
    journalLoading,
    journalError,
    journalLabelsInView,
    addJournalEntry,
    deleteJournalEntry,
    updateJournalEntry,
    authenticated,
  } = usePastTradeLogic();

  const [showHigh, setShowHigh] = useState(true);
  const [showLow, setShowLow] = useState(true);
  const [showKeyLevels, setShowKeyLevels] = useState(true);

  const selectedCoin = useMemo(() => {
    return allCoins.find((c) => c.symbol === symbol) || null;
  }, [allCoins, symbol]);

  const currentPrice = useMemo(() => {
    if (selectedCoin?.currentPrice != null) {
      return selectedCoin.currentPrice;
    }
    if (points.length === 0) return 0;
    const lastPoint = points[points.length - 1];
    return (lastPoint.high + lastPoint.low) / 2;
  }, [selectedCoin, points]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
        >
          <span>←</span>
          <span>Back to Home</span>
        </Link>
      </div>

      <PastTradeScanPanel allCoins={allCoins} onSelectSymbol={setSymbol} />

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <Dropdown
          label="Coin"
          placeholder="Select a coin to analyse"
          value={symbol}
          onChange={setSymbol}
          options={coinOptions.map((c) => ({
            label: `${c.name} (${c.symbol})`,
            value: c.symbol,
          }))}
        />

        <div
          className={`flex flex-wrap items-center gap-1.5 rounded-md border border-gray-200 p-1 bg-white ${
            !symbol ? "opacity-50 pointer-events-none" : ""
          }`}
        >
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
        </div>

        <span className="text-xs text-gray-400">
          Intraday (recorded highs/lows) · leverage / margin / short — for fast trades, not the spot
          15-30 day swing view
        </span>
      </div>

      {!symbol ? (
        <div className="flex min-h-[250px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center">
          <div className="text-4xl mb-4">⚡</div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">No Coin Selected</h2>
          <p className="text-sm text-gray-500 max-w-sm">
            Use the dropdown above to select a cryptocurrency and view its intraday chart,
            entry/exit read, and your fast-trade journal — or run the scan above to find one.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {chartError && <AlertBanner variant="error" message={`Failed to load chart: ${chartError}`} />}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-purple-100 rounded-lg p-5 shadow-sm">
            <h2 className="text-xl font-bold text-gray-900 whitespace-nowrap">
              {selectedCoin?.name || symbol} ({symbol?.endsWith("PHP") ? symbol : `${symbol}PHP`})
            </h2>
            {currentPrice > 0 && (
              <div className="text-left sm:text-right border-t sm:border-0 border-gray-100 pt-3 sm:pt-0 w-full sm:w-auto mt-2 sm:mt-0">
                <div className="text-xs font-semibold uppercase text-gray-500">Current Price</div>
                <div className="text-2xl font-bold text-gray-900 font-mono">{formatPhp(currentPrice)}</div>
              </div>
            )}
          </div>

          <div className="w-full rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            {chartLoading ? (
              <div className="flex h-96 items-center justify-center text-sm text-gray-500">
                Loading chart…
              </div>
            ) : insufficientData ? (
              <div className="flex h-64 flex-col items-center justify-center text-center gap-2">
                <p className="text-sm text-gray-500">
                  Not enough intraday history for {symbol} yet.
                </p>
                <p className="text-xs text-gray-400">
                  {points.length} recorded point(s) available — need at least 20 for a basic read,
                  more for the 50/200 SMA to fill in.
                </p>
              </div>
            ) : (
              <PriceLineChart
                points={points}
                journalLabels={journalLabelsInView}
                showHigh={showHigh}
                showLow={showLow}
                showKeyLevels={showKeyLevels}
                support={technicals.support}
                resistance={technicals.resistance}
              />
            )}
          </div>

          <PastTradeInsightCard
            points={points}
            symbol={symbol}
            currentPrice={currentPrice}
            support={technicals.support}
            resistance={technicals.resistance}
            seriesDensity={seriesDensity}
          />

          <JournalSidebar
            entries={entries}
            loading={journalLoading}
            error={journalError}
            defaultSymbol={symbol}
            authenticated={authenticated}
            onAdd={addJournalEntry}
            onDelete={deleteJournalEntry}
            onUpdate={updateJournalEntry}
          />
        </div>
      )}
    </div>
  );
}
