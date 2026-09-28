import { useCallback, useState } from "react";
import type { ChartPoint, CoinSummary } from "@/validators/recordSchema";
import {
  computeConfluenceSignal,
  getSupportResistance,
  isLongExtended,
  isShortExtended,
  isWatchlistBuyLowHit,
  isFastTradeShortReadyHit,
  type ConfluenceResult,
} from "../../features/chart/Technicals";
import { formatSingleScanResult, type ScanResult } from "../../features/chart/useCoinScanner";
import {
  computeSeriesDensity,
  PAST_TRADE_GRANULARITY,
  PAST_TRADE_HOURS,
  PAST_TRADE_SR_LOOKBACK,
  PAST_TRADE_RANGE_LABEL,
  type SeriesDensity,
} from "./usePastTradeLogic";

export interface FastTradeScanResult {
  symbol: string;
  name: string;
  confluence: ConfluenceResult | null;
  seriesDensity: SeriesDensity | null;
  error: string | null;
  scannedAt: string;
}

// Same bounded-concurrency pattern as useCoinScanner's Watchlist Scan —
// kinder to the backend/browser than firing one request per coin at once.
const SCAN_CONCURRENCY = 5;

async function fetchPastTradePoints(symbol: string): Promise<ChartPoint[]> {
  const res = await fetch(
    `/api/coins?type=chart&symbol=${symbol}&granularity=${PAST_TRADE_GRANULARITY}&hours=${PAST_TRADE_HOURS}`
  );
  if (!res.ok) throw new Error(`Failed to load ${symbol} (${res.status})`);
  const data: { points: ChartPoint[] } = await res.json();
  return data.points;
}

export function usePastTradeScanner(allCoins: CoinSummary[]) {
  const [scanResults, setScanResults] = useState<FastTradeScanResult[]>([]);
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

    const results: FastTradeScanResult[] = [];
    let cursor = 0;

    async function worker() {
      while (cursor < allCoins.length) {
        const coin = allCoins[cursor];
        cursor += 1;
        try {
          const points = await fetchPastTradePoints(coin.symbol);
          const density = computeSeriesDensity(points);
          let confluence: ConfluenceResult | null = null;
          if (points.length > 0) {
            const { support, resistance } = getSupportResistance(points, PAST_TRADE_SR_LOOKBACK);
            confluence = computeConfluenceSignal(points, {
              support,
              resistance,
              currentPrice: coin.currentPrice,
              mode: "leverage",
              rangeLabel: PAST_TRADE_RANGE_LABEL,
            });
          }
          results.push({
            symbol: coin.symbol,
            name: coin.name,
            confluence,
            seriesDensity: density,
            error: null,
            scannedAt: new Date().toISOString(),
          });
        } catch (err) {
          results.push({
            symbol: coin.symbol,
            name: coin.name,
            confluence: null,
            seriesDensity: null,
            error: (err as Error).message,
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

/** Which "bucket" a scanned coin falls into for the fast-trade digest. */
export type FastTradeBucket = "long-ready" | "long-extended" | "short-ready" | "short-extended" | null;

export function classifyFastTradeResult(r: FastTradeScanResult): FastTradeBucket {
  if (!r.confluence) return null;
  const c = r.confluence;
  if (c.bias.includes("LONG")) {
    return isLongExtended(c) ? "long-extended" : isWatchlistBuyLowHit(c) ? "long-ready" : null;
  }
  if (isFastTradeShortReadyHit(c)) {
    return isShortExtended(c) ? "short-extended" : "short-ready";
  }
  return null;
}

/** Same "why" breakdown as formatSingleScanResult (useCoinScanner.ts), plus
 * a leading density line — a confident-looking LONG/SHORT bias on a coin
 * that's barely printing new extremes is exactly the case this page needs
 * to flag, not hide. */
export function formatSingleFastTradeResult(r: FastTradeScanResult): string {
  if (!r.confluence) return `**${r.symbol}** — no data available.`;
  const scanResult: ScanResult = {
    symbol: r.symbol,
    name: r.name,
    confluence: r.confluence,
    error: r.error,
    streak: 0,
    scannedAt: r.scannedAt,
  };
  const base = formatSingleScanResult(scanResult);
  if (!r.seriesDensity || r.seriesDensity.pointCount < 2) return base;

  const d = r.seriesDensity;
  const densityLine = d.isFastEnough
    ? `- ✅ Printing frequently${d.avgRecentGapHours != null ? ` (~${d.avgRecentGapHours.toFixed(1)}h between recent prints)` : ""}`
    : `- ⚠️ Printing slowly${d.avgRecentGapHours != null ? ` (~${d.avgRecentGapHours.toFixed(1)}h between recent prints)` : ""} — thin data, lower-confidence read`;

  return `${base}\n${densityLine}`;
}

/** Builds a full Markdown digest of the fast-trade scan, split into the
 * four buckets above — mirrors formatScanResultsForJournal (useCoinScanner)
 * but covers BOTH directions, since leverage makes SHORT an actionable
 * entry instead of "hold cash". */
export function formatFastTradeScanForJournal(results: FastTradeScanResult[]): string {
  const dateStr = new Date().toISOString().slice(0, 10);

  const buckets: Record<Exclude<FastTradeBucket, null>, FastTradeScanResult[]> = {
    "long-ready": [],
    "long-extended": [],
    "short-ready": [],
    "short-extended": [],
  };

  for (const r of results) {
    const bucket = classifyFastTradeResult(r);
    if (bucket) buckets[bucket].push(r);
  }

  const total =
    buckets["long-ready"].length +
    buckets["long-extended"].length +
    buckets["short-ready"].length +
    buckets["short-extended"].length;

  if (total === 0) {
    return `## Fast-Trade Scan — ${dateStr}\n\nNo LONG or SHORT entries ready today. All scanned coins are NEUTRAL, extended, or still accumulating history.`;
  }

  const sections: string[] = [`## Fast-Trade Scan — ${dateStr}`];

  if (buckets["long-ready"].length > 0) {
    sections.push(
      `\n### 🟢 LONG — near support / ready (${buckets["long-ready"].length})\n\n${buckets["long-ready"].map(formatSingleFastTradeResult).join("\n\n")}`
    );
  }
  if (buckets["short-ready"].length > 0) {
    sections.push(
      `\n### 🔴 SHORT — near resistance / ready (${buckets["short-ready"].length})\n\n${buckets["short-ready"].map(formatSingleFastTradeResult).join("\n\n")}`
    );
  }
  if (buckets["long-extended"].length > 0) {
    sections.push(
      `\n### ⏳ LONG — extended, wait for pullback (${buckets["long-extended"].length})\n\n${buckets["long-extended"].map(formatSingleFastTradeResult).join("\n\n")}`
    );
  }
  if (buckets["short-extended"].length > 0) {
    sections.push(
      `\n### ⏳ SHORT — extended, wait for bounce (${buckets["short-extended"].length})\n\n${buckets["short-extended"].map(formatSingleFastTradeResult).join("\n\n")}`
    );
  }

  return sections.join("\n");
}
