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
    lines.push(`You are researching **${label}** for a trader who **already holds** a spot position (PHP pair **${pair}**, ticker **${base}**).`);
    lines.push(`When searching news, use **${base}** / the project name — not “${pair}” and not non-crypto meanings of “${base}”.`);
    lines.push(`**Focus: verified current events + next ~30 days only.** Do **not** dig a long past history. The trader will decide later whether to add or sell — your job is **event/catalyst research**, not size advice.`);
  } else {
    lines.push(`You are researching **${label}** for a trader who does **not** hold this coin yet (PHP pair **${pair}**, ticker **${base}**).`);
    lines.push(`When searching news, use **${base}** / the project name — not “${pair}” and not non-crypto meanings of “${base}”.`);
    lines.push(`**Focus: verified past ~30 days + present/~72h + next ~30 days.** The trader will decide later whether to stage buys — your job is **event/catalyst research**, not a forced buy call.`);
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
    lines.push(`- Research only: surface catalysts; the trader decides add vs sell later. Do not push ADD / average-down.`);
    lines.push(``);
  }

  lines.push(`## Rules`);
  lines.push(`- **Stance: NEUTRAL.** Never force a bullish/long bias. If evidence is bearish or unclear, prefer DO NOT ADD / WAIT / SKIP and preserve cash.`);
  lines.push(`- **Spot only** — buy or sell coins; never recommend shorting or leverage.`);
  lines.push(`- **Technicals first**; verified catalysts can **change risk assessment** but do not override a broken structure by themselves.`);
  lines.push(`- **Do not average down** only because the bag is underwater.`);
  lines.push(`- **TRIM** only when existing position risk/thesis warrants it — not as a soft default.`);
  lines.push(`- Data is **poll-based** (~8x/day Manila): daily H/L aggregates for RSI/SMA/ATR/range; 3h series for swings/ladder. Do **not** treat these as exchange OHLC candles.`);
  lines.push(`- **Incomplete / thin data:** if confidence is low, macro is ACCUMULATING DATA, or too few bars, name which signals are unreliable. Do not invent certainty. If missing data could flip the call → default **WAIT / DO NOT ADD**.`);
  lines.push(`- **Correlated indicators:** do **not** count a liquidity sweep, RSI divergence hint, near-support, and bullish swing as independent confirmations of the same bounce. A sweep or divergence alone is **not** enough to ADD. Require price stabilization and/or a defined entry + **clear invalidation**. Weight **structure + risk/reward** over the count of green flags.`);
  lines.push(`- Live search only for news; no training-memory headlines; never invent events. Empty category → **"none verified"**.`);
  lines.push(`- Politically themed tickers (e.g. TRUMP): separate **token/project** news from **person/politics** news with no demonstrated link to the asset.`);
  lines.push(`- Unlock does not equal automatic sell pressure — note amount/schedule and whether sales are confirmed.`);
  lines.push(`- Analysis date = **today Manila** unless the user supplies a historical snapshot date (then label it explicitly and shift research windows).`);
  if (isAllocated) {
    lines.push(`- Holding context is background only — prioritize **dated events** over ladder % advice.`);
    lines.push(`- If ADD: state max additional PHP budget, each tranche PHP size + entry condition, stop-adding / invalidation, approx **new average cost** if filled, extra PHP at risk. Lower avg cost does not mean a safer trade.`);
    lines.push(`- If catalysts + technicals do not justify an add → **PHP 0** additional spending.`);
  } else {
    lines.push(`- Not holding yet — include **past ~30d** catalysts that explain the path into today, plus forward dates.`);
    lines.push(`- Extended above ladder → WAIT FOR PULLBACK, not chase.`);
  }
  lines.push(``);

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
  // Support/resistance omitted — research focus is coin news, not S/R targets
  if (structureLevels && structureLevels.length > 0) {
    lines.push(`- Structure levels (optional context only — do not treat as entry advice):`);
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

  lines.push(`## Mandatory research (complete BEFORE any verdict — no silent skips)`);
  lines.push(`Live search only. Training memory is not evidence. Do not invent events.`);
  lines.push(`Silence is not "none verified." Each category: verified item OR **searched, none found**. Distinguish from not-searched.`);
  lines.push(`**A) Security/exploit (~90d):** search project, ticker, exploit, hack, bridge, security incident. Report verified hits factually.`);
  lines.push(`**B) Audit lines:** exploit | unlocks/supply | listing/delisting | partnership/launch | regulatory if asset-linked.`);
  if (isAllocated) {
    lines.push(`**C) Windows (already holding):** **present/~72h** + **next ~30d** dated catalysts only. Do **not** prioritize deep past-30d history. None dated → searched, none found.`);
  } else {
    lines.push(`**C) Windows (not holding):** past ~30d · **present/~72h** · next ~30d dated catalysts; optional context around last local high if supplied. None dated → searched, none found.`);
  }
  lines.push(`**D) Output:** news audit + ≤6 catalyst rows (date·URL·official vs reported·in-price?·uncertainty·spot implication). Then verdict.`);
  lines.push(`**E) Watch dates:** for every dated catalyst emit \`- **Watch date:** YYYY-MM-DD · unlock|delisting|event|integration|listing|hardfork · short detail\` (scraped into Home Coin watch dates).`);
  lines.push(`Correlated indicators are not independent confirms. Structure + invalidation > green-flag count.`);
  lines.push(``);
  if (isAllocated) {
    const priceNow = c.currentPrice;
    if (
      spent > 0 &&
      holdings > 0 &&
      priceNow != null &&
      Number.isFinite(priceNow) &&
      priceNow > 0
    ) {
      const upnl =
        unrealizedPct != null
          ? unrealizedPct
          : avgCost != null && avgCost > 0
            ? ((priceNow - avgCost) / avgCost) * 100
            : null;
      const daysH =
        daysHeld != null
          ? daysHeld
          : firstBuyAt
            ? Math.max(
                0,
                Math.floor((Date.now() - new Date(firstBuyAt).getTime()) / 86400000)
              )
            : null;
      if (upnl != null) {
        lines.push(`## Thesis health`);
        lines.push(
          `- Unrealized ~${upnl.toFixed(1)}%` +
            (daysH != null ? ` · held ~${daysH} day(s)` : "") +
            `.`
        );
        lines.push(
          `- If underwater worse than **-40%** AND held **> 60 days**: ADD needs ≥1 verified positive catalyst with token utility — bounce alone is not enough. Else DO NOT ADD / TRIM if thesis broken.`
        );
        lines.push(``);
      }
    }
    lines.push(`## Answer format (already holding — add / size decision)`);
    lines.push(`1. **News audit** — exploit / unlock / listing / partnership / regulatory (found or searched-none-found)`);
    lines.push(`2. **Catalyst table** ≤6 rows with links`);
    lines.push(`3. Verdict: **ADD** | **ADD ONLY ON PULLBACK** | **DO NOT ADD** | **TRIM** — after audit; incomplete data → DO NOT ADD`);
    lines.push(`4. Why (max 3 bullets) — no signal stacking; mention exploit/unlock if relevant`);
    lines.push(`5. If ADD / ADD ONLY ON PULLBACK: max **additional PHP budget**; each tranche PHP (30/30/40 of budget) + entry; invalidation; new avg cost if filled. If not justified → **PHP 0**.`);
    lines.push(`6. If DO NOT ADD: leave bag as-is unless thesis broken (then TRIM)`);
    lines.push(`7. **Timeframe:** valid until / review by YYYY-MM-DD (Manila; analysis date **${todayManila}**)`);
    lines.push(`8. Final **journal note** markdown (required)`);
  } else {
    lines.push(`## Answer format (no position)`);
    lines.push(`1. **News audit** — exploit / unlock / listing / partnership / regulatory (found or searched-none-found)`);
    lines.push(`2. **Catalyst table** ≤6 rows with links`);
    lines.push(`3. Verdict: **READY TO STAGE** | **WAIT FOR PULLBACK** | **SKIP** — after audit; thin data → WAIT/SKIP`);
    lines.push(`4. Why (max 3 bullets) — no signal stacking`);
    lines.push(`5. If READY or WAIT: which ladder level(s) and invalidation`);
    lines.push(`6. Spot risk note (LONG only — no short / no leverage)`);
    lines.push(`7. **Timeframe:** valid until / review by YYYY-MM-DD (Manila; analysis date **${todayManila}**)`);
    lines.push(`8. Final **journal note** markdown (required)`);
  }

  lines.push(``);
  lines.push(`## Final journal note (REQUIRED — pure markdown, copy-paste ready)`);
  lines.push(
    `End with ONLY the fenced markdown block below. Home Target monitor **parses these exact labels** — do not rename, translate, or merge them into one sentence.`
  );
  lines.push(`**STRICT field rules (machine-readable):**`);
  lines.push(
    `1. **Agent:** one line, start with \`Spot Trading Desk AI\` then product/model in parentheses. Example: \`Spot Trading Desk AI (Grok)\`. Never put the note title here.`
  );
  lines.push(
    `2. **Target entry** / **Target re-entry:** REQUIRED. Full PHP from research + levels. If allocated / adding, use **Target re-entry**. Example: ₱16332.9 — no commas, no truncation. n/a only if SKIP with no buy level.`
  );
  lines.push(
    `3. **Target exit:** REQUIRED. One full PHP price from research + levels (resistance / trim / TP). Optional ₱. Example: ₱20036.1. **No thousands commas.** Use n/a only if no exit level applies.`
  );
  lines.push(
    `4. **Review by:** exactly \`YYYY-MM-DD\` (Manila calendar date). Example: \`2026-11-04\`. No extra words on that line.`
  );
  lines.push(
    `5. **Watch date:** one bullet per dated catalyst. Shape: \`- **Watch date:** YYYY-MM-DD · event · short detail\`. Labels: unlock | delisting | event | integration | listing | hardfork. Example: \`- **Watch date:** 2026-11-19 · event · SKY governance executive vote\`. Repeat per date. Omit only if none verified. Scraped into Home **Coin watch dates**.`
  );
  lines.push(
    `Keep each of those four as its own bullet: \`- **Label:** value\`. Do not bold the value. Do not use tables for these four.`
  );
  lines.push(``);
  lines.push('```markdown');

  if (isAllocated) {
    lines.push(`## ${pair} · add / size note · ${todayManila} (Manila)`);
    lines.push(``);
    lines.push(`- **Agent:** Spot Trading Desk AI (ChatGPT / Grok / Gemini — name model)`);
    lines.push(`- **Prompt:** Spot Insights · Copy add/size review (full confluence)`);
    lines.push(`- **Verdict:** ADD | ADD ONLY ON PULLBACK | DO NOT ADD | TRIM`);
    lines.push(`- **Analysis date (Manila):** ${todayManila}`);
    lines.push(`- **Price now:** …`);
    lines.push(`- **Avg cost / unrealized:** …`);
    lines.push(
      `- **Target re-entry:** ₱${c.support != null && Number.isFinite(c.support) ? Number(c.support).toFixed(2) : "…"}`
    );
    lines.push(
      `- **Target exit:** ₱${c.resistance != null && Number.isFinite(c.resistance) ? Number(c.resistance).toFixed(2) : "…"}`
    );
    lines.push(`- **Additional budget (PHP):** … (0 if DO NOT ADD)`);
    lines.push(`- **Tranches:** … (PHP + level; 30/30/40 of additional budget)`);
    lines.push(`- **New avg cost if filled:** …`);
    lines.push(`- **Last pump / local high (if relevant):** date · peak · why it may have faded`);
    lines.push(`- **Invalidation (add thesis broken if):** …`);
    lines.push(`- **Review by:** YYYY-MM-DD`);
    lines.push(`- **Watch date:** YYYY-MM-DD · event · short detail (repeat once per dated catalyst; omit only if none verified)`);
    lines.push(`- **News audit:** exploit / unlock / listing / partnership / regulatory`);
    lines.push(`- **News (verified only):** …`);
    lines.push(`- **Why (1–3 short lines):**`);
    lines.push(`  - …`);
  } else {
    lines.push(`## ${pair} · entry note · ${todayManila} (Manila)`);
    lines.push(``);
    lines.push(`- **Agent:** Spot Trading Desk AI (ChatGPT / Grok / Gemini — name model)`);
    lines.push(`- **Prompt:** Spot Insights · Copy entry review (full confluence)`);
    lines.push(`- **Verdict:** READY TO STAGE | WAIT FOR PULLBACK | SKIP`);
    lines.push(`- **Analysis date (Manila):** ${todayManila}`);
    lines.push(`- **Price now:** …`);
    lines.push(
      `- **Target entry:** ₱${c.support != null && Number.isFinite(c.support) ? Number(c.support).toFixed(2) : "…"}`
    );
    lines.push(
      `- **Target exit:** ₱${c.resistance != null && Number.isFinite(c.resistance) ? Number(c.resistance).toFixed(2) : "…"}`
    );
    lines.push(`- **Ladder levels:**`);
    lines.push(`  - … (pct)`);
    lines.push(`- **Invalidation:** …`);
    lines.push(`- **Review by:** YYYY-MM-DD`);
    lines.push(`- **Watch date:** YYYY-MM-DD · event · short detail (repeat once per dated catalyst; omit only if none verified)`);
    lines.push(`- **News audit:** exploit / unlock / listing / partnership / regulatory`);
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
      `Spot research (already holding) ${label}. Pair ${pair}; search as ${base} crypto. NEUTRAL. Research CURRENT events + NEXT ~30 days only (no deep past). No size/add advice — trader decides add vs sell later. CRITICAL: emit Watch date lines for every dated catalyst.`
    );
    if (avgCost != null) {
      parts.push(`Avg cost ~${avgCost.toFixed(4)}; price ${c.currentPrice}; holdings ${holdings}.`);
    }
  } else {
    parts.push(
      `Spot research (not holding) ${label}. Pair ${pair}; search as ${base} crypto. NEUTRAL. Research PAST ~30d + present/~72h + NEXT ~30d. No forced buy. CRITICAL: emit Watch date lines for every dated catalyst (Coin watch dates).`
    );
  }

  parts.push(
    `Data: ~8 polls/day daily H/L for RSI/SMA/ATR/range; 3h swings/ladder (not exchange OHLC). LONG=buy bias SHORT=cash never short. Catalysts before verdict; no correlated-signal stacking; thin data=wait; ladder%=extra PHP budget not bag size.`
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

  parts.push(
    `Mandatory research BEFORE verdict: (A) past ~30d news for ${base}; (B) present/~72h; (C) next ~30d dated catalysts or none verified; (D) security/exploit ~90d or searched none found. Emit Watch date lines for dated items. Do not invent news. No training-memory headlines. Goal is coin information — not S/R advice.`
  );

  if (isAllocated) {
    parts.push(
      `Answer: 1) brief catalyst summary (current + next 30d only)  2) optional light note on risk (no size advice)  3) review by YYYY-MM-DD (Manila; today ${todayManila})  4) **Watch date lines for every dated item**  5) End with copy-paste markdown journal ONLY with exact labels:`
    );
  } else {
    parts.push(
      `Answer: 1) brief catalyst summary (past 30d + present + next 30d)  2) review by YYYY-MM-DD (Manila; today ${todayManila})  3) **Watch date lines for every dated item**  4) End with copy-paste markdown journal ONLY with exact labels:`
    );
  }

  parts.push(
    [
      "```markdown",
      `## ${symbol} · google review · ${todayManila} (Manila)`,
      "- **Agent:** Spot Trading Desk AI (name model)",
      "- **Prompt:** Spot · Google review",
      "- **Verdict:** …",
      "- **Price now:** …",
      "- **Target entry:** ₱… or n/a",
      "- **Target exit:** ₱… or n/a",
      "- **Invalidation:** …",
      "- **Review by:** YYYY-MM-DD",
      "- **Watch date:** YYYY-MM-DD · unlock|delisting|event|integration|listing|hardfork · short detail (REQUIRED per dated catalyst; repeat lines; omit only if none verified)",
      "- **Past 30d:** … (skip or n/a if already holding — forward-only research)",
      "- **Next 30d:** …",
      "- **Security 90d:** …",
      "- **Why:** …",
      "```",
    ].join("\n")
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

