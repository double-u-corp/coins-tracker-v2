import { useCallback, useState } from "react";
import type { ChartPoint, CoinSummary } from "@/validators/recordSchema";
import { computeConfluenceSignal, isLongExtended, isWatchlistBuyLowHit, type ConfluenceResult } from "./Technicals";

export interface ScanResult {
  symbol: string;
  name: string;
  confluence: ConfluenceResult | null;
  error: string | null;
  /** Always 0 — scan-log / streak API removed; field kept so UI stays compatible. */
  streak: number;
  scannedAt: string; // ISO timestamp, captured at the moment this coin's scan completed
}

// Fetch a bounded number of coins at once rather than firing one request per
// tracked coin simultaneously — kinder to the backend and to the browser's
// own connection limits on a full watchlist scan.
const SCAN_CONCURRENCY = 5;

// One year of daily history is enough for RSI / 20 SMA / 50 SMA on most
// coins, and close to enough for the 200-day macro trend on longer-tracked
// ones, while keeping the per-coin payload reasonable across a full-watchlist
// scan. Coins with less history than this will just show fewer available
// signals in their confluence breakdown — the engine already handles that.
const SCAN_YEARS = "1.00";

async function fetchCoinPoints(symbol: string): Promise<ChartPoint[]> {
  const res = await fetch(`/api/coins?type=chart&symbol=${symbol}&years=${SCAN_YEARS}&granularity=daily`);
  if (!res.ok) throw new Error(`Failed to load ${symbol} (${res.status})`);
  const data: { points: ChartPoint[] } = await res.json();
  return data.points;
}

// 336 hours (14 days) rather than a shorter window — at 3-hour granularity
// that's ~112 candles. detectSwingPoints(strength=3) needs a 7-bar window
// per candidate, so finding 2 confirmed highs AND 2 confirmed lows from a
// much shorter window (e.g. 72h/~24 candles) is often mathematically not
// going to happen, especially with real gaps in the data (Records only log
// on a new intraday high/low, not every check).
const INTRADAY_HOURS = 336;

/** Fetches the intraday series used specifically for swing structure and
 * the entry ladder. Fails SILENTLY (returns null, not a thrown error) —
 * if this endpoint is ever unavailable, the confluence engine falls back
 * to daily-bar swing detection rather than breaking the scan. */
async function fetchIntradayPoints(symbol: string): Promise<ChartPoint[] | null> {
  try {
    const res = await fetch(`/api/coins?type=chart&symbol=${symbol}&granularity=3h&hours=${INTRADAY_HOURS}`);
    if (!res.ok) return null;
    const data: { points: ChartPoint[] } = await res.json();
    return data.points?.length > 0 ? data.points : null;
  } catch {
    return null;
  }
}

export function useCoinScanner(allCoins: CoinSummary[]) {
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ completed: 0, total: 0 });
  const [scanError, setScanError] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);

  const runScan = useCallback(async () => {
    if (allCoins.length === 0) return;

    setIsScanning(true);
    setScanError(null);
    setScanResults([]);
    setScanProgress({ completed: 0, total: allCoins.length });

    const results: ScanResult[] = [];
    let cursor = 0;

    async function worker() {
      while (cursor < allCoins.length) {
        const coin = allCoins[cursor];
        cursor += 1;
        try {
          const [points, intradayPoints] = await Promise.all([
            fetchCoinPoints(coin.symbol),
            fetchIntradayPoints(coin.symbol),
          ]);
          const confluence =
            points.length > 0
              ? computeConfluenceSignal(points, { currentPrice: coin.currentPrice, intradayPoints })
              : null;
          results.push({
            symbol: coin.symbol,
            name: coin.name,
            confluence,
            error: null,
            streak: 0,
            scannedAt: new Date().toISOString(),
          });
        } catch (err) {
          results.push({
            symbol: coin.symbol,
            name: coin.name,
            confluence: null,
            error: (err as Error).message,
            streak: 0,
            scannedAt: new Date().toISOString(),
          });
        }
        setScanProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
      }
    }

    try {
      const workerCount = Math.min(SCAN_CONCURRENCY, allCoins.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      setScanResults(results);
      setHasScanned(true);
    } catch (err) {
      setScanError((err as Error).message || "Scan failed");
    } finally {
      setIsScanning(false);
    }
  }, [allCoins]);

  return { scanResults, isScanning, scanProgress, scanError, hasScanned, runScan };
}

function biasCircle(bias: string): string {
  if (bias.includes("LONG")) return "🟢";
  if (bias.includes("SHORT")) return "🔴";
  return "⚪";
}

/** Formats a single coin's full confluence breakdown — scannable journal
 * copy with status circle + bold critical terms. Shared by the per-card
 * copy button and the bulk journal report. */
export function formatSingleScanResult(r: ScanResult): string {
  if (!r.confluence) return `**${r.symbol}** — no data available.`;
  const c = r.confluence;
  const scannedAtLabel = new Date(r.scannedAt).toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const circle = biasCircle(c.bias);
  const extended = isLongExtended(c);
  const lines: string[] = [];

  lines.push(
    `${circle} **${r.symbol}** — **${c.bias}** (Score: **${c.score >= 0 ? "+" : ""}${c.score}**/±${c.maxPossibleScore}, ${(c.confidence * 100).toFixed(0)}% data)`
  );
  lines.push(`- Scanned: ${scannedAtLabel} (Manila)`);
  if (extended) {
    lines.push(`- ⏳ **Extended — wait for pullback into ladder** (do not chase)`);
  }
  lines.push(
    `- **Price:** ${c.currentPrice} | **Support:** ${c.support} | **Resistance:** ${c.resistance}`
  );
  lines.push(
    `- **Macro:** ${c.macroTrend}${c.isCounterTrend ? " ⚠️ COUNTER-TREND (disagrees with macro)" : ""}`
  );
  if (c.divergence) {
    lines.push(
      `- Divergence: 🔍 Possible ${c.divergence} RSI divergence — worth a manual look, not a standalone signal`
    );
  }
  if (c.liquiditySweep) {
    lines.push(
      `- **Sweep:** 🎣 ${c.liquiditySweep.type} · ${c.liquiditySweep.sweptLevel} (extreme ${c.liquiditySweep.extremePrice}, ${c.liquiditySweep.daysAgo}d ago)`
    );
  }

  const signalBits = c.signals
    .filter((s) => s.available)
    .map((s) => `${s.detail}${s.weight !== 0 ? ` (${s.weight > 0 ? "+" : ""}${s.weight})` : ""}`);
  if (signalBits.length > 0) {
    lines.push(`- Signals: ${signalBits.join(" · ")}`);
  }

  if (c.entrySuggestion) {
    lines.push(`- **Entry ladder:**`);
    for (const level of c.entrySuggestion.ladder) {
      lines.push(`  - **~${level.price}** (${level.basis}) — ${level.allocationPct}%`);
    }
    lines.push(`  ${c.entrySuggestion.note}`);
  }
  if (c.invalidationLevel != null || c.invalidationNote) {
    const stop =
      c.invalidationLevel != null
        ? `close below **~${c.invalidationLevel.toFixed(2)}**`
        : c.invalidationNote;
    lines.push(`- **Invalidation:** ${stop}`);
    if (c.invalidationLevel != null && c.invalidationNote) {
      lines.push(`  ${c.invalidationNote}`);
    }
  }
  if (c.exitSuggestion) {
    lines.push(`- **Target:** **~${c.exitSuggestion.price}** — ${c.exitSuggestion.note}`);
  }
  return lines.join("\n");
}

/** Builds a full Markdown report of only the directional (LONG / SHORT /
 * STRONG LONG / STRONG SHORT) results — suitable for pasting into a journal.
 * NEUTRAL and INSUFFICIENT DATA are excluded on purpose. */
export function formatScanResultsForJournal(results: ScanResult[]): string {
  const dateStr = new Date().toISOString().slice(0, 10);

  const isWatchlistHit = (r: ScanResult) =>
    !!r.confluence && isWatchlistBuyLowHit(r.confluence);

  // Watchlist Scan: only coins near support / cooling into key level (buy-low)
  const signalResults = results.filter(isWatchlistHit);

  if (signalResults.length === 0) {
    return `## Watchlist Scan — ${dateStr}\n\nNo LONG or SHORT signals today. All tracked coins are NEUTRAL or still accumulating price history.`;
  }

  const longs = signalResults.filter((r) => r.confluence!.bias.includes("LONG"));
  const longsReady = longs.filter((r) => !isLongExtended(r.confluence!));
  const longsExtended = longs.filter((r) => isLongExtended(r.confluence!));
  const shorts = signalResults.filter((r) => r.confluence!.bias.includes("SHORT"));

  const sections: string[] = [`## Watchlist Scan — ${dateStr}`];

  if (longsReady.length > 0) {
    sections.push(
      `\n### 🟢 LONG — near ladder / ready (${longsReady.length})\n\n${longsReady.map(formatSingleScanResult).join("\n\n")}`
    );
  }
  if (longsExtended.length > 0) {
    sections.push(
      `\n### ⏳ LONG — extended, wait for pullback (${longsExtended.length})\n\n${longsExtended.map(formatSingleScanResult).join("\n\n")}`
    );
  }
  if (shorts.length > 0) {
    sections.push(
      `\n### 🔴 SHORT — hold cash / do not buy (${shorts.length})\n\n${shorts.map(formatSingleScanResult).join("\n\n")}`
    );
  }

  return sections.join("\n");
}
