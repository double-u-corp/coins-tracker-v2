import { useCallback, useState } from "react";
import type { ChartPoint, CoinSummary } from "@/validators/recordSchema";
import {
  computeConfluenceSignal,
  isLongExtended,
  isWatchlistBuyLowHit,
  getSupportResistance,
  type ConfluenceResult,
} from "../../features/chart/Technicals";
import {
  PAST_TRADE_GRANULARITY,
  PAST_TRADE_HOURS,
  PAST_TRADE_RANGE_LABEL,
  PAST_TRADE_SR_LOOKBACK,
  computeSeriesDensity,
  type SeriesDensity,
} from "./usePastTradeLogic";

export interface StructureScanResult {
  symbol: string;
  name: string;
  confluence: ConfluenceResult | null;
  seriesDensity: SeriesDensity;
  error: string | null;
  scannedAt: string;
}

const SCAN_CONCURRENCY = 5;

async function fetchPoints(symbol: string): Promise<ChartPoint[]> {
  const res = await fetch(
    `/api/coins?type=chart&symbol=${symbol}&granularity=${PAST_TRADE_GRANULARITY}&hours=${PAST_TRADE_HOURS}`
  );
  if (!res.ok) throw new Error(`Failed to load ${symbol} (${res.status})`);
  const data: { points: ChartPoint[] } = await res.json();
  return data.points || [];
}

export function usePastTradeScanner(allCoins: CoinSummary[]) {
  const [scanResults, setScanResults] = useState<StructureScanResult[]>([]);
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

    const results: StructureScanResult[] = [];
    let cursor = 0;

    async function worker() {
      while (cursor < allCoins.length) {
        const coin = allCoins[cursor];
        cursor += 1;
        try {
          const points = await fetchPoints(coin.symbol);
          const density = computeSeriesDensity(points);
          const sr = points.length > 0 ? getSupportResistance(points, PAST_TRADE_SR_LOOKBACK) : null;
          const confluence =
            points.length > 0 && sr
              ? computeConfluenceSignal(points, {
                  support: sr.support,
                  resistance: sr.resistance,
                  currentPrice: coin.currentPrice,
                  mode: "spot",
                  rangeLabel: PAST_TRADE_RANGE_LABEL,
                })
              : null;
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
            seriesDensity: {
              pointCount: 0,
              spanDays: null,
              avgRecentGapHours: null,
              lastObservedAgoMs: null,
              isFastEnough: false,
            },
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

export type StructureBucket = "near-ladder" | "extended-wait" | null;

export function classifyStructureResult(r: StructureScanResult): StructureBucket {
  if (!r.confluence) return null;
  const c = r.confluence;
  if (!c.bias.includes("LONG")) return null;
  if (isLongExtended(c)) return "extended-wait";
  if (isWatchlistBuyLowHit(c) && r.seriesDensity.isFastEnough) return "near-ladder";
  return null;
}

export function formatStructureScanForJournal(results: StructureScanResult[]): string {
  const dateStr = new Date().toISOString().slice(0, 10);
  const near = results.filter((r) => classifyStructureResult(r) === "near-ladder");
  const ext = results.filter((r) => classifyStructureResult(r) === "extended-wait");
  if (near.length === 0 && ext.length === 0) {
    return `## 3h Structure Scan — ${dateStr}\n\nNo LONG near-ladder setups on dense prints. Confirm on Spot chart.`;
  }
  const lines = [
    `## 3h Structure Scan — ${dateStr}`,
    "",
    "Spot decides bias. 3h only stages entries.",
    "",
  ];
  if (near.length) {
    lines.push(`### Near ladder (${near.length})`);
    for (const r of near) {
      const c = r.confluence!;
      lines.push(`- **${r.symbol}** ${c.bias} · ${c.currentPrice} · S ${c.support} R ${c.resistance}`);
    }
    lines.push("");
  }
  if (ext.length) {
    lines.push(`### Extended — wait pullback (${ext.length})`);
    for (const r of ext) {
      lines.push(`- **${r.symbol}**`);
    }
  }
  return lines.join("\n");
}
