import type { ChartPoint } from "@/validators/recordSchema";

/**
 * Effective daily price used for ALL technical calculations below. Prefers
 * a genuine end-of-day "close" if the stored point has one (e.g. the last
 * of several intraday cron polls) — falls back to the high/low midpoint
 * when only a daily range is available.
 *
 * Using a real close instead of (high+low)/2 everywhere matters: a day
 * with a wide intraday swing that closed near its low will look
 * artificially "bullish" under a midpoint proxy. If your cron jobs persist
 * a `close` (or `last`) field on ChartPoint, this automatically starts
 * using it with no other code changes required.
 */
export function getEffectivePrice(point: ChartPoint): number {
  const withOptional = point as ChartPoint & { close?: number; last?: number };
  if (typeof withOptional.close === "number") return withOptional.close;
  if (typeof withOptional.last === "number") return withOptional.last;
  return (point.high + point.low) / 2;
}

// ---------------------------------------------------------------------------
// SMA
// ---------------------------------------------------------------------------

/** Full SMA series aligned to `points` (nulls where there isn't enough history yet). */
export function calculateSMASeries(points: ChartPoint[], period: number): (number | null)[] {
  const prices = points.map(getEffectivePrice);
  const result: (number | null)[] = new Array(points.length).fill(null);
  for (let i = period - 1; i < points.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += prices[j];
    result[i] = sum / period;
  }
  return result;
}

/** SMA at a specific point in the series. `offset` counts back from the end
 * (0 = latest, 1 = the point before that) — used to compare "today" vs
 * "yesterday" for crossover detection without re-slicing arrays everywhere. */
export function calculateSMAAt(points: ChartPoint[], period: number, offset = 0): number | null {
  const endIndex = points.length - offset;
  if (endIndex < period) return null;
  const prices = points.slice(endIndex - period, endIndex).map(getEffectivePrice);
  return prices.reduce((a, b) => a + b, 0) / period;
}

// ---------------------------------------------------------------------------
// RSI (Wilder's smoothing)
// ---------------------------------------------------------------------------

export function calculateRSISeries(points: ChartPoint[], period = 14): (number | null)[] {
  const prices = points.map(getEffectivePrice);
  const result: (number | null)[] = new Array(points.length).fill(null);
  if (points.length <= period) return result;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    diff >= 0 ? (gains += diff) : (losses += Math.abs(diff));
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < points.length; i++) {
    const diff = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

/** RSI at a point in the series, with the same `offset` convention as calculateSMAAt.
 * Computes the full series once and indexes into it rather than re-running the
 * recursive Wilder smoothing from scratch per call. */
export function calculateRSIAt(points: ChartPoint[], period = 14, offset = 0): number | null {
  const series = calculateRSISeries(points, period);
  const idx = series.length - 1 - offset;
  return idx >= 0 ? series[idx] : null;
}

// ---------------------------------------------------------------------------
// Support / Resistance
// ---------------------------------------------------------------------------

export interface SupportResistance {
  support: number;
  resistance: number;
}

export function getSupportResistance(points: ChartPoint[], lookback = 30): SupportResistance {
  const recentData = points.slice(-Math.min(lookback, points.length));
  return {
    support: Math.min(...recentData.map((p) => p.low)),
    resistance: Math.max(...recentData.map((p) => p.high)),
  };
}

/** Simplified Average True Range. True textbook ATR needs a prior close to
 * capture overnight/session gaps; since ChartPoint isn't guaranteed one,
 * this approximates true range as (high - low) per day, averaged over
 * `period` days. Still a meaningfully better volatility measure for
 * invalidation levels than an arbitrary fixed percentage — it will just
 * slightly understate true range on gappy assets versus the textbook formula. */
export function calculateATR(points: ChartPoint[], period = 14): number | null {
  if (points.length < period) return null;
  const recent = points.slice(-period);
  const ranges = recent.map((p) => p.high - p.low);
  return ranges.reduce((a, b) => a + b, 0) / period;
}

export type DivergenceSignal = "bullish" | "bearish" | null;

/** Simplified regular RSI divergence check — compares the price/RSI pivot
 * in an earlier window against the most recent window. This is a
 * lightweight approximation, NOT full swing-point detection: it can miss
 * multi-swing divergences or misfire on noisy/choppy data. Treat it as a
 * hint worth a manual look, not a standalone signal to size a trade on. */
export function detectRSIDivergence(points: ChartPoint[], lookback = 20, recentWindow = 5): DivergenceSignal {
  if (points.length < lookback + 1) return null;
  const rsiSeries = calculateRSISeries(points, 14);
  const window = points.slice(-lookback);
  const rsiWindow = rsiSeries.slice(-lookback);

  const priorSlice = window.slice(0, lookback - recentWindow);
  const priorRsiSlice = rsiWindow.slice(0, lookback - recentWindow);
  const recentSlice = window.slice(lookback - recentWindow);
  const recentRsiSlice = rsiWindow.slice(lookback - recentWindow);
  if (priorSlice.length === 0 || recentSlice.length === 0) return null;

  const priorLowIdx = priorSlice.reduce((minIdx, p, i) => (p.low < priorSlice[minIdx].low ? i : minIdx), 0);
  const recentLowIdx = recentSlice.reduce((minIdx, p, i) => (p.low < recentSlice[minIdx].low ? i : minIdx), 0);
  const priorLowRsi = priorRsiSlice[priorLowIdx];
  const recentLowRsi = recentRsiSlice[recentLowIdx];
  if (
    recentSlice[recentLowIdx].low < priorSlice[priorLowIdx].low &&
    priorLowRsi !== null &&
    recentLowRsi !== null &&
    recentLowRsi > priorLowRsi
  ) {
    return "bullish";
  }

  const priorHighIdx = priorSlice.reduce((maxIdx, p, i) => (p.high > priorSlice[maxIdx].high ? i : maxIdx), 0);
  const recentHighIdx = recentSlice.reduce((maxIdx, p, i) => (p.high > recentSlice[maxIdx].high ? i : maxIdx), 0);
  const priorHighRsi = priorRsiSlice[priorHighIdx];
  const recentHighRsi = recentRsiSlice[recentHighIdx];
  if (
    recentSlice[recentHighIdx].high > priorSlice[priorHighIdx].high &&
    priorHighRsi !== null &&
    recentHighRsi !== null &&
    recentHighRsi < priorHighRsi
  ) {
    return "bearish";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Crossover / event detection — "something just happened" alerts, separate
// from the steady-state confluence score below.
// ---------------------------------------------------------------------------

export interface SwingPoint {
  index: number;
  price: number;
  type: "high" | "low";
}

/** Identifies swing highs/lows using a simple fractal method: a swing low
 * is a candle whose low is lower than the low of `strength` candles on
 * both sides of it; a swing high mirrors this for highs. This is a
 * standard, widely-used simplification (the same idea behind a basic
 * ZigZag indicator) — not full Elliott-wave analysis. It can produce
 * closely-spaced, noisy swings in a choppy market, and the most recent
 * `strength` candles can never be confirmed as swings yet (a swing point
 * is only confirmable once price has moved away from it on both sides). */
export function detectSwingPoints(points: ChartPoint[], strength = 3): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = strength; i < points.length - strength; i++) {
    const windowLows = points.slice(i - strength, i + strength + 1).map((p) => p.low);
    const windowHighs = points.slice(i - strength, i + strength + 1).map((p) => p.high);
    if (points[i].low === Math.min(...windowLows)) {
      swings.push({ index: i, price: points[i].low, type: "low" });
    }
    if (points[i].high === Math.max(...windowHighs)) {
      swings.push({ index: i, price: points[i].high, type: "high" });
    }
  }
  return swings;
}

/** Reads the last two confirmed swing lows and the last two confirmed
 * swing highs to classify market structure — higher-highs-and-higher-lows
 * (bullish structure), lower-highs-and-lower-lows (bearish structure), or
 * mixed (no clear structural trend). This is a genuinely different read
 * from the SMA-based trend signals: it's about the SHAPE of price action,
 * not moving averages. */
export function getSwingStructure(
  swings: SwingPoint[]
): { direction: 1 | -1 | 0; available: boolean; detail: string } {
  const lows = swings.filter((s) => s.type === "low");
  const highs = swings.filter((s) => s.type === "high");
  if (lows.length < 2 || highs.length < 2) {
    return { direction: 0, available: false, detail: "Not enough confirmed swing points yet" };
  }

  const [prevLow, lastLow] = lows.slice(-2);
  const [prevHigh, lastHigh] = highs.slice(-2);
  const higherLows = lastLow.price > prevLow.price;
  const higherHighs = lastHigh.price > prevHigh.price;

  if (higherHighs && higherLows) {
    return { direction: 1, available: true, detail: "Higher highs & higher lows — bullish structure" };
  }
  if (!higherHighs && !higherLows) {
    return { direction: -1, available: true, detail: "Lower highs & lower lows — bearish structure" };
  }
  return { direction: 0, available: true, detail: "Mixed swing structure — no clear structural trend" };
}

export interface LadderLevel {
  price: number;
  allocationPct: number;
  basis: "swing-low" | "support";
}

/** Builds a 2-3 tranche entry ladder anchored to actual confirmed swing
 * lows near/below the current price, falling back to the plain support
 * level when there isn't enough confirmed swing structure yet. Deeper
 * (lower) tranches get a larger suggested allocation, since a fill there
 * is a better price if it happens — this mirrors how a real trader
 * typically sizes a ladder, not an equal split. */
export function buildEntryLadder(points: ChartPoint[], support: number, currentPrice: number): LadderLevel[] {
  const swings = detectSwingPoints(points, 3);
  const swingLows = swings
    .filter((s) => s.type === "low" && s.price <= currentPrice * 1.01)
    .map((s) => s.price)
    .sort((a, b) => b - a); // closest to current price first

  const dedup: number[] = [];
  for (const lvl of swingLows) {
    if (dedup.every((d) => Math.abs(d - lvl) / d > 0.01)) dedup.push(lvl);
    if (dedup.length >= 3) break;
  }
  if (dedup.every((d) => Math.abs(d - support) / support > 0.01)) {
    dedup.push(support);
  }
  const levels = dedup.sort((a, b) => b - a).slice(0, 3);

  if (levels.length === 0) {
    return [{ price: support, allocationPct: 100, basis: "support" }];
  }

  const weights = levels.length === 3 ? [30, 30, 40] : levels.length === 2 ? [40, 60] : [100];
  return levels.map((price, i) => ({
    price,
    allocationPct: weights[i],
    basis: Math.abs(price - support) / support < 0.01 ? "support" : "swing-low",
  }));
}

export interface LiquiditySweepResult {
  type: "bullish" | "bearish";
  sweptLevel: number; // the prior support/resistance level that got pierced
  extremePrice: number; // the actual wick low/high reached during the sweep
  daysAgo: number; // how many days ago the sweep candle occurred
}

/** Detects a liquidity sweep: price recently pierced a support/resistance
 * level established just before that window (where stop-loss orders
 * typically cluster), then closed back on the "right" side of it — a
 * classic stop-hunt pattern that often precedes a reversal in the swept
 * direction's favor. This is a simplified, single-level check against the
 * two most recent windows, not full swing-structure analysis — treat it as
 * a supporting clue, not a standalone trigger. */
export function detectLiquiditySweep(
  points: ChartPoint[],
  lookback = 20,
  recentWindow = 5,
  currentPriceOverride?: number | null
): LiquiditySweepResult | null {
  if (points.length < lookback + 1) return null;

  const window = points.slice(-lookback);
  const priorSlice = window.slice(0, lookback - recentWindow);
  const recentSlice = window.slice(lookback - recentWindow);
  if (priorSlice.length === 0 || recentSlice.length === 0) return null;

  const priorSupport = Math.min(...priorSlice.map((p) => p.low));
  const priorResistance = Math.max(...priorSlice.map((p) => p.high));
  const currentPrice =
    currentPriceOverride != null ? currentPriceOverride : getEffectivePrice(points[points.length - 1]);

  // Bullish sweep: a recent candle's LOW pierced below the prior support,
  // but current price has reclaimed back above it.
  let sweepLowIdx = -1;
  let sweepLow = Infinity;
  recentSlice.forEach((p, i) => {
    if (p.low < priorSupport && p.low < sweepLow) {
      sweepLow = p.low;
      sweepLowIdx = i;
    }
  });
  if (sweepLowIdx !== -1 && currentPrice > priorSupport) {
    return {
      type: "bullish",
      sweptLevel: priorSupport,
      extremePrice: sweepLow,
      daysAgo: recentSlice.length - sweepLowIdx,
    };
  }

  // Bearish sweep: a recent candle's HIGH pierced above the prior
  // resistance, but current price has fallen back below it.
  let sweepHighIdx = -1;
  let sweepHigh = -Infinity;
  recentSlice.forEach((p, i) => {
    if (p.high > priorResistance && p.high > sweepHigh) {
      sweepHigh = p.high;
      sweepHighIdx = i;
    }
  });
  if (sweepHighIdx !== -1 && currentPrice < priorResistance) {
    return {
      type: "bearish",
      sweptLevel: priorResistance,
      extremePrice: sweepHigh,
      daysAgo: recentSlice.length - sweepHighIdx,
    };
  }

  return null;
}

export function detectCrossoverEvent(points: ChartPoint[]): string | null {
  const rsi = calculateRSIAt(points, 14);
  if (rsi !== null && rsi >= 70) return `🔥 RSI Overbought (${rsi.toFixed(0)}) — caution on new entries.`;
  if (rsi !== null && rsi <= 30) return `💎 RSI Oversold (${rsi.toFixed(0)}) — high-conviction accumulation zone.`;

  const sma50 = calculateSMAAt(points, 50, 0);
  const sma200 = calculateSMAAt(points, 200, 0);
  const prevSma50 = calculateSMAAt(points, 50, 1);
  const prevSma200 = calculateSMAAt(points, 200, 1);
  if (prevSma50 !== null && prevSma200 !== null && sma50 !== null && sma200 !== null) {
    if (prevSma50 <= prevSma200 && sma50 > sma200)
      return "🚀 Golden Cross Detected! (50 SMA crossed above 200 SMA) — Strong Macro Bullish Signal.";
    if (prevSma50 >= prevSma200 && sma50 < sma200)
      return "⚠️ Death Cross Detected! (50 SMA crossed below 200 SMA) — Major Macro Bearish Warning.";
  }

  const sma20 = calculateSMAAt(points, 20, 0);
  const prevSma20 = calculateSMAAt(points, 20, 1);
  if (prevSma20 !== null && prevSma50 !== null && sma20 !== null && sma50 !== null) {
    if (prevSma20 <= prevSma50 && sma20 > sma50)
      return "📈 Bullish Momentum Cross! (20 SMA crossed above 50 SMA) — Upward Trend Accelerating.";
    if (prevSma20 >= prevSma50 && sma20 < sma50)
      return "📉 Bearish Momentum Cross! (20 SMA crossed below 50 SMA) — Short-term Trend Weakening.";
  }

  if (points.length >= 21 && sma20 !== null && prevSma20 !== null) {
    const currentPrice = getEffectivePrice(points[points.length - 1]);
    const prevPrice = getEffectivePrice(points[points.length - 2]);
    if (prevPrice <= prevSma20 && currentPrice > sma20) return "⚡ Price Breakout! Price crossed above the 20 SMA.";
    if (prevPrice >= prevSma20 && currentPrice < sma20) return "🔴 Price Breakdown! Price dropped below the 20 SMA.";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Confluence scoring engine — replaces the old OR-chained tradeBias logic.
//
// Design goals this directly fixes vs. the previous implementation:
// 1. Missing SMA data (new coins) is treated as "no signal," never silently
//    folded into a bearish reading.
// 2. A directional bias is only issued once there's a genuine minimum of
//    history (RSI or 20 SMA available) — otherwise returns INSUFFICIENT DATA.
// 3. The 50/200 SMA macro trend is now a weighted INPUT to the score, not a
//    disconnected badge — so it's no longer possible to show "LONG / Buy
//    Zone" while the macro trend is bearish without at least a visible
//    counter-trend warning.
// 4. Each signal's contribution is shown individually, so the reasoning is
//    inspectable rather than a black-box verdict.
// 5. A support/resistance-based invalidation level is attached to any
//    directional call.
// ---------------------------------------------------------------------------

export type BiasLabel = "STRONG LONG" | "LONG" | "NEUTRAL" | "SHORT" | "STRONG SHORT" | "INSUFFICIENT DATA";

/** Shared badge color classes for BiasLabel — single source of truth so the
 * detail card and any summary/scan view stay visually consistent. */
export const BIAS_BADGE_CLASSES: Record<BiasLabel, string> = {
  "STRONG LONG": "bg-emerald-600 text-white border-emerald-700",
  LONG: "bg-emerald-100 text-emerald-800 border-emerald-300",
  NEUTRAL: "bg-gray-100 text-gray-600 border-gray-200",
  SHORT: "bg-rose-100 text-rose-800 border-rose-300",
  "STRONG SHORT": "bg-rose-600 text-white border-rose-700",
  "INSUFFICIENT DATA": "bg-amber-100 text-amber-700 border-amber-300",
};

/** Lower number = more actionable / worth looking at first when triaging a
 * whole watchlist — strong directional calls before weak ones, weak calls
 * before neutral, neutral before "we don't even have enough data yet." */
export const BIAS_PRIORITY: Record<BiasLabel, number> = {
  "STRONG LONG": 0,
  "STRONG SHORT": 0,
  LONG: 1,
  SHORT: 1,
  NEUTRAL: 2,
  "INSUFFICIENT DATA": 3,
};

export interface SignalContribution {
  name: string;
  weight: number; // positive = bullish contribution, negative = bearish, 0 = neutral/unavailable
  detail: string;
  available: boolean;
}

export interface ConfluenceResult {
  bias: BiasLabel;
  score: number;
  maxPossibleScore: number;
  confidence: number; // 0–1, fraction of signals that actually had enough data
  isCounterTrend: boolean; // short-term bias direction disagrees with the macro trend
  wasDowngradedFromMacroOnly: boolean; // a directional call was reduced to NEUTRAL because only the macro-trend signal supported it
  macroTrend: "MACRO BULLISH" | "MACRO BEARISH" | "ACCUMULATING DATA";
  divergence: DivergenceSignal;
  liquiditySweep: LiquiditySweepResult | null;
  usedIntradaySwings: boolean;
  atr: number | null;
  signals: SignalContribution[];
  currentPrice: number;
  support: number;
  resistance: number;
  invalidationLevel: number | null;
  invalidationNote: string | null;
  entrySuggestion: { ladder: LadderLevel[]; note: string } | null;
  exitSuggestion: { price: number; note: string } | null;
}

export function computeConfluenceSignal(
  points: ChartPoint[],
  overrides?: {
    support?: number | null;
    resistance?: number | null;
    currentPrice?: number | null;
    // Finer-grained series (e.g. 3-hour bars) used SPECIFICALLY for swing
    // structure and the entry ladder, since those care about recent
    // turning points and daily bars confirm swings too slowly (3+ days of
    // lag). Everything else (RSI, SMA20/50/200, macro trend) still needs
    // real daily history and keeps using `points` regardless. Falls back
    // to `points` when omitted — this stays fully functional without it.
    intradayPoints?: ChartPoint[] | null;
  }
): ConfluenceResult {
  const signals: SignalContribution[] = [];
  let score = 0;
  let maxPossible = 0;

  // Prefer a live/monitored price over the last chart point's derived
  // value — daily chart data can lag behind the actual latest tick (e.g.
  // if today's bucket hasn't been updated by the most recent cron run
  // yet), which would otherwise silently feed a stale price into the
  // "Price vs 20 SMA" and "Position in Range" signals.
  const derivedPrice = points.length > 0 ? getEffectivePrice(points[points.length - 1]) : 0;
  const currentPrice = overrides?.currentPrice != null ? overrides.currentPrice : derivedPrice;

  // --- RSI ---
  const rsi = calculateRSIAt(points, 14);
  maxPossible += 2;
  if (rsi !== null) {
    let s = 0;
    let detail = `RSI ${rsi.toFixed(0)} — neutral zone`;
    if (rsi <= 30) {
      s = 2;
      detail = `RSI ${rsi.toFixed(0)} — oversold`;
    } else if (rsi <= 40) {
      s = 1;
      detail = `RSI ${rsi.toFixed(0)} — leaning oversold`;
    } else if (rsi >= 70) {
      s = -2;
      detail = `RSI ${rsi.toFixed(0)} — overbought`;
    } else if (rsi >= 60) {
      s = -1;
      detail = `RSI ${rsi.toFixed(0)} — leaning overbought`;
    }
    score += s;
    signals.push({ name: "RSI (14)", weight: s, detail, available: true });
  } else {
    signals.push({ name: "RSI (14)", weight: 0, detail: "Not enough history yet (needs 14+ days)", available: false });
  }

  // --- Price vs 20 SMA (short-term trend) ---
  const sma20 = calculateSMAAt(points, 20);
  maxPossible += 1;
  if (sma20 !== null) {
    const s = currentPrice > sma20 ? 1 : currentPrice < sma20 ? -1 : 0;
    score += s;
    signals.push({
      name: "Price vs 20 SMA",
      weight: s,
      detail:
        s > 0
          ? "Price above 20 SMA — short-term uptrend"
          : s < 0
          ? "Price below 20 SMA — short-term downtrend"
          : "Price sitting right at the 20 SMA",
      available: true,
    });
  } else {
    signals.push({ name: "Price vs 20 SMA", weight: 0, detail: "Not enough history yet (needs 20+ days)", available: false });
  }

  // --- 20 SMA vs 50 SMA (medium-term momentum) ---
  const sma50 = calculateSMAAt(points, 50);
  maxPossible += 1;
  if (sma20 !== null && sma50 !== null) {
    const s = sma20 > sma50 ? 1 : sma20 < sma50 ? -1 : 0;
    score += s;
    signals.push({
      name: "20 SMA vs 50 SMA",
      weight: s,
      detail:
        s > 0
          ? "20 SMA above 50 SMA — medium-term momentum up"
          : s < 0
          ? "20 SMA below 50 SMA — medium-term momentum down"
          : "20/50 SMA converging",
      available: true,
    });
  } else {
    signals.push({ name: "20 SMA vs 50 SMA", weight: 0, detail: "Not enough history yet (needs 50+ days)", available: false });
  }

  // --- 50 SMA vs 200 SMA (macro trend — double-weighted) ---
  const sma200 = calculateSMAAt(points, 200);
  const macroWeight = 2;
  maxPossible += macroWeight;
  let macroTrend: ConfluenceResult["macroTrend"] = "ACCUMULATING DATA";
  let macroDirection = 0;
  if (sma50 !== null && sma200 !== null) {
    macroDirection = sma50 >= sma200 ? 1 : -1;
    macroTrend = macroDirection > 0 ? "MACRO BULLISH" : "MACRO BEARISH";
    const s = macroDirection * macroWeight;
    score += s;
    signals.push({
      name: "50 SMA vs 200 SMA (Macro Trend)",
      weight: s,
      detail:
        macroDirection > 0
          ? "50 SMA above 200 SMA — macro uptrend regime"
          : "50 SMA below 200 SMA — macro downtrend regime",
      available: true,
    });
  } else {
    signals.push({
      name: "50 SMA vs 200 SMA (Macro Trend)",
      weight: 0,
      detail: "Not enough history yet (needs 200+ days)",
      available: false,
    });
  }

  // --- Position within the recent trading range ---
  const { support, resistance } =
    overrides?.support != null && overrides?.resistance != null
      ? { support: overrides.support, resistance: overrides.resistance }
      : getSupportResistance(points, 30);
  const range = resistance - support;
  const positionInRange = range > 0 ? (currentPrice - support) / range : 0.5;
  maxPossible += 1;
  {
    let s = 0;
    let detail = `Mid-range (${(positionInRange * 100).toFixed(0)}% of 30-day range)`;
    if (positionInRange <= 0.25) {
      s = 1;
      detail = `Near range support (${(positionInRange * 100).toFixed(0)}% of range) — discount zone`;
    } else if (positionInRange >= 0.75) {
      s = -1;
      detail = `Near range resistance (${(positionInRange * 100).toFixed(0)}% of range) — expensive zone`;
    }
    score += s;
    signals.push({ name: "Position in 30-Day Range", weight: s, detail, available: points.length >= 5 });
  }

  // --- Swing structure (higher-highs/higher-lows vs lower-highs/lower-lows) ---
  // Prefer intraday resolution for swing detection when available — daily
  // bars take 3+ days to confirm a swing, intraday bars confirm within
  // hours. Falls back to daily points otherwise (same behavior as before).
  const swingSeries = overrides?.intradayPoints && overrides.intradayPoints.length > 0 ? overrides.intradayPoints : points;
  const usedIntradaySwings = !!(overrides?.intradayPoints && overrides.intradayPoints.length > 0);
  const swingPoints = detectSwingPoints(swingSeries, 3);
  const swingStructure = getSwingStructure(swingPoints);
  maxPossible += 1;
  if (swingStructure.available) {
    score += swingStructure.direction;
    signals.push({
      name: "Swing Structure",
      weight: swingStructure.direction,
      detail: swingStructure.detail,
      available: true,
    });
  } else {
    signals.push({ name: "Swing Structure", weight: 0, detail: swingStructure.detail, available: false });
  }

  const availableCount = signals.filter((s) => s.available).length;
  const confidence = signals.length > 0 ? availableCount / signals.length : 0;

  // Hard minimum: require at least 20 days of real history before ANY
  // directional call, regardless of which individual indicators happen to
  // be available. (Previously this checked `rsi !== null || sma20 !== null`,
  // which could pass at just 15 days on RSI alone, against a barely-seeded
  // 15-day range for the "position in range" signal too — too thin to trust.)
  const hasMinimumData = points.length >= 20;

  let bias: BiasLabel;
  if (!hasMinimumData) {
    bias = "INSUFFICIENT DATA";
  } else if (score >= 4) {
    bias = "STRONG LONG";
  } else if (score >= 2) {
    bias = "LONG";
  } else if (score <= -4) {
    bias = "STRONG SHORT";
  } else if (score <= -2) {
    bias = "SHORT";
  } else {
    bias = "NEUTRAL";
  }

  // Require at least one NON-macro signal to agree with the call's
  // direction. Without this, the double-weighted macro-trend signal (±2)
  // could single-handedly cross the ±2 threshold while every other signal
  // sits neutral or offsetting — a lone trend reading isn't genuine
  // multi-signal confluence.
  let wasDowngradedFromMacroOnly = false;
  if (bias !== "INSUFFICIENT DATA" && bias !== "NEUTRAL") {
    const direction = bias.includes("LONG") ? 1 : -1;
    const nonMacroConfirms = signals.some(
      (s) => s.name !== "50 SMA vs 200 SMA (Macro Trend)" && s.available && Math.sign(s.weight) === direction
    );
    if (!nonMacroConfirms) {
      bias = "NEUTRAL";
      wasDowngradedFromMacroOnly = true;
    }
  }

  const shortTermDirection = bias.includes("LONG") ? 1 : bias.includes("SHORT") ? -1 : 0;
  const isCounterTrend = macroDirection !== 0 && shortTermDirection !== 0 && shortTermDirection !== macroDirection;

  const divergence = detectRSIDivergence(points);
  const liquiditySweep = detectLiquiditySweep(points, 20, 5, currentPrice);
  const atr = calculateATR(points, 14);

  let invalidationLevel: number | null = null;
  let invalidationNote: string | null = null;
  if (bias.includes("LONG")) {
    if (liquiditySweep?.type === "bullish") {
      // The naive support level was already tested — price wicked below it
      // and reclaimed. Anchor the stop just below that ACTUAL tested low
      // instead of the generic ATR buffer below the naive support: the
      // naive level is exactly where a stop hunt would target again, while
      // the sweep low is a level that's already been defended once.
      const buffer = atr !== null ? 0.5 * atr : liquiditySweep.sweptLevel * 0.01;
      invalidationLevel = liquiditySweep.extremePrice - buffer;
      invalidationNote = `Support near ${liquiditySweep.sweptLevel.toFixed(2)} was already swept and reclaimed (low of ~${liquiditySweep.extremePrice.toFixed(2)}, ${liquiditySweep.daysAgo} day(s) ago) — the stop is anchored just below that tested low rather than the naive support line, since that naive line is exactly what a repeat stop-hunt would target. If price closes below ~${invalidationLevel.toFixed(2)}, this long thesis is invalidated.`;
    } else if (atr !== null) {
      invalidationLevel = support - 1.5 * atr;
      invalidationNote = `If price closes below ~${invalidationLevel.toFixed(2)} (support broken by more than the recent ATR-14 of ${atr.toFixed(2)}), this long thesis is invalidated.`;
    } else {
      invalidationLevel = support * 0.97;
      invalidationNote = `If price closes below ~${invalidationLevel.toFixed(2)} (support broken), this long thesis is invalidated. (Flat 3% buffer — not enough history yet for a volatility-based ATR stop.)`;
    }
  } else if (bias.includes("SHORT")) {
    if (liquiditySweep?.type === "bearish") {
      const buffer = atr !== null ? 0.5 * atr : liquiditySweep.sweptLevel * 0.01;
      invalidationLevel = liquiditySweep.extremePrice + buffer;
      invalidationNote = `Resistance near ${liquiditySweep.sweptLevel.toFixed(2)} was already swept and rejected (high of ~${liquiditySweep.extremePrice.toFixed(2)}, ${liquiditySweep.daysAgo} day(s) ago) — the stop is anchored just above that tested high rather than the naive resistance line, for the same stop-hunt reason. If price closes above ~${invalidationLevel.toFixed(2)}, re-evaluate — momentum may be turning.`;
    } else if (atr !== null) {
      invalidationLevel = resistance + 1.5 * atr;
      invalidationNote = `If price closes above ~${invalidationLevel.toFixed(2)} (resistance reclaimed by more than the recent ATR-14 of ${atr.toFixed(2)}), re-evaluate — momentum may be turning.`;
    } else {
      invalidationLevel = resistance * 1.03;
      invalidationNote = `If price closes above ~${invalidationLevel.toFixed(2)} (resistance reclaimed), re-evaluate. (Flat 3% buffer — not enough history yet for a volatility-based ATR stop.)`;
    }
  }

  // Entry/exit reference levels — a suggestion only, not a directive. Entry
  // is now a real ladder anchored to confirmed swing lows (not just a flat
  // support line) so it mirrors how a trader would actually stage limit
  // orders. Exit stays a single resistance-based target for now.
  let entrySuggestion: ConfluenceResult["entrySuggestion"] = null;
  let exitSuggestion: ConfluenceResult["exitSuggestion"] = null;

  if (bias !== "INSUFFICIENT DATA") {
    const ladder = buildEntryLadder(swingSeries, support, currentPrice);

    if (bias.includes("LONG")) {
      entrySuggestion = {
        ladder,
        note:
          liquiditySweep?.type === "bullish"
            ? `The deepest tranche sits near a level that was already tested and defended — price swept to ~${liquiditySweep.extremePrice.toFixed(2)} and reclaimed, which is somewhat higher-conviction than an untested level.`
            : currentPrice <= support * 1.02
            ? "Price is already near the lower end of this ladder — current conditions look like a reasonable entry zone, not just the target."
            : "Rather than buying all at once, consider splitting across these tranches — deeper fills are lower-risk if they happen, at the cost of maybe not filling at all if price never pulls back that far.",
      };
      exitSuggestion = {
        price: resistance,
        note: "Near-term target — worth considering taking some profit if price reaches this level.",
      };
    } else {
      entrySuggestion = {
        ladder,
        note: "Technicals don't support buying at the current price — these are the levels worth waiting for, staged from least to most aggressive, before considering a fresh entry.",
      };
      exitSuggestion = {
        price: resistance,
        note: "If you're already holding, this is a level worth watching to trim or take profit rather than a fresh buy target.",
      };
    }
  }

  return {
    bias,
    score,
    maxPossibleScore: maxPossible,
    confidence,
    isCounterTrend,
    wasDowngradedFromMacroOnly,
    macroTrend,
    divergence,
    liquiditySweep,
    usedIntradaySwings,
    atr,
    signals,
    currentPrice,
    support,
    resistance,
    invalidationLevel,
    invalidationNote,
    entrySuggestion,
    exitSuggestion,
  };
}