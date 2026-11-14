import { useMemo, useState } from "react";
import {
  buildCoinNewsResearchPrompt,
  buildCoinNewsResearchPromptCompact,
} from "@/lib/coinNewsResearchPrompt";
import type { ChartPoint } from "@/validators/recordSchema";
import { formatPhp } from "@/lib/format";
import { computeConfluenceSignal, detectCrossoverEvent,
  buildStructureKeyLevels,
  type StructureKeyLevel, BIAS_BADGE_CLASSES, isLongExtended, type BiasLabel } from "./Technicals";

interface TradingInsightCardProps {
  points: ChartPoint[];
  symbol: string | null;
  activePortfolio?: {
    holdings: number;
    spent: number;
    firstBuyAt?: string | null;
    daysHeld?: number | null;
  } | null;
  support?: number | null;
  resistance?: number | null;
  currentPrice?: number | null;
  intradayPoints?: ChartPoint[] | null;
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



/** Local pairs are stored as GRAMPHP / VIRTUALPHP — agents need the base crypto ticker. */
function baseAssetSymbol(symbol: string): string {
  const s = (symbol || "").trim().toUpperCase();
  if (s.endsWith("PHP") && s.length > 3) return s.slice(0, -3);
  return s;
}

/** Human + search-safe label so GRAM ≠ unit of mass, VIRTUAL ≠ English word, etc. */
function formatAssetLabel(symbol: string): { base: string; pair: string; label: string } {
  const pair = (symbol || "").trim().toUpperCase();
  const base = baseAssetSymbol(pair);
  const notes: Record<string, string> = {
    TX: "txEcosystem / Coreum–Sologenic merged token",
    POL: "Polygon (formerly MATIC)",
    VIRTUAL: "Virtuals Protocol AI agent token on Base — not the English word “virtual”",
    SPX: "SPX6900 meme coin — not the S&P 500 index",
    HYPE: "Hyperliquid token",
    RON: "Ronin / Axie Infinity token",
    GRAM: "Telegram/TON-related crypto token — not the unit of mass",
    UNI: "Uniswap token",
    LINK: "Chainlink",
    ENA: "Ethena",
    XAUT: "Tether Gold",
    ONDO: "Ondo Finance RWA",
    SKY: "Sky protocol (MakerDAO-related)",
    TRUMP: "TRUMP meme coin on Solana — not the person as a news topic alone",
    SOL: "Solana",
    SUI: "Sui blockchain",
    AAVE: "Aave DeFi",
    BCH: "Bitcoin Cash",
    XLM: "Stellar",
    HBAR: "Hedera",
  };
  const note = notes[base];
  const label = note ? `${base} (${note})` : `${base} (crypto token)`;
  return { base, pair, label };
}

/** Prompt for agent review — entry if flat, hold/exit if already allocated. */

/** Recent peak on daily (or poll) series — "last pump" for drawdown context. */
export function findLastPumpContext(
  points: { period?: string; high?: number; low?: number; close?: number }[]
): { period: string; peak: number; dropPct: number; daysAgo: number } | null {
  if (!points?.length) return null;
  const slice = points.slice(-90);
  let bestIdx = -1;
  let bestHigh = -Infinity;
  for (let i = 0; i < slice.length; i++) {
    const h = Number(slice[i].high ?? slice[i].close ?? 0);
    if (Number.isFinite(h) && h > bestHigh) {
      bestHigh = h;
      bestIdx = i;
    }
  }
  if (bestIdx < 0 || !Number.isFinite(bestHigh) || bestHigh <= 0) return null;
  const last = slice[slice.length - 1];
  const now = Number(last.close ?? last.high ?? last.low ?? 0);
  if (!Number.isFinite(now) || now <= 0) return null;
  // Only call it a pump peak if price has given back some ground since
  const dropPct = ((bestHigh - now) / bestHigh) * 100;
  if (dropPct < 1.5 && bestIdx >= slice.length - 2) return null;
  const period = String(slice[bestIdx].period || "");
  const peakMs = period ? new Date(period).getTime() : NaN;
  const nowMs = last.period ? new Date(String(last.period)).getTime() : Date.now();
  const daysAgo =
    Number.isFinite(peakMs) && Number.isFinite(nowMs)
      ? Math.max(0, Math.round((nowMs - peakMs) / 86400000))
      : slice.length - 1 - bestIdx;
  return { period, peak: bestHigh, dropPct: Number(dropPct.toFixed(2)), daysAgo };
}

export function formatEntryReviewPrompt(
  symbol: string,
  confluence: ReturnType<typeof computeConfluenceSignal>,
  crossoverAlert: string | null,
  activePortfolio?: {
    holdings: number;
    spent: number;
    firstBuyAt?: string | null;
    daysHeld?: number | null;
  } | null,
  structureLevels?: StructureKeyLevel[] | null,
  chartPoints?: { period?: string; high?: number; low?: number; close?: number }[] | null
): string {
  void crossoverAlert;
  void structureLevels;
  void chartPoints;
  const c = confluence;
  const { base, pair, label } = formatAssetLabel(symbol);
  const holdings = activePortfolio?.holdings ?? 0;
  const isAllocated = holdings > 0;
  const extra: string[] = [];
  if (c.currentPrice != null && Number.isFinite(c.currentPrice)) {
    extra.push(`Price now: ${c.currentPrice} (${pair})`);
  }
  if (crossoverAlert) extra.push(`App note: ${crossoverAlert}`);
  return buildCoinNewsResearchPrompt({
    coins: [{ symbol: pair, name: base || label }],
    mode: isAllocated ? "holding" : "not_holding",
    promptLabel: isAllocated ? "Spot · Agent (holding · news)" : "Spot · Agent (not held · news)",
    extraContext: extra,
  });
}

export function formatEntryReviewPromptForGoogle(
  symbol: string,
  confluence: ReturnType<typeof computeConfluenceSignal>,
  crossoverAlert: string | null,
  activePortfolio?: {
    holdings: number;
    spent: number;
    firstBuyAt?: string | null;
    daysHeld?: number | null;
  } | null,
  structureLevels?: StructureKeyLevel[] | null,
  chartPoints?: { period?: string; high?: number; low?: number; close?: number }[] | null
): string {
  void crossoverAlert;
  void structureLevels;
  void chartPoints;
  void confluence;
  const { base, pair, label } = formatAssetLabel(symbol);
  const holdings = activePortfolio?.holdings ?? 0;
  const isAllocated = holdings > 0;
  return buildCoinNewsResearchPromptCompact({
    coins: [{ symbol: pair, name: base || label }],
    mode: isAllocated ? "holding" : "not_holding",
    promptLabel: isAllocated ? "Spot · Google (holding)" : "Spot · Google (not held)",
  });
}


export default function TradingInsightCard({
  points,
  symbol,
  activePortfolio,
  support,
  resistance,
  currentPrice,
  intradayPoints,
}: TradingInsightCardProps) {
  const [agentCopied, setAgentCopied] = useState(false);

  const result = useMemo(() => {
    if (!symbol || points.length === 0) return null;
    const confluence = computeConfluenceSignal(points, { support, resistance, currentPrice, intradayPoints });
    const crossoverAlert = detectCrossoverEvent(points);
    return { confluence, crossoverAlert };
  }, [symbol, points, support, resistance, currentPrice, intradayPoints]);

  const structureLevels = useMemo(() => {
    const series =
      intradayPoints && intradayPoints.length >= 10 ? intradayPoints : points;
    const px = currentPrice ?? (series.length ? series[series.length - 1].close ?? series[series.length - 1].high : null);
    const s = support;
    const r = resistance;
    if (px == null || s == null || r == null || series.length < 10) return null;
    return buildStructureKeyLevels(series, px, s, r);
  }, [intradayPoints, points, currentPrice, support, resistance]);

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

  const holdings = activePortfolio?.holdings ?? 0;
  const spent = activePortfolio?.spent ?? 0;
  const isAllocated = holdings > 0;
  const avgCost = isAllocated && holdings > 0 ? spent / holdings : null;
  const px = currentPrice ?? confluence.currentPrice;
  const unrealizedPhp =
    isAllocated && avgCost != null && px != null ? (px - avgCost) * holdings : null;
  const unrealizedPct =
    isAllocated && avgCost != null && avgCost > 0 && px != null
      ? ((px - avgCost) / avgCost) * 100
      : null;
  const daysHeld = activePortfolio?.daysHeld ?? null;
  const firstBuyAt = activePortfolio?.firstBuyAt ?? null;

  const buildAgentPrompt = () =>
    formatEntryReviewPrompt(
      symbol,
      confluence,
      crossoverAlert,
      activePortfolio,
      structureLevels,
      points
    );

  const handleCopyAgentPrompt = () => {
    const prompt = buildAgentPrompt();
    navigator.clipboard.writeText(prompt);
    setAgentCopied(true);
    setTimeout(() => setAgentCopied(false), 2000);
  };


  /**
   * Open Google with the review text.
   * Browsers cannot programmatically paste into Google's box (security).
   * The only auto-fill is ?q= in the URL — Google truncates long queries (~2k chars),
   * so we always copy the FULL prompt and open a tab; user pastes with Ctrl/Cmd+V
   * when the box is empty or truncated (same practical flow as long Catalyst prompts).
   */
  const handleOpenGoogleReview = () => {
    // Full prompt on clipboard for paste into Gemini/AI Mode if needed
    const full = buildAgentPrompt();
    void navigator.clipboard.writeText(full).catch(() => {});

    // Compact prompt fits Google ?q= without mid-sentence cut
    const mini = formatEntryReviewPromptForGoogle(
      symbol,
      confluence,
      crossoverAlert,
      activePortfolio,
      structureLevels,
      points
    );
    const url = `https://www.google.com/search?q=${encodeURIComponent(mini)}`;
    window.open(url, "_blank", "noopener,noreferrer");

    setAgentCopied(true);
    setTimeout(() => setAgentCopied(false), 2500);
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          Spot Trading Insights <span className="text-brand-600">({symbol}/PHP)</span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${
              BIAS_BADGE_CLASSES[confluence.bias]
            }`}
          >
            BIAS: {confluence.bias}
          </span>
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${style.status}`}
          >
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

        {!isInsufficient && isLongExtended(confluence) && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
            ⏳ Extended — wait for pullback into the entry ladder. Bias is still bullish, but price has
            already run (upper range and/or above the top ladder tranche). Do not chase; stage buys on a dip.
          </div>
        )}

        {confluence.divergence && (
          <div className="rounded-md border border-purple-200 bg-purple-50 p-3 text-xs font-semibold text-purple-900">
            {confluence.divergence === "bullish"
              ? "🔍 Possible Bullish RSI Divergence — price made a lower low while RSI made a higher low. Worth a manual look, not a standalone signal."
              : "🔍 Possible Bearish RSI Divergence — price made a higher high while RSI made a lower high. Worth a manual look, not a standalone signal."}
          </div>
        )}

        {confluence.liquiditySweep && (
          <div className="rounded-md border border-cyan-200 bg-cyan-50 p-3 text-xs font-semibold text-cyan-900">
            {confluence.liquiditySweep.type === "bullish"
              ? `🎣 Liquidity Sweep — price wicked below ~${confluence.liquiditySweep.sweptLevel.toFixed(2)} to ~${confluence.liquiditySweep.extremePrice.toFixed(2)} and reclaimed it (${confluence.liquiditySweep.daysAgo}d ago). Classic stop-hunt pattern — often precedes a bounce, not a breakdown.`
              : `🎣 Liquidity Sweep — price wicked above ~${confluence.liquiditySweep.sweptLevel.toFixed(2)} to ~${confluence.liquiditySweep.extremePrice.toFixed(2)} and fell back below it (${confluence.liquiditySweep.daysAgo}d ago). Classic stop-hunt pattern — often precedes a drop, not a breakout.`}
          </div>
        )}

        {crossoverAlert && (
          <div className="rounded-md border border-indigo-200 bg-indigo-50/70 p-3 text-xs font-semibold text-indigo-900">
            {crossoverAlert}
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
            {confluence.signals
              .filter((s) => !/^swing structure$/i.test(s.name))
              .map((s) => (
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
      </div>
    </div>
  );
}

