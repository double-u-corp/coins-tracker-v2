import { useMemo } from "react";
import type { ChartPoint } from "@/validators/recordSchema";
import { formatPhp } from "@/lib/format";
import { computeConfluenceSignal, detectCrossoverEvent, BIAS_BADGE_CLASSES, type BiasLabel } from "./Technicals";

interface TradingInsightCardProps {
  points: ChartPoint[];
  symbol: string | null;
  activePortfolio?: { holdings: number; spent: number } | null;
  support?: number | null;
  resistance?: number | null;
}

const BIAS_STYLES: Record<BiasLabel, { status: string; statusText: string; action: string }> = {
  "STRONG LONG": {
    status: "text-emerald-700 bg-emerald-100",
    statusText: "Strong Buy Zone",
    action: "Deploy Ladder Buy",
  },
  LONG: {
    status: "text-emerald-700 bg-emerald-100",
    statusText: "Buy Zone",
    action: "Deploy Ladder Buy",
  },
  NEUTRAL: {
    status: "text-gray-700 bg-gray-100",
    statusText: "Neutral",
    action: "Wait for Setup",
  },
  SHORT: {
    status: "text-rose-700 bg-rose-100",
    statusText: "Risk Off",
    action: "Hold PHP Cash",
  },
  "STRONG SHORT": {
    status: "text-rose-700 bg-rose-100",
    statusText: "Strong Risk Off",
    action: "Hold PHP Cash",
  },
  "INSUFFICIENT DATA": {
    status: "text-amber-700 bg-amber-100",
    statusText: "Accumulating Data",
    action: "Awaiting History",
  },
};

export default function TradingInsightCard({
  points,
  symbol,
  activePortfolio,
  support,
  resistance,
}: TradingInsightCardProps) {
  const result = useMemo(() => {
    if (!symbol || points.length === 0) return null;
    const confluence = computeConfluenceSignal(points, { support, resistance });
    const crossoverAlert = detectCrossoverEvent(points);
    return { confluence, crossoverAlert };
  }, [symbol, points, support, resistance]);

  if (!symbol || points.length === 0 || !result) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">Spot Strategy Guide</h3>
        <p className="mt-2 text-xs text-gray-500">Select a coin to view dynamic spot trading insights.</p>
      </div>
    );
  }

  const { confluence, crossoverAlert } = result;
  const style = BIAS_STYLES[confluence.bias];
  const isInsufficient = confluence.bias === "INSUFFICIENT DATA";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          Spot Trading Insights <span className="text-brand-600">({symbol}/PHP)</span>
        </h3>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${BIAS_BADGE_CLASSES[confluence.bias]}`}>
            BIAS: {confluence.bias}
          </span>
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${style.status}`}>
            {style.statusText}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {isInsufficient && (
          <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3 text-xs font-medium text-amber-900">
            ⏳ Not enough price history yet to issue a directional signal for {symbol}. Signals activate
            progressively as history builds — RSI at 14 days, 20 SMA at 20 days, and so on. What's tracked so
            far is shown in the breakdown below.
          </div>
        )}

        {!isInsufficient && confluence.isCounterTrend && (
          <div className="rounded-md border border-orange-300 bg-orange-50 p-3 text-xs font-semibold text-orange-900">
            ⚠️ Counter-Trend Signal — this {confluence.bias.toLowerCase()} call is going against the macro trend
            ({confluence.macroTrend}). Higher risk; consider smaller size or tighter invalidation.
          </div>
        )}

        {!isInsufficient && confluence.wasDowngradedFromMacroOnly && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs font-medium text-blue-900">
            ℹ️ Downgraded to NEUTRAL — the macro trend alone leaned directional, but no other signal (RSI,
            short-term SMA, range position) confirmed it. Waiting for genuine multi-signal confluence.
          </div>
        )}

        {confluence.divergence && (
          <div className="rounded-md border border-purple-200 bg-purple-50 p-3 text-xs font-semibold text-purple-900">
            {confluence.divergence === "bullish"
              ? "🔍 Possible Bullish RSI Divergence — price made a lower low while RSI made a higher low. Worth a manual look, not a standalone signal."
              : "🔍 Possible Bearish RSI Divergence — price made a higher high while RSI made a lower high. Worth a manual look, not a standalone signal."}
          </div>
        )}

        {crossoverAlert && (
          <div className="rounded-md border border-indigo-200 bg-indigo-50/70 p-3 text-xs font-semibold text-indigo-900">
            {crossoverAlert}
          </div>
        )}

        {!isInsufficient && confluence.invalidationNote && (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
            <span className="font-semibold text-gray-900">Invalidation: </span>
            {confluence.invalidationNote}
          </div>
        )}

        {/* Confluence breakdown — every signal that fed the score, visible */}
        <div className="rounded-md border border-gray-200 bg-gray-50/80 p-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2 flex justify-between items-center">
            <span>
              Signal Confluence ({confluence.score >= 0 ? "+" : ""}
              {confluence.score} / ±{confluence.maxPossibleScore})
            </span>
            <span className="text-gray-700 font-bold">{confluence.macroTrend}</span>
          </div>
          <div className="space-y-1.5">
            {confluence.signals.map((s) => (
              <div
                key={s.name}
                className={`flex items-center justify-between gap-2 text-xs p-1.5 rounded ${
                  !s.available
                    ? "bg-gray-100 text-gray-400"
                    : s.weight > 0
                    ? "bg-emerald-50 text-emerald-900"
                    : s.weight < 0
                    ? "bg-rose-50 text-rose-900"
                    : "bg-white text-gray-600"
                }`}
              >
                <span className="font-medium">{s.name}</span>
                <span className="text-right">
                  {s.detail}
                  {s.available && s.weight !== 0 && (
                    <span className="ml-1.5 font-bold">
                      ({s.weight > 0 ? "+" : ""}
                      {s.weight})
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">
            Data confidence: {(confluence.confidence * 100).toFixed(0)}% of signals have enough history to
            contribute. Grayed-out rows aren't counted toward the score yet. Today's high/low may still be
            updating as new price checks come in — signals can shift until the day closes.
          </p>
        </div>

        <div className="rounded-md border border-brand-200 bg-brand-50/50 p-3">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-800">DCA Allocation Directive</div>
            <div className="text-xs font-bold text-brand-900 bg-brand-100 px-2 py-0.5 rounded">{style.action}</div>
          </div>
          <p className="text-xs text-brand-900/80 font-medium leading-normal mt-1">
            💡 <span className="underline decoration-brand-300 underline-offset-2">Meaning</span>:{" "}
            {isInsufficient
              ? "Wait for more history before sizing an entry — early signals on thin data are unreliable."
              : confluence.bias.includes("LONG")
              ? "Multiple signals align bullish. Execute tranches near support, respecting the invalidation level above."
              : confluence.bias.includes("SHORT")
              ? "Multiple signals align bearish or price is extended. Maintain cash reserves and wait for a better entry."
              : "Signals are mixed or offsetting. No strong edge either way — wait for clearer confluence."}
          </p>
        </div>

        <div className="rounded-md border border-gray-200 bg-gray-50/80 p-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
            Key Levels
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-white p-1.5 rounded border border-gray-100">
              <div className="text-[10px] text-gray-500 font-medium">Support</div>
              <div className="text-xs font-bold text-emerald-700">{formatPhp(confluence.support)}</div>
            </div>
            <div className="bg-white p-1.5 rounded border border-gray-100">
              <div className="text-[10px] text-gray-500 font-medium">Current</div>
              <div className="text-xs font-bold text-gray-800">{formatPhp(confluence.currentPrice)}</div>
            </div>
            <div className="bg-white p-1.5 rounded border border-gray-100">
              <div className="text-[10px] text-gray-500 font-medium">Resistance</div>
              <div className="text-xs font-bold text-rose-700">{formatPhp(confluence.resistance)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}