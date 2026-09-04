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
  directiveDescription: string;
  crossoverAlert: string | null; // Explict Crossover Text
  targetLow: number | null;
  targetHigh: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi: number | null;
  macroTrend: "MACRO BULLISH" | "MACRO BEARISH" | "ACCUMULATING DATA";
}

// Calculate SMA for a specific slice of points
function calculateSMAAt(points: ChartPoint[], period: number, offset = 0): number | null {
  const endIndex = points.length - offset;
  if (endIndex < period) return null;
  let sum = 0;
  for (let i = endIndex - period; i < endIndex; i++) {
    sum += (points[i].high + points[i].low) / 2;
  }
  return sum / period;
}

// Calculate RSI for a specific slice of points
function calculateRSIAt(points: ChartPoint[], period = 14): number | null {
  if (points.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const prevPrice = (points[i - 1].high + points[i - 1].low) / 2;
    const currPrice = (points[i].high + points[i].low) / 2;
    const diff = currPrice - prevPrice;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  let lastRsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < points.length; i++) {
    const prevPrice = (points[i - 1].high + points[i - 1].low) / 2;
    const currPrice = (points[i].high + points[i].low) / 2;
    const diff = currPrice - prevPrice;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    lastRsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return Number(lastRsi.toFixed(1));
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
        directiveDescription: "Select a coin from the dropdown above to begin tracking.",
        crossoverAlert: null,
        targetLow: null,
        targetHigh: null,
        sma20: null,
        sma50: null,
        sma200: null,
        rsi: null,
        macroTrend: "ACCUMULATING DATA",
      };
    }

    const recentData = points.slice(-Math.min(30, points.length));
    const lastPoint = points[points.length - 1];
    const currentPrice = (lastPoint.high + lastPoint.low) / 2;

    // 1. Current Day SMAs & RSI
    const sma20 = calculateSMAAt(points, 20, 0);
    const sma50 = calculateSMAAt(points, 50, 0);
    const sma200 = calculateSMAAt(points, 200, 0);
    const rsi = calculateRSIAt(points, 14);

    // 2. Previous Day SMAs
    const prevSma20 = calculateSMAAt(points, 20, 1);
    const prevSma50 = calculateSMAAt(points, 50, 1);
    const prevSma200 = calculateSMAAt(points, 200, 1);

    // 3. Evaluate Specific Crossover Events & RSI Alerts
    let crossoverAlert: string | null = null;

    if (rsi !== null && rsi >= 70) {
      crossoverAlert = `🔥 RSI Overbought (${rsi}) — Caution advised for new buy entries.`;
    } else if (rsi !== null && rsi <= 30) {
      crossoverAlert = `💎 RSI Oversold (${rsi}) — High-conviction DCA Accumulation Zone.`;
    }

    // Golden Cross / Death Cross
    if (!crossoverAlert && prevSma50 && prevSma200 && sma50 && sma200) {
      if (prevSma50 <= prevSma200 && sma50 > sma200) {
        crossoverAlert = "🚀 Golden Cross Detected! (50 SMA crossed above 200 SMA) — Strong Macro Bullish Signal.";
      } else if (prevSma50 >= prevSma200 && sma50 < sma200) {
        crossoverAlert = "⚠️ Death Cross Detected! (50 SMA crossed below 200 SMA) — Major Macro Bearish Warning.";
      }
    }

    // Medium-Term Swing Cross
    if (!crossoverAlert && prevSma20 && prevSma50 && sma20 && sma50) {
      if (prevSma20 <= prevSma50 && sma20 > sma50) {
        crossoverAlert = "📈 Bullish Momentum Cross! (20 SMA crossed above 50 SMA) — Upward Trend Accelerating.";
      } else if (prevSma20 >= prevSma50 && sma20 < sma50) {
        crossoverAlert = "📉 Bearish Momentum Cross! (20 SMA crossed below 50 SMA) — Short-term Trend Weakening.";
      }
    }

    // Price vs 20 SMA Cross
    if (!crossoverAlert && points.length >= 2) {
      const prevPrice = (points[points.length - 2].high + points[points.length - 2].low) / 2;
      if (prevSma20 && sma20) {
        if (prevPrice <= prevSma20 && currentPrice > sma20) {
          crossoverAlert = "⚡ Price Breakout! Price crossed above the 20 SMA.";
        } else if (prevPrice >= prevSma20 && currentPrice < sma20) {
          crossoverAlert = "🔴 Price Breakdown! Price dropped below the 20 SMA.";
        }
      }
    }

    // 4. Macro Trend Alignment
    let macroTrend: "MACRO BULLISH" | "MACRO BEARISH" | "ACCUMULATING DATA" = "ACCUMULATING DATA";
    if (sma50 !== null && sma200 !== null) {
      macroTrend = sma50 >= sma200 ? "MACRO BULLISH" : "MACRO BEARISH";
    }

    // 5. Technical Range & Levels
    const localSupport = support !== undefined && support !== null ? support : Math.min(...recentData.map((p) => p.low));
    const localResistance = resistance !== undefined && resistance !== null ? resistance : Math.max(...recentData.map((p) => p.high));
    
    const targetLow = localSupport;
    const targetHigh = localResistance;

    const isAboveSma20 = sma20 !== null && currentPrice > sma20;
    const range = localResistance - localSupport;
    const positionInRange = range > 0 ? (currentPrice - localSupport) / range : 0.5;

    // 6. Trade Bias Logic
    let tradeBias: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";

    if ((rsi !== null && rsi <= 35) || positionInRange <= 0.25 || (isAboveSma20 && positionInRange <= 0.45)) {
      tradeBias = "LONG";
    } else if ((rsi !== null && rsi >= 65) || positionInRange >= 0.75 || (!isAboveSma20 && positionInRange >= 0.55)) {
      tradeBias = "SHORT";
    }

    const biasColor =
      tradeBias === "LONG"
        ? "bg-emerald-100 text-emerald-800 border-emerald-300"
        : tradeBias === "SHORT"
        ? "bg-rose-100 text-rose-800 border-rose-300"
        : "bg-gray-100 text-gray-700 border-gray-300";

    // Dynamic Title & Description generation
    let title = "Range Consolidation";
    let description = `Trading at ${formatPhp(currentPrice)}. Awaiting directional breakout.`;

    if (crossoverAlert) {
      title = "Active Market Alert";
      description = crossoverAlert;
    } else if (isAboveSma20) {
      title = "Bullish SMA Alignment";
      description = `Price (${formatPhp(currentPrice)}) is holding above the 20 SMA (${formatPhp(sma20 ?? 0)}), confirming positive short-term momentum.`;
    } else if (sma20 !== null) {
      title = "Bearish SMA Alignment";
      description = `Price (${formatPhp(currentPrice)}) is trading below the 20 SMA (${formatPhp(sma20)}), indicating short-term selling pressure.`;
    }

    return {
      title,
      description,
      statusText: tradeBias === "LONG" ? "Buy Zone" : tradeBias === "SHORT" ? "Risk Off" : "Neutral",
      statusColor: tradeBias === "LONG" ? "text-emerald-700 bg-emerald-100" : tradeBias === "SHORT" ? "text-rose-700 bg-rose-100" : "text-gray-700 bg-gray-100",
      tradeBias,
      biasColor,
      dcaAction: tradeBias === "LONG" ? "Deploy Ladder Buy" : tradeBias === "SHORT" ? "Hold PHP Cash" : "Wait for Setup",
      directiveDescription: tradeBias === "LONG" 
        ? "Price alignment and technicals support buying. Execute tranches near support." 
        : "Market momentum is weak or extended. Maintain cash reserves.",
      crossoverAlert,
      targetLow,
      targetHigh,
      sma20,
      sma50,
      sma200,
      rsi,
      macroTrend,
    };
  }, [symbol, points, activePortfolio, support, resistance]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          Spot Trading Insights {symbol && <span className="text-brand-600">({symbol}/PHP)</span>}
        </h3>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${insights.biasColor}`}>
            BIAS: {insights.tradeBias}
          </span>
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${insights.statusColor}`}>
            {insights.statusText}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {/* Dynamic Alert Banner */}
        {insights.crossoverAlert && (
          <div className="rounded-md border border-indigo-200 bg-indigo-50/70 p-3 text-xs font-semibold text-indigo-900">
            {insights.crossoverAlert}
          </div>
        )}

        <div className="rounded-md bg-gray-50 p-3">
          <h4 className="mb-1 text-sm font-medium text-gray-800">{insights.title}</h4>
          <p className="text-sm leading-relaxed text-gray-600">{insights.description}</p>
        </div>

        {/* DCA Action Directive Banner */}
        <div className="rounded-md border border-brand-200 bg-brand-50/50 p-3">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-800">DCA Allocation Directive</div>
            <div className="text-xs font-bold text-brand-900 bg-brand-100 px-2 py-0.5 rounded">
              {insights.dcaAction}
            </div>
          </div>
          <p className="text-xs text-brand-900/80 font-medium leading-normal mt-1">
            💡 <span className="underline decoration-brand-300 underline-offset-2">Meaning</span>: {insights.directiveDescription}
          </p>
        </div>

        {/* Moving Averages & RSI Indicators Grid */}
        <div className="rounded-md border border-gray-200 bg-gray-50/80 p-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2 flex justify-between">
            <span>Indicators & Moving Averages</span>
            <span className="text-gray-700 font-bold">{insights.macroTrend}</span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="bg-white p-1.5 rounded border border-gray-100">
              <div className="text-[10px] text-gray-500 font-medium">20 SMA</div>
              <div className="text-xs font-bold text-gray-800">
                {insights.sma20 ? formatPhp(insights.sma20) : "Building..."}
              </div>
            </div>
            <div className="bg-white p-1.5 rounded border border-gray-100">
              <div className="text-[10px] text-gray-500 font-medium">50 SMA</div>
              <div className="text-xs font-bold text-gray-800">
                {insights.sma50 ? formatPhp(insights.sma50) : "Building..."}
              </div>
            </div>
            <div className="bg-white p-1.5 rounded border border-gray-100">
              <div className="text-[10px] text-gray-500 font-medium">200 SMA</div>
              <div className="text-xs font-bold text-gray-800">
                {insights.sma200 ? formatPhp(insights.sma200) : "Building..."}
              </div>
            </div>
            <div className="bg-white p-1.5 rounded border border-indigo-100">
              <div className="text-[10px] text-indigo-600 font-medium">RSI (14)</div>
              <div className="text-xs font-bold text-indigo-900">
                {insights.rsi !== null ? insights.rsi : "Building..."}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}