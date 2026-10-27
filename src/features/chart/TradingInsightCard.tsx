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
  lines.push(`- **Stance: NEUTRAL.** Do not default to bullish or "talk the trader into staying long."`);
  lines.push(`- If technicals and/or verified news are weak, risk-off, or bearish → say so clearly (WAIT / SKIP / TRIM / SELL as fits). Do not soften a bearish read into HOLD out of optimism.`);
  lines.push(`- Primary filter = technical snapshot below; news is secondary and only when verified.`);
  lines.push(`- You MAY search live **crypto-specific** news (protocol, exchange, regulation, ETF, unlocks, exploits); do NOT use training-memory headlines.`);
  lines.push(`- Skip routine macro calendars unless a clear, timely crypto link. Do not invent news. Unverified → "none verified".`);
  lines.push(`- Balanced view: list both supportive and negative factors when both exist; do not cherry-pick only bullish points.`);
  if (isAllocated) {
    lines.push(`- **Verified positive catalysts** may support HOLD or a short wait — only when they outweigh technical risk.`);
    lines.push(`- **Verified bad news** (unlock dump, delist risk, exploit, regulatory hit) → lean TRIM or SELL even if price has not fully reacted.`);
    lines.push(`- Extended into resistance with empty/mixed news → consider TRIM, not hopeful HOLD.`);
    lines.push(`- Underwater with no catalyst → patient hold or adds only on weakness are options; never revenge-buy. Selling is allowed when thesis is broken.`);
  } else {
    lines.push(`- SHORT / risk-off bias → hold cash / do not buy (never recommend shorting).`);
    lines.push(`- Price extended above the ladder → WAIT FOR PULLBACK over chasing.`);
    lines.push(`- Thin history, low confidence, or bearish structure → lean WAIT or SKIP — do not force a long.`);
  }
  lines.push(``);
  const pump = findLastPumpContext(chartPoints || []);
  if (pump) {
    const pumpDate = pump.period
      ? new Date(pump.period).toLocaleDateString("en-CA", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
      : "unknown";
    lines.push(`## Last local high / pump (from our daily series)`);
    lines.push(
      `- Peak ~**${pump.peak}** on **${pumpDate}** Manila (~${pump.daysAgo}d ago).`
    );
    lines.push(
      `- Now vs that peak: **${pump.dropPct >= 0 ? "−" : "+"}${Math.abs(pump.dropPct).toFixed(2)}%** (our poll data, not exchange OHLC).`
    );
    lines.push(
      `- Research task: search **verified** news around **${pumpDate}** and the days after that could explain a run-up and the subsequent move down (unlock, listing, exploit, regulatory, project news). Do not invent causes.`
    );
    lines.push(``);
  }

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

  // Concrete calendar anchor for the agent's timeframe answer (Manila)
  const todayManila = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  if (isAllocated) {
    lines.push(`## Answer format (position open)`);
    lines.push(`1. Verdict: **HOLD** | **WAIT A FEW MORE DAYS** | **TRIM (partial sell)** | **SELL (exit)**`);
    lines.push(`2. Why (max 3 technical bullets; max 2 verified news bullets)`);
    lines.push(`3. If TRIM/SELL: urgency (now vs into resistance) and what would justify holding instead`);
    lines.push(`4. If HOLD/WAIT: price or event that should flip you to sell`);
    lines.push(`5. Relate to break-even and days held when relevant`);
    lines.push(`6. **Timeframe (required):** give a calendar window anchored to today **${todayManila} (Manila)**.`);
    lines.push(`   - Prefer: **valid until YYYY-MM-DD** and/or **review again by YYYY-MM-DD**.`);
    lines.push(`   - Also state a rough hold horizon if useful (e.g. 3–7 days, 1–2 weeks) — must still include at least one concrete date.`);
    lines.push(`   - If uncertain, say so and give a short default review date (e.g. +3 or +7 Manila days), not an open-ended hold.`);
    lines.push(`7. News: verified only, or "none verified"`);
    lines.push(`8. Then output the **Final journal note** block exactly as specified below — this is the text the trader **copies into the app journal**. Keep it short, factual, and ready to paste.`);
  } else {
    lines.push(`## Answer format (no position)`);
    lines.push(`1. Verdict: **READY TO STAGE** | **WAIT FOR PULLBACK** | **SKIP**`);
    lines.push(`2. Why (max 3 technical bullets; max 2 verified news bullets if any)`);
    lines.push(`3. If READY or WAIT: which ladder level(s) and invalidation price`);
    lines.push(`4. Spot risk note (LONG only — no short / no leverage)`);
    lines.push(`5. **Timeframe (required):** anchored to today **${todayManila} (Manila)**.`);
    lines.push(`   - If READY TO STAGE: until when the ladder plan stays valid (**valid until YYYY-MM-DD**) and when to re-check if unfilled.`);
    lines.push(`   - If WAIT FOR PULLBACK: until when to keep waiting before the idea expires or needs a fresh review (**wait until / review by YYYY-MM-DD**).`);
    lines.push(`   - If SKIP: optional — when this setup might be worth looking at again (date or "not in the next 1–2 weeks").`);
    lines.push(`   - Always include at least one concrete calendar date, not only "a few days."`);
    lines.push(`6. News: verified items only, or "none verified"`);
    lines.push(`7. Then output the **Final journal note** block exactly as specified below.`);
  }

  lines.push(``);
  lines.push(`## Final journal note (REQUIRED — pure markdown, copy-paste ready)`);
  lines.push(
    `End your answer with ONLY this block (use real newlines, no HTML). Fill every field; use "n/a" if not applicable.`
  );
  lines.push(
    `The trader will **copy this markdown into General / coin journal** as the decision record — write it so it still makes sense in 3–7 days without the rest of the chat. **Always fill Agent** with your product name (e.g. ChatGPT, Grok, Gemini) and model if known.`
  );
  lines.push(``);
  lines.push('```markdown');
  if (isAllocated) {
    lines.push(`## ${pair} · hold/exit note · ${todayManila} (Manila)`);
    lines.push(``);
    lines.push(`- **Verdict:** HOLD | WAIT | TRIM | SELL`);
    lines.push(`- **Price now:** …`);
    lines.push(`- **Break-even / avg cost:** …`);
    lines.push(`- **Unrealized:** …% / … PHP`);
    lines.push(`- **Last pump / local high (if relevant):** date · peak · why it may have faded`);
    lines.push(`- **Sell / trim if price hits:** …`);
    lines.push(`- **Invalidation (thesis broken if):** …`);
    lines.push(`- **Timeframe — valid until:** YYYY-MM-DD`);
    lines.push(`- **Review again by:** YYYY-MM-DD`);
    lines.push(`- **News (verified only):** …`);
    lines.push(`- **Why (1–3 short lines):**`);
    lines.push(`  - …`);
  } else {
    lines.push(`## ${pair} · entry note · ${todayManila} (Manila)`);
    lines.push(``);
    lines.push(`- **Verdict:** READY TO STAGE | WAIT FOR PULLBACK | SKIP`);
    lines.push(`- **Price now:** …`);
    lines.push(`- **Ladder levels:**`);
    lines.push(`  - … (pct)`);
    lines.push(`- **Invalidation:** …`);
    lines.push(`- **Timeframe — valid until / review by:** YYYY-MM-DD`);
    lines.push(`- **News (verified only):** …`);
    lines.push(`- **Why (1–3 short lines):**`);
    lines.push(`  - …`);
  }
  lines.push('```');
  lines.push(``);
  lines.push(`The fenced markdown block above is what the trader saves as a note for later re-checks.`);

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
  structureLevels?: StructureKeyLevel[] | null,
  chartPoints?: { period?: string; high?: number; low?: number; close?: number }[] | null
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
      `Spot LONG review (already holding) ${label}. Pair ${pair}; search news as ${base} crypto not index/other meanings. No short/leverage. Be NEUTRAL — do not default bullish; if bearish/weak say TRIM/SELL/WAIT. Hold, trim, or wait?`
    );
    if (avgCost != null) {
      parts.push(`Avg cost ~${avgCost.toFixed(4)}; price ${c.currentPrice}; holdings ${holdings}.`);
    }
  } else {
    parts.push(
      `Spot LONG-only entry review ${label}. Pair ${pair}; search news as ${base} crypto not other meanings. No short/leverage/margin. Be NEUTRAL — do not force a long; if weak/bearish say WAIT or SKIP. Stage ladder buys or wait?`
    );
  }

  parts.push(
    `Data: ~8 polls/day → daily H/L for RSI/SMA/ATR/range; 3h series (~14d) for swings/ladder. Bias LONG=buy bias, SHORT=hold cash (never short).`
  );

  parts.push(
    `Snapshot: bias ${c.bias} (score ${c.score >= 0 ? "+" : ""}${c.score}/±${c.maxPossibleScore}, ${(c.confidence * 100).toFixed(0)}% conf). Macro ${c.macroTrend}. Price ${c.currentPrice}; support ${c.support}; resistance ${c.resistance}.`
  );

  const pumpG = findLastPumpContext(chartPoints || []);
  if (pumpG) {
    const pd = pumpG.period
      ? new Date(pumpG.period).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })
      : "?";
    parts.push(
      `Last local high ~${pumpG.peak} on ${pd} (~${pumpG.daysAgo}d ago, ${pumpG.dropPct}% below peak). Search verified news around that date for why price may be down.`
    );
  }

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

  const todayManila = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  if (isAllocated) {
    parts.push(
      `Answer: 1) HOLD | WAIT | TRIM | SELL  2) why  3) sell/trim trigger price  4) invalidation  5) Timeframe: valid until + review by YYYY-MM-DD (today Manila ${todayManila})  6) news  7) End with a markdown journal note block (Agent name e.g. ChatGPT/Grok/Gemini, verdict, levels, timeframe, news). Neutral stance. Do not invent news.`
    );
  } else {
    parts.push(
      `Answer: 1) READY TO STAGE | WAIT FOR PULLBACK | SKIP  2) why  3) ladder + invalidation  4) Timeframe: valid until / review by YYYY-MM-DD (today Manila ${todayManila})  5) news  6) End with markdown journal note (Agent name e.g. ChatGPT/Grok/Gemini, verdict, ladder, invalidation, timeframe, news). Neutral. Do not invent news.`
    );
  }

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
          <button
            type="button"
            onClick={handleCopyAgentPrompt}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-800 hover:bg-gray-50"
          >
            {agentCopied
              ? "✅ Copied"
              : activePortfolio && activePortfolio.holdings > 0
                ? "📋 Copy hold/exit review"
                : "📋 Copy entry review"}
          </button>
          <button
            type="button"
            onClick={handleOpenGoogleReview}
            title="Opens Google with a short review prompt. Full prompt also copied."
            className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-800 hover:bg-sky-100"
          >
            🔍 Google review
          </button>
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

