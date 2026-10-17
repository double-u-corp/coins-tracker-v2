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
  hottestSlot: SlotStat | null;
  quietestSlot: SlotStat | null;
  topMoversByHotSlot: CoinSlotHighlight[];
  guidance: string[];
};

type ErrorBody = { error: string };

function toManilaHour(d: Date): number {
  // Asia/Manila is UTC+8 year-round (no DST)
  const utc = d.getTime() + d.getTimezoneOffset() * 60_000;
  const manila = new Date(utc + 8 * 60 * 60_000);
  return manila.getHours();
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody | ErrorBody>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const daysRaw = Number(req.query.days ?? 30);
  const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(7, Math.round(daysRaw))) : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const coins = await prisma.coin.findMany({
    select: { id: true, symbol: true, name: true },
    orderBy: { symbol: "asc" },
  });

  const movesBySlot = new Map<number, number[]>();
  const movesBySlotCoin = new Map<number, Map<string, number[]>>();
  for (const h of SLOT_HOURS) {
    movesBySlot.set(h, []);
    movesBySlotCoin.set(h, new Map());
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
      const slot = nearestSlotHour(toManilaHour(cur.createdAt));
      if (slot < 0) continue;

      movesBySlot.get(slot)!.push(absPct);
      const coinMap = movesBySlotCoin.get(slot)!;
      if (!coinMap.has(coin.symbol)) coinMap.set(coin.symbol, []);
      coinMap.get(coin.symbol)!.push(absPct);
    }
  }

  const rawSlots: Omit<SlotStat, "rank" | "intensity">[] = SLOT_HOURS.map((hour) => {
    const samples = movesBySlot.get(hour) || [];
    const avgAbsPct =
      samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
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

  // Rank by average absolute move (hottest = 1)
  const byHeat = [...rawSlots].sort((a, b) => b.avgAbsPct - a.avgAbsPct);
  const maxAvg = byHeat[0]?.avgAbsPct || 1;
  const minAvg = byHeat[byHeat.length - 1]?.avgAbsPct || 0;

  const slots: SlotStat[] = rawSlots.map((s) => {
    const rank = byHeat.findIndex((x) => x.hour === s.hour) + 1;
    const t = maxAvg > minAvg ? (s.avgAbsPct - minAvg) / (maxAvg - minAvg) : 0.5;
    const intensity: SlotStat["intensity"] =
      t >= 0.75 ? "hot" : t >= 0.5 ? "active" : t >= 0.25 ? "normal" : "quiet";
    return { ...s, rank, intensity };
  });

  const hottestSlot = [...slots].sort((a, b) => b.avgAbsPct - a.avgAbsPct)[0] || null;
  const quietestSlot = [...slots].sort((a, b) => a.avgAbsPct - b.avgAbsPct)[0] || null;

  let topMoversByHotSlot: CoinSlotHighlight[] = [];
  if (hottestSlot) {
    const coinMap = movesBySlotCoin.get(hottestSlot.hour) || new Map();
    const nameBySym = new Map(coins.map((c) => [c.symbol, c.name]));
    topMoversByHotSlot = [...coinMap.entries()]
      .map(([symbol, arr]) => ({
        symbol,
        name: nameBySym.get(symbol) || symbol,
        avgAbsPct: arr.reduce((a, b) => a + b, 0) / arr.length,
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
    guidance.push(
      `Hot windows suit watching for sweeps/breaks; quiet windows suit placing ladder buys when Spot already says LONG.`
    );
    guidance.push(
      `This is slot-to-slot swing across your monitored coins — not a guarantee of direction. Always confirm bias on Spot.`
    );
  }

  return res.status(200).json({
    days,
    generatedAt: new Date().toISOString(),
    slots: slots.sort((a, b) => a.hour - b.hour),
    hottestSlot,
    quietestSlot,
    topMoversByHotSlot,
    guidance,
  });
}
