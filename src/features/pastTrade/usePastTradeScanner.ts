import { useCallback, useState } from "react";
import type { ChartPoint, CoinSummary } from "@/validators/recordSchema";
import {
  computeConfluenceSignal,
  isLongExtended,
  isWatchlistBuyLowHit,
  getSupportResistance,
  getEffectivePrice,
  calculateSMAAt,
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

/** Price near 20 SMA with upside pressure (possible/fresh cross) — not historical crosses. */
export interface SmaCrossScanResult {
  symbol: string;
  name: string;
  currentPrice: number;
  sma20: number;
  distPct: number;
  /** approaching = below SMA rising; at_cross = within tight band; above = just above SMA */
  status: "approaching" | "at_cross" | "above";
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

/** Daily bars for SMA20 cross (matches Spot-style daily confluence). */
async function fetchDailyPoints(symbol: string): Promise<ChartPoint[]> {
  const res = await fetch(
    `/api/coins?type=chart&symbol=${symbol}&years=0.50&granularity=daily`
  );
  if (!res.ok) {
    // Fallback: weekly won't work well — try years=1 daily
    const res2 = await fetch(
      `/api/coins?type=chart&symbol=${symbol}&years=1.00&granularity=daily`
    );
    if (!res2.ok) throw new Error(`Failed to load daily ${symbol} (${res.status})`);
    const data2: { points: ChartPoint[] } = await res2.json();
    return data2.points || [];
  }
  const data: { points: ChartPoint[] } = await res.json();
  return data.points || [];
}

/**
 * Current setup only: price near 20 SMA and rising (possible crossover).
 * - approaching: below SMA but within ~3%, last close up
 * - at_cross: within ~±1% of SMA and rising (or flat-to-up)
 * - above: 0–3% above SMA (fresh reclaim zone — not extended)
 * Does NOT require a historical cross in the past N days.
 */
function detectNearSma20Upside(
  points: ChartPoint[]
): { sma20: number; price: number; distPct: number; status: "approaching" | "at_cross" | "above" } | null {
  if (points.length < 21) return null;
  const closes = points.map(getEffectivePrice);
  const price = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const sma20 = calculateSMAAt(points, 20, 0);
  if (sma20 == null || sma20 <= 0 || !Number.isFinite(price)) return null;

  const distPct = ((price - sma20) / sma20) * 100;
  const rising = price > prev;
  const flatOrUp = price >= prev * 0.998; // allow tiny noise

  // Band for illiquid PHP pairs (e.g. SHIB can sit ~4% above and still "look near")
  // Outside this → not a near-cross setup (either deep discount or already extended)
  if (distPct < -4 || distPct > 5) return null;

  let status: "approaching" | "at_cross" | "above" | null = null;
  if (distPct < -1) {
    // Below SMA — only if climbing toward it
    if (rising) status = "approaching";
  } else if (distPct <= 1.5) {
    // Hugging the SMA
    if (flatOrUp) status = "at_cross";
  } else {
    // Slightly above (to +5%) — fresh reclaim zone, still near
    if (flatOrUp) status = "above";
  }
  if (!status) return null;
  return { sma20, price, distPct, status };
}

export function usePastTradeScanner(allCoins: CoinSummary[]) {
  const [scanResults, setScanResults] = useState<StructureScanResult[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ completed: 0, total: 0 });
  const [scanError, setScanError] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);

  const [crossResults, setCrossResults] = useState<SmaCrossScanResult[]>([]);
  const [isCrossScanning, setIsCrossScanning] = useState(false);
  const [crossProgress, setCrossProgress] = useState({ completed: 0, total: 0 });
  const [crossError, setCrossError] = useState<string | null>(null);
  const [hasCrossScanned, setHasCrossScanned] = useState(false);

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

  /** Daily 20 SMA bullish cross scan (separate from structure scan). */
  const runSmaCrossScan = useCallback(async () => {
    if (allCoins.length === 0) return;
    setIsCrossScanning(true);
    setCrossError(null);
    setCrossResults([]);
    setCrossProgress({ completed: 0, total: allCoins.length });

    const results: SmaCrossScanResult[] = [];
    let cursor = 0;

    async function worker() {
      while (cursor < allCoins.length) {
        const coin = allCoins[cursor];
        cursor += 1;
        try {
          const points = await fetchDailyPoints(coin.symbol);
          const hit = detectNearSma20Upside(points);
          if (hit) {
            results.push({
              symbol: coin.symbol,
              name: coin.name,
              currentPrice: hit.price,
              sma20: hit.sma20,
              distPct: hit.distPct,
              status: hit.status,
              error: null,
              scannedAt: new Date().toISOString(),
            });
          }
        } catch (err) {
          results.push({
            symbol: coin.symbol,
            name: coin.name,
            currentPrice: coin.currentPrice ?? 0,
            sma20: 0,
            distPct: 0,
            status: "approaching",
            error: (err as Error).message,
            scannedAt: new Date().toISOString(),
          });
        }
        setCrossProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
      }
    }

    try {
      const workerCount = Math.min(SCAN_CONCURRENCY, allCoins.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      // Sort: freshest cross first, then closer to SMA (less extended)
      const statusRank = (s: SmaCrossScanResult["status"]) =>
        s === "at_cross" ? 0 : s === "approaching" ? 1 : 2;
      results.sort((a, b) => {
        if (a.error && !b.error) return 1;
        if (!a.error && b.error) return -1;
        const ra = statusRank(a.status);
        const rb = statusRank(b.status);
        if (ra !== rb) return ra - rb;
        return Math.abs(a.distPct) - Math.abs(b.distPct);
      });
      setCrossResults(results.filter((r) => !r.error));
      setHasCrossScanned(true);
    } catch (err) {
      setCrossError((err as Error).message || "SMA cross scan failed");
    } finally {
      setIsCrossScanning(false);
    }
  }, [allCoins]);

  return {
    scanResults,
    isScanning,
    scanProgress,
    scanError,
    hasScanned,
    runScan,
    crossResults,
    isCrossScanning,
    crossProgress,
    crossError,
    hasCrossScanned,
    runSmaCrossScan,
  };
}

export type StructureBucket = "near-ladder" | "extended-wait" | null;

export function classifyStructureResult(r: StructureScanResult): StructureBucket {
  if (!r.confluence) return null;
  const c = r.confluence;
  if (!c.bias.includes("LONG")) return null;
  if (!r.seriesDensity.isFastEnough) return null;
  if (isLongExtended(c)) return "extended-wait";
  if (isWatchlistBuyLowHit(c)) return "near-ladder";
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
    "Spot decides bias. Structure only stages entries.",
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

export function formatSmaCrossScanForJournal(results: SmaCrossScanResult[]): string {
  const dateStr = new Date().toISOString().slice(0, 10);
  if (results.length === 0) {
    return `## 20 SMA Near-Cross Scan — ${dateStr}\n\nNo coins near 20 SMA with upside pressure right now.`;
  }
  const lines = [
    `## 20 SMA Near-Cross Scan — ${dateStr}`,
    "",
    "Price near 20 SMA and rising (possible cross). Confirm on Spot; do not chase if already extended.",
    "",
  ];
  for (const r of results) {
    lines.push(
      `- **${r.symbol}** · ${r.status} · price ${r.currentPrice.toFixed(6)} · 20SMA ${r.sma20.toFixed(6)} · ${r.distPct >= 0 ? "+" : ""}${r.distPct.toFixed(1)}% vs SMA`
    );
  }
  return lines.join("\n");
}
