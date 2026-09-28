import { useMemo, useState } from "react";
import type { ChartPoint } from "@/validators/recordSchema";
import { formatPhp } from "@/lib/format";
import {
  computeConfluenceSignal,
  BIAS_BADGE_CLASSES,
  type ConfluenceResult,
} from "../../features/chart/Technicals";
import { formatSingleScanResult, type ScanResult } from "../../features/chart/useCoinScanner";
import { PAST_TRADE_RANGE_LABEL, type SeriesDensity } from "./usePastTradeLogic";

interface PastTradeInsightCardProps {
  points: ChartPoint[];
  symbol: string;
  currentPrice: number;
  support: number | null;
  resistance: number | null;
  seriesDensity: SeriesDensity;
}

function formatAgo(ms: number): string {
  const hours = ms / (60 * 60 * 1000);
  if (hours < 1) return `${Math.round(ms / (60 * 1000))}m ago`;
  if (hours < 48) return `${hours.toFixed(1)}h ago`;
  return `${(hours / 24).toFixed(1)}d ago`;

}

function ladderTitle(bias: ConfluenceResult["bias"]): string {
  if (bias.includes("SHORT")) return "Short Entry Ladder";
  if (bias.includes("LONG")) return "Long Entry Ladder";
  return "Levels to Watch";
}

function basisLabel(basis: string): string {
  switch (basis) {
    case "swing-low":
      return "confirmed swing low";
    case "swing-high":
      return "confirmed swing high";
    case "support":
      return "range support";
    case "resistance":
      return "range resistance";
    default:
      return basis;
  }
}

export default function PastTradeInsightCard({
  points,
  symbol,
  currentPrice,
  support,
  resistance,
  seriesDensity,
}: PastTradeInsightCardProps) {
  const [copied, setCopied] = useState(false);

  const confluence = useMemo<ConfluenceResult | null>(() => {
    if (!symbol || points.length === 0 || support == null || resistance == null) return null;
    return computeConfluenceSignal(points, {
      support,
      resistance,
      currentPrice,
      mode: "leverage",
      rangeLabel: PAST_TRADE_RANGE_LABEL,
    });
  }, [points, symbol, currentPrice, support, resistance]);

  if (!symbol) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">Fast-Trade Signal</h3>
        <p className="mt-2 text-xs text-gray-500">Select a coin to view its 3h entry/exit read.</p>
      </div>
    );
  }

  if (!confluence) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">
          Fast-Trade Signal <span className="text-brand-600">({symbol})</span>
        </h3>
        <p className="mt-2 text-xs text-gray-500">Loading 3h candles…</p>
      </div>
    );
  }

  const c = confluence;
  const insufficient = c.bias === "INSUFFICIENT DATA";

  const handleCopy = () => {
    const scanResult: ScanResult = {
      symbol,
      name: symbol,
      confluence: c,
      error: null,
      streak: 0,
      scannedAt: new Date().toISOString(),
    };
    navigator.clipboard.writeText(formatSingleScanResult(scanResult));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2 border-b border-gray-100 pb-3">
        <h3 className="text-sm font-semibold text-gray-900">
          Fast-Trade Signal <span className="text-brand-600">({symbol}/PHP · intraday)</span>
        </h3>
        {!insufficient && (
          <button
            type="button"
            onClick={handleCopy}
            className="text-[11px] font-semibold text-white bg-gray-700 hover:bg-gray-800 rounded px-2.5 py-1 transition"
          >
            {copied ? "✅ Copied!" : "📋 Copy summary"}
          </button>
        )}
      </div>

      {/* Data freshness/density — the real "can I fast-trade this coin"
          check, since this feed only prints a new point when a new high/low
          actually happens (see usePastTradeLogic's computeSeriesDensity).
          A quiet coin can still show a confident-looking SMA/RSI signal
          below even though the data behind it is stale or thin, so this
          goes first. */}
      {seriesDensity.pointCount >= 2 && (
        <div
          className={`rounded-md border p-2.5 text-[11px] ${
            seriesDensity.isFastEnough
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          <span className="font-semibold">
            {seriesDensity.isFastEnough ? "✅ Printing frequently" : "⚠️ Printing slowly"}
          </span>
          {" — "}
          last new high/low {seriesDensity.lastObservedAgoMs != null ? formatAgo(seriesDensity.lastObservedAgoMs) : "unknown"}
          {seriesDensity.avgRecentGapHours != null && (
            <>, averaging ~{seriesDensity.avgRecentGapHours.toFixed(1)}h between recent prints</>
          )}
          {seriesDensity.spanDays != null && <> · {Math.round(seriesDensity.spanDays)} day(s) of history</>}
          {!seriesDensity.isFastEnough && (
            <span className="block mt-1 font-normal">
              This coin isn't setting new highs/lows often enough right now for a confident
              fast-trade read off this feed — consider a more active coin, or size this down and
              treat it more like a spot-timeframe idea than a fast trade.
            </span>
          )}
        </div>
      )}

      {insufficient ? (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
          Not enough intraday history yet for {symbol} to call a bias (need at least 20 recorded
          highs/lows — more for the 50/200 SMA to fill in). Check back once more history has been
          collected, or try a coin that's been tracked longer.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md border px-2.5 py-1 text-xs font-bold ${BIAS_BADGE_CLASSES[c.bias]}`}>
              {c.bias}
            </span>
            <span className="text-xs text-gray-500">
              Score {c.score >= 0 ? "+" : ""}
              {c.score}/±{c.maxPossibleScore} · {(c.confidence * 100).toFixed(0)}% data available
            </span>
            {c.isCounterTrend && (
              <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                ⚠️ Counter-trend vs macro
              </span>
            )}
          </div>

          <div className="text-xs text-gray-600">
            <span className="font-semibold">Macro (50 vs 200 SMA):</span> {c.macroTrend}
          </div>

          {/* Signal breakdown — the "why" behind the score, one line per indicator */}
          <div className="rounded-md border border-gray-100 bg-gray-50 p-3 space-y-1.5">
            {c.signals.map((s) => (
              <div key={s.name} className="flex items-start justify-between gap-2 text-[11px]">
                <span className={`font-medium ${s.available ? "text-gray-700" : "text-gray-400"}`}>
                  {s.name}
                </span>
                <span className={`text-right ${!s.available ? "text-gray-400" : s.weight > 0 ? "text-emerald-700" : s.weight < 0 ? "text-rose-700" : "text-gray-500"}`}>
                  {s.detail}
                </span>
              </div>
            ))}
          </div>

          {c.divergence && (
            <p className="text-[11px] text-sky-800 bg-sky-50 border border-sky-200 rounded-md p-2">
              🔍 Possible {c.divergence} RSI divergence — worth a manual look, not a standalone
              signal on its own.
            </p>
          )}

          {c.liquiditySweep && (
            <p className="text-[11px] text-purple-800 bg-purple-50 border border-purple-200 rounded-md p-2">
              🎣 {c.liquiditySweep.type === "bullish" ? "Bullish" : "Bearish"} liquidity sweep: swept{" "}
              {formatPhp(c.liquiditySweep.sweptLevel)} to an extreme of {formatPhp(c.liquiditySweep.extremePrice)}{" "}
              ({c.liquiditySweep.daysAgo} print(s) ago).
            </p>
          )}

          {/* Entry ladder — where the technicals say to stage in */}
          {c.entrySuggestion && (
            <div className="rounded-md border border-emerald-100 bg-emerald-50/50 p-3 space-y-1.5">
              <div className="text-xs font-bold text-gray-900">{ladderTitle(c.bias)}</div>
              {c.entrySuggestion.ladder.map((level, i) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="font-mono font-semibold text-gray-800">
                    ~{formatPhp(level.price)}
                  </span>
                  <span className="text-gray-500">{basisLabel(level.basis)}</span>
                  <span className="font-semibold text-emerald-700">{level.allocationPct}%</span>
                </div>
              ))}
              <p className="text-[11px] text-gray-600 pt-1 border-t border-emerald-100">
                {c.entrySuggestion.note}
              </p>
            </div>
          )}

          {/* Exit / take-profit target */}
          {c.exitSuggestion && (
            <div className="rounded-md border border-blue-100 bg-blue-50/50 p-3">
              <div className="text-xs font-bold text-gray-900">Exit / Take-Profit Target</div>
              <div className="mt-1 flex items-center justify-between text-[11px]">
                <span className="font-mono font-semibold text-gray-800">
                  ~{formatPhp(c.exitSuggestion.price)}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-gray-600">{c.exitSuggestion.note}</p>
            </div>
          )}

          {/* Invalidation / stop-loss */}
          {c.invalidationNote && (
            <div className="rounded-md border border-rose-100 bg-rose-50/50 p-3">
              <div className="text-xs font-bold text-gray-900">Invalidation / Stop</div>
              <p className="mt-1 text-[11px] text-gray-700">{c.invalidationNote}</p>
            </div>
          )}

          <p className="text-[10px] text-gray-400 pt-2 border-t border-gray-100">
            Leverage/margin trading carries liquidation risk beyond spot — this is a technical read
            of recorded intraday highs/lows, not financial advice. Size and leverage are your call.
          </p>
        </>
      )}
    </div>
  );
}
