import { useMemo } from "react";
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

/** Structure page — Spot companion for entry ladder from poll prices. */
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

  const selectedCoin = useMemo(() => {
    return allCoins.find((c) => c.symbol === symbol) || null;
  }, [allCoins, symbol]);

  const currentPrice = useMemo(() => {
    if (selectedCoin?.currentPrice != null) return selectedCoin.currentPrice;
    if (points.length === 0) return 0;
    const last = points[points.length - 1];
    return last.close ?? (last.high + last.low) / 2;
  }, [selectedCoin, points]);

  // Client render window (~100 points) — full series still used for ladder in insight card
  const chartPoints = useMemo(() => {
    if (points.length <= 100) return points;
    return points.slice(-100);
  }, [points]);

  const sparseNote =
    seriesDensity.avgRecentGapHours != null && seriesDensity.avgRecentGapHours > 12
      ? "Wider gaps in older history are normal (pre every-poll logging). Recent prints are denser."
      : null;

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
        <div className="flex flex-wrap items-center gap-2">
          {symbol ? (
            <Link
              href={`/chart?symbol=${encodeURIComponent(symbol)}`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-md hover:bg-purple-100 transition-colors"
            >
              📈 Spot chart
            </Link>
          ) : null}
          <Link
            href="/chart"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 border border-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50"
          >
            All Spot
          </Link>
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
        <span className="font-bold">How to use:</span> Decide buy / wait / cash on{" "}
        <Link href="/chart" className="font-semibold text-purple-700 hover:underline">
          Spot
        </Link>
        . This page only refines the <span className="font-semibold">entry ladder</span> from poll
        prices — not a second bias system.
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
      </div>

      {!symbol ? (
        <div className="flex min-h-[250px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center">
          <div className="text-4xl mb-4">🔎</div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">No coin selected</h2>
          <p className="text-sm text-gray-500 max-w-sm">
            Select a coin for poll-price structure and ladder. Confirm buy/wait on Spot first.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {chartError ? (
            <AlertBanner variant="error" message={`Failed to load chart: ${chartError}`} />
          ) : null}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-purple-100 rounded-lg p-5 shadow-sm">
            <h2 className="text-xl font-bold text-gray-900 whitespace-nowrap">
              {selectedCoin?.name || symbol} (
              {symbol.endsWith("PHP") ? symbol : `${symbol}PHP`})
            </h2>
            {currentPrice > 0 ? (
              <div className="text-left sm:text-right border-t sm:border-0 border-gray-100 pt-3 sm:pt-0 w-full sm:w-auto mt-2 sm:mt-0">
                <div className="text-xs font-semibold uppercase text-gray-500">Current Price</div>
                <div className="text-2xl font-bold text-gray-900 font-mono">
                  {formatPhp(currentPrice)}
                </div>
              </div>
            ) : null}
          </div>

          {sparseNote ? (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
              {sparseNote}
            </p>
          ) : null}

          <div className="w-full rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            {chartLoading ? (
              <div className="flex h-96 items-center justify-center text-sm text-gray-500">
                Loading chart…
              </div>
            ) : insufficientData ? (
              <div className="flex h-64 flex-col items-center justify-center text-center gap-2">
                <p className="text-sm text-gray-500">Not enough poll history for {symbol} yet.</p>
                <p className="text-xs text-gray-400">
                  {points.length} print(s) available — denser after every-poll logging accumulates.
                </p>
              </div>
            ) : (
              <PriceLineChart
                points={chartPoints}
                journalLabels={journalLabelsInView}
                showHigh={true}
                showLow={false}
                showKeyLevels={false}
                priceLineName="Price"
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
