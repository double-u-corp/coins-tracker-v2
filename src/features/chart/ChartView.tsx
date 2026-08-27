import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Dropdown from "@/components/Dropdown";
import AlertBanner from "@/components/AlertBanner";
import JournalSidebar from "./JournalSidebar";
import TradingInsightCard from "./TradingInsightCard";
import DCACalculator from "./DCACalculator";
import StrategyPlaybook from "./StrategyPlaybook"
import { useChartLogic, type ChartRange } from "./useChartLogic";
import { formatPhp } from "@/lib/format";

const PriceLineChart = dynamic(() => import("./PriceLineChart"), {
  ssr: false,
  loading: () => <div className="flex h-96 items-center justify-center text-sm text-gray-500">Loading chart…</div>,
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
    entries,
    journalLoading,
    journalError,
    journalLabelsInView,
    addJournalEntry,
    deleteJournalEntry,
    authenticated,
    transactions,
    portfolio,
  } = useChartLogic();

  const [showHigh, setShowHigh] = useState(true);
  const [showLow, setShowLow] = useState(true);
  const [showKeyLevels, setShowKeyLevels] = useState(true);

  const activePortfolio = useMemo(() => {
    if (!symbol || !portfolio) return null;
    return portfolio.find((p) => p.symbol === symbol) || null;
  }, [symbol, portfolio]);

  const currentPrice = useMemo(() => {
    if (points.length === 0) return 0;
    const lastPoint = points[points.length - 1];
    return (lastPoint.high + lastPoint.low) / 2;
  }, [points]);

  const coinTransactions = useMemo(() => {
    if (!symbol || !transactions) return [];
    return transactions
      .filter((tx) => tx.symbol === symbol)
      .sort((a, b) => new Date(b.transactedAt).getTime() - new Date(a.transactedAt).getTime());
  }, [symbol, transactions]);

  const technicals = useMemo(() => {
    if (points.length === 0) return { support: null, resistance: null };

    const recentData = points.slice(-Math.min(30, points.length));
    const support = Math.min(...recentData.map((p) => p.low));
    const resistance = Math.max(...recentData.map((p) => p.high));

    return { support, resistance };
  }, [points]);

  const nearingTargets = useMemo(() => {
    if (!allCoins || allCoins.length === 0) return [];

    const targets = [];

    for (const coin of allCoins) {
      if (coin.currentPrice === null) continue;

      const isNearHigh = coin.targetHigh !== null && coin.currentPrice >= coin.targetHigh * 0.95;
      const isNearLow = coin.targetLow !== null && coin.currentPrice <= coin.targetLow * 1.05;

      if (isNearHigh || isNearLow) {
        let status = "";
        let distance = 0;
        let targetType: "high" | "low" | null = null;
        let targetPrice = 0;

        if (isNearHigh && coin.targetHigh !== null) {
          targetType = "high";
          targetPrice = coin.targetHigh;
          distance = ((coin.targetHigh - coin.currentPrice) / coin.targetHigh) * 100;
          status = distance <= 0 ? "Target Reached!" : `Within ${distance.toFixed(1)}% of High`;
        } else if (isNearLow && coin.targetLow !== null) {
          targetType = "low";
          targetPrice = coin.targetLow;
          distance = ((coin.currentPrice - coin.targetLow) / coin.targetLow) * 100;
          status = distance <= 0 ? "Target Reached!" : `Within ${distance.toFixed(1)}% of Low`;
        }

        targets.push({
          ...coin,
          targetType,
          targetPrice,
          status,
          distance: distance <= 0 ? 0 : distance,
          currentPrice: coin.currentPrice,
        });
      }
    }

    return targets.sort((a, b) => a.distance - b.distance);
  }, [allCoins]);

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

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <Dropdown
          label="Coin"
          placeholder="Select a coin to analyse"
          value={symbol}
          onChange={setSymbol}
          options={coinOptions.map((c) => ({ label: `${c.name} (${c.symbol})`, value: c.symbol }))}
        />

        {/* Range Selector (1M, 3M, 6M, 1Y, 3Y) */}
        <div className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          <span>Range</span>
          <div className={`inline-flex rounded-md border border-gray-200 p-1 bg-white ${!symbol ? "opacity-50 pointer-events-none" : ""}`}>
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRange(opt.value)}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  range === opt.value ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Analysis Overlays */}
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
                showKeyLevels ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
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

          {allCoins && allCoins.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">🚨 Nearing Targets Scanner</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Coins within 5% of their configured limit targets.</p>
                </div>
              </div>

              {nearingTargets.length === 0 ? (
                <div className="rounded border border-gray-100 bg-gray-50 p-6 text-center text-sm text-gray-500">
                  No coins are currently within 5% of their set target highs or lows.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {nearingTargets.map((coin) => (
                    <div
                      key={coin.symbol}
                      className={`rounded-lg border p-4 transition-all hover:shadow-md cursor-pointer ${
                        coin.targetType === "high" ? "border-green-200 bg-green-50/30" : "border-red-200 bg-red-50/30"
                      }`}
                      onClick={() => setSymbol(coin.symbol)}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-bold text-gray-900">{coin.symbol}</span>
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            coin.distance === 0
                              ? "bg-brand-600 text-white"
                              : coin.targetType === "high"
                              ? "bg-green-100 text-green-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {coin.status}
                        </span>
                      </div>

                      <div className="flex items-end justify-between">
                        <div>
                          <div className="text-[11px] font-semibold uppercase text-gray-500">Current Price</div>
                          <div className="text-sm font-medium text-gray-900">{formatPhp(coin.currentPrice)}</div>
                        </div>
                        <div className="text-right">
                          <div
                            className={`text-[11px] font-semibold uppercase ${
                              coin.targetType === "high" ? "text-green-700" : "text-red-700"
                            }`}
                          >
                            Target {coin.targetType}
                          </div>
                          <div
                            className={`text-sm font-medium ${
                              coin.targetType === "high" ? "text-green-700" : "text-red-700"
                            }`}
                          >
                            {formatPhp(coin.targetPrice)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="flex-1 space-y-4">
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
                    showKeyLevels={showKeyLevels}
                    showBreakEven={!!activePortfolio && activePortfolio.holdings > 0}
                    breakEvenPrice={
                      activePortfolio && activePortfolio.holdings > 0
                        ? activePortfolio.spent / activePortfolio.holdings
                        : null
                    }
                    support={technicals.support}
                    resistance={technicals.resistance}
                  />
                )}
              </div>

              {/* Spot Trading Insights */}
              <TradingInsightCard
                points={points}
                symbol={symbol}
                activePortfolio={activePortfolio}
                support={technicals.support}
                resistance={technicals.resistance}
              />

              {/* NEW: DCA Strategy Playbook */}
              <StrategyPlaybook 
                symbol={symbol} 
                support={technicals.support} 
              />

              {/* DCA Recovery Calculator */}
              <DCACalculator
                symbol={symbol}
                currentPrice={currentPrice}
                portfolio={activePortfolio}
              />

              {/* Transaction History */}
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
                            <td className="px-3 py-2 text-gray-500">{new Date(tx.transactedAt).toLocaleDateString()}</td>
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
                            <td className="px-3 py-2 text-right font-semibold text-gray-900">{formatPhp(tx.phpAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
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
            />
          </div>
        </>
      )}
    </div>
  );
}