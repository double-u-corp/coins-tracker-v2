import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { attachManilaFields, extractJsonArray, type MacroEvent } from "@/lib/macroEvents";

const CACHE_ID = "timing-macro-impact";
const MACRO_ID = "macro-calendar-events";

/** Direction anchors — excluded from book impact (alts only). */
const EXCLUDE_SYMBOLS = new Set(["BTCPHP", "ETHPHP", "XAUTPHP", "BTC", "ETH", "XAUT"]);

type CoinMove = {
  symbol: string;
  name: string;
  priceBefore: number;
  price24h: number | null;
  price72h: number | null;
  pct24h: number | null;
  pct72h: number | null;
};

type MeetingImpact = {
  type: string;
  title: string;
  date: string;
  sampleCoins: number;
  downShare24h: number;
  downShare72h: number;
  avgSigned24h: number;
  avgSigned72h: number;
  /** Short risk-off / mixed / risk-on read from alt book only */
  regime24h: "risk-off" | "mixed" | "risk-on" | "thin";
  summary: string;
  /** Largest |moves| among alts for the card table */
  topMoves: CoinMove[];
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
  return best && best.dist <= 36 * 3600_000 ? best.price : null;
}

function familyOf(e: MacroEvent): string {
  const title = e.title || "";
  if (/CPI|inflation|consumer price/i.test(title)) return "CPI";
  if (/NFP|payroll|employment|jobs/i.test(title)) return "NFP";
  if (/PCE/i.test(title)) return "PCE";
  if (/FOMC|rate decision|federal reserve/i.test(title)) return "FOMC";
  if (/PPI|producer price/i.test(title)) return "PPI";
  const t = String(e.type || "OTHER").toUpperCase();
  if (["CPI", "NFP", "PCE", "FOMC", "PPI"].includes(t)) return t;
  return t || "OTHER";
}

function regime(downShare: number, avg: number): MeetingImpact["regime24h"] {
  if (downShare >= 60 || avg <= -0.8) return "risk-off";
  if (downShare <= 40 && avg >= 0.5) return "risk-on";
  if (downShare === 0 && avg === 0) return "thin";
  return "mixed";
}

function formatPhp(n: number): string {
  if (n >= 1000) return `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
  return `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 4 })}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    if (req.method === "GET" && req.query.refresh !== "1" && req.query.force !== "1") {
      const cached = await prisma.catalystLog.findUnique({ where: { promptId: CACHE_ID } });
      if (cached?.response) {
        try {
          const parsed = JSON.parse(cached.response) as Store;
          if (parsed?.meetings || parsed?.tips) {
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
        message: "No macro impact analysis yet. Click “Last CPI/NFP/FOMC impact” on Timing.",
      });
    }

    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const macroLog = await prisma.catalystLog.findUnique({ where: { promptId: MACRO_ID } });
    const events = parseEvents(macroLog?.response);
    const today = dayKeyManila(new Date());
    const keyword = /CPI|NFP|PCE|FOMC|PPI|payroll|inflation|jobs|rate decision/i;

    const past = events
      .map((e) => {
        const date = String((e as { manilaDateKey?: string }).manilaDateKey || e.date || "").slice(0, 10);
        return { ...e, _date: date, _family: familyOf(e) };
      })
      .filter(
        (e) =>
          e._date &&
          e._date < today &&
          (["CPI", "NFP", "PCE", "FOMC", "PPI"].includes(e._family) || keyword.test(e.title || ""))
      )
      .sort((a, b) => b._date.localeCompare(a._date));

    // Last 2 meetings per family (dedicated slots)
    const byType = new Map<string, typeof past>();
    for (const e of past) {
      if (!byType.has(e._family)) byType.set(e._family, []);
      const arr = byType.get(e._family)!;
      if (arr.length < 2) arr.push(e);
    }
    const selected = [...byType.values()].flat();

    const coins = (
      await prisma.coin.findMany({ select: { id: true, symbol: true, name: true } })
    ).filter((c) => !EXCLUDE_SYMBOLS.has(c.symbol.toUpperCase()));

    const meetings: MeetingImpact[] = [];

    for (const ev of selected) {
      const anchor = new Date(`${ev._date}T12:00:00.000Z`);
      const t0 = anchor.getTime();
      const windowStart = new Date(t0 - 2 * 86400000);
      const windowEnd = new Date(t0 + 5 * 86400000);

      const coinMoves: CoinMove[] = [];
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
        const p0 = priceNear(rows, t0 - 3 * 3600_000);
        const p24 = priceNear(rows, t0 + 24 * 3600_000);
        const p72 = priceNear(rows, t0 + 72 * 3600_000);
        if (p0 == null || !(p0 > 0)) continue;

        let pct24: number | null = null;
        let pct72: number | null = null;
        if (p24 != null) {
          pct24 = ((p24 - p0) / p0) * 100;
          signed24.push(pct24);
        }
        if (p72 != null) {
          pct72 = ((p72 - p0) / p0) * 100;
          signed72.push(pct72);
        }
        coinMoves.push({
          symbol: coin.symbol,
          name: coin.name,
          priceBefore: p0,
          price24h: p24,
          price72h: p72,
          pct24h: pct24,
          pct72h: pct72,
        });
      }

      const downShare = (arr: number[]) =>
        arr.length ? (arr.filter((x) => x < 0).length / arr.length) * 100 : 0;
      const avg = (arr: number[]) =>
        arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

      const down24 = Number(downShare(signed24).toFixed(1));
      const down72 = Number(downShare(signed72).toFixed(1));
      const avg24 = Number(avg(signed24).toFixed(2));
      const avg72 = Number(avg(signed72).toFixed(2));
      const reg = signed24.length < 3 ? "thin" : regime(down24, avg24);

      const topMoves = [...coinMoves]
        .filter((c) => c.pct24h != null)
        .sort((a, b) => Math.abs(b.pct24h!) - Math.abs(a.pct24h!))
        .slice(0, 8);

      let summary = "";
      if (reg === "thin") {
        summary = `Thin poll coverage around ${ev._date} — not enough alt prints to read the book.`;
      } else if (reg === "risk-off") {
        summary = `After ${ev._family} (${ev._date}), your alt book leaned risk-off: ~${down24}% of alts were down 24h later (avg ${avg24}%). By 72h ~${down72}% still down (avg ${avg72}%). BTC/ETH/XAUT excluded.`;
      } else if (reg === "risk-on") {
        summary = `After ${ev._family} (${ev._date}), alts did not show a broad dump: only ~${down24}% down 24h (avg ${avg24}%). Still situational — not a buy signal.`;
      } else {
        summary = `After ${ev._family} (${ev._date}), alt reaction was mixed: ~${down24}% down 24h (avg ${avg24}%), ~${down72}% down by 72h (avg ${avg72}%).`;
      }

      if (signed24.length >= 3 || signed72.length >= 3) {
        meetings.push({
          type: ev._family,
          title: ev.title || ev._family,
          date: ev._date,
          sampleCoins: Math.max(signed24.length, signed72.length),
          downShare24h: down24,
          downShare72h: down72,
          avgSigned24h: avg24,
          avgSigned72h: avg72,
          regime24h: reg,
          summary,
          topMoves,
        });
      }
    }

    // Newest first; keep only last 4 meetings (storage + UI stay light)
    meetings.sort((a, b) => b.date.localeCompare(a.date));
    const kept = meetings.slice(0, 4).map((m) => ({
      ...m,
      // Cap table size in DB
      topMoves: (m.topMoves || []).slice(0, 5),
    }));

    const tips: string[] = [];
    for (const fam of ["CPI", "NFP", "PCE", "FOMC", "PPI"]) {
      const rows = kept.filter((m) => m.type === fam).slice(0, 2);
      if (rows.length >= 2) {
        const avgDown = (rows[0].downShare24h + rows[1].downShare24h) / 2;
        const avgMove = (rows[0].avgSigned24h + rows[1].avgSigned24h) / 2;
        tips.push(
          `Last two ${fam} (${rows[1].date} & ${rows[0].date}): ~${avgDown.toFixed(0)}% of alts down 24h after (avg ${avgMove.toFixed(2)}%). Alts only — not a trade rule.`
        );
      } else if (rows.length === 1) {
        const r = rows[0];
        tips.push(
          `After ${fam} on ${r.date}: ${r.downShare24h.toFixed(0)}% of alts down in 24h (avg ${r.avgSigned24h.toFixed(2)}%). Alts only — confirm on Spot.`
        );
      }
    }

    if (!kept.length) {
      tips.push(
        "No past CPI/NFP/FOMC/PCE with enough alt poll history yet. Keep Macro watch dates, then re-run impact."
      );
    }

    const store: Store = {
      generatedAt: new Date().toISOString(),
      meetings: kept,
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
