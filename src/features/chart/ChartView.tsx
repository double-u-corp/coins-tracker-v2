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
    transactions,
    portfolio,
  } = useChartLogic();

  const [showHigh, setShowHigh] = useState(true);
  const [showLow, setShowLow] = useState(true);
  const [showSma, setShowSma] = useState(false);
  const [showKeyLevels, setShowKeyLevels] = useState(true);

  // 1. Get active portfolio data for the selected coin
  const activePortfolio = useMemo(() => {
    if (!symbol || !portfolio) return null;
    return portfolio.find((p) => p.symbol === symbol) || null;
  }, [symbol, portfolio]);

  // 2. Filter transaction history for the selected coin
  const coinTransactions = useMemo(() => {
    if (!symbol || !transactions) return [];
    return transactions
      .filter((tx) => tx.symbol === symbol)
      .sort((a, b) => new Date(b.transactedAt).getTime() - new Date(a.transactedAt).getTime());
  }, [symbol, transactions]);

  // 3. Calculate Technical Levels (Support & Resistance over last 30 periods)
  const technicals = useMemo(() => {
    if (points.length === 0) return { support: null, resistance: null, currentPrice: null, positionInRange: null };
    
    const recentData = points.slice(-Math.min(30, points.length));
    const lastPoint = points[points.length - 1];
    
    const currentPrice = (lastPoint.high + lastPoint.low) / 2;
    const support = Math.min(...recentData.map((p) => p.low));
    const resistance = Math.max(...recentData.map((p) => p.high));
    
    const range = resistance - support;
    const positionInRange = range > 0 ? (currentPrice - support) / range : 0.5;

    return { support, resistance, currentPrice, positionInRange };
  }, [points]);

  // 4. Generate dynamic action suggestion based on BOTH Portfolio and Technical Analysis
  const actionSuggestion = useMemo(() => {
    if (!symbol || points.length === 0 || technicals.currentPrice === null) return null;

    const { currentPrice, positionInRange } = technicals;
    const hasHoldings = activePortfolio && activePortfolio.holdings > 0;

    // --- Scenario A: User is HOLDING the coin ---
    if (hasHoldings) {
      const avgCost = activePortfolio.spent / activePortfolio.holdings;
      const profitMargin = (currentPrice - avgCost) / avgCost;

      if (profitMargin >= 0.3) return { action: "Take Profit Zone", text: "Significant gains realized. Consider a partial spot sell to secure profits while it's trending high.", color: "text-emerald-700 bg-emerald-50 border-emerald-200", stat: "In Profit" };
      if (profitMargin >= 0.05) {
        if (positionInRange! > 0.8) return { action: "Approaching Resistance", text: "You are in profit, but the price is testing recent resistance. Monitor for rejection; a partial sell might be wise.", color: "text-green-700 bg-green-50 border-green-200", stat: "In Profit" };
        return { action: "Holding Steady", text: "Position is safely in profit. Let the trend develop or trail your stop loss.", color: "text-green-700 bg-green-50 border-green-200", stat: "In Profit" };
      }
      if (profitMargin < -0.1) {
        if (positionInRange! < 0.2) return { action: "Support Hit (Drawdown)", text: "Price is discounted and testing support. This is a potential setup to wait for the dip and ladder buy to lower your average.", color: "text-blue-700 bg-blue-50 border-blue-200", stat: "Drawdown" };
        return { action: "Drawdown", text: "Price is below your entry average. Watch support levels carefully before attempting to scale in further.", color: "text-amber-700 bg-amber-50 border-amber-200", stat: "Drawdown" };
      }
      return { action: "Chopping Near Entry", text: "Price is hovering around your average cost basis. Wait for a clearer swing direction.", color: "text-gray-700 bg-gray-50 border-gray-200", stat: "Break Even" };
    }

    // --- Scenario B: NO HOLDINGS (Pure Technical Analysis) ---
    if (positionInRange! <= 0.15) return { action: "Support Hit", text: "Price is resting at recent support levels. Excellent area to watch for a bounce and plan a ladder buy entry.", color: "text-blue-700 bg-blue-50 border-blue-200", stat: "Wait for the Dip" };
    if (positionInRange! >= 0.85) return { action: "Resistance Tested", text: "Price is heavily extended and testing resistance. High risk of rejection. Avoid buying and wait for a clear pullback.", color: "text-red-700 bg-red-50 border-red-200", stat: "High Risk" };
    if (positionInRange! < 0.5) return { action: "Lower Range Swing", text: "Trending in the lower half of its recent swing. You can scale in lightly or wait for a deeper dip to key support.", color: "text-indigo-700 bg-indigo-50 border-indigo-200", stat: "Consolidating" };
    
    return { action: "Upper Range Swing", text: "Price is pushing toward the upper half of its range. Risk-to-reward for new spot buys is moderate. Wait for a dip.", color: "text-amber-700 bg-amber-50 border-amber-200", stat: "Consolidating" };

  }, [activePortfolio, points, symbol, technicals]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">
          <span>←</span>
          <span>Back to Home</span>
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <Dropdown label="Coin" placeholder="Select a coin to analyse" value={symbol} onChange={setSymbol} options={coinOptions.map((c) => ({ label: `${c.name} (${c.symbol})`, value: c.symbol }))} />

        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          <span>Range</span>
          <select value={years} onChange={(e) => setYears(Number(e.target.value))} disabled={!symbol} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50">
            {YEAR_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </label>

        <div className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          <span>View</span>
          <div className={`inline-flex rounded-md border border-gray-200 p-1 ${!symbol ? 'opacity-50 pointer-events-none' : ''}`}>
            {GRANULARITY_OPTIONS.map((opt) => (
              <button key={opt.value} type="button" onClick={() => setGranularity(opt.value)} className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${granularity === opt.value ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}>{opt.label}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          <span>Analysis Overlays</span>
          <div className={`flex flex-wrap items-center gap-1.5 rounded-md border border-gray-200 p-1 bg-white ${!symbol ? 'opacity-50 pointer-events-none' : ''}`}>
            <button type="button" onClick={() => setShowHigh(!showHigh)} className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${showHigh ? "bg-green-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>High</button>
            <button type="button" onClick={() => setShowLow(!showLow)} className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${showLow ? "bg-red-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>Low</button>
            <button type="button" onClick={() => setShowKeyLevels(!showKeyLevels)} className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${showKeyLevels ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>Key Levels</button>
            <button type="button" onClick={() => setShowSma(!showSma)} className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${showSma ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>20 SMA</button>
          </div>
        </div>
      </div>

      {!symbol ? (
        <div className="flex min-h-[400px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center">
          <div className="text-4xl mb-4">📈</div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">No Coin Selected</h2>
          <p className="text-sm text-gray-500 max-w-sm">Use the dropdown above to select a cryptocurrency to view its chart history, technical insights, and your trade logs.</p>
        </div>
      ) : (
        <>
          {actionSuggestion && !chartLoading && points.length > 0 && (
            <div className={`rounded-lg border p-4 shadow-sm ${actionSuggestion.color}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold uppercase tracking-wide">{actionSuggestion.action}</h4>
                  <p className="mt-1 text-sm">{actionSuggestion.text}</p>
                </div>
                <div className="text-right shrink-0 ml-4">
                  <p className="text-xs opacity-75">Status</p>
                  <p className="text-base font-bold">{actionSuggestion.stat}</p>
                </div>
              </div>
            </div>
          )}

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
                    showSma={showSma}
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

              <TradingInsightCard points={points} symbol={symbol} />

              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">Transaction History <span className="text-brand-600">({symbol})</span></h3>
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
                              <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${tx.type === "buy" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{tx.type}</span>
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

            <JournalSidebar entries={entries} loading={journalLoading} error={journalError} defaultSymbol={symbol} authenticated={authenticated} onAdd={addJournalEntry} onDelete={deleteJournalEntry} />
          </div>
        </>
      )}
    </div>
  );
}