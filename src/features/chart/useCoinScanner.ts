import { useCallback, useState } from "react";
import type { ChartPoint, CoinSummary } from "@/validators/recordSchema";
import { computeConfluenceSignal, type ConfluenceResult } from "./Technicals";

export interface ScanResult {
  symbol: string;
  name: string;
  confluence: ConfluenceResult | null;
  error: string | null;
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
          const confluence = points.length > 0 ? computeConfluenceSignal(points) : null;
          results.push({ symbol: coin.symbol, name: coin.name, confluence, error: null });
        } catch (err) {
          results.push({ symbol: coin.symbol, name: coin.name, confluence: null, error: (err as Error).message });
        }
        setScanProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
      }
    }

    try {
      const workerCount = Math.min(SCAN_CONCURRENCY, allCoins.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      // Preserve the original watchlist order isn't useful here — the view
      // layer sorts by signal priority, so raw completion order is fine.
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

  const formatCoin = (r: ScanResult): string => {
    const c = r.confluence!;
    const lines: string[] = [];
    lines.push(
      `**${r.symbol}** — ${c.bias} (Score: ${c.score >= 0 ? "+" : ""}${c.score}/±${c.maxPossibleScore}, ${(c.confidence * 100).toFixed(0)}% data confidence)`
    );
    lines.push(`- Price: ${c.currentPrice} | Support: ${c.support} | Resistance: ${c.resistance}`);
    lines.push(`- Macro Trend: ${c.macroTrend}${c.isCounterTrend ? " ⚠️ COUNTER-TREND (disagrees with macro)" : ""}`);
    if (c.divergence) {
      lines.push(
        `- Divergence: 🔍 Possible ${c.divergence} RSI divergence — worth a manual look, not a standalone signal`
      );
    }
    for (const s of c.signals) {
      if (!s.available) continue;
      lines.push(`  - ${s.name}: ${s.detail}${s.weight !== 0 ? ` (${s.weight > 0 ? "+" : ""}${s.weight})` : ""}`);
    }
    if (c.invalidationNote) {
      lines.push(`- Invalidation: ${c.invalidationNote}`);
    }
    return lines.join("\n");
  };

  const sections: string[] = [`## Morning Scan — ${dateStr}`];
  if (longs.length > 0) {
    sections.push(`\n### 🟢 LONG Signals (${longs.length})\n\n${longs.map(formatCoin).join("\n\n")}`);
  }
  if (shorts.length > 0) {
    sections.push(`\n### 🔴 SHORT Signals (${shorts.length})\n\n${shorts.map(formatCoin).join("\n\n")}`);
  }

  return sections.join("\n");
}