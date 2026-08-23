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
    if (points.length === 0) return { support: null, resistance: null };
    
    const recentData = points.slice(-Math.min(30, points.length));
    const support = Math.min(...recentData.map((p) => p.low));
    const resistance = Math.max(...recentData.map((p) => p.high));
    
    return { support, resistance };
  }, [points]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">
          <span>←</span>
          <span>Back to Home</span>
        </Link>
      </div>

      {/* Main Toolbar */}
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

              {/* Single Unified Insight Card */}
              <TradingInsightCard 
                points={points} 
                symbol={symbol} 
                activePortfolio={activePortfolio}
                support={technicals.support}
                resistance={technicals.resistance}
              />

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