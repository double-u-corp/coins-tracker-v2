import { useMemo, useState } from "react";
import Link from "next/link";
import type { ChartPoint } from "@/validators/recordSchema";
import { formatPhp } from "@/lib/format";
import {
  computeConfluenceSignal,
  isLongExtended,
  buildStructureKeyLevels,
  BIAS_BADGE_CLASSES,
  type ConfluenceResult,
} from "../../features/chart/Technicals";
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

function basisLabel(basis: string): string {
  switch (basis) {
    case "swing-low":
      return "swing low";
    case "support":
      return "support";
    case "swing-high":
      return "swing high";
    case "resistance":
      return "resistance";
    default:
      return basis;
  }
}

/** 3h structure deep-dive for SPOT — not leverage, not shorting. */
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
      mode: "spot",
      rangeLabel: PAST_TRADE_RANGE_LABEL,
    });
  }, [points, symbol, currentPrice, support, resistance]);

  if (!symbol) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">3h Structure Deep Dive</h3>
        <p className="mt-2 text-xs text-gray-500">
          Select a coin. Spot decides the bias — this page refines entry structure from finer prints.
        </p>
      </div>
    );
  }

  if (!confluence) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">3h Structure Deep Dive</h3>
        <p className="mt-2 text-xs text-gray-500">Loading structure for {symbol}…</p>
      </div>
    );
  }

  const c = confluence;
  const extended = c.bias.includes("LONG") && isLongExtended(c);
  const range = c.resistance - c.support;
  const pos = range > 0 && c.support != null ? (c.currentPrice - c.support) / range : 0.5;
  const positionLabel =
    extended || pos >= 0.6
      ? "Extended / upper zone — wait for pullback"
      : pos <= 0.33
      ? "Near floor / discount zone"
      : "Mid-range — ladder watch only";
  const spotHref = `/chart?symbol=${encodeURIComponent(symbol)}`;

  const copyLadder = () => {
    const lines = [
      `${symbol} — 3h structure (spot companion)`,
      `Price ${c.currentPrice} | Support ${c.support} | Resistance ${c.resistance}`,
      `3h structure read (confirm on Spot): ${c.bias}`,
    ];
    if (c.entrySuggestion) {
      lines.push("Entry ladder:");
      for (const l of c.entrySuggestion.ladder) {
        lines.push(`  ~${l.price} (${l.basis}) ${l.allocationPct}%`);
      }
    }
    if (c.invalidationLevel != null) lines.push(`Invalidation ~${c.invalidationLevel}`);
        try {
      const levels = buildStructureKeyLevels(
        points,
        currentPrice,
        support ?? confluence.support,
        resistance ?? confluence.resistance
      );
      if (levels.length) {
        lines.push("");
        lines.push("Structure key levels:");
        for (const lvl of levels) {
          lines.push(`- ${lvl.shortLabel}: ${lvl.price} (${lvl.label})`);
        }
      }
    } catch {
      /* ignore */
    }
    void navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            3h Structure Deep Dive <span className="text-brand-600 font-bold">({symbol})</span>
          </h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Spot decides buy / wait / cash. This page only refines <span className="font-semibold">where</span> to stage limits.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={spotHref}
            className="rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 text-[11px] font-semibold text-purple-800 hover:bg-purple-100"
          >
            📈 Open Spot chart
          </Link>
          <button
            type="button"
            onClick={copyLadder}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
          >
            {copied ? "✅ Copied" : "📋 Copy ladder"}
          </button>
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-700">
            Confirm bias on Spot
          </span>
        </div>
      </div>

      <div
        className={`rounded-md border px-3 py-2 text-[11px] ${
          seriesDensity.isFastEnough
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : "border-amber-200 bg-amber-50 text-amber-950"
        }`}
      >
        {seriesDensity.isFastEnough ? (
          <span>
            ✅ Prints often enough for structure
            {seriesDensity.avgRecentGapHours != null &&
              ` (~${seriesDensity.avgRecentGapHours.toFixed(1)}h between recent prints)`}
            {seriesDensity.lastObservedAgoMs != null &&
              ` · last ${formatAgo(seriesDensity.lastObservedAgoMs)}`}
          </span>
        ) : (
          <span>
            ⚠️ Sparse prints — treat levels carefully; confirm on{" "}
            <Link href={spotHref} className="font-semibold underline">
              Spot
            </Link>
            .
          </span>
        )}
      </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-800">
        Position: {positionLabel}
      </div>

      {extended && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-950">
          ⏳ Extended vs support/ladder — wait for pullback. Do not chase.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
        <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5">
          <div className="text-[10px] font-bold uppercase text-gray-400">Price</div>
          <div className="font-bold tabular-nums">{formatPhp(c.currentPrice)}</div>
        </div>
        <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5">
          <div className="text-[10px] font-bold uppercase text-gray-400">Support</div>
          <div className="font-bold tabular-nums text-emerald-800">{formatPhp(c.support)}</div>
        </div>
        <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5">
          <div className="text-[10px] font-bold uppercase text-gray-400">Resistance</div>
          <div className="font-bold tabular-nums text-rose-800">{formatPhp(c.resistance)}</div>
        </div>
        <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5">
          <div className="text-[10px] font-bold uppercase text-gray-400">Prints</div>
          <div className="font-bold tabular-nums">{seriesDensity.pointCount}</div>
        </div>
      </div>

      <div className="rounded-md border border-gray-100 bg-gray-50/80 p-3 space-y-1">
        <div className="text-[10px] font-bold uppercase text-gray-500">Poll-path signals (confirm on Spot)</div>
        {c.signals
          .filter((s) => s.available)
          .map((s) => (
            <div key={s.name} className="flex justify-between gap-2 text-[11px]">
              <span className="text-gray-600">{s.name}</span>
              <span className="text-right text-gray-900">
                {s.detail}
                {s.weight !== 0 && (
                  <span className="ml-1 font-semibold text-gray-500">
                    ({s.weight > 0 ? "+" : ""}
                    {s.weight})
                  </span>
                )}
              </span>
            </div>
          ))}
      </div>

      {c.entrySuggestion && c.entrySuggestion.ladder.length > 0 && (
        <div className="rounded-md border border-indigo-100 bg-indigo-50/50 p-3">
          <div className="text-xs font-bold text-indigo-950">Spot entry ladder (from 3h swings)</div>
          <p className="mt-0.5 text-[10px] text-indigo-800/80">
            Stage limit buys on weakness — only if Spot bias supports a long.
          </p>
          <ul className="mt-2 space-y-1">
            {c.entrySuggestion.ladder.map((l) => (
              <li
                key={`${l.price}-${l.basis}`}
                className="flex justify-between text-[11px] font-semibold text-gray-900"
              >
                <span>
                  ~{formatPhp(l.price)}{" "}
                  <span className="font-normal text-gray-500">({basisLabel(l.basis)})</span>
                </span>
                <span className="text-indigo-700">{l.allocationPct}%</span>
              </li>
            ))}
          </ul>
          {c.entrySuggestion.note && (
            <p className="mt-2 text-[10px] text-gray-600">{c.entrySuggestion.note}</p>
          )}
        </div>
      )}

      {c.invalidationNote && (
        <div className="rounded-md border border-rose-100 bg-rose-50/50 p-3">
          <div className="text-xs font-bold text-gray-900">Invalidation (spot)</div>
          <p className="mt-1 text-[11px] text-gray-700">{c.invalidationNote}</p>
        </div>
      )}

      <p className="text-[10px] text-gray-400 border-t border-gray-100 pt-2">
        PHP spot · long-only · no leverage. Confirm bias on{" "}
        <Link href={spotHref} className="font-semibold text-purple-700 hover:underline">
          Spot chart
        </Link>
        .
      </p>
    </div>
  );
}
