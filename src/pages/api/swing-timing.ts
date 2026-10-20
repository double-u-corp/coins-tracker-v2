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
  rank: number;
  intensity: "quiet" | "normal" | "active" | "hot";
};

type CoinSlotHighlight = {
  symbol: string;
  name: string;
  avgAbsPct: number;
  samples: number;
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
  topMoversByHotSlot: CoinSlotHighlight[];
  guidance: string[];
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

  const daysRaw = Number(req.query.days ?? 30);
  const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(7, Math.round(daysRaw))) : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const coins = await prisma.coin.findMany({
    select: { id: true, symbol: true, name: true },
    orderBy: { symbol: "asc" },
  });

  const movesBySlot = new Map<number, number[]>();
  const movesBySlotCoin = new Map<number, Map<string, number[]>>();
  const movesByWeekday = new Map<number, number[]>();

  for (const h of SLOT_HOURS) {
    movesBySlot.set(h, []);
    movesBySlotCoin.set(h, new Map());
  }
  for (let d = 0; d <= 6; d++) {
    movesByWeekday.set(d, []);
  }

  for (const coin of coins) {
    const records = await prisma.record.findMany({
      where: { coinId: coin.id, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { price: true, createdAt: true },
    });
    if (records.length < 2) continue;

    for (let i = 1; i < records.length; i++) {
      const prev = records[i - 1];
      const cur = records[i];
      if (!(prev.price > 0) || !(cur.price > 0)) continue;

      // Skip gaps larger than ~5h (missed polls / multi-day) so we measure slot-to-slot swing
      const gapH = (cur.createdAt.getTime() - prev.createdAt.getTime()) / (60 * 60 * 1000);
      if (gapH > 5) continue;

      const absPct = (Math.abs(cur.price - prev.price) / prev.price) * 100;
      const { hour, weekday } = toManilaParts(cur.createdAt);
      const slot = nearestSlotHour(hour);
      if (slot < 0) continue;

      movesBySlot.get(slot)!.push(absPct);
      const coinMap = movesBySlotCoin.get(slot)!;
      if (!coinMap.has(coin.symbol)) coinMap.set(coin.symbol, []);
      coinMap.get(coin.symbol)!.push(absPct);

      movesByWeekday.get(weekday)!.push(absPct);
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

    return {
      hour,
      label: SLOT_LABELS[hour] || `${hour}:05`,
      sampleCount: samples.length,
      coinCount,
      avgAbsPct: Number(avgAbsPct.toFixed(3)),
      medianAbsPct: Number(medianAbsPct.toFixed(3)),
      pctMovesAbove1: Number(pctMovesAbove1.toFixed(1)),
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
  guidance.push(
    `Hot time/day = more movement to watch — not an automatic entry signal. Confirm bias on Spot.`
  );

  return res.status(200).json({
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
    topMoversByHotSlot,
    guidance,
  });
}
