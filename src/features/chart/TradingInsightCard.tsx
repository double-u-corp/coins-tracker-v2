import { useMemo } from "react";
import type { ChartPoint } from "@/validators/recordSchema";
import { formatPhp } from "@/lib/format";

interface TradingInsightCardProps {
  points: ChartPoint[];
  symbol: string | null;
  activePortfolio?: { holdings: number; spent: number } | null;
  support?: number | null;
  resistance?: number | null;
}

export interface InsightResult {
  title: string;
  description: string;
  statusText: string;
  statusColor: string;
  tradeBias: "LONG" | "SHORT" | "NEUTRAL";
  biasColor: string;
  dcaAction: string;
  targetLow: number | null;
  targetHigh: number | null;
}

export default function TradingInsightCard({
  points,
  symbol,
  activePortfolio,
  support,
  resistance,
}: TradingInsightCardProps) {
  const insights = useMemo<InsightResult>(() => {
    if (!symbol || points.length === 0) {
      return {
        title: "Spot Strategy Guide",
        description: "Select a coin to view dynamic spot trading insights.",
        statusText: "Awaiting Data",
        statusColor: "text-gray-500 bg-gray-100",
        tradeBias: "NEUTRAL",
        biasColor: "bg-gray-100 text-gray-600 border-gray-200",
        dcaAction: "Awaiting Selection",
        targetLow: null,
        targetHigh: null,
      };
    }

    const recentData = points.slice(-Math.min(30, points.length));
    const lastPoint = points[points.length - 1];
    const currentPrice = (lastPoint.high + lastPoint.low) / 2;

    // 1. Calculate 20 SMA (Midpoint based)
    let sma20 = null;
    if (points.length >= 20) {
      let sum = 0;
      for (let i = points.length - 20; i < points.length; i++) {
        sum += (points[i].high + points[i].low) / 2;
      }
      sma20 = sum / 20;
    }

    // 2. Technical Range & Levels
    const localSupport = support !== undefined && support !== null ? support : Math.min(...recentData.map((p) => p.low));
    const localResistance = resistance !== undefined && resistance !== null ? resistance : Math.max(...recentData.map((p) => p.high));
    
    const targetLow = localSupport;
    const targetHigh = localResistance;

    const hasHoldings = activePortfolio && activePortfolio.holdings > 0;
    const avgEntry = hasHoldings ? activePortfolio.spent / activePortfolio.holdings : null;

    const isAboveSma = sma20 !== null && currentPrice > sma20;
    const range = localResistance - localSupport;
    const positionInRange = range > 0 ? (currentPrice - localSupport) / range : 0.5;

    // 3. Determine Long vs Short Trade Bias
    let tradeBias: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
    let biasColor = "bg-gray-100 text-gray-700 border-gray-300";

    if (positionInRange <= 0.25 || (isAboveSma && positionInRange <= 0.45)) {
      tradeBias = "LONG";
      biasColor = "bg-emerald-100 text-emerald-800 border-emerald-300";
    } else if (positionInRange >= 0.75 || (!isAboveSma && positionInRange >= 0.55)) {
      tradeBias = "SHORT";
      biasColor = "bg-rose-100 text-rose-800 border-rose-300";
    }

    // 4. Generate Strategy Guidelines
    if (hasHoldings && avgEntry !== null) {
      const profitMargin = (currentPrice - avgEntry) / avgEntry;

      if (profitMargin >= 0.3) {
        return {
          title: "Take Profit Zone",
          description: "Significant gains realized. Consider a partial spot sell to secure profits while it's trending high.",
          statusText: "In Profit",
          statusColor: "text-emerald-700 bg-emerald-100",
          tradeBias: "SHORT",
          biasColor: "bg-rose-100 text-rose-800 border-rose-300",
          dcaAction: "Pause DCA / Take Profits",
          targetLow,
          targetHigh,
        };
      }
      if (positionInRange >= 0.85) {
        return {
          title: "Approaching Resistance",
          description: `Price is testing heavy resistance (${formatPhp(localResistance)}). High risk of rejection. Hold your cash reserves.`,
          statusText: "High Risk",
          statusColor: "text-amber-700 bg-amber-100",
          tradeBias: "SHORT",
          biasColor: "bg-rose-100 text-rose-800 border-rose-300",
          dcaAction: "Hold Cash (Do Not Buy)",
          targetLow,
          targetHigh,
        };
      }
      if (profitMargin < -0.1 && positionInRange <= 0.15) {
        return {
          title: "Support Hit (Drawdown)",
          description: `Price is discounted near support (${formatPhp(localSupport)}). Prime zone to deploy a full tranche ladder buy to lower average of ${formatPhp(avgEntry)}.`,
          statusText: "Drawdown",
          statusColor: "text-blue-700 bg-blue-100",
          tradeBias: "LONG",
          biasColor: "bg-emerald-100 text-emerald-800 border-emerald-300",
          dcaAction: "Deploy Full Tranche (Aggressive Buy)",
          targetLow,
          targetHigh,
        };
      }
      return {
        title: "Holding Position",
        description: `Position active around ${formatPhp(currentPrice)}. Navigating relative to 20 SMA.`,
        statusText: profitMargin >= 0 ? "In Profit" : "Drawdown",
        statusColor: profitMargin >= 0 ? "text-green-700 bg-green-100" : "text-gray-700 bg-gray-100",
        tradeBias,
        biasColor,
        dcaAction: isAboveSma ? "Standard Tranche DCA OK" : "Wait for Dip Before DCA",
        targetLow,
        targetHigh,
      };
    }

    // --- NO HOLDINGS SETUP ---
    if (positionInRange <= 0.15) {
      return {
        title: "Support Hit",
        description: `Price is resting at macro support (${formatPhp(localSupport)}). Ideal risk-to-reward setup for a new spot position.`,
        statusText: "Wait for Dip",
        statusColor: "text-blue-700 bg-blue-100",
        tradeBias: "LONG",
        biasColor: "bg-emerald-100 text-emerald-800 border-emerald-300",
        dcaAction: "Deploy Full Tranche (Prime Entry)",
        targetLow,
        targetHigh,
      };
    }
    if (positionInRange >= 0.85) {
      return {
        title: "Resistance Tested",
        description: `Price is heavily extended near resistance (${formatPhp(localResistance)}). Avoid buying the top.`,
        statusText: "High Risk",
        statusColor: "text-red-700 bg-red-100",
        tradeBias: "SHORT",
        biasColor: "bg-rose-100 text-rose-800 border-rose-300",
        dcaAction: "Hold Cash (Skip DCA)",
        targetLow,
        targetHigh,
      };
    }
    if (!isAboveSma && positionInRange < 0.5) {
      return {
        title: "Lower Range Swing",
        description: `Trending below 20 SMA in lower half of swing. Scale in lightly or wait for flush to support.`,
        statusText: "Consolidating",
        statusColor: "text-indigo-700 bg-indigo-100",
        tradeBias: "LONG",
        biasColor: "bg-emerald-100 text-emerald-800 border-emerald-300",
        dcaAction: "Split Allocation into Ladder Tranches",
        targetLow,
        targetHigh,
      };
    }
    return {
      title: "Upper Range Swing",
      description: `Price pushing toward upper half of range. Risk-to-reward for new spot buys is moderate.`,
      statusText: "Consolidating",
      statusColor: "text-amber-700 bg-amber-100",
      tradeBias,
      biasColor,
      dcaAction: "Light DCA or Wait for Pullback",
      targetLow,
      targetHigh,
    };
  }, [symbol, points, activePortfolio, support, resistance]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          Spot Trading Insights {symbol && <span className="text-brand-600">({symbol}/PHP)</span>}
        </h3>
        <div className="flex items-center gap-2">
          {/* Trade Bias Indicator Badge */}
          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${insights.biasColor}`}>
            BIAS: {insights.tradeBias}
          </span>
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${insights.statusColor}`}>
            {insights.statusText}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {/* Main Strategy Guide */}
        <div className="rounded-md bg-gray-50 p-3">
          <h4 className="mb-1 text-sm font-medium text-gray-800">{insights.title}</h4>
          <p className="text-sm leading-relaxed text-gray-600">{insights.description}</p>
        </div>

        {/* DCA Action Directive Banner */}
        <div className="rounded-md border border-brand-200 bg-brand-50/50 p-2.5 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-800">DCA Allocation Directive</div>
          <div className="text-xs font-bold text-brand-900 bg-brand-100 px-2 py-0.5 rounded">
            {insights.dcaAction}
          </div>
        </div>

        {/* Target Alert Levels Block */}
        {insights.targetLow !== null && insights.targetHigh !== null && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Target Low (Support)</div>
              <div className="text-sm font-bold text-emerald-900">{formatPhp(insights.targetLow)}</div>
            </div>
            <div className="rounded-md border border-red-200 bg-red-50/50 p-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-red-700">Target High (Resistance)</div>
              <div className="text-sm font-bold text-red-900">{formatPhp(insights.targetHigh)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}