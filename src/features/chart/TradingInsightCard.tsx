import { useMemo, useState } from "react";
import { formatPhp } from "@/lib/format";
import type { ChartPoint } from "@/validators/recordSchema";

interface TradingInsightCardProps {
  points: ChartPoint[];
  symbol: string;
}

interface Insight {
  type: "buy" | "warning" | "neutral";
  title: string;
  description: string;
}

export default function TradingInsightCard({ points, symbol }: TradingInsightCardProps) {
  const [showHelp, setShowHelp] = useState(false);

  const insights = useMemo(() => {
    if (!points || points.length < 20) return [];

    const latest = points[points.length - 1];
    const latestPrice = latest.low;

    let minLow = points[0].low;
    let maxHigh = points[0].high;
    for (const p of points) {
      if (p.low < minLow) minLow = p.low;
      if (p.high > maxHigh) maxHigh = p.high;
    }

    const last20 = points.slice(-20);
    const sma20 = last20.reduce((sum, p) => sum + (p.high + p.low) / 2, 0) / 20;

    const distToSupportPct = ((latestPrice - minLow) / minLow) * 100;
    const distFromPeakPct = ((maxHigh - latest.high) / maxHigh) * 100;
    const distToSmaPct = ((latestPrice - sma20) / sma20) * 100;

    const generated: Insight[] = [];

    // Spot Accumulation Zone (Major Dip)
    if (distToSupportPct <= 3) {
      generated.push({
        type: "buy",
        title: "Prime Spot Accumulation Zone",
        description: `Price is within ${distToSupportPct.toFixed(1)}% of historical support (${formatPhp(minLow)}). High-probability zone to set up tiered ladder limit buys.`,
      });
    } else if (distFromPeakPct >= 10) {
      generated.push({
        type: "buy",
        title: `Spot Pullback Opportunity (-${distFromPeakPct.toFixed(1)}% from High)`,
        description: `Price has cooled off from the peak (${formatPhp(maxHigh)}). Consider placing partial spot limit orders rather than buying market rate all at once.`,
      });
    }

    // 20 SMA Dynamic Support
    if (Math.abs(distToSmaPct) <= 2) {
      generated.push({
        type: "neutral",
        title: "Testing 20 SMA Trend Support",
        description: `Current spot price (${formatPhp(latestPrice)}) is at the 20 SMA line (${formatPhp(sma20)}). A solid bounce here favors continuing spot DCA entries.`,
      });
    }

    // Resistance / Take-Profit Caution
    const distToResistancePct = ((maxHigh - latest.high) / maxHigh) * 100;
    if (distToResistancePct <= 3) {
      generated.push({
        type: "warning",
        title: "Spot Take-Profit / Caution Zone",
        description: `Price is near local resistance ceiling (${formatPhp(maxHigh)}). Avoid FOMO spot buys here; consider locking in partial profits into PHP/cash.`,
      });
    }

    return generated;
  }, [points]);

  if (!symbol || points.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <span>⚡</span>
          <span>Spot Trading Insights ({symbol})</span>
        </h4>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowHelp(!showHelp)}
            className="text-xs text-brand-600 hover:text-brand-700 underline font-medium"
          >
            {showHelp ? "Hide Guide" : "Spot Strategy Guide"}
          </button>
          <span className="text-xs px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 font-medium">
            Spot Model
          </span>
        </div>
      </div>

      {/* Collapsible Spot Trading Guide */}
      {showHelp && (
        <div className="p-3 bg-gray-50 rounded-md border border-gray-200 text-xs space-y-2 text-gray-600">
          <div className="font-semibold text-gray-800">Spot Trading Signal Playbook:</div>
          <div className="flex items-start gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 mt-0.5 shrink-0" />
            <div>
              <strong className="text-gray-800">Green (Spot Accumulation):</strong> Price is at or near strong support. Divide your budget into 2–3 limit buy orders down to the support floor.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 mt-0.5 shrink-0" />
            <div>
              <strong className="text-gray-800">Blue (DCA / Trend Continuation):</strong> Price is testing moving average support. Good entry if you are building a medium-term spot holding.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 mt-0.5 shrink-0" />
            <div>
              <strong className="text-gray-800">Amber (Take Profit / No Buy Zone):</strong> Price is hitting local resistance. Do not buy market orders here; evaluate taking partial spot profits.
            </div>
          </div>
        </div>
      )}

      {/* Generated Insights List */}
      {insights.length === 0 ? (
        <p className="text-xs text-gray-500">
          Spot price is currently in a neutral zone. Keep cash ready and wait for a dip toward support before placing limit orders.
        </p>
      ) : (
        <div className="space-y-2">
          {insights.map((item, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-md text-xs border ${
                item.type === "buy"
                  ? "bg-green-50 border-green-200 text-green-900"
                  : item.type === "warning"
                  ? "bg-amber-50 border-amber-200 text-amber-900"
                  : "bg-blue-50 border-blue-200 text-blue-900"
              }`}
            >
              <div className="font-semibold mb-1">{item.title}</div>
              <div>{item.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}