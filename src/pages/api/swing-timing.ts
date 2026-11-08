import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";

/** Cron slots (Manila local hour) — matches Home next-run schedule. */
const SLOT_HOURS = [2, 5, 8, 11, 14, 17, 20, 23] as const;

const SLOT_LABELS: Record<number, string> = {
  2: "02:05 AM Manila",
  5: "05:05 AM Manila",
  8: "08:05 AM Manila (daily reset)",
  11: "11:05 AM Manila",
  14: "02:05 PM Manila",
  17: "05:05 PM Manila (London)",
  20: "08:05 PM Manila (US pre-market)",
  23: "11:05 PM Manila (US peak)",
};

/** JS getUTCDay: 0=Sun … 6=Sat — labels in Monday-first display order */
const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

type SlotStat = {
  hour: number;
  label: string;
  sampleCount: number;
  coinCount: number;
  avgAbsPct: number;
  medianAbsPct: number;
  pctMovesAbove1: number;
  upSharePct: number;
  avgUpPct: number;
  avgDownPct: number;
  upCount: number;
  downCount: number;
  rank: number;
  intensity: "quiet" | "normal" | "active" | "hot";
};

type WeekdayStat = {
  /** 0=Sunday … 6=Saturday (JS) */
  day: number;
  label: string;
  sampleCount: number;
  avgAbsPct: number;
  medianAbsPct: number;
  pctMovesAbove1: number;
  upSharePct: number;
  avgUpPct: number;
  avgDownPct: number;
  upCount: number;
  downCount: number;
  rank: number;
  intensity: "quiet" | "normal" | "active" | "hot";
};

type CoinSlotHighlight = {
  symbol: string;
  name: string;
  avgAbsPct: number;
  samples: number;
};

/** Per-coin tendency on a given Manila weekday */
type CoinWeekdayBias = {
  symbol: string;
  name: string;
  day: number;
  dayLabel: string;
  samples: number;
  upSharePct: number;
  avgSignedPct: number;
  /** "buy-lean" if upShare >= 55, "sell-lean" if upShare <= 45, else "mixed" */
  lean: "buy-lean" | "sell-lean" | "mixed";
};

type UserFillOutcome = {
  type: "buy" | "sell";
  symbol: string;
  name: string;
  phpAmount: number;
  price: number;
  coinAmount: number;
  /** ISO UTC */
  transactedAt: string;
  /** Manila label */
  manilaLabel: string;
  weekdayLabel: string;
  /** % vs fill price */
  path24hPct: number | null;
  path72hPct: number | null;
  pathToLatestPct: number | null;
};

type DayFlowSummary = {
  day: number;
  label: string;
  upSharePct: number;
  avgSignedPct: number;
  /** Coins that most often rise this weekday */
  topBuyLeanCoins: { symbol: string; name: string; upSharePct: number; samples: number }[];
  /** Coins that most often fall this weekday */
  topSellLeanCoins: { symbol: string; name: string; upSharePct: number; samples: number }[];
};

/** Biggest movers over the last ~48h only (independent of days window). */
type Coin2dMover = {
  symbol: string;
  name: string;
  /** Sum of consecutive |%| moves in the last ~2 days */
  totalAbsPct: number;
  /** Last print vs first print in window (%) */
  netPct: number;
  samples: number;
  lastPrice: number;
};

type ResponseBody = {
  days: number;
  generatedAt: string;
  slots: SlotStat[];
  weekdays: WeekdayStat[];
  hottestSlot: SlotStat | null;
  quietestSlot: SlotStat | null;
  hottestWeekday: WeekdayStat | null;
  quietestWeekday: WeekdayStat | null;
  strongestUpSlot: SlotStat | null;
  strongestDownSlot: SlotStat | null;
  strongestUpWeekday: WeekdayStat | null;
  strongestDownWeekday: WeekdayStat | null;
  topMoversByHotSlot: CoinSlotHighlight[];
  userFills: UserFillOutcome[];
  /** Ranked by totalAbsPct over last 48h — not the 14/30/60 hot-slot list */
  topMovers2d: Coin2dMover[];
  /** Weekdays sorted most buy-lean (high % up) → most sell-lean */
  dayFlow: DayFlowSummary[];
  /** Coins with clearest buy-lean day (need enough samples) */
  coinsBuyLean: CoinWeekdayBias[];
  /** Coins with clearest sell-lean day */
  coinsSellLean: CoinWeekdayBias[];
  /** All coins with weekday rows (for Timing coin selector) */
  coinWeekdayTable: {
    symbol: string;
    name: string;
    days: {
      day: number;
      dayLabel: string;
      samples: number;
      upSharePct: number;
      avgSignedPct: number;
      lean: "buy-lean" | "sell-lean" | "mixed";
    }[];
  }[];
  guidance: string[];
  fromCache?: boolean;
  cacheUpdatedAt?: string | null;
};

type ErrorBody = { error: string };

function toManilaParts(d: Date): { hour: number; weekday: number } {
  // Asia/Manila is UTC+8 year-round (no DST)
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000;
  const manila = new Date(utcMs + 8 * 60 * 60_000);
  return { hour: manila.getHours(), weekday: manila.getDay() };
}

function nearestSlotHour(hour: number): number {
  let best: number = SLOT_HOURS[0];
  let bestDist = 24;
  for (const s of SLOT_HOURS) {
    const dist = Math.min(Math.abs(hour - s), 24 - Math.abs(hour - s));
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  // Only accept if within ~90 minutes of a slot
  return bestDist <= 1 ? best : -1;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function directionStats(signed: number[]) {
  const ups = signed.filter((x) => x > 0);
  const downs = signed.filter((x) => x < 0);
  const n = signed.length;
  return {
    upCount: ups.length,
    downCount: downs.length,
    upSharePct: Number((n > 0 ? (ups.length / n) * 100 : 0).toFixed(1)),
    avgUpPct: Number((ups.length ? ups.reduce((a: number, b: number) => a + b, 0) / ups.length : 0).toFixed(3)),
    avgDownPct: Number(
      (downs.length ? downs.reduce((a: number, b: number) => a + Math.abs(b), 0) / downs.length : 0).toFixed(3)
    ),
  };
}

function intensityFromRank(
  avgAbsPct: number,
  minAvg: number,
  maxAvg: number
): "quiet" | "normal" | "active" | "hot" {
  const t = maxAvg > minAvg ? (avgAbsPct - minAvg) / (maxAvg - minAvg) : 0.5;
  if (t >= 0.75) return "hot";
  if (t >= 0.5) return "active";
  if (t >= 0.25) return "normal";
  return "quiet";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody | ErrorBody>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Bust CDN/browser cache when user hits Refresh
  res.setHeader("Cache-Control", "no-store, max-age=0");

  const daysRaw = Number(req.query.days ?? 28);
  // Only 7 / 14 / 28 supported for cache keys
  let days = Number.isFinite(daysRaw) ? Math.round(daysRaw) : 28;
  if (![7, 14, 28].includes(days)) {
    days = days <= 10 ? 7 : days <= 21 ? 14 : 28;
  }
  const forceRefresh =
    req.query.refresh === "1" ||
    req.query.refresh === "true" ||
    req.query.force === "1";

  const cacheKey = `swing-timing-${days}`;

  if (!forceRefresh) {
    try {
      const cached = await prisma.catalystLog.findUnique({ where: { promptId: cacheKey } });
      if (cached?.response) {
        const parsed = JSON.parse(cached.response) as ResponseBody;
        if (parsed && Array.isArray(parsed.slots)) {
          return res.status(200).json({
            ...parsed,
            days,
            fromCache: true,
            cacheUpdatedAt: cached.updatedAt?.toISOString?.() ?? cached.createdAt?.toISOString?.() ?? null,
          });
        }
      }
    } catch {
      /* fall through to empty */
    }
    return res.status(200).json({
      days,
      generatedAt: new Date().toISOString(),
      slots: [],
      weekdays: [],
      hottestSlot: null,
      quietestSlot: null,
      hottestWeekday: null,
      quietestWeekday: null,
      strongestUpSlot: null,
      strongestDownSlot: null,
      strongestUpWeekday: null,
      strongestDownWeekday: null,
      topMoversByHotSlot: [],
      userFills: [],
      topMovers2d: [],
      dayFlow: [],
      coinsBuyLean: [],
      coinsSellLean: [],
      coinWeekdayTable: [],
      guidance: ["No cached analysis for this range. Click Run analysis on Timing."],
      fromCache: true,
      cacheUpdatedAt: null,
    });
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const coins = await prisma.coin.findMany({
    select: { id: true, symbol: true, name: true },
    orderBy: { symbol: "asc" },
  });

  const movesBySlot = new Map<number, number[]>();
  const signedBySlot = new Map<number, number[]>();
  const movesBySlotCoin = new Map<number, Map<string, number[]>>();
  const movesByWeekday = new Map<number, number[]>();
  const signedByWeekday = new Map<number, number[]>();

  for (const h of SLOT_HOURS) {
    movesBySlot.set(h, []);
    signedBySlot.set(h, []);
    movesBySlotCoin.set(h, new Map());
  }
  for (let d = 0; d <= 6; d++) {
    movesByWeekday.set(d, []);
    signedByWeekday.set(d, []);
  }
  /** weekday -> symbol -> signed % moves */
  const signedByWeekdayCoin = new Map<number, Map<string, number[]>>();
  for (let d = 0; d <= 6; d++) signedByWeekdayCoin.set(d, new Map());

  const since2d = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const movers2dRaw: {
    symbol: string;
    name: string;
    totalAbsPct: number;
    netPct: number;
    samples: number;
    lastPrice: number;
  }[] = [];

  for (const coin of coins) {
    const records = await prisma.record.findMany({
      where: { coinId: coin.id, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { price: true, createdAt: true },
    });
    if (records.length < 2) continue;

    // Last ~48h path only (independent of activity-window days)
    const rec2d = records.filter((r) => r.createdAt >= since2d);
    if (rec2d.length >= 2) {
      let totalAbs = 0;
      let samples2d = 0;
      for (let i = 1; i < rec2d.length; i++) {
        const prev = rec2d[i - 1];
        const cur = rec2d[i];
        if (!(prev.price > 0) || !(cur.price > 0)) continue;
        const gapH = (cur.createdAt.getTime() - prev.createdAt.getTime()) / (60 * 60 * 1000);
        if (gapH > 5) continue;
        totalAbs += (Math.abs(cur.price - prev.price) / prev.price) * 100;
        samples2d += 1;
      }
      const first = rec2d.find((r) => r.price > 0);
      const last = [...rec2d].reverse().find((r) => r.price > 0);
      if (samples2d >= 2 && first && last) {
        movers2dRaw.push({
          symbol: coin.symbol,
          name: coin.name,
          totalAbsPct: totalAbs,
          netPct: ((last.price - first.price) / first.price) * 100,
          samples: samples2d,
          lastPrice: last.price,
        });
      }
    }

    for (let i = 1; i < records.length; i++) {
      const prev = records[i - 1];
      const cur = records[i];
      if (!(prev.price > 0) || !(cur.price > 0)) continue;

      // Skip gaps larger than ~5h (missed polls / multi-day) so we measure slot-to-slot swing
      const gapH = (cur.createdAt.getTime() - prev.createdAt.getTime()) / (60 * 60 * 1000);
      if (gapH > 5) continue;

      const signedPct = ((cur.price - prev.price) / prev.price) * 100;
      const absPct = Math.abs(signedPct);
      const { hour, weekday } = toManilaParts(cur.createdAt);
      const slot = nearestSlotHour(hour);
      if (slot < 0) continue;

      movesBySlot.get(slot)!.push(absPct);
      signedBySlot.get(slot)!.push(signedPct);
      const coinMap = movesBySlotCoin.get(slot)!;
      if (!coinMap.has(coin.symbol)) coinMap.set(coin.symbol, []);
      coinMap.get(coin.symbol)!.push(absPct);

      movesByWeekday.get(weekday)!.push(absPct);
      signedByWeekday.get(weekday)!.push(signedPct);
      const wdCoin = signedByWeekdayCoin.get(weekday)!;
      if (!wdCoin.has(coin.symbol)) wdCoin.set(coin.symbol, []);
      wdCoin.get(coin.symbol)!.push(signedPct);
    }
  }

  const rawSlots: Omit<SlotStat, "rank" | "intensity">[] = SLOT_HOURS.map((hour) => {
    const samples = movesBySlot.get(hour) || [];
    const avgAbsPct =
      samples.length > 0 ? samples.reduce((a: number, b: number) => a + b, 0) / samples.length : 0;
    const medianAbsPct = median(samples);
    const pctMovesAbove1 =
      samples.length > 0
        ? (samples.filter((x) => x >= 1).length / samples.length) * 100
        : 0;
    const coinCount = [...(movesBySlotCoin.get(hour)?.values() || [])].filter(
      (arr) => arr.length > 0
    ).length;

    const dir = directionStats(signedBySlot.get(hour) || []);
    return {
      hour,
      label: SLOT_LABELS[hour] || `${hour}:05`,
      sampleCount: samples.length,
      coinCount,
      avgAbsPct: Number(avgAbsPct.toFixed(3)),
      medianAbsPct: Number(medianAbsPct.toFixed(3)),
      pctMovesAbove1: Number(pctMovesAbove1.toFixed(1)),
      ...dir,
    };
  });

  const byHeat = [...rawSlots].sort((a, b) => b.avgAbsPct - a.avgAbsPct);
  const maxAvg = byHeat[0]?.avgAbsPct || 1;
  const minAvg = byHeat[byHeat.length - 1]?.avgAbsPct || 0;

  const slots: SlotStat[] = rawSlots.map((s) => {
    const rank = byHeat.findIndex((x) => x.hour === s.hour) + 1;
    return {
      ...s,
      rank,
      intensity: intensityFromRank(s.avgAbsPct, minAvg, maxAvg),
    };
  });

  // Weekday stats (Manila calendar day of the later poll)
  const rawWeekdays: Omit<WeekdayStat, "rank" | "intensity">[] = [];
  for (let d = 0; d <= 6; d++) {
    const samples = movesByWeekday.get(d) || [];
    const avgAbsPct =
      samples.length > 0 ? samples.reduce((a: number, b: number) => a + b, 0) / samples.length : 0;
    const dir = directionStats(signedByWeekday.get(d) || []);
    rawWeekdays.push({
      day: d,
      label: WEEKDAY_LABELS[d],
      sampleCount: samples.length,
      avgAbsPct: Number(avgAbsPct.toFixed(3)),
      medianAbsPct: Number(median(samples).toFixed(3)),
      pctMovesAbove1:
        samples.length > 0
          ? Number(((samples.filter((x) => x >= 1).length / samples.length) * 100).toFixed(1))
          : 0,
      ...dir,
    });
  }
  const wdByHeat = [...rawWeekdays].sort((a, b) => b.avgAbsPct - a.avgAbsPct);
  const wdMax = wdByHeat[0]?.avgAbsPct || 1;
  const wdMin = wdByHeat[wdByHeat.length - 1]?.avgAbsPct || 0;
  const weekdays: WeekdayStat[] = rawWeekdays.map((s) => {
    const rank = wdByHeat.findIndex((x) => x.day === s.day) + 1;
    return {
      ...s,
      rank,
      intensity: intensityFromRank(s.avgAbsPct, wdMin, wdMax),
    };
  });

  const hottestSlot = [...slots].sort((a, b) => b.avgAbsPct - a.avgAbsPct)[0] || null;
  const quietestSlot = [...slots].sort((a, b) => a.avgAbsPct - b.avgAbsPct)[0] || null;
  const hottestWeekday = [...weekdays].sort((a, b) => b.avgAbsPct - a.avgAbsPct)[0] || null;
  const quietestWeekday = [...weekdays].sort((a, b) => a.avgAbsPct - b.avgAbsPct)[0] || null;
  const strongestUpSlot =
    [...slots].filter((s) => s.upCount > 0).sort((a, b) => b.avgUpPct - a.avgUpPct)[0] || null;
  const strongestDownSlot =
    [...slots].filter((s) => s.downCount > 0).sort((a, b) => b.avgDownPct - a.avgDownPct)[0] || null;
  const strongestUpWeekday =
    [...weekdays].filter((w) => w.upCount > 0).sort((a, b) => b.avgUpPct - a.avgUpPct)[0] || null;
  const strongestDownWeekday =
    [...weekdays].filter((w) => w.downCount > 0).sort((a, b) => b.avgDownPct - a.avgDownPct)[0] || null;

  let topMoversByHotSlot: CoinSlotHighlight[] = [];
  if (hottestSlot) {
    const coinMap: Map<string, number[]> = movesBySlotCoin.get(hottestSlot.hour) || new Map();
    const nameBySym = new Map(coins.map((c) => [c.symbol, c.name]));
    topMoversByHotSlot = [...coinMap.entries()]
      .map(([symbol, arr]: [string, number[]]) => ({
        symbol,
        name: nameBySym.get(symbol) || symbol,
        avgAbsPct: arr.reduce((a: number, b: number) => a + b, 0) / arr.length,
        samples: arr.length,
      }))
      .filter((x) => x.samples >= 3)
      .sort((a, b) => b.avgAbsPct - a.avgAbsPct)
      .slice(0, 8)
      .map((x) => ({ ...x, avgAbsPct: Number(x.avgAbsPct.toFixed(3)) }));
  }

  const topMovers2d = movers2dRaw
    .sort((a, b) => b.totalAbsPct - a.totalAbsPct)
    .slice(0, 8)
    .map((x) => ({
      ...x,
      totalAbsPct: Number(x.totalAbsPct.toFixed(3)),
      netPct: Number(x.netPct.toFixed(3)),
    }));

  const nameBySym = new Map(coins.map((c) => [c.symbol, c.name]));
  const MIN_COIN_SAMPLES = 8;

  const dayFlow: DayFlowSummary[] = [1, 2, 3, 4, 5, 6, 0]
    .map((d) => {
      const wd = weekdays.find((w) => w.day === d);
      if (!wd) return null;
      const coinMap = signedByWeekdayCoin.get(d) || new Map();
      const coinStats = [...coinMap.entries()]
        .map(([symbol, arr]: [string, number[]]) => {
          const dir = directionStats(arr);
          const avgSigned =
            arr.length > 0 ? arr.reduce((a: number, b: number) => a + b, 0) / arr.length : 0;
          return {
            symbol,
            name: nameBySym.get(symbol) || symbol,
            samples: arr.length,
            upSharePct: dir.upSharePct,
            avgSignedPct: Number(avgSigned.toFixed(3)),
          };
        })
        .filter((c) => c.samples >= MIN_COIN_SAMPLES);

      const topBuyLeanCoins = [...coinStats]
        .filter((c) => c.upSharePct >= 55)
        .sort((a, b) => b.upSharePct - a.upSharePct || b.avgSignedPct - a.avgSignedPct)
        .slice(0, 5)
        .map(({ symbol, name, upSharePct, samples }) => ({
          symbol,
          name,
          upSharePct,
          samples,
        }));

      const topSellLeanCoins = [...coinStats]
        .filter((c) => c.upSharePct <= 45)
        .sort((a, b) => a.upSharePct - b.upSharePct || a.avgSignedPct - b.avgSignedPct)
        .slice(0, 5)
        .map(({ symbol, name, upSharePct, samples }) => ({
          symbol,
          name,
          upSharePct,
          samples,
        }));

      const signed = signedByWeekday.get(d) || [];
      const avgSignedPct =
        signed.length > 0
          ? Number((signed.reduce((a: number, b: number) => a + b, 0) / signed.length).toFixed(3))
          : 0;

      return {
        day: d,
        label: wd.label,
        upSharePct: wd.upSharePct,
        avgSignedPct,
        topBuyLeanCoins,
        topSellLeanCoins,
      };
    })
    .filter(Boolean) as DayFlowSummary[];

  // Sort dayFlow: strongest buy days first
  dayFlow.sort((a, b) => b.upSharePct - a.upSharePct);

  // Per coin: pick best buy-lean day and best sell-lean day
  const coinBestBuy: CoinWeekdayBias[] = [];
  const coinBestSell: CoinWeekdayBias[] = [];
  const allSymbols = new Set<string>();
  for (const m of signedByWeekdayCoin.values()) {
    for (const s of m.keys()) allSymbols.add(s);
  }
  for (const symbol of allSymbols) {
    const perDay: CoinWeekdayBias[] = [];
    for (let d = 0; d <= 6; d++) {
      const arr = signedByWeekdayCoin.get(d)?.get(symbol) || [];
      if (arr.length < MIN_COIN_SAMPLES) continue;
      const dir = directionStats(arr);
      const avgSigned = arr.reduce((a: number, b: number) => a + b, 0) / arr.length;
      let lean: CoinWeekdayBias["lean"] = "mixed";
      if (dir.upSharePct >= 55) lean = "buy-lean";
      else if (dir.upSharePct <= 45) lean = "sell-lean";
      perDay.push({
        symbol,
        name: nameBySym.get(symbol) || symbol,
        day: d,
        dayLabel: WEEKDAY_LABELS[d],
        samples: arr.length,
        upSharePct: dir.upSharePct,
        avgSignedPct: Number(avgSigned.toFixed(3)),
        lean,
      });
    }
    const buys = perDay.filter((x) => x.lean === "buy-lean");
    const sells = perDay.filter((x) => x.lean === "sell-lean");
    if (buys.length) {
      buys.sort((a, b) => b.upSharePct - a.upSharePct);
      coinBestBuy.push(buys[0]);
    }
    if (sells.length) {
      sells.sort((a, b) => a.upSharePct - b.upSharePct);
      coinBestSell.push(sells[0]);
    }
  }
  coinBestBuy.sort((a, b) => b.upSharePct - a.upSharePct);
  coinBestSell.sort((a, b) => a.upSharePct - b.upSharePct);
  const coinsBuyLean = coinBestBuy.slice(0, 10);
  const coinsSellLean = coinBestSell.slice(0, 10);

  // Every monitored coin (so the Timing dropdown is never empty)
  const coinWeekdayTable: ResponseBody["coinWeekdayTable"] = [];
  const symbolsForTable = coins.map((c) => c.symbol).sort((a, b) => a.localeCompare(b));
  for (const symbol of symbolsForTable) {
    const days: ResponseBody["coinWeekdayTable"][0]["days"] = [];
    for (const d of [1, 2, 3, 4, 5, 6, 0]) {
      const arr = signedByWeekdayCoin.get(d)?.get(symbol) || [];
      if (arr.length < 1) continue;
      const dir = directionStats(arr);
      const avgSigned = arr.reduce((a: number, b: number) => a + b, 0) / arr.length;
      let lean: "buy-lean" | "sell-lean" | "mixed" = "mixed";
      if (dir.upSharePct >= 55) lean = "buy-lean";
      else if (dir.upSharePct <= 45) lean = "sell-lean";
      days.push({
        day: d,
        dayLabel: WEEKDAY_LABELS[d],
        samples: arr.length,
        upSharePct: dir.upSharePct,
        avgSignedPct: Number(avgSigned.toFixed(3)),
        lean,
      });
    }
    coinWeekdayTable.push({
      symbol,
      name: nameBySym.get(symbol) || symbol,
      days,
    });
  }

  const guidance: string[] = [];
  if (hottestSlot && quietestSlot) {
    guidance.push(
      `Most active poll window (last ${days}d): ${hottestSlot.label} — avg |move| ${hottestSlot.avgAbsPct}% between this print and the prior one.`
    );
    guidance.push(
      `Quietest window: ${quietestSlot.label} — avg |move| ${quietestSlot.avgAbsPct}%. Often better for staging limit orders with less noise.`
    );
  }
  if (hottestWeekday && quietestWeekday) {
    guidance.push(
      `Most active weekday (Manila): ${hottestWeekday.label} — avg |move| ${hottestWeekday.avgAbsPct}%. Be more aware on this day.`
    );
    guidance.push(
      `Quietest weekday: ${quietestWeekday.label} — avg |move| ${quietestWeekday.avgAbsPct}%.`
    );
  }
  if (strongestUpSlot) {
    guidance.push(
      `Strongest average UP into a print: ${strongestUpSlot.label} — avg +${strongestUpSlot.avgUpPct}% when rising (${strongestUpSlot.upSharePct}% of samples up).`
    );
  }
  if (strongestDownSlot) {
    guidance.push(
      `Strongest average DOWN into a print: ${strongestDownSlot.label} — avg −${strongestDownSlot.avgDownPct}% when falling (${100 - strongestDownSlot.upSharePct}% of samples down-ish).`
    );
  }
  guidance.push(
    `Hot time/day = more movement to watch — not an automatic entry signal. Confirm bias on Spot.`
  );
  guidance.push(
    `Macro catalysts (FOMC, CPI, NFP, PCE) often cluster in US hours → 8:05 PM–2:05 AM Manila can spike both ways. Check Home → Macro watch around those dates — correlation is situational, not a rule.`
  );
  if (dayFlow.length) {
    const bestBuy = dayFlow[0];
    const bestSell = dayFlow[dayFlow.length - 1];
    guidance.push(
      `Across the book, Manila ${bestBuy.label} leans most UP (${bestBuy.upSharePct}% of prints up, avg signed ${bestBuy.avgSignedPct}%). ${bestSell.label} leans most DOWN (${bestSell.upSharePct}% up).`
    );
  }
  if (coinsBuyLean[0]) {
    guidance.push(
      `Clearest buy-lean coin/day: ${coinsBuyLean[0].name} on ${coinsBuyLean[0].dayLabel} (${coinsBuyLean[0].upSharePct}% up). Still not a signal — confirm on Spot.`
    );
  }
  if (coinsSellLean[0]) {
    guidance.push(
      `Clearest sell-lean coin/day: ${coinsSellLean[0].name} on ${coinsSellLean[0].dayLabel} (${coinsSellLean[0].upSharePct}% up / often red). Prefer not to chase adds that day without Spot bias.`
    );
  }


  // Your fills in window + path after fill (from 3h polls)
  const fillRows = await prisma.transaction.findMany({
    where: {
      transactedAt: { gte: since },
      type: { in: ["buy", "sell"] },
      coinId: { not: null },
    },
    include: { coin: { select: { id: true, symbol: true, name: true } } },
    orderBy: { transactedAt: "asc" },
  });

  const userFills: UserFillOutcome[] = [];
  for (const tx of fillRows) {
    if (!tx.coin) continue;
    const at = tx.transactedAt;
    const manilaMs = at.getTime() + 8 * 60 * 60 * 1000;
    const manila = new Date(manilaMs);
    // format via UTC getters after +8 offset
    const wd = WEEKDAY_LABELS[manila.getUTCDay()];
    const manilaLabel = `${manila.getUTCFullYear()}-${String(manila.getUTCMonth() + 1).padStart(2, "0")}-${String(manila.getUTCDate()).padStart(2, "0")} ${String(manila.getUTCHours()).padStart(2, "0")}:${String(manila.getUTCMinutes()).padStart(2, "0")} MNL`;

    const recs = await prisma.record.findMany({
      where: { coinId: tx.coin.id, createdAt: { gte: at } },
      orderBy: { createdAt: "asc" },
      select: { price: true, createdAt: true },
      take: 80,
    });
    const fillPx = Number(tx.price);
    const pctAt = (hours: number): number | null => {
      if (!(fillPx > 0) || recs.length === 0) return null;
      const target = at.getTime() + hours * 3600 * 1000;
      let last: number | null = null;
      for (const r of recs) {
        if (r.createdAt.getTime() <= target) last = r.price;
        else break;
      }
      if (last == null) return null;
      return Number((((last - fillPx) / fillPx) * 100).toFixed(2));
    };
    const latest =
      recs.length > 0 && fillPx > 0
        ? Number((((recs[recs.length - 1].price - fillPx) / fillPx) * 100).toFixed(2))
        : null;

    userFills.push({
      type: tx.type === "sell" ? "sell" : "buy",
      symbol: tx.coin.symbol,
      name: tx.coin.name,
      phpAmount: tx.phpAmount,
      price: tx.price,
      coinAmount: tx.coinAmount,
      transactedAt: at.toISOString(),
      manilaLabel,
      weekdayLabel: wd,
      path24hPct: pctAt(24),
      path72hPct: pctAt(72),
      pathToLatestPct: latest,
    });
  }

  // Dynamic guidance from dayFlow + fills
  if (userFills.length) {
    const buys = userFills.filter((f) => f.type === "buy");
    const sells = userFills.filter((f) => f.type === "sell");
    const avgPath = (arr: UserFillOutcome[], key: "path24hPct" | "path72hPct") => {
      const xs = arr.map((f) => f[key]).filter((x): x is number => x != null);
      if (!xs.length) return null;
      return Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2));
    };
    if (buys.length) {
      const a24 = avgPath(buys, "path24hPct");
      const a72 = avgPath(buys, "path72hPct");
      guidance.push(
        `Your ${buys.length} buy(s) in this window: avg path 24h ${a24 != null ? a24 + "%" : "n/a"}, 72h ${a72 != null ? a72 + "%" : "n/a"} (vs fill price, poll path).`
      );
    }
    if (sells.length) {
      const a24 = avgPath(sells, "path24hPct");
      guidance.push(
        `Your ${sells.length} sell(s): avg path 24h after exit ${a24 != null ? a24 + "%" : "n/a"} (negative = price fell after sell = good timing).`
      );
    }
  }

  const body: ResponseBody = {
    days,
    generatedAt: new Date().toISOString(),
    slots: slots.sort((a, b) => a.hour - b.hour),
    // Monday-first display order
    weekdays: [1, 2, 3, 4, 5, 6, 0]
      .map((d) => weekdays.find((w) => w.day === d)!)
      .filter(Boolean),
    hottestSlot,
    quietestSlot,
    hottestWeekday,
    quietestWeekday,
    strongestUpSlot,
    strongestDownSlot,
    strongestUpWeekday,
    strongestDownWeekday,
    topMoversByHotSlot,
    userFills,
    topMovers2d,
    dayFlow,
    coinsBuyLean,
    coinsSellLean,
    coinWeekdayTable,
    guidance,
    fromCache: false,
    cacheUpdatedAt: new Date().toISOString(),
  };

  try {
    await prisma.catalystLog.upsert({
      where: { promptId: cacheKey },
      create: {
        promptId: cacheKey,
        category: "Daily",
        response: JSON.stringify(body),
      },
      update: {
        category: "Daily",
        response: JSON.stringify(body),
      },
    });
  } catch {
    /* non-fatal */
  }

  return res.status(200).json(body);
}
