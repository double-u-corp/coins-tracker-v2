import type { ConfluenceResult, RiskLeverageInfo } from "../../features/chart/Technicals";
import type { SeriesDensity } from "./usePastTradeLogic";

/** Local pairs are stored as GRAMPHP / VIRTUALPHP — agents need the base crypto ticker. */
function baseAssetSymbol(symbol: string): string {
  const s = (symbol || "").trim().toUpperCase();
  if (s.endsWith("PHP") && s.length > 3) return s.slice(0, -3);
  return s;
}

/** Same disambiguation table as the spot TradingInsightCard (that helper
 * isn't exported there, so it's duplicated here) — stops a search/AI agent
 * from reading GRAM as a unit of mass, SPX as the S&P 500, etc. */
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

function directionOf(c: ConfluenceResult): "LONG" | "SHORT" | "NEUTRAL" {
  if (c.bias.includes("LONG")) return "LONG";
  if (c.bias.includes("SHORT")) return "SHORT";
  return "NEUTRAL";
}

/** Full prompt (goes to clipboard) — for a leveraged/margin fast trade,
 * both directions allowed. */
export function formatFastTradeReviewPrompt(
  symbol: string,
  c: ConfluenceResult,
  density: SeriesDensity,
  risk: RiskLeverageInfo
): string {
  const { base, pair, label } = formatAssetLabel(symbol);
  const dir = directionOf(c);
  const lines: string[] = [];

  lines.push(`You are reviewing a **fast leveraged/margin trade** idea for **${label}**.`);
  lines.push(
    `Local PHP pair symbol in the app: **${pair}** (underlying asset ticker: **${base}**). When searching news, use **${base}** / the crypto project name — not “${pair}” and not non-crypto meanings of “${base}”.`
  );
  lines.push(
    `Both **LONG and SHORT** are allowed here (leverage/margin). Question: is the technical read's direction (**${dir}**) worth taking now, should the trader **wait**, or **skip**?`
  );
  lines.push(``);
  lines.push(`## How this technical data is built (important)`);
  lines.push(`- Price is polled about every ~3 hours; a point is only recorded when a NEW high or low is set — so this is a sparse series of recorded extremes, NOT fixed 1h/4h exchange candles.`);
  lines.push(`- RSI(14), SMA 20/50/200, ATR, support/resistance and swings are all computed on these recorded intraday points (not daily bars).`);
  lines.push(`- "200 SMA" = average of the last 200 recorded points; how much real time that spans depends on how active the coin is.`);
  lines.push(`- Bias: LONG = constructive for longs; SHORT = constructive for shorts; NEUTRAL = no edge.`);
  lines.push(``);
  lines.push(`## Data quality`);
  lines.push(`- ${density.isFastEnough ? "Printing frequently" : "Printing slowly (thin data — lower confidence)"}`);
  if (density.avgRecentGapHours != null) lines.push(`- Avg gap between recent prints: ~${density.avgRecentGapHours.toFixed(1)}h`);
  if (density.spanDays != null) lines.push(`- History covered: ~${Math.round(density.spanDays)} day(s), ${density.pointCount} points`);
  lines.push(``);
  lines.push(`## Rules`);
  lines.push(`- Primary filter = technical snapshot below.`);
  lines.push(`- You MAY search live news/trends; do NOT use training-memory headlines (often stale).`);
  lines.push(`- Do not invent news. Unverified → say "none verified".`);
  lines.push(`- Verified bad news against the trade direction (unlock dump, delist, exploit, regulatory hit for a LONG; strong positive catalyst for a SHORT) → lean SKIP or WAIT.`);
  lines.push(`- Thin data, low confidence, or poor reward:risk → lean WAIT or SKIP.`);
  lines.push(`- Price already extended beyond the entry ladder → WAIT for a pullback/bounce rather than chasing.`);
  lines.push(``);
  lines.push(`## Technical snapshot`);
  lines.push(`- Bias: **${c.bias}** (score ${c.score >= 0 ? "+" : ""}${c.score}/±${c.maxPossibleScore}, ${(c.confidence * 100).toFixed(0)}% data)`);
  lines.push(`- Macro: ${c.macroTrend}${c.isCounterTrend ? " — short-term bias conflicts with macro" : ""}`);
  lines.push(`- Price now: ${c.currentPrice}`);
  lines.push(`- Support: ${c.support} | Resistance: ${c.resistance}`);
  if (c.invalidationLevel != null) lines.push(`- Invalidation / stop reference: ~${c.invalidationLevel}`);
  if (c.liquiditySweep) {
    lines.push(
      `- Liquidity sweep: ${c.liquiditySweep.type} at ${c.liquiditySweep.sweptLevel} (extreme ${c.liquiditySweep.extremePrice}, ${c.liquiditySweep.daysAgo} prints ago)`
    );
  }
  if (c.divergence) lines.push(`- RSI divergence hint: ${c.divergence} (supporting only)`);
  lines.push(`- Confluence signals:`);
  for (const s of c.signals) {
    if (!s.available) continue;
    lines.push(`  - ${s.name}: ${s.detail}${s.weight !== 0 ? ` (${s.weight > 0 ? "+" : ""}${s.weight})` : ""}`);
  }
  if (c.entrySuggestion?.ladder?.length) {
    lines.push(`- Proposed ${dir === "SHORT" ? "short" : "long"} entry ladder (limit orders, not market-now):`);
    for (const lvl of c.entrySuggestion.ladder) {
      lines.push(`  - ~${lvl.price} (${lvl.basis}) — ~${lvl.allocationPct}%`);
    }
  }
  if (c.exitSuggestion?.price != null) lines.push(`- Take-profit reference: ~${c.exitSuggestion.price}`);
  if (c.invalidationNote) lines.push(`- Invalidation detail: ${c.invalidationNote}`);

  if (risk.quality !== "unavailable") {
    lines.push(`- Reward:risk ≈ ${risk.riskRewardRatio!.toFixed(2)}:1 (stop ~${(risk.stopDistancePct! * 100).toFixed(1)}% from avg entry, target ~${(risk.rewardDistancePct! * 100).toFixed(1)}%)`);
    lines.push(`- Suggested max leverage ≈ ${risk.suggestedMaxLeverage}x (simplified isolated-margin estimate; stop trips at ~60% of estimated liquidation distance)`);
  }
  lines.push(``);
  lines.push(`## Answer format`);
  lines.push(`1. Verdict: **TAKE ${dir === "NEUTRAL" ? "TRADE" : dir}** | **WAIT** | **SKIP**`);
  lines.push(`2. Why (max 3 technical bullets; max 2 verified news bullets if any)`);
  lines.push(`3. Which ladder level(s), stop price, and take-profit`);
  lines.push(`4. Leverage/risk note (sizing, liquidation vs stop, reward:risk)`);
  lines.push(`5. News: verified items only, or "none verified"`);

  return lines.join("\n");
}

/** Compact version for Google ?q= (stays under URL limits). */
export function formatFastTradeReviewPromptForGoogle(
  symbol: string,
  c: ConfluenceResult,
  density: SeriesDensity,
  risk: RiskLeverageInfo
): string {
  const { base, pair, label } = formatAssetLabel(symbol);
  const dir = directionOf(c);
  const parts: string[] = [];

  parts.push(
    `Leveraged fast-trade review ${label}. Pair ${pair}; search news as ${base} crypto not other meanings. LONG and SHORT both allowed. Take ${dir}, wait, or skip?`
  );
  parts.push(
    `Data: recorded intraday highs/lows (~3h poll, new-extreme events only) for RSI/SMA/ATR/range/swings. ${density.isFastEnough ? "Printing frequently" : "Printing slowly (thin)"}.`
  );
  parts.push(
    `Snapshot: bias ${c.bias} (score ${c.score >= 0 ? "+" : ""}${c.score}/±${c.maxPossibleScore}, ${(c.confidence * 100).toFixed(0)}% conf). Macro ${c.macroTrend}. Price ${c.currentPrice}; support ${c.support}; resistance ${c.resistance}.`
  );
  if (c.invalidationLevel != null) parts.push(`Stop ~${Number(c.invalidationLevel).toFixed(2)}.`);

  const sigBits = c.signals
    .filter((s) => s.available && s.weight !== 0)
    .slice(0, 6)
    .map((s) => `${s.name}:${s.weight > 0 ? "+" : ""}${s.weight}`)
    .join("; ");
  if (sigBits) parts.push(`Signals: ${sigBits}.`);

  if (c.entrySuggestion?.ladder?.length) {
    parts.push(`Ladder: ${c.entrySuggestion.ladder.map((l) => `~${l.price}(${l.allocationPct}%)`).join(", ")}.`);
  }
  if (c.exitSuggestion?.price != null) parts.push(`TP ~${c.exitSuggestion.price}.`);
  if (risk.quality !== "unavailable") {
    parts.push(`R:R ${risk.riskRewardRatio!.toFixed(2)}:1; suggested max leverage ~${risk.suggestedMaxLeverage}x.`);
  }

  parts.push(
    `Answer: 1) TAKE ${dir === "NEUTRAL" ? "TRADE" : dir} | WAIT | SKIP  2) why (tech + verified news only)  3) ladder, stop, TP  4) leverage/risk note  5) news or none verified. Do not invent news.`
  );

  return parts.join(" ");
}
