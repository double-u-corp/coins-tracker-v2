import { useState } from "react";
import Link from "next/link";
import Dropdown from "@/components/Dropdown";
import AlertBanner from "@/components/AlertBanner";
import { formatPhp } from "@/lib/format";
import { useCalendarLogic } from "./useCalendarLogic";

export default function CalendarView() {
  const {
    coinOptions,
    selectedSymbol,
    setSelectedSymbol,
    monthCursor,
    goToPreviousMonth,
    goToNextMonth,
    days,
    allCoinsData,
    loading,
    error,
  } = useCalendarLogic();

  // New state for sorting market overview cards
  const [marketSortBy, setMarketSortBy] = useState<string>("volatility-desc");

  const monthLabel = monthCursor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const formatDateShort = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  // --- SINGLE COIN MODE PROCESSING ---
  const recordsWithData = days
    .filter((d) => d.high != null && d.low != null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const monthHighest = recordsWithData.length > 0 ? Math.max(...recordsWithData.map((d) => d.high as number)) : null;
  const monthLowest = recordsWithData.length > 0 ? Math.min(...recordsWithData.map((d) => d.low as number)) : null;
  const highestRecord = recordsWithData.find((d) => d.high === monthHighest);
  const lowestRecord = recordsWithData.find((d) => d.low === monthLowest);
  const volatilitySpread = monthHighest && monthLowest && monthLowest > 0 ? ((monthHighest - monthLowest) / monthLowest) * 100 : 0;

  // --- ALL COINS COMPUTED SPREADS & SORTING ---
  const coinCardsData = coinOptions.map((coin) => {
    const coinDays = (allCoinsData[coin.symbol] || []).filter(
      (d) => d.high != null && d.low != null
    );

    const coinHigh = coinDays.length > 0 ? Math.max(...coinDays.map((d) => d.high as number)) : null;
    const coinLow = coinDays.length > 0 ? Math.min(...coinDays.map((d) => d.low as number)) : null;
    const highRec = coinDays.find((d) => d.high === coinHigh);
    const lowRec = coinDays.find((d) => d.low === coinLow);
    const spread = coinHigh && coinLow && coinLow > 0 ? ((coinHigh - coinLow) / coinLow) * 100 : 0;

    return { coin, coinDays, coinHigh, coinLow, highRec, lowRec, spread };
  });

  // Sort based on marketSortBy selection
  const sortedCoinCards = [...coinCardsData].sort((a, b) => {
    if (marketSortBy === "volatility-desc") return b.spread - a.spread;
    if (marketSortBy === "volatility-asc") return a.spread - b.spread;
    if (marketSortBy === "name") return a.coin.name.localeCompare(b.coin.name);
    return 0;
  });

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

      {/* Top Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4 flex-1">
          <Dropdown
            label="Favorite coin"
            placeholder="All Coins (Market Overview)"
            value={selectedSymbol}
            onChange={setSelectedSymbol}
            options={[
              { label: "🌐 All Coins (Market Overview)", value: "" },
              ...coinOptions.map((c) => ({
                label: `${c.name} (${c.symbol})`,
                value: c.symbol,
              })),
            ]}
          />

          {/* Secondary Sort Dropdown (Visible only in Market Overview Mode) --> */}
          {!selectedSymbol && (
            <Dropdown
              label="Sort market by"
              placeholder="Sort order"
              value={marketSortBy}
              onChange={setMarketSortBy}
              options={[
                { label: "🔥 Highest Volatility (Swing)", value: "volatility-desc" },
                { label: "❄️ Lowest Volatility (Swing)", value: "volatility-asc" },
                { label: "🔤 Coin Name (A-Z)", value: "name" },
              ]}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-3 sm:justify-start">
          <button
            type="button"
            onClick={goToPreviousMonth}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ← Prev
          </button>
          <span className="min-w-[8rem] text-center text-sm font-semibold text-gray-900">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={goToNextMonth}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
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

      {/* SINGLE COIN SUMMARY BAR */}
      {!loading && !error && selectedSymbol && recordsWithData.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row gap-4 bg-gray-50 border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="flex-1 flex items-center justify-between bg-white border border-green-200 p-3 rounded-md shadow-sm">
              <div>
                <span className="text-xs font-bold uppercase text-green-700 flex items-center gap-1.5">
                  <span>🏆</span> Month High
                </span>
                {highestRecord && (
                  <span className="text-[11px] font-medium text-gray-500">
                    {formatDateShort(highestRecord.date)}
                  </span>
                )}
              </div>
              <span className="text-lg font-bold text-green-700 font-mono">
                {formatPhp(monthHighest as number)}
              </span>
            </div>

            <div className="flex-1 flex items-center justify-between bg-white border border-red-200 p-3 rounded-md shadow-sm">
              <div>
                <span className="text-xs font-bold uppercase text-red-700 flex items-center gap-1.5">
                  <span>📉</span> Month Low
                </span>
                {lowestRecord && (
                  <span className="text-[11px] font-medium text-gray-500">
                    {formatDateShort(lowestRecord.date)}
                  </span>
                )}
              </div>
              <span className="text-lg font-bold text-red-700 font-mono">
                {formatPhp(monthLowest as number)}
              </span>
            </div>

            <div className="flex-1 flex items-center justify-between bg-white border border-blue-200 p-3 rounded-md shadow-sm">
              <div>
                <span className="text-xs font-bold uppercase text-blue-700 flex items-center gap-1.5">
                  <span>📊</span> Monthly Swing
                </span>
                <span className="text-[11px] font-medium text-gray-500">
                  High-to-Low Spread
                </span>
              </div>
              <span className="text-lg font-bold text-blue-700 font-mono">
                {volatilitySpread.toFixed(1)}%
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 text-xs text-blue-900">
            <h4 className="font-bold mb-1 flex items-center gap-1.5">
              <span>💡</span> How to use this Monthly Swing ({volatilitySpread.toFixed(1)}%):
            </h4>
            <ul className="list-disc list-inside space-y-1 text-blue-800">
              {volatilitySpread > 20 ? (
                <li><strong>High Volatility Detected:</strong> Wide channel swings. Avoid chasing pumps mid-month; wait patiently for prices to bleed down toward the Month Low before deploying your fixed cash budgets.</li>
              ) : (
                <li><strong>Stable / Tight Range:</strong> Lower volatility spread. Look for clean breakouts or use standard support-level ladder buys.</li>
              )}
              <li>Use the <strong>Month High date</strong> to track when distribution happened, and the <strong>Month Low date</strong> to benchmark your support floors.</li>
            </ul>
          </div>
        </div>
      )}

      {/* ALL COINS OVERVIEW BANNER */}
      {!loading && !error && !selectedSymbol && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 text-xs text-purple-900 flex items-center justify-between">
          <div>
            <h4 className="font-bold text-purple-900 text-sm flex items-center gap-1.5">
              <span>🌐</span> All Coins Market Overview ({monthLabel})
            </h4>
            <p className="text-purple-700 mt-0.5">
              Comparing monthly highs, lows, and volatility swing spreads across all monitored coins. Sorted by active ranking preference.
            </p>
          </div>
        </div>
      )}

      {/* DISPLAY MODE 1: SINGLE COIN GRID */}
      {!loading && !error && selectedSymbol && recordsWithData.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {recordsWithData.map((record) => {
            const dateObj = new Date(record.date);
            const formattedDate = dateObj.toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            });

            const isMonthHigh = record.high === monthHighest;
            const isMonthLow = record.low === monthLowest;

            return (
              <div
                key={record.date}
                className={`flex flex-col justify-between rounded-lg border bg-white p-4 transition-colors ${
                  isMonthHigh || isMonthLow ? "border-gray-400 shadow-md" : "border-gray-200 shadow-sm hover:border-gray-300"
                }`}
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
                  <div className={`flex items-baseline justify-between gap-2 rounded px-2 py-1.5 ${isMonthHigh ? "bg-green-50 border border-green-200" : ""}`}>
                    <span className={`text-xs font-medium uppercase tracking-wide flex items-center gap-1 ${isMonthHigh ? "text-green-800 font-bold" : "text-gray-500"}`}>
                      {isMonthHigh && <span>🏆</span>} High
                    </span>
                    <span className={`break-all text-right font-mono ${isMonthHigh ? "font-bold text-green-700" : "font-semibold text-green-600"}`}>
                      {formatPhp(record.high)}
                    </span>
                  </div>
                  
                  <div className={`flex items-baseline justify-between gap-2 rounded px-2 py-1.5 ${isMonthLow ? "bg-red-50 border border-red-200" : ""}`}>
                    <span className={`text-xs font-medium uppercase tracking-wide flex items-center gap-1 ${isMonthLow ? "text-red-800 font-bold" : "text-gray-500"}`}>
                      {isMonthLow && <span>📉</span>} Low
                    </span>
                    <span className={`break-all text-right font-mono ${isMonthLow ? "font-bold text-red-700" : "font-semibold text-red-600"}`}>
                      {formatPhp(record.low)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* DISPLAY MODE 2: SORTED ALL COINS SUMMARY CARDS GRID */}
      {!loading && !error && !selectedSymbol && sortedCoinCards.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedCoinCards.map(({ coin, coinDays, coinHigh, coinLow, highRec, lowRec, spread }) => (
            <div
              key={coin.symbol}
              className="flex flex-col justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:border-gray-300 transition-colors"
            >
              <div className="flex items-center justify-between border-b border-gray-100 pb-2 mb-3">
                <span className="text-sm font-bold text-gray-900">
                  {coin.name}
                </span>
                <span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-700 font-mono">
                  {coin.symbol}
                </span>
              </div>

              {coinDays.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-400 italic">
                  No data for {monthLabel}
                </div>
              ) : (
                <div className="space-y-3 text-sm">
                  {/* Month High */}
                  <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded p-2">
                    <div>
                      <span className="text-xs font-bold uppercase text-green-800 flex items-center gap-1">
                        <span>🏆</span> Month High
                      </span>
                      {highRec && (
                        <span className="text-[11px] font-medium text-gray-500">
                          {formatDateShort(highRec.date)}
                        </span>
                      )}
                    </div>
                    <span className="font-bold text-green-700 font-mono text-sm">
                      {coinHigh != null ? formatPhp(coinHigh) : "—"}
                    </span>
                  </div>

                  {/* Month Low */}
                  <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded p-2">
                    <div>
                      <span className="text-xs font-bold uppercase text-red-800 flex items-center gap-1">
                        <span>📉</span> Month Low
                      </span>
                      {lowRec && (
                        <span className="text-[11px] font-medium text-gray-500">
                          {formatDateShort(lowRec.date)}
                        </span>
                      )}
                    </div>
                    <span className="font-bold text-red-700 font-mono text-sm">
                      {coinLow != null ? formatPhp(coinLow) : "—"}
                    </span>
                  </div>

                  {/* Monthly Swing Spread */}
                  <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded p-2">
                    <div>
                      <span className="text-xs font-bold uppercase text-blue-800 flex items-center gap-1">
                        <span>📊</span> Monthly Swing
                      </span>
                      <span className="text-[11px] font-medium text-gray-500">
                        High-to-Low Spread
                      </span>
                    </div>
                    <span className="font-bold text-blue-700 font-mono text-sm">
                      {spread.toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty States */}
      {!loading && !error && selectedSymbol && recordsWithData.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          No records available for {selectedSymbol} in {monthLabel}.
        </div>
      )}
    </div>
  );
}