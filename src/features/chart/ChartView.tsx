import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Dropdown from "@/components/Dropdown";
import AlertBanner from "@/components/AlertBanner";
import JournalSidebar from "./JournalSidebar";
import TradingInsightCard from "./TradingInsightCard";
import DCACalculator from "./DCACalculator";
import { useChartLogic, type ChartRange } from "./useChartLogic";
import { formatPhp } from "@/lib/format";
import { getSupportResistance, BIAS_BADGE_CLASSES, BIAS_PRIORITY, isLongExtended, isWatchlistBuyLowHit, isNearSupportWorthCheck } from "./Technicals";
import { useCoinScanner, formatScanResultsForJournal, formatSingleScanResult } from "./useCoinScanner";

const PriceLineChart = dynamic(() => import("./PriceLineChart"), {
  ssr: false,
  loading: () => (
    <div className="flex h-96 items-center justify-center text-sm text-gray-500">
      Loading chart…
    </div>
  ),
});

const RANGE_OPTIONS: { label: string; value: ChartRange }[] = [
  { label: "1M", value: "1m" },
  { label: "3M", value: "3m" },
  { label: "6M", value: "6m" },
  { label: "1Y", value: "1y" },
  { label: "3Y", value: "3y" },
];

export default function ChartView() {
  const {
    coinOptions,
    allCoins,
    symbol,
    setSymbol,
    range,
    setRange,
    points,
    chartLoading,
    chartError,
    intradayPoints,
    confluencePoints,
    entries,
    journalLoading,
    journalError,
    journalLabelsInView,
    addJournalEntry,
    deleteJournalEntry,
    updateJournalEntry,
    authenticated,
    transactions,
    portfolio,
  } = useChartLogic();

  const [showHigh, setShowHigh] = useState(true);
  const [showLow, setShowLow] = useState(true);
  const [showKeyLevels, setShowKeyLevels] = useState(true);
  const [showAllScanResults, setShowAllScanResults] = useState(false);
  const [scanCopied, setScanCopied] = useState(false);
  const [cardCopiedSymbol, setCardCopiedSymbol] = useState<string | null>(null);

  const { scanResults, isScanning, scanProgress, scanError, hasScanned, runScan } = useCoinScanner(allCoins);

  const sortedScanResults = useMemo(() => {
    return [...scanResults].sort((a, b) => {
      // 0 = primary buy-low hit, 1 = near-support worth-check, 2 = other
      const tier = (r: (typeof scanResults)[number]) => {
        if (!r.confluence) return 2;
        if (isWatchlistBuyLowHit(r.confluence)) return 0;
        if (isNearSupportWorthCheck(r.confluence)) return 1;
        return 2;
      };
      const at = tier(a);
      const bt = tier(b);
      if (at !== bt) return at - bt;
      const aBias = a.confluence?.bias ?? "INSUFFICIENT DATA";
      const bBias = b.confluence?.bias ?? "INSUFFICIENT DATA";
      const priorityDiff = BIAS_PRIORITY[aBias] - BIAS_PRIORITY[bBias];
      if (priorityDiff !== 0) return priorityDiff;
      const aExt = a.confluence ? (isLongExtended(a.confluence) ? 1 : 0) : 0;
      const bExt = b.confluence ? (isLongExtended(b.confluence) ? 1 : 0) : 0;
      if (aExt !== bExt) return aExt - bExt;
      const aScore = a.confluence?.score ?? 0;
      const bScore = b.confluence?.score ?? 0;
      return bScore - aScore;
    });
  }, [scanResults]);

  const visibleScanResults = showAllScanResults
    ? sortedScanResults
    : sortedScanResults.filter((r) => {
        if (r.error) return true;
        if (!r.confluence) return false;
        // Primary hits + secondary near-support plugs (not priority)
        return isWatchlistBuyLowHit(r.confluence) || isNearSupportWorthCheck(r.confluence);
      });

  const directionalSignalCount = scanResults.filter(
    (r) => !!r.confluence && isWatchlistBuyLowHit(r.confluence)
  ).length;

  const worthCheckCount = scanResults.filter(
    (r) =>
      !!r.confluence &&
      !isWatchlistBuyLowHit(r.confluence) &&
      isNearSupportWorthCheck(r.confluence)
  ).length;

  const handleCopyScanResults = () => {
    const text = formatScanResultsForJournal(scanResults);
    navigator.clipboard.writeText(text);
    setScanCopied(true);
    setTimeout(() => setScanCopied(false), 2000);
  };

  const handleCopyCard = (r: (typeof scanResults)[number]) => {
    navigator.clipboard.writeText(formatSingleScanResult(r));
    setCardCopiedSymbol(r.symbol);
    setTimeout(() => setCardCopiedSymbol(null), 2000);
  };

  const selectedCoin = useMemo(() => {
    return allCoins.find((c) => c.symbol === symbol) || null;
  }, [allCoins, symbol]);

  const activePortfolio = useMemo(() => {
    if (!symbol || !portfolio) return null;
    return portfolio.find((p) => p.symbol === symbol) || null;
  }, [symbol, portfolio]);

  const currentPrice = useMemo(() => {
    if (selectedCoin?.currentPrice != null) {
      return selectedCoin.currentPrice;
    }
    if (points.length === 0) return 0;
    const lastPoint = points[points.length - 1];
    return (lastPoint.high + lastPoint.low) / 2;
  }, [selectedCoin, points]);

  const swingRanks = useMemo(() => {
    if (!allCoins || allCoins.length === 0) return new Map<string, number>();

    const ranked = [...allCoins]
      .map((coin) => {
        const high = coin.targetHigh;
        const low = coin.targetLow;
        let swingPercent = 0;
        if (high != null && low != null && low > 0) {
          swingPercent = ((high - low) / low) * 100;
        }
        return { symbol: coin.symbol, swingPercent };
      })
      .sort((a, b) => b.swingPercent - a.swingPercent);

    const map = new Map<string, number>();
    ranked.forEach((item, idx) => {
      map.set(item.symbol, idx + 1);
    });
    return map;
  }, [allCoins]);

  const coinRank = useMemo(() => {
    if (!symbol) return null;
    return swingRanks.get(symbol) ?? null;
  }, [symbol, swingRanks]);

  const coinTransactions = useMemo(() => {
    if (!symbol || !transactions) return [];
    return transactions
      .filter((tx) => tx.symbol === symbol)
      .sort((a, b) => new Date(b.transactedAt).getTime() - new Date(a.transactedAt).getTime());
  }, [symbol, transactions]);

  const technicals = useMemo(() => {
    if (points.length === 0) return { support: null, resistance: null };
    return getSupportResistance(points, 30);
  }, [points]);

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

        {symbol && (
          <div className="flex items-center gap-2">
            <Link
              href={`/calendar?symbol=${symbol}`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-md hover:bg-purple-100 transition-colors"
            >
              <span>📅</span>
              <span>View Calendar</span>
            </Link>

            <Link
              href={`/manage?symbol=${symbol}`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-md hover:bg-emerald-100 transition-colors"
            >
              <span>⚙️</span>
              <span>Manage Coin</span>
            </Link>
          </div>
        )}
      </div>

      {/* Watchlist Scan — check every tracked coin's confluence signal at once
          instead of clicking through the dropdown one by one */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <span>📡</span> Watchlist Scan
            </h2>
            <p className="text-xs text-gray-500">
              Check every tracked coin's confluence signal at once — click a result to load its full chart below.
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Suggested: ~08:15 and ~20:15 Manila
            </p>
          </div>
          <button
            type="button"
            onClick={runScan}
            disabled={isScanning || allCoins.length === 0}
            className="px-4 py-2 rounded-md text-sm font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap shadow-sm"
          >
            {isScanning ? `Scanning ${scanProgress.completed}/${scanProgress.total}…` : "🔍 Scan All Coins"}
          </button>
        </div>

        {scanError && <AlertBanner variant="error" message={`Scan failed: ${scanError}`} />}

        {hasScanned && !isScanning && (
          <div className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-[11px] text-gray-400">
                {visibleScanResults.length} of {sortedScanResults.length} coins shown
                {!showAllScanResults && " (hits + near-support worth-check)"}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCopyScanResults}
                  disabled={directionalSignalCount === 0}
                  title={
                    directionalSignalCount === 0
                      ? "No LONG/SHORT signals to copy right now"
                      : "Copy full details of LONG/SHORT signals for your journal"
                  }
                  className="text-[11px] font-semibold text-white bg-gray-700 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed rounded px-2.5 py-1 transition"
                >
                  {scanCopied ? "✅ Copied!" : `📋 Copy for Journal (${directionalSignalCount})`}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAllScanResults((v) => !v)}
                  className="text-[11px] font-medium text-purple-700 hover:underline"
                >
                  {showAllScanResults ? "Show buy-low hits only" : "Show all coins"}
                </button>
              </div>
            </div>

            {visibleScanResults.length === 0 ? (
              <p className="text-xs text-gray-500 py-2">
                No buy-low watchlist hits right now — no LONG/NEUTRAL coin is near support or in the lower third of range.
                Try "Show all coins" to see the full breakdown.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {visibleScanResults.map((r) => (
                  <div
                    key={r.symbol}
                    className={`rounded-md border p-2.5 transition hover:shadow-sm ${
                      symbol === r.symbol ? "ring-2 ring-purple-400" : ""
                    } ${r.error ? "border-gray-200 bg-gray-50" : "border-gray-200 bg-white"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setSymbol(r.symbol)}
                        className="text-xs font-bold text-gray-900 hover:underline text-left"
                        title={`Load ${r.symbol} chart`}
                      >
                        {r.symbol}
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        {r.streak >= 2 && (
                          <span
                            className="rounded-md border border-orange-300 bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold text-orange-700"
                            title={`${r.streak} consecutive scan runs with the same signal direction`}
                          >
                            🔥{r.streak}
                          </span>
                        )}
                        {r.confluence &&
                          !isWatchlistBuyLowHit(r.confluence) &&
                          isNearSupportWorthCheck(r.confluence) && (
                            <span
                              className="rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-800"
                              title="Near support — secondary watch, not a priority hit"
                            >
                              📌 Check
                            </span>
                          )}
                        {r.confluence && (
                          <span
                            className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${
                              BIAS_BADGE_CLASSES[r.confluence.bias]
                            }`}
                          >
                            {r.confluence.bias}
                          </span>
                        )}
                        {r.confluence && (
                          <button
                            type="button"
                            onClick={() => handleCopyCard(r)}
                            title="Copy this coin's full details"
                            className="text-[11px] px-1.5 py-0.5 rounded hover:bg-gray-100 text-gray-500"
                          >
                            {cardCopiedSymbol === r.symbol ? "✅" : "📋"}
                          </button>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSymbol(r.symbol)}
                      className="block w-full text-left mt-1"
                      title={`Load ${r.symbol} chart`}
                    >
                      {r.error ? (
                        <p className="text-[10px] text-red-500">Failed to load</p>
                      ) : r.confluence ? (
                        <p className="text-[10px] text-gray-500">
                          Score {r.confluence.score >= 0 ? "+" : ""}
                          {r.confluence.score}/±{r.confluence.maxPossibleScore} ·{" "}
                          {(r.confluence.confidence * 100).toFixed(0)}% data
                          <br />
                          {isWatchlistBuyLowHit(r.confluence) ? (
                            isLongExtended(r.confluence) ? (
                              <span className="text-amber-700 font-semibold">
                                ⏳ Extended — wait for pullback into ladder
                              </span>
                            ) : r.confluence.bias.includes("LONG") ? (
                              <span className="text-emerald-700 font-medium">
                                Near ladder / ready to stage
                              </span>
                            ) : (
                              <span className="text-emerald-700/90 font-medium">
                                Buy-low zone — watch for confirmation
                              </span>
                            )
                          ) : isNearSupportWorthCheck(r.confluence) ? (
                            <span className="text-sky-700 font-medium">
                              📌 Worth to check — near support / key level
                            </span>
                          ) : r.confluence.bias.includes("SHORT") ? (
                            <span className="text-rose-600 font-medium">
                              Hold cash — do not buy
                            </span>
                          ) : isLongExtended(r.confluence) ? (
                            <span className="text-amber-700 font-semibold">
                              ⏳ Extended — wait for pullback into ladder
                            </span>
                          ) : r.confluence.bias.includes("LONG") ? (
                            <span className="text-emerald-700 font-medium">
                              Near ladder / ready to stage
                            </span>
                          ) : null}
                          <br />
                          <span className="text-gray-400">
                            {new Date(r.scannedAt).toLocaleTimeString("en-US", {
                              timeZone: "Asia/Manila",
                              hour: "numeric",
                              minute: "2-digit",
                            })}{" "}
                            Manila
                          </span>
                        </p>
                      ) : (
                        <p className="text-[10px] text-gray-400">No data</p>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

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

        <div className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          <span>Range</span>
          <div
            className={`inline-flex rounded-md border border-gray-200 p-1 bg-white ${
              !symbol ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRange(opt.value)}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  range === opt.value
                    ? "bg-brand-600 text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          <span>Analysis Overlays</span>
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
                showKeyLevels
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              Key Levels
            </button>
          </div>
        </div>
      </div>

      {!symbol ? (
        <div className="space-y-6">
          <div className="flex min-h-[250px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center">
            <div className="text-4xl mb-4">📈</div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">No Coin Selected</h2>
            <p className="text-sm text-gray-500 max-w-sm">
              Use the dropdown above to select a cryptocurrency to view its chart history, technical insights, and your trade logs.
            </p>
          </div>

          {/* General Journal Block displayed when no coin is selected */}
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900">🌍 General Market Journal &amp; Notes</h3>
                <p className="text-xs text-gray-500 mt-0.5">Track macro updates, news, and notes not tied to a specific coin.</p>
              </div>
            </div>

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
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {chartError && <AlertBanner variant="error" message={`Failed to load chart: ${chartError}`} />}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-purple-100 rounded-lg p-5 shadow-sm">
            <div className="flex flex-row items-center gap-3 flex-wrap sm:flex-nowrap">
              {coinRank !== null && (
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-1 rounded-md whitespace-nowrap">
                  <span>Rank #{coinRank}</span>
                  {coinRank === 1 && <span className="font-medium text-purple-600 hidden sm:inline">(Highest Swing)</span>}
                </div>
              )}
              
              <h2 className="text-xl font-bold text-gray-900 whitespace-nowrap">
                {selectedCoin?.name || symbol} ({symbol?.endsWith('PHP') ? symbol : `${symbol}PHP`})
              </h2>
            </div>

            {currentPrice > 0 && (
              <div className="text-left sm:text-right border-t sm:border-0 border-gray-100 pt-3 sm:pt-0 w-full sm:w-auto mt-2 sm:mt-0">
                <div className="text-xs font-semibold uppercase text-gray-500">Current Price</div>
                <div className="text-2xl font-bold text-gray-900 font-mono">
                  {formatPhp(currentPrice)}
                </div>
              </div>
            )}
          </div>

          <div className="w-full rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            {chartLoading ? (
              <div className="flex h-96 items-center justify-center text-sm text-gray-500">
                Loading chart…
              </div>
            ) : (
              <PriceLineChart
                points={points}
                journalLabels={journalLabelsInView}
                showHigh={showHigh}
                showLow={showLow}
                showKeyLevels={showKeyLevels}
                showBreakEven={!!activePortfolio && activePortfolio.holdings > 0 && activePortfolio.spent > 0}
                breakEvenPrice={
                  activePortfolio && activePortfolio.holdings > 0 && activePortfolio.spent > 0
                    ? activePortfolio.spent / activePortfolio.holdings
                    : null
                }
                support={technicals.support}
                resistance={technicals.resistance}
                intradayPoints={intradayPoints}
              />
            )}
          </div>

          <TradingInsightCard
            points={confluencePoints.length > 0 ? confluencePoints : points}
            symbol={symbol}
            activePortfolio={activePortfolio}
            support={undefined}
            resistance={undefined}
            currentPrice={currentPrice}
            intradayPoints={intradayPoints}
          />

          <DCACalculator
            symbol={symbol}
            currentPrice={currentPrice}
            portfolio={activePortfolio}
            support={technicals.support}
            resistance={technicals.resistance}
          />

          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              Transaction History <span className="text-brand-600">({symbol})</span>
            </h3>
            {coinTransactions.length === 0 ? (
              <p className="text-xs text-gray-500">No transactions recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Price</th>
                      <th className="px-3 py-2 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {coinTransactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-500">
                          {new Date(tx.transactedAt).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              tx.type === "buy" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                            }`}
                          >
                            {tx.type}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-800">{tx.coinAmount}</td>
                        <td className="px-3 py-2 text-gray-600">{formatPhp(tx.price)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-900">
                          {formatPhp(tx.phpAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

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