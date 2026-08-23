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

export default function TradingInsightCard({
  points,
  symbol,
  activePortfolio,
  support,
  resistance,
}: TradingInsightCardProps) {
  const insights = useMemo(() => {
    if (!symbol || points.length === 0) {
      return {
        title: "Spot Strategy Guide",
        description: "Select a coin to view dynamic spot trading insights.",
        statusText: "Awaiting Data",
        statusColor: "text-gray-500 bg-gray-100",
      };
    }

    const recentData = points.slice(-Math.min(30, points.length));
    const lastPoint = points[points.length - 1];
    const currentPrice = (lastPoint.high + lastPoint.low) / 2;

    // 1. Calculate 20 SMA
    let sma20 = null;
    if (points.length >= 20) {
      let sum = 0;
      for (let i = points.length - 20; i < points.length; i++) {
        sum += (points[i].high + points[i].low) / 2;
      }
      sma20 = sum / 20;
    }

    // 2. Determine Levels
    const localSupport = support !== undefined && support !== null ? support : Math.min(...recentData.map((p) => p.low));
    const localResistance = resistance !== undefined && resistance !== null ? resistance : Math.max(...recentData.map((p) => p.high));
    const keyLevel = (localSupport + localResistance) / 2;

    // 3. User Holding Data
    const hasHoldings = activePortfolio && activePortfolio.holdings > 0;
    const avgEntry = hasHoldings ? activePortfolio.spent / activePortfolio.holdings : null;

    const isAboveSma = sma20 !== null && currentPrice > sma20;
    const range = localResistance - localSupport;
    const positionInRange = range > 0 ? (currentPrice - localSupport) / range : 0.5;

    // 4. Generate Unified Insight
    if (hasHoldings && avgEntry !== null) {
      const profitMargin = (currentPrice - avgEntry) / avgEntry;

      if (profitMargin >= 0.3) {
        return {
          title: "Take Profit Zone",
          description: "Significant gains realized. Consider a partial spot sell to secure profits while it's trending high.",
          statusText: "In Profit",
          statusColor: "text-emerald-700 bg-emerald-100",
        };
      }
      if (positionInRange >= 0.85) {
        return {
          title: "Approaching Resistance",
          description: `You are holding, but the price is testing heavy resistance (${formatPhp(localResistance)}). Monitor for rejection; a partial take-profit might be wise.`,
          statusText: "High Risk",
          statusColor: "text-amber-700 bg-amber-100",
        };
      }
      if (profitMargin < -0.1 && positionInRange <= 0.15) {
        return {
          title: "Support Hit (Drawdown)",
          description: `Price is discounted and testing support (${formatPhp(localSupport)}). This is your setup to wait for the dip and ladder buy to lower your average entry of ${formatPhp(avgEntry)}.`,
          statusText: "Drawdown",
          statusColor: "text-blue-700 bg-blue-100",
        };
      }
      return {
        title: "Holding Position",
        description: `Position is active. Price is hovering around ${formatPhp(currentPrice)}. Let the trend develop relative to the 20 SMA.`,
        statusText: profitMargin >= 0 ? "In Profit" : "Drawdown",
        statusColor: profitMargin >= 0 ? "text-green-700 bg-green-100" : "text-gray-700 bg-gray-100",
      };
    }

    // --- NO HOLDINGS (Pure Technical Analysis) ---
    if (positionInRange <= 0.15) {
      return {
        title: "Support Hit",
        description: `Price is resting at recent support (${formatPhp(localSupport)}). Excellent area to watch for a bounce and execute your ladder buy entry.`,
        statusText: "Wait for the Dip",
        statusColor: "text-blue-700 bg-blue-100",
      };
    }
    if (positionInRange >= 0.85) {
      return {
        title: "Resistance Tested",
        description: `Price is heavily extended and testing resistance (${formatPhp(localResistance)}). High risk of rejection. Avoid buying and wait for a clear pullback.`,
        statusText: "High Risk",
        statusColor: "text-red-700 bg-red-100",
      };
    }
    if (!isAboveSma && positionInRange < 0.5) {
      return {
        title: "Lower Range Swing",
        description: `Trending in the lower half of its recent swing. Scale in lightly or wait for a deeper flush to key support.`,
        statusText: "Consolidating",
        statusColor: "text-indigo-700 bg-indigo-100",
      };
    }
    return {
      title: "Upper Range Swing",
      description: `Price is pushing toward the upper half of its range. Risk-to-reward for new spot buys is moderate. Keep cash ready.`,
      statusText: "Consolidating",
      statusColor: "text-amber-700 bg-amber-100",
    };
  }, [symbol, points, activePortfolio, support, resistance]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          Spot Trading Insights {symbol && <span className="text-brand-600">({symbol}/PHP)</span>}
        </h3>
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${insights.statusColor}`}>
          {insights.statusText}
        </span>
      </div>
      <div className="rounded-md bg-gray-50 p-3">
        <h4 className="mb-1 text-sm font-medium text-gray-800">{insights.title}</h4>
        <p className="text-sm leading-relaxed text-gray-600">{insights.description}</p>
      </div>
    </div>
  );
}