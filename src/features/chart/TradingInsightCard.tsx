import { useMemo, useState } from "react";
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
  structureLevels?: StructureKeyLevel[] | null
): string {
  const c = confluence;
  const { base, pair, label } = formatAssetLabel(symbol);
  const holdings = activePortfolio?.holdings ?? 0;
  const spent = activePortfolio?.spent ?? 0;
  const isAllocated = holdings > 0;
  const avgCost = isAllocated && holdings > 0 ? spent / holdings : null;
  const unrealized =
    isAllocated && avgCost != null && c.currentPrice != null
      ? (c.currentPrice - avgCost) * holdings
      : null;
  const unrealizedPct =
    isAllocated && avgCost != null && avgCost > 0 && c.currentPrice != null
      ? ((c.currentPrice - avgCost) / avgCost) * 100
      : null;
  const daysHeld = activePortfolio?.daysHeld ?? null;
  const firstBuyAt = activePortfolio?.firstBuyAt ?? null;

  const lines: string[] = [];

  if (isAllocated) {
    lines.push(`You are reviewing an **open spot LONG** in **${label}**.`);
    lines.push(`Local PHP spot pair symbol in the app: **${pair}** (underlying asset ticker: **${base}**). When searching news, use **${base}** / the crypto project name — not “${pair}” and not non-crypto meanings of “${base}”.`);
    lines.push(`The trader **already holds** this coin. **No shorting. No leverage.** Question: **hold, trim/sell, or wait** — not "should I open a new bag from zero."`);
  } else {
    lines.push(`You are reviewing a **spot LONG-only** entry for **${label}**.`);
    lines.push(`Local PHP spot pair symbol in the app: **${pair}** (underlying asset ticker: **${base}**). When searching news, use **${base}** / the crypto project name — not “${pair}” and not non-crypto meanings of “${base}”.`);
    lines.push(`The trader does **not** hold this coin yet. **No shorting. No leverage. No margin.** Question: is it reasonable to **stage buy limit orders** on the ladder (or wait)?`);
  }

  lines.push(``);
  lines.push(`## How this technical data is built (important)`);
  lines.push(`- Price is polled about **8 times per day** (~every 3 hours, Manila schedule).`);
  lines.push(`- **Daily bar** = that day's high and low (and effective close) from those checks. Used for RSI, SMA 20/50/200, ATR, 30-day support/resistance, and the main confluence score.`);
  lines.push(`- **Swing / entry ladder** uses the finer **3-hour (8-check) series** over roughly the last 14 days — fractal swing highs/lows, structure, and ladder levels.`);
  lines.push(`- Bias: LONG = constructive for buyers; SHORT = risk-off / prefer cash (never a short recommendation).`);
  lines.push(`- Do not assume exchange OHLC 1h/4h candles — this is our poll → daily aggregate + 3h swing series.`);
  lines.push(``);

  if (isAllocated) {
    lines.push(`## Position (already allocated)`);
    lines.push(`- Holdings: ${holdings}`);
    lines.push(`- Net spent (cost basis proxy): ${spent}`);
    if (avgCost != null) {
      lines.push(`- **Break-even / avg cost: ~${avgCost}**`);
      lines.push(`  - Mark above break-even → selling locks a gain; below → selling realizes a loss.`);
      lines.push(`  - Prefer trims into strength above break-even; avoid panic sells on noise if thesis still valid.`);
    }
    lines.push(`- Mark price (snapshot): ${c.currentPrice}`);
    if (unrealized != null && unrealizedPct != null) {
      lines.push(
        `- Unrealized (approx): ${unrealized >= 0 ? "+" : ""}${unrealized.toFixed(2)} PHP (${unrealizedPct >= 0 ? "+" : ""}${unrealizedPct.toFixed(1)}%)`
      );
    }
    if (daysHeld != null) {
      lines.push(
        `- **Days held (since first buy): ${daysHeld}d**${firstBuyAt ? ` (first buy ~${String(firstBuyAt).slice(0, 10)})` : ""}`
      );
      lines.push(`  - Long hold underwater with no catalyst → patience or thesis review, not revenge adds.`);
      lines.push(`  - Short hold + extended into resistance → trims more reasonable than waiting forever.`);
    }
    lines.push(`- Use this to judge **trim / full exit / hold** — average-down only if technicals + verified news support it.`);
    lines.push(``);
  }

  lines.push(`## Rules`);
  lines.push(`- Primary filter = technical snapshot below.`);
  lines.push(`- You MAY search live news/trends; do NOT use training-memory headlines (often stale).`);
  lines.push(`- Do not invent news. Unverified → say "none verified".`);
  if (isAllocated) {
    lines.push(`- **Good verified upcoming catalysts** (listings, unlocks delayed positively, adoption) → lean HOLD or wait a few more days before selling strength.`);
    lines.push(`- **Bad verified news ahead** (unlock dump, delist risk, exploit, regulatory hit) → lean TRIM or SELL even if price hasn't fully reacted.`);
    lines.push(`- If technicals are extended into resistance and news is empty/mixed → consider partial take-profit, not FOMO hold.`);
    lines.push(`- If still underwater and no clear catalyst, prefer patient hold or ladder adds only on weakness — never revenge-buy.`);
  } else {
    lines.push(`- SHORT / risk-off bias → hold cash / do not buy (never short).`);
    lines.push(`- Price extended above the ladder → WAIT FOR PULLBACK over chasing.`);
    lines.push(`- Thin history or low confidence → lean WAIT or SKIP.`);
  }
  lines.push(``);
  lines.push(`## Technical snapshot`);
  lines.push(`- Bias: **${c.bias}** (score ${c.score >= 0 ? "+" : ""}${c.score}/±${c.maxPossibleScore}, ${(c.confidence * 100).toFixed(0)}% data)`);
  lines.push(`- Macro: ${c.macroTrend}${c.isCounterTrend ? " — short-term bias conflicts with macro" : ""}`);
  lines.push(`- Price now: ${c.currentPrice}`);
  lines.push(`- Support: ${c.support} | Resistance: ${c.resistance}`);
  if (structureLevels && structureLevels.length > 0) {
    lines.push(`- Structure key levels (poll/swing path — placement aids, confirm bias on Spot):`);
    for (const lvl of structureLevels) {
      lines.push(`  - ${lvl.shortLabel || lvl.label}: ${lvl.price} (${lvl.label})`);
    }
  }
  lines.push(
    `- Swing series: ${c.usedIntradaySwings ? "3h / 8-check intraday" : "daily bars (intraday unavailable)"}`
  );
  if (c.invalidationLevel != null) {
    lines.push(`- Invalidation reference: ~${c.invalidationLevel}`);
  }
  if (c.liquiditySweep) {
    lines.push(
      `- Liquidity sweep: ${c.liquiditySweep.type} at ${c.liquiditySweep.sweptLevel} (extreme ${c.liquiditySweep.extremePrice}, ${c.liquiditySweep.daysAgo}d ago)`
    );
  }
  if (c.divergence) lines.push(`- RSI divergence hint: ${c.divergence} (supporting only)`);
  if (crossoverAlert) lines.push(`- Event flag: ${crossoverAlert}`);
  lines.push(`- Confluence signals:`);
  for (const s of c.signals) {
    if (!s.available) continue;
    lines.push(
      `  - ${s.name}: ${s.detail}${s.weight !== 0 ? ` (${s.weight > 0 ? "+" : ""}${s.weight})` : ""}`
    );
  }
  if (c.entrySuggestion?.ladder?.length) {
    lines.push(
      isAllocated
        ? `- Reference buy ladder (only relevant if averaging on weakness — optional):`
        : `- Proposed buy ladder (limit buys on weakness — not market-buy-now):`
    );
    for (const lvl of c.entrySuggestion.ladder) {
      lines.push(`  - ~${lvl.price} (${lvl.basis}) — ~${lvl.allocationPct}%`);
    }
  }
  if (c.exitSuggestion?.price != null) {
    lines.push(
      isAllocated
        ? `- Take-profit / trim reference: ~${c.exitSuggestion.price}`
        : `- Take-profit reference (if you were holding): ~${c.exitSuggestion.price}`
    );
  }
  if (c.invalidationNote) lines.push(`- Invalidation detail: ${c.invalidationNote}`);
  lines.push(``);

  if (isAllocated) {
    lines.push(`## Answer format (position open)`);
    lines.push(`1. Verdict: **HOLD** | **WAIT A FEW MORE DAYS** | **TRIM (partial sell)** | **SELL (exit)**`);
    lines.push(`2. Why (max 3 technical bullets; max 2 verified news bullets)`);
    lines.push(`3. If TRIM/SELL: urgency (now vs into resistance) and what would justify holding instead`);
    lines.push(`4. If HOLD/WAIT: price or event that should flip you to sell`);
    lines.push(`5. Relate to break-even and days held when relevant`);
    lines.push(`6. News: verified only, or "none verified"`);
  } else {
    lines.push(`## Answer format (no position)`);
    lines.push(`1. Verdict: **READY TO STAGE** | **WAIT FOR PULLBACK** | **SKIP**`);
    lines.push(`2. Why (max 3 technical bullets; max 2 verified news bullets if any)`);
    lines.push(`3. If READY or WAIT: which ladder level(s) and invalidation price`);
    lines.push(`4. Spot risk note (LONG only — no short / no leverage)`);
    lines.push(`5. News: verified items only, or "none verified"`);
  }

  return lines.join("\n");
}



/** Compact review text for Google ?q= (stays under URL limits). Full detail stays on Copy. */
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
  structureLevels?: StructureKeyLevel[] | null
): string {
  const c = confluence;
  const { base, pair, label } = formatAssetLabel(symbol);
  const holdings = activePortfolio?.holdings ?? 0;
  const spent = activePortfolio?.spent ?? 0;
  const isAllocated = holdings > 0;
  const avgCost = isAllocated && holdings > 0 ? spent / holdings : null;

  const parts: string[] = [];

  if (isAllocated) {
    parts.push(
      `Spot LONG review (already holding) ${label}. Pair ${pair}; search news as ${base} crypto not index/other meanings. No short/leverage. Hold, trim, or wait?`
    );
    if (avgCost != null) {
      parts.push(`Avg cost ~${avgCost.toFixed(4)}; price ${c.currentPrice}; holdings ${holdings}.`);
    }
  } else {
    parts.push(
      `Spot LONG-only entry review ${label}. Pair ${pair}; search news as ${base} crypto not other meanings. No short/leverage/margin. Stage ladder buys or wait?`
    );
  }

  parts.push(
    `Data: ~8 polls/day → daily H/L for RSI/SMA/ATR/range; 3h series (~14d) for swings/ladder. Bias LONG=buy bias, SHORT=hold cash (never short).`
  );

  parts.push(
    `Snapshot: bias ${c.bias} (score ${c.score >= 0 ? "+" : ""}${c.score}/±${c.maxPossibleScore}, ${(c.confidence * 100).toFixed(0)}% conf). Macro ${c.macroTrend}. Price ${c.currentPrice}; support ${c.support}; resistance ${c.resistance}.`
  );

  if (c.invalidationLevel != null) {
    parts.push(`Invalidation ~${Number(c.invalidationLevel).toFixed(2)}.`);
  }

  const sigBits = c.signals
    .filter((s) => s.available && s.weight !== 0)
    .slice(0, 6)
    .map((s) => `${s.name}:${s.weight > 0 ? "+" : ""}${s.weight}`)
    .join("; ");
  if (sigBits) parts.push(`Signals: ${sigBits}.`);

  if (crossoverAlert) parts.push(`Event: ${crossoverAlert}`);

  if (c.entrySuggestion?.ladder?.length) {
    const ladder = c.entrySuggestion.ladder
      .map((l) => `~${l.price}(${l.allocationPct}%)`)
      .join(", ");
    parts.push(`Ladder limits: ${ladder}.`);
  }
  if (structureLevels && structureLevels.length > 0) {
    const bits = structureLevels
      .slice(0, 6)
      .map((l) => `${l.shortLabel || l.label}:${l.price}`)
      .join(" ");
    parts.push(`Key levels: ${bits}.`);
  }
  if (c.exitSuggestion?.price != null) {
    parts.push(`TP ref ~${c.exitSuggestion.price}.`);
  }

  parts.push(
    `Answer: 1) READY TO STAGE | WAIT FOR PULLBACK | SKIP  2) why (tech + verified news only)  3) ladder levels + invalidation  4) spot risk  5) news or none verified. Do not invent news.`
  );

  return parts.join(" ");
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
    formatEntryReviewPrompt(symbol, confluence, crossoverAlert, activePortfolio, structureLevels);

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
      structureLevels
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
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleCopyAgentPrompt}
            title="Copy review prompt to clipboard"
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
          >
            {agentCopied
              ? "✅ Copied — Ctrl/Cmd+V to paste"
              : activePortfolio && activePortfolio.holdings > 0
              ? "📋 Copy hold/exit review"
              : "📋 Copy entry review"}
          </button>
          <button
            type="button"
            onClick={handleOpenGoogleReview}
            title="Opens Google with a short full-context review (fits URL). Full long prompt also copied for paste if needed."
            className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-800 hover:bg-sky-100"
          >
            🔍 Google review
          </button>
          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${BIAS_BADGE_CLASSES[confluence.bias]}`}>
            BIAS: {confluence.bias}
          </span>
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${style.status}`}>
            {style.statusText}
          </span>
        </div>
      </div>

      {/* #2 Position bridge — only when you hold this coin */}
      {isAllocated && (
        <div className="mb-3 rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-violet-800">
              🎒 Open position
            </span>
            <span className="text-[11px] font-semibold text-violet-700">
              Spot LONG · no leverage
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-md bg-white/80 border border-violet-100 px-2 py-1.5">
              <div className="text-[10px] font-bold uppercase text-gray-400">Holdings</div>
              <div className="text-sm font-bold tabular-nums text-gray-900">
                {holdings.toLocaleString(undefined, { maximumFractionDigits: 6 })}
              </div>
            </div>
            <div className="rounded-md bg-white/80 border border-violet-100 px-2 py-1.5">
              <div className="text-[10px] font-bold uppercase text-gray-400">Avg cost</div>
              <div className="text-sm font-bold tabular-nums text-gray-900">
                {avgCost != null ? formatPhp(avgCost) : "—"}
              </div>
            </div>
            <div className="rounded-md bg-white/80 border border-violet-100 px-2 py-1.5">
              <div className="text-[10px] font-bold uppercase text-gray-400">Unrealized</div>
              <div
                className={`text-sm font-bold tabular-nums ${
                  unrealizedPhp == null
                    ? "text-gray-900"
                    : unrealizedPhp >= 0
                    ? "text-emerald-700"
                    : "text-rose-700"
                }`}
              >
                {unrealizedPhp != null ? (
                  <>
                    {unrealizedPhp >= 0 ? "+" : ""}
                    {formatPhp(unrealizedPhp)}
                    {unrealizedPct != null && (
                      <span className="ml-1 text-[11px] font-semibold">
                        ({unrealizedPct >= 0 ? "+" : ""}
                        {unrealizedPct.toFixed(1)}%)
                      </span>
                    )}
                  </>
                ) : (
                  "—"
                )}
              </div>
            </div>
            <div className="rounded-md bg-white/80 border border-violet-100 px-2 py-1.5">
              <div className="text-[10px] font-bold uppercase text-gray-400">Days held</div>
              <div className="text-sm font-bold tabular-nums text-gray-900">
                {daysHeld != null ? `${daysHeld}d` : "—"}
                {firstBuyAt && (
                  <span className="ml-1 text-[10px] font-medium text-gray-400">
                    since {String(firstBuyAt).slice(0, 10)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-violet-900/80">
            You already hold this coin — use <span className="font-semibold">hold/exit review</span> (not a fresh
            entry). Bias below is context; decision is hold, trim, or wait.
          </p>
        </div>
      )}

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

        {!isInsufficient && (confluence.entrySuggestion || confluence.exitSuggestion || confluence.invalidationNote) && (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                Entry / Stop / Target — Suggestion Only
              </span>
            </div>
            {confluence.entrySuggestion && (
              <div className="text-xs text-gray-700 space-y-1">
                <span className="font-semibold text-emerald-700">Entry Ladder:</span>
                <ul className="space-y-0.5 pl-3">
                  {confluence.entrySuggestion.ladder.map((level, idx) => (
                    <li key={idx} className="flex items-center justify-between">
                      <span>
                        ~{formatPhp(level.price)}{" "}
                        <span className="text-gray-400">
                          ({level.basis === "swing-low" ? "swing low" : "support"})
                        </span>
                      </span>
                      <span className="font-semibold text-emerald-700">{level.allocationPct}%</span>
                    </li>
                  ))}
                </ul>
                <p>{confluence.entrySuggestion.note}</p>
              </div>
            )}
            {confluence.invalidationNote && (
              <div className="text-xs text-gray-700">
                <span className="font-semibold text-rose-700">Stop: </span>
                {confluence.invalidationNote}
              </div>
            )}
            {confluence.exitSuggestion && (
              <div className="text-xs text-gray-700">
                <span className="font-semibold text-blue-700">Target ~{formatPhp(confluence.exitSuggestion.price)}: </span>
                {confluence.exitSuggestion.note}
              </div>
            )}
            <p className="text-[10px] text-gray-400 pt-1 border-t border-gray-200">
              These are technical reference levels only, not instructions — news, fundamentals, and your own risk
              tolerance can override any of this. You're responsible for the call either way.
            </p>
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
              ? "Multiple signals align bearish or price is extended. This means wait, not short — hold cash and watch for a pullback into the entry ladder above."
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