import { useCallback, useState } from "react";
import type { ChartPoint, CoinSummary } from "@/validators/recordSchema";
import { computeConfluenceSignal, type ConfluenceResult } from "./Technicals";

export interface ScanResult {
  symbol: string;
  name: string;
  confluence: ConfluenceResult | null;
  error: string | null;
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

/** Saves this run's result and returns the consecutive-signal streak
 * computed server-side from the coin's prior scan history. Best-effort:
 * if the save fails, the scan itself still succeeds — streak is enrichment,
 * not load-bearing for the actual technical read. */
async function persistAndGetStreak(symbol: string, bias: string, score: number): Promise<number> {
  try {
    const res = await fetch("/api/chart-scan-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, bias, score }),
    });
    if (!res.ok) return 0;
    const data: { streak?: number } = await res.json();
    return data.streak ?? 0;
  } catch {
    return 0;
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
          const points = await fetchCoinPoints(coin.symbol);
          const confluence =
            points.length > 0
              ? computeConfluenceSignal(points, { currentPrice: coin.currentPrice })
              : null;
          const streak = confluence ? await persistAndGetStreak(coin.symbol, confluence.bias, confluence.score) : 0;
          results.push({
            symbol: coin.symbol,
            name: coin.name,
            confluence,
            error: null,
            streak,
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

/** Formats a single coin's full confluence breakdown — every contributing
 * signal, macro trend, counter-trend flag, divergence, and invalidation
 * level. Shared by both the per-card copy button and the bulk journal report
 * below, so the two never drift out of sync with each other. */
export function formatSingleScanResult(r: ScanResult): string {
  if (!r.confluence) return `**${r.symbol}** — no data available.`;
  const c = r.confluence;
  const scannedAtLabel = new Date(r.scannedAt).toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const lines: string[] = [];
  lines.push(
    `**${r.symbol}** — ${c.bias} (Score: ${c.score >= 0 ? "+" : ""}${c.score}/±${c.maxPossibleScore}, ${(c.confidence * 100).toFixed(0)}% data confidence)`
  );
  lines.push(`- Scanned: ${scannedAtLabel} (Manila time)`);
  if (r.streak >= 2) {
    lines.push(`- 🔥 ${r.streak}-day consecutive ${c.bias.includes("LONG") ? "LONG" : "SHORT"} streak`);
  }
  lines.push(`- Price: ${c.currentPrice} | Support: ${c.support} | Resistance: ${c.resistance}`);
  lines.push(`- Macro Trend: ${c.macroTrend}${c.isCounterTrend ? " ⚠️ COUNTER-TREND (disagrees with macro)" : ""}`);
  if (c.divergence) {
    lines.push(
      `- Divergence: 🔍 Possible ${c.divergence} RSI divergence — worth a manual look, not a standalone signal`
    );
  }
  if (c.liquiditySweep) {
    lines.push(
      `- Liquidity Sweep: 🎣 ${c.liquiditySweep.type} sweep of ${c.liquiditySweep.sweptLevel} (extreme ${c.liquiditySweep.extremePrice}, ${c.liquiditySweep.daysAgo}d ago)`
    );
  }
  for (const s of c.signals) {
    if (!s.available) continue;
    lines.push(`  - ${s.name}: ${s.detail}${s.weight !== 0 ? ` (${s.weight > 0 ? "+" : ""}${s.weight})` : ""}`);
  }
  if (c.invalidationNote) {
    if (c.entrySuggestion) {
      lines.push(`- Entry Ladder:`);
      for (const level of c.entrySuggestion.ladder) {
        lines.push(`  - ~${level.price} (${level.basis}) — ${level.allocationPct}%`);
      }
      lines.push(`  ${c.entrySuggestion.note}`);
    }
    lines.push(`- Invalidation: ${c.invalidationNote}`);
    if (c.exitSuggestion) {
      lines.push(`- Target ~${c.exitSuggestion.price}: ${c.exitSuggestion.note}`);
    }
  }
  return lines.join("\n");
}

/** Builds a full Markdown report of only the directional (LONG / SHORT /
 * STRONG LONG / STRONG SHORT) results — every contributing signal, macro
 * trend, counter-trend flag, divergence, and invalidation level included —
 * suitable for pasting straight into a journal entry to track day over day.
 * NEUTRAL and INSUFFICIENT DATA coins are deliberately excluded regardless
 * of what's currently shown on screen; this is meant to be a durable record
 * of what actually looked actionable that day, not the full watchlist dump. */
export function formatScanResultsForJournal(results: ScanResult[]): string {
  const dateStr = new Date().toISOString().slice(0, 10);

  const isDirectional = (r: ScanResult) =>
    r.confluence?.bias === "STRONG LONG" ||
    r.confluence?.bias === "LONG" ||
    r.confluence?.bias === "STRONG SHORT" ||
    r.confluence?.bias === "SHORT";

  const signalResults = results.filter(isDirectional);

  if (signalResults.length === 0) {
    return `## Morning Scan — ${dateStr}\n\nNo LONG or SHORT signals today. All tracked coins are NEUTRAL or still accumulating price history.`;
  }

  const longs = signalResults.filter((r) => r.confluence!.bias.includes("LONG"));
  const shorts = signalResults.filter((r) => r.confluence!.bias.includes("SHORT"));

  const sections: string[] = [`## Morning Scan — ${dateStr}`];
  if (longs.length > 0) {
    sections.push(`\n### 🟢 LONG Signals (${longs.length})\n\n${longs.map(formatSingleScanResult).join("\n\n")}`);
  }
  if (shorts.length > 0) {
    sections.push(`\n### 🔴 SHORT Signals (${shorts.length})\n\n${shorts.map(formatSingleScanResult).join("\n\n")}`);
  }

  return sections.join("\n");
}