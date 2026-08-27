import { useState, useMemo } from "react";
import { formatPhp } from "@/lib/format";

interface DCACalculatorProps {
  symbol: string;
  currentPrice: number;
  portfolio: {
    holdings: number;
    spent: number;
  } | null;
}

export default function DCACalculator({ symbol, currentPrice, portfolio }: DCACalculatorProps) {
  const [mode, setMode] = useState<"targetPrice" | "budget">("targetPrice");
  const [targetPriceInput, setTargetPriceInput] = useState<string>("");
  const [budgetInput, setBudgetInput] = useState<string>("");

  const currentAverage = useMemo(() => {
    if (!portfolio || portfolio.holdings <= 0) return 0;
    return portfolio.spent / portfolio.holdings;
  }, [portfolio]);

  if (!portfolio || portfolio.holdings <= 0 || currentPrice <= 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">
          DCA Recovery Calculator {symbol && <span className="text-brand-600">({symbol})</span>}
        </h3>
        <p className="mt-2 text-xs text-gray-500">
          {!symbol
            ? "Select a coin from the dropdown above to use the DCA calculator."
            : `No active holdings found for ${symbol}. Buy transactions are required to calculate DCA recovery.`}
        </p>
      </div>
    );
  }

  const targetPrice = parseFloat(targetPriceInput);
  const budget = parseFloat(budgetInput);

  let targetModeResult = null;
  let budgetModeResult = null;
  let targetError = "";

  // Mode 1: Calculate required capital for target average price
  if (mode === "targetPrice" && !isNaN(targetPrice) && targetPrice > 0) {
    if (targetPrice >= currentAverage) {
      targetError = `Target price must be lower than your current average (${formatPhp(currentAverage)}).`;
    } else if (targetPrice <= currentPrice) {
      targetError = `Target price must be higher than the current market price (${formatPhp(currentPrice)}).`;
    } else {
      const requiredCoins = (portfolio.spent - targetPrice * portfolio.holdings) / (targetPrice - currentPrice);
      const requiredPhp = requiredCoins * currentPrice;
      const newTotalHoldings = portfolio.holdings + requiredCoins;
      const newTotalSpent = portfolio.spent + requiredPhp;

      targetModeResult = {
        requiredCoins,
        requiredPhp,
        newTotalHoldings,
        newTotalSpent,
        priceDropNeeded: ((currentAverage - targetPrice) / currentAverage) * 100,
      };
    }
  }

  // Mode 2: Calculate new average for given cash budget
  if (mode === "budget" && !isNaN(budget) && budget > 0) {
    const additionalCoins = budget / currentPrice;
    const newTotalSpent = portfolio.spent + budget;
    const newTotalHoldings = portfolio.holdings + additionalCoins;
    const newAverage = newTotalSpent / newTotalHoldings;
    const averageReduction = ((currentAverage - newAverage) / currentAverage) * 100;

    budgetModeResult = {
      additionalCoins,
      newTotalSpent,
      newTotalHoldings,
      newAverage,
      averageReduction,
    };
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            DCA Recovery Calculator <span className="text-brand-600">({symbol})</span>
          </h3>
          <p className="text-xs text-gray-500">Calculate buy tranches to lower your break-even entry</p>
        </div>

        {/* Mode Switcher */}
        <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode("targetPrice")}
            className={`rounded px-2.5 py-1 font-medium transition-colors ${
              mode === "targetPrice"
                ? "bg-white text-brand-700 shadow-sm font-semibold"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            By Target Price
          </button>
          <button
            type="button"
            onClick={() => setMode("budget")}
            className={`rounded px-2.5 py-1 font-medium transition-colors ${
              mode === "budget"
                ? "bg-white text-brand-700 shadow-sm font-semibold"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            By Cash Budget
          </button>
        </div>
      </div>

      {/* Holdings & Price Overview */}
      <div className="grid grid-cols-3 gap-2 rounded-md bg-gray-50 p-3 text-xs">
        <div>
          <span className="block text-[10px] font-semibold uppercase text-gray-500">Holdings</span>
          <span className="font-bold text-gray-900">
            {portfolio.holdings.toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol}
          </span>
        </div>
        <div>
          <span className="block text-[10px] font-semibold uppercase text-gray-500">Avg Entry</span>
          <span className="font-bold text-gray-900">{formatPhp(currentAverage)}</span>
        </div>
        <div>
          <span className="block text-[10px] font-semibold uppercase text-gray-500">Current Price</span>
          <span className="font-bold text-brand-600">{formatPhp(currentPrice)}</span>
        </div>
      </div>

      {/* Mode 1: Target Price Input */}
      {mode === "targetPrice" && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Target Average Price (₱)
            </label>
            <div className="relative">
              <input
                type="number"
                step="any"
                value={targetPriceInput}
                onChange={(e) => setTargetPriceInput(e.target.value)}
                placeholder={`e.g., ${((currentAverage + currentPrice) / 2).toFixed(2)}`}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              {currentAverage > currentPrice && (
                <button
                  type="button"
                  onClick={() => setTargetPriceInput(((currentAverage + currentPrice) / 2).toFixed(2))}
                  className="absolute right-2 top-1.5 rounded bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600 hover:bg-gray-200"
                >
                  Midpoint
                </button>
              )}
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              Enter a price between current market ({formatPhp(currentPrice)}) and your avg ({formatPhp(currentAverage)}).
            </p>
          </div>

          {targetError && (
            <div className="rounded-md bg-red-50 p-2.5 text-xs text-red-700 font-medium">
              {targetError}
            </div>
          )}

          {targetModeResult && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3.5 space-y-3">
              <div className="flex items-center justify-between border-b border-emerald-200/60 pb-2">
                <span className="text-xs font-semibold text-emerald-900">Required DCA Investment</span>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  -{targetModeResult.priceDropNeeded.toFixed(1)}% Avg Reduction
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="block text-[10px] font-medium uppercase text-emerald-700">Capital Needed</span>
                  <span className="text-sm font-bold text-emerald-950">{formatPhp(targetModeResult.requiredPhp)}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-medium uppercase text-emerald-700">Coins to Buy</span>
                  <span className="text-sm font-bold text-emerald-950">
                    {targetModeResult.requiredCoins.toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-medium uppercase text-emerald-700">New Total Spent</span>
                  <span className="font-semibold text-emerald-900">{formatPhp(targetModeResult.newTotalSpent)}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-medium uppercase text-emerald-700">New Total Holdings</span>
                  <span className="font-semibold text-emerald-900">
                    {targetModeResult.newTotalHoldings.toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mode 2: Budget Input */}
      {mode === "budget" && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Additional Buy Amount / Cash Budget (₱)
            </label>
            <div className="relative">
              <input
                type="number"
                step="any"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                placeholder="e.g., 3000"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <div className="absolute right-2 top-1.5 flex gap-1">
                {[1000, 3000, 5000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setBudgetInput(amt.toString())}
                    className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 hover:bg-gray-200"
                  >
                    ₱{amt >= 1000 ? `${amt / 1000}k` : amt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {budgetModeResult && (
            <div className="rounded-md border border-brand-200 bg-brand-50/60 p-3.5 space-y-3">
              <div className="flex items-center justify-between border-b border-brand-200/60 pb-2">
                <span className="text-xs font-semibold text-brand-900">Projected DCA Impact</span>
                <span className="rounded bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-800">
                  -{budgetModeResult.averageReduction.toFixed(1)}% Avg Entry
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="block text-[10px] font-medium uppercase text-brand-700">New Avg Price</span>
                  <span className="text-sm font-bold text-brand-950">{formatPhp(budgetModeResult.newAverage)}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-medium uppercase text-brand-700">Coins Acquired</span>
                  <span className="text-sm font-bold text-brand-950">
                    +{budgetModeResult.additionalCoins.toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-medium uppercase text-brand-700">New Total Spent</span>
                  <span className="font-semibold text-brand-900">{formatPhp(budgetModeResult.newTotalSpent)}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-medium uppercase text-brand-700">New Total Holdings</span>
                  <span className="font-semibold text-brand-900">
                    {budgetModeResult.newTotalHoldings.toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}