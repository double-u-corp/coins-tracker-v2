/**
 * One bulk scan for Home: Near 30d support · RSI oversold (fast pump removed — weekly Timing covers momentum).
 * Results stored in CatalystLog — Home loads snapshot (1 read) unless user re-runs.
 */
import prisma from "@/lib/prisma";
import {
  calculateRSIAt,
  calculateSMAAt,
} from "@/features/chart/Technicals";
import type { ChartPoint } from "@/validators/recordSchema";

export const HOME_MONITOR_PROMPT_ID = "home-monitor-scan";
export const HOME_MONITOR_CATEGORY = "HomeMonitor";

const SKIP = new Set(["BTCPHP", "BTC", "ETHPHP", "ETH", "XAUTPHP", "XAUT"]);
const DAYS = 100;

export type MonitorHitBase = {
  symbol: string;
  name: string;
  priceAtScan: number;
  detail: string;
  score: number;
};

export type NearSupportHit = MonitorHitBase & {
  support: number;
  resistance: number;
  positionPct: number;
};

export type FastPumpHit = MonitorHitBase & {
  sma20: number;
  extensionPct: number;
  oneDayLiftPct: number;
};

export type RsiOversoldHit = MonitorHitBase & {
  rsi: number;
  sma20: number | null;
};

export type HomeMonitorSnapshot = {
  scannedAt: string; // ISO
  scannedAtManila?: string;
  coinCount: number;
  nearSupport: NearSupportHit[];
  fastPump: FastPumpHit[];
  rsiOversold: RsiOversoldHit[];
};

function manilaLabel(d = new Date()): string {
  return d.toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function toDailyPoints(
  rows: { price: number; createdAt: Date }[]
): ChartPoint[] {
  // One bar per Manila calendar day: high/low/close from prints
  const byDay = new Map<
    string,
    { high: number; low: number; close: number; period: string }
  >();
  for (const r of rows) {
    const m = new Date(r.createdAt.getTime() + 8 * 3600_000);
    const day = m.toISOString().slice(0, 10);
    const p = r.price;
    if (!(p > 0)) continue;
    const prev = byDay.get(day);
    if (!prev) {
      byDay.set(day, { high: p, low: p, close: p, period: day });
    } else {
      prev.high = Math.max(prev.high, p);
      prev.low = Math.min(prev.low, p);
      prev.close = p;
    }
  }
  return [...byDay.values()]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((b) => ({
      period: b.period,
      label: b.period,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
}

function scoreNearSupport(points: ChartPoint[]): Omit<NearSupportHit, "symbol" | "name"> | null {
  if (points.length < 8) return null;
  const slice = points.slice(-30);
  if (slice.length < 8) return null;
  const last = slice[slice.length - 1];
  const price = last.close ?? last.high;
  if (!(price > 0)) return null;
  const prior = slice.length > 1 ? slice.slice(0, -1) : slice;
  const support = Math.min(...prior.map((p) => p.low));
  const resistance = Math.max(...slice.map((p) => p.high));
  if (!(support > 0) || !(resistance > support)) return null;
  const range = resistance - support;
  if (range / support < 0.002) return null;
  const position = (price - support) / range;
  const positionPct = position * 100;
  // Near floor: lower third or below prior support
  if (position > 0.33 && position >= 0) return null;
  let detail: string;
  if (position < 0) detail = `Below prior support (${Math.abs(positionPct).toFixed(0)}% under)`;
  else detail = `Near range support (${positionPct.toFixed(0)}% of 30d range)`;
  // Prefer closer to floor
  const score = position < 0 ? 100 + Math.abs(positionPct) : 33 - positionPct;
  return {
    priceAtScan: price,
    support,
    resistance,
    positionPct,
    detail,
    score,
  };
}

function scoreFastPump(points: ChartPoint[]): Omit<FastPumpHit, "symbol" | "name"> | null {
  if (points.length < 22) return null;
  const chartPts = points;
  const i = chartPts.length - 1;
  const price = chartPts[i].close ?? chartPts[i].high;
  const sma20 = calculateSMAAt(chartPts, 20, 0);
  if (sma20 == null || !(sma20 > 0) || !(price > 0) || price <= sma20) return null;
  const extensionPct = ((price - sma20) / sma20) * 100;
  const prev1 = chartPts[Math.max(0, i - 1)].close ?? chartPts[Math.max(0, i - 1)].high;
  const prev3 = chartPts[Math.max(0, i - 3)].close ?? chartPts[Math.max(0, i - 3)].high;
  const oneDayLiftPct = prev1 > 0 ? ((price - prev1) / prev1) * 100 : 0;
  const quickLiftPct = prev3 > 0 ? ((price - prev3) / prev3) * 100 : 0;
  let freshCross = false;
  for (let k = 1; k <= 3; k++) {
    const j = i - k;
    if (j < 0) break;
    const s = calculateSMAAt(chartPts, 20, k);
    const pj = chartPts[j].close ?? chartPts[j].high;
    if (s != null && pj <= s) {
      freshCross = true;
      break;
    }
  }
  const hasImpulse = oneDayLiftPct >= 1.2 || quickLiftPct >= 2.5 || freshCross;
  if (!hasImpulse) return null;
  let score = oneDayLiftPct * 4 + Math.max(0, quickLiftPct) * 1.5;
  if (freshCross) score += 6;
  score += Math.min(Math.max(extensionPct, 0), 8) * 0.4;
  const detail =
    oneDayLiftPct >= 2
      ? `Fast +${oneDayLiftPct.toFixed(1)}% day above 20 SMA — watch cool-down`
      : `Above 20 SMA · +${extensionPct.toFixed(1)}% vs SMA`;
  return {
    priceAtScan: price,
    sma20,
    extensionPct,
    oneDayLiftPct,
    detail,
    score,
  };
}

function scoreRsi(points: ChartPoint[]): Omit<RsiOversoldHit, "symbol" | "name"> | null {
  if (points.length < 20) return null;
  const rsi = calculateRSIAt(points, 14, 0);
  if (rsi == null || rsi > 40) return null;
  const price = points[points.length - 1].close ?? points[points.length - 1].high;
  if (!(price > 0)) return null;
  const sma20 = calculateSMAAt(points, 20, 0);
  const pctBelowSma20 =
    sma20 != null && sma20 > 0 ? ((sma20 - price) / sma20) * 100 : null;
  let score = 40 - rsi;
  if (pctBelowSma20 != null && pctBelowSma20 > 0) score += Math.min(pctBelowSma20, 8) * 0.15;
  const zone = rsi <= 30 ? "oversold" : "leaning oversold";
  const detail =
    pctBelowSma20 != null && pctBelowSma20 > 0
      ? `RSI ${rsi.toFixed(0)} — ${zone} · ${pctBelowSma20.toFixed(1)}% below 20 SMA`
      : `RSI ${rsi.toFixed(0)} — ${zone}`;
  return { priceAtScan: price, rsi, sma20, detail, score };
}

export async function loadHomeMonitorSnapshot(): Promise<HomeMonitorSnapshot | null> {
  try {
    const log = await prisma.catalystLog.findUnique({
      where: { promptId: HOME_MONITOR_PROMPT_ID },
    });
    if (!log?.response) return null;
    const j = JSON.parse(log.response) as HomeMonitorSnapshot;
    if (!j?.scannedAt) return null;
    return j;
  } catch {
    return null;
  }
}

export async function runHomeMonitorScan(): Promise<HomeMonitorSnapshot> {
  const cutoff = new Date(Date.now() - DAYS * 24 * 3600_000);
  let coins: { id: number; symbol: string; name: string }[];
  try {
    coins = await prisma.coin.findMany({
      where: { trackingEnabled: true },
      select: { id: true, symbol: true, name: true },
      orderBy: { symbol: "asc" },
    });
  } catch {
    coins = await prisma.coin.findMany({
      select: { id: true, symbol: true, name: true },
      orderBy: { symbol: "asc" },
    });
  }
  const active = coins.filter((c) => !SKIP.has(c.symbol.toUpperCase()));
  const ids = active.map((c) => c.id);
  const records = await prisma.record.findMany({
    where: { coinId: { in: ids }, createdAt: { gte: cutoff } },
    select: { coinId: true, price: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const byCoin = new Map<number, { price: number; createdAt: Date }[]>();
  for (const r of records) {
    const arr = byCoin.get(r.coinId) || [];
    arr.push({ price: r.price, createdAt: r.createdAt });
    byCoin.set(r.coinId, arr);
  }

  const near: NearSupportHit[] = [];
  const pump: FastPumpHit[] = [];
  const rsiHits: RsiOversoldHit[] = [];

  for (const c of active) {
    const rows = byCoin.get(c.id) || [];
    const points = toDailyPoints(rows);
    const name = c.name || c.symbol.replace(/PHP$/i, "");
    const ns = scoreNearSupport(points);
    if (ns) near.push({ symbol: c.symbol, name, ...ns });
    const fp = scoreFastPump(points);
    if (fp) pump.push({ symbol: c.symbol, name, ...fp });
    const rs = scoreRsi(points);
    if (rs) rsiHits.push({ symbol: c.symbol, name, ...rs });
  }

  near.sort((a, b) => b.score - a.score);
  pump.sort((a, b) => b.score - a.score);
  rsiHits.sort((a, b) => b.score - a.score);

  const now = new Date();
  const snapshot: HomeMonitorSnapshot = {
    scannedAt: now.toISOString(),
    scannedAtManila: manilaLabel(now),
    coinCount: active.length,
    nearSupport: near.slice(0, 8),
    fastPump: [] /* deprecated: weekly Timing soft/hot windows */,
    rsiOversold: rsiHits.slice(0, 8),
  };

  await prisma.catalystLog.upsert({
    where: { promptId: HOME_MONITOR_PROMPT_ID },
    create: {
      promptId: HOME_MONITOR_PROMPT_ID,
      category: HOME_MONITOR_CATEGORY,
      response: JSON.stringify(snapshot),
    },
    update: {
      category: HOME_MONITOR_CATEGORY,
      response: JSON.stringify(snapshot),
    },
  });

  return snapshot;
}
