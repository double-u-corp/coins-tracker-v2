import { useState, useMemo } from "react";
import { formatPhp } from "@/lib/format";

interface DCACalculatorProps {
  symbol: string;
  currentPrice: number;
  support?: number | null;
  resistance?: number | null;
  portfolio: {
    holdings: number;
    spent: number;
  } | null;
}

interface DCAScenario {
  targetPrice: number;
  requiredCoins: number;
  requiredPhp: number;
  newTotalHoldings: number;
  newTotalSpent: number;
  priceDropNeeded: number;
  multipleOfOriginalSpent: number;
}

/** Core DCA-to-target-average math, pulled out so both the manual input and
 * the scenario table below use the exact same formula. Returns null if the
 * target isn't mathematically reachable (target >= current average, or
 * target <= current price — buying at the current price can only pull the
 * average DOWN toward that price, never below it or back above your
 * existing average). */
function computeTargetScenario(
  targetPrice: number,
  currentPrice: number,
  currentAverage: number,
  holdings: number,
  spent: number
): DCAScenario | null {
  if (targetPrice >= currentAverage || targetPrice <= currentPrice) return null;

  const requiredCoins = (spent - targetPrice * holdings) / (targetPrice - currentPrice);
  const requiredPhp = requiredCoins * currentPrice;
  const newTotalHoldings = holdings + requiredCoins;
  const newTotalSpent = spent + requiredPhp;

  return {
    targetPrice,
    requiredCoins,
    requiredPhp,
    newTotalHoldings,
    newTotalSpent,
    priceDropNeeded: ((currentAverage - targetPrice) / currentAverage) * 100,
    multipleOfOriginalSpent: spent > 0 ? requiredPhp / spent : 0,
  };
}

export default function DCACalculator({ symbol, currentPrice, support, resistance, portfolio }: DCACalculatorProps) {
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

  const drawdownPct = currentAverage > 0 && currentPrice > 0 ? ((currentAverage - currentPrice) / currentAverage) * 100 : 0;
  const isSevereDrawdown = drawdownPct >= 50;

  // A handful of illustrative targets between the current price and current
  // average, so the relationship is visible at a glance instead of requiring
  // the user to manually try numbers one at a time. Spaced as fractions of
  // the gap between the two, closest-to-current-price last (most aggressive,
  // most capital-hungry).
  const scenarioFractions = [0.75, 0.5, 0.25, 0.1];
  const scenarios: DCAScenario[] =
    currentAverage > 0 && currentPrice > 0 && currentAverage > currentPrice
      ? scenarioFractions
          .map((frac) => currentPrice + frac * (currentAverage - currentPrice))
          .map((t) => computeTargetScenario(t, currentPrice, currentAverage, portfolio.holdings, portfolio.spent))
          .filter((s): s is DCAScenario => s !== null)
      : [];

  let targetModeResult: DCAScenario | null = null;
  let budgetModeResult = null;
  let targetError = "";
  let targetWarning = "";

  // Mode 1: Calculate required capital for target average price
  if (mode === "targetPrice" && !isNaN(targetPrice) && targetPrice > 0) {
    if (targetPrice >= currentAverage) {
      targetError = `Target price must be lower than your current average (${formatPhp(currentAverage)}).`;
    } else if (targetPrice <= currentPrice) {
      targetError = `Target price must be higher than the current market price (${formatPhp(currentPrice)}).`;
    } else {
      targetModeResult = computeTargetScenario(targetPrice, currentPrice, currentAverage, portfolio.holdings, portfolio.spent);
      // Getting the average within a small band of the current price is
      // mathematically possible but requires disproportionate capital —
      // surface that plainly rather than showing a huge number with no context.
      const distanceFromCurrentPct = currentAverage > currentPrice ? ((targetPrice - currentPrice) / (currentAverage - currentPrice)) * 100 : 100;
      if (distanceFromCurrentPct <= 15 && targetModeResult) {
        targetWarning = `This target sits very close to the current price — closing that last stretch takes disproportionately more capital than getting partway there. This scenario alone needs ${targetModeResult.multipleOfOriginalSpent.toFixed(1)}x what you've spent so far.`;
      }
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

      {isSevereDrawdown && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-900">
              ⚠️ Reality Check — {drawdownPct.toFixed(0)}% below your average
            </span>
          </div>
          <p className="text-xs text-amber-900/90 leading-relaxed">
            Buying more {symbol} now can only pull your average DOWN toward today's price ({formatPhp(currentPrice)}) —
            it can never push it back up toward your original {formatPhp(currentAverage)} entry, and it can never
            fully reach today's price either. The closer you try to get your average to the current price, the more
            capital each additional step requires — the relationship isn't linear.
          </p>
          {scenarios.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="text-[10px] font-semibold uppercase text-amber-800">
                What it actually costs to get partway there
              </div>
              {scenarios.map((s) => (
                <div
                  key={s.targetPrice}
                  className="flex items-center justify-between text-[11px] bg-white/70 rounded px-2 py-1.5 border border-amber-200"
                >
                  <span className="font-medium text-amber-900">
                    New avg → {formatPhp(s.targetPrice)} <span className="text-amber-600">(-{s.priceDropNeeded.toFixed(0)}%)</span>
                  </span>
                  <span className="font-bold text-amber-950">
                    {formatPhp(s.requiredPhp)} <span className="font-normal text-amber-600">({s.multipleOfOriginalSpent.toFixed(1)}x original spend)</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mode 1: Target Price Input */}
      {mode === "targetPrice" && (
        <div className="space-y-3">
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-medium text-gray-700">
                Target Average Break-Even Price (₱)
              </label>
              {/* Quick Level Presets if Support/Resistance exist */}
              <div className="flex gap-1">
                {support && support > currentPrice && support < currentAverage && (
                  <button
                    type="button"
                    onClick={() => setTargetPriceInput(support.toFixed(2))}
                    className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                  >
                    Use Support ({formatPhp(support)})
                  </button>
                )}
              </div>
            </div>

            <div className="relative">
              <input
                type="number"
                step="any"
                value={targetPriceInput}
                onChange={(e) => setTargetPriceInput(e.target.value)}
                placeholder={`e.g., ${((currentAverage + currentPrice) / 2).toFixed(2)}`}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="button"
                onClick={() => setTargetPriceInput(((currentAverage + currentPrice) / 2).toFixed(2))}
                className="absolute right-2 top-1.5 rounded bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600 hover:bg-gray-200"
              >
                Midpoint
              </button>
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              Set your target break-even goal between current market ({formatPhp(currentPrice)}) and your current average ({formatPhp(currentAverage)}).
            </p>
          </div>

          {targetError && (
            <div className="rounded-md bg-red-50 p-2.5 text-xs text-red-700 font-medium">
              {targetError}
            </div>
          )}

          {targetWarning && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800 font-medium">
              ⚠️ {targetWarning}
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
                  <span className="block text-[10px] text-emerald-700/80 mt-0.5">
                    {targetModeResult.multipleOfOriginalSpent.toFixed(1)}x what you've spent so far
                  </span>
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
                placeholder="e.g., 5000"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <div className="absolute right-2 top-1.5 flex gap-1">
                {[3000, 5000, 10000, 20000].map((amt) => (
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