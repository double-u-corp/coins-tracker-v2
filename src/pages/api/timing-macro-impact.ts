import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { attachManilaFields, extractJsonArray, type MacroEvent } from "@/lib/macroEvents";

const CACHE_ID = "timing-macro-impact";
const MACRO_ID = "macro-calendar-events";

type MeetingImpact = {
  type: string;
  title: string;
  date: string; // YYYY-MM-DD Manila-ish
  sampleCoins: number;
  downShare24h: number;
  downShare72h: number;
  avgSigned24h: number;
  avgSigned72h: number;
};

type Store = {
  generatedAt: string;
  meetings: MeetingImpact[];
  tips: string[];
};

function dayKeyManila(d: Date): string {
  const m = new Date(d.getTime() + 8 * 3600_000);
  return m.toISOString().slice(0, 10);
}

function parseEvents(raw: string | null | undefined): MacroEvent[] {
  if (!raw) return [];
  try {
    const arr = extractJsonArray(raw);
    if (Array.isArray(arr) && arr.length) return attachManilaFields(arr as MacroEvent[]);
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return attachManilaFields(j as MacroEvent[]);
    if (Array.isArray(j?.events)) return attachManilaFields(j.events as MacroEvent[]);
  } catch {
    /* ignore */
  }
  return [];
}

/** Price nearest to target time (forward-looking first record at/after t, else last before). */
function priceNear(
  rows: { price: number; createdAt: Date }[],
  targetMs: number
): number | null {
  if (!rows.length) return null;
  let best: { price: number; dist: number } | null = null;
  for (const r of rows) {
    const t = r.createdAt.getTime();
    const dist = Math.abs(t - targetMs);
    if (!best || dist < best.dist) best = { price: r.price, dist };
  }
  return best && best.dist <= 36 * 3600_000 ? best.price : null; // within 36h
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    if (req.method === "GET" && req.query.refresh !== "1" && req.query.force !== "1") {
      const cached = await prisma.catalystLog.findUnique({ where: { promptId: CACHE_ID } });
      if (cached?.response) {
        try {
          const parsed = JSON.parse(cached.response) as Store;
          if (parsed?.tips) {
            return res.status(200).json({ ...parsed, fromCache: true });
          }
        } catch {
          /* recompute */
        }
      }
      return res.status(200).json({
        generatedAt: null,
        meetings: [],
        tips: [],
        fromCache: true,
        message: "No macro impact analysis yet. Run it from Timing.",
      });
    }

    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    // --- Compute ---
    const macroLog = await prisma.catalystLog.findUnique({ where: { promptId: MACRO_ID } });
    let events = parseEvents(macroLog?.response);
    // Prefer past meetings only
    const today = dayKeyManila(new Date());
    const focusTypes = /^(CPI|NFP|PCE|FOMC|PPI|OTHER)$/i;
    const keyword =
      /CPI|NFP|PCE|FOMC|PPI|payroll|inflation|jobs|rate decision/i;

    const past = events
      .map((e) => {
        const date = String((e as { manilaDateKey?: string }).manilaDateKey || e.date || "").slice(
          0,
          10
        );
        return { ...e, _date: date };
      })
      .filter((e) => e._date && e._date < today && (focusTypes.test(String(e.type)) || keyword.test(e.title || "")))
      .sort((a, b) => b._date.localeCompare(a._date));

    // Last 2 per type family
    const byType = new Map<string, typeof past>();
    for (const e of past) {
      let key = String(e.type || "OTHER").toUpperCase();
      if (/CPI|inflation|consumer price/i.test(e.title || "")) key = "CPI";
      else if (/NFP|payroll|employment|jobs/i.test(e.title || "")) key = "NFP";
      else if (/PCE/i.test(e.title || "")) key = "PCE";
      else if (/FOMC|rate decision|federal reserve/i.test(e.title || "")) key = "FOMC";
      else if (/PPI|producer price/i.test(e.title || "")) key = "PPI";
      if (!byType.has(key)) byType.set(key, []);
      const arr = byType.get(key)!;
      if (arr.length < 2) arr.push(e);
    }

    const selected = [...byType.entries()].flatMap(([type, arr]) =>
      arr.map((e) => ({ ...e, _family: type }))
    );

    const coins = await prisma.coin.findMany({
      select: { id: true, symbol: true, name: true },
    });
    // Skip BTC/ETH/XAUT for "your alts book" narrative? Include all monitored for honesty.
    const meetings: MeetingImpact[] = [];

    for (const ev of selected) {
      // Event "print" approx: 20:30 UTC for 8:30 ET ≈ use date 12:00 UTC as anchor mid-day MNL evening for ET morning
      const anchor = new Date(`${ev._date}T12:00:00.000Z`);
      const t0 = anchor.getTime();
      const windowStart = new Date(t0 - 2 * 86400000);
      const windowEnd = new Date(t0 + 5 * 86400000);

      const signed24: number[] = [];
      const signed72: number[] = [];

      for (const coin of coins) {
        const rows = await prisma.record.findMany({
          where: {
            coinId: coin.id,
            createdAt: { gte: windowStart, lte: windowEnd },
          },
          orderBy: { createdAt: "asc" },
          select: { price: true, createdAt: true },
          take: 120,
        });
        if (rows.length < 2) continue;
        const p0 = priceNear(rows, t0 - 3 * 3600_000); // few hours before
        const p24 = priceNear(rows, t0 + 24 * 3600_000);
        const p72 = priceNear(rows, t0 + 72 * 3600_000);
        if (p0 != null && p0 > 0 && p24 != null) {
          signed24.push(((p24 - p0) / p0) * 100);
        }
        if (p0 != null && p0 > 0 && p72 != null) {
          signed72.push(((p72 - p0) / p0) * 100);
        }
      }

      const downShare = (arr: number[]) =>
        arr.length ? (arr.filter((x) => x < 0).length / arr.length) * 100 : 0;
      const avg = (arr: number[]) =>
        arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

      if (signed24.length >= 3 || signed72.length >= 3) {
        meetings.push({
          type: ev._family,
          title: ev.title || ev._family,
          date: ev._date,
          sampleCoins: Math.max(signed24.length, signed72.length),
          downShare24h: Number(downShare(signed24).toFixed(1)),
          downShare72h: Number(downShare(signed72).toFixed(1)),
          avgSigned24h: Number(avg(signed24).toFixed(2)),
          avgSigned72h: Number(avg(signed72).toFixed(2)),
        });
      }
    }

    const tips: string[] = [];
    // Aggregate by type: last two CPI etc.
    const families = ["CPI", "NFP", "PCE", "FOMC", "PPI"];
    for (const fam of families) {
      const rows = meetings.filter((m) => m.type === fam).slice(0, 2);
      if (rows.length === 0) continue;
      if (rows.length >= 2) {
        const avgDown =
          (rows[0].downShare24h + rows[1].downShare24h) / 2;
        const avgMove =
          (rows[0].avgSigned24h + rows[1].avgSigned24h) / 2;
        if (avgDown >= 55) {
          tips.push(
            `Did you know · Last two ${fam} prints (${rows[1].date} & ${rows[0].date}): ~${avgDown.toFixed(0)}% of your watchlist was down 24h after the event (avg move ${avgMove.toFixed(2)}%). Not a rule — confirm on Spot.`
          );
        } else if (avgDown <= 45) {
          tips.push(
            `Did you know · Last two ${fam} prints: most of your book was not red 24h after (only ~${avgDown.toFixed(0)}% down). Treat as situational, not a signal.`
          );
        } else {
          tips.push(
            `Did you know · Last two ${fam} prints mixed: ~${avgDown.toFixed(0)}% of coins down 24h after (avg ${avgMove.toFixed(2)}%).`
          );
        }
      } else {
        const r = rows[0];
        tips.push(
          `Did you know · After ${fam} on ${r.date}: ${r.downShare24h.toFixed(0)}% of coins down in 24h (avg ${r.avgSigned24h.toFixed(2)}%), ${r.downShare72h.toFixed(0)}% still down by 72h.`
        );
      }
    }

    if (!tips.length) {
      tips.push(
        "No enough poll history around past CPI/NFP/FOMC dates yet. Keep polling and re-run after the next release."
      );
    }

    const store: Store = {
      generatedAt: new Date().toISOString(),
      meetings,
      tips,
    };

    await prisma.catalystLog.upsert({
      where: { promptId: CACHE_ID },
      create: {
        promptId: CACHE_ID,
        category: "Timing",
        response: JSON.stringify(store),
      },
      update: {
        category: "Timing",
        response: JSON.stringify(store),
      },
    });

    return res.status(200).json({ ...store, fromCache: false });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
