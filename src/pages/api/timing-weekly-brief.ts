import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";

/**
 * Weekly Monday brief.
 * GET  → latest saved brief (no heavy work)
 * POST or GET ?refresh=1 → rebuild from caches
 * POST/GET ?full=1 → refresh 7/14/28 swing-timing + macro impact, then save brief
 *
 * Chat trigger: user says "Monday weekly timing review" → call ?full=1 then interpret.
 */

const BRIEF_ID = "timing-weekly-brief";
const HISTORY_ID = "timing-weekly-brief-history";
const MACRO_ID = "timing-macro-impact";

type TimingCache = {
  days?: number;
  slots?: { hour: number; label: string; avgAbsPct: number; intensity?: string; upSharePct?: number }[];
  weekdays?: { day: number; label: string; avgAbsPct: number; upSharePct?: number; intensity?: string }[];
  hottestSlot?: { label: string; avgAbsPct?: number } | null;
  quietestSlot?: { label: string; avgAbsPct?: number } | null;
  hottestWeekday?: { label: string; avgAbsPct?: number } | null;
  quietestWeekday?: { label: string; avgAbsPct?: number } | null;
  strongestUpSlot?: { label: string; avgUpPct?: number } | null;
  strongestDownSlot?: { label: string; avgDownPct?: number } | null;
  coinsBuyLean?: { name: string; dayLabel: string; upSharePct: number }[];
  coinsSellLean?: { name: string; dayLabel: string; upSharePct: number }[];
  dayFlow?: { label: string; upSharePct: number; avgSignedPct: number }[];
  fillAlignment?: {
    takeaways?: string[];
    buyLeanAlignmentPct?: number | null;
    sellLeanAlignmentPct?: number | null;
  } | null;
  guidance?: string[];
  topWindowLosers?: {
    symbol: string;
    name: string;
    netPct: number;
    totalAbsPct?: number;
    lastPrice?: number;
  }[];
  topWindowGainers?: {
    symbol: string;
    name: string;
    netPct: number;
    lastPrice?: number;
  }[];
  cacheUpdatedAt?: string | null;
  generatedAt?: string;
};

type MacroCache = {
  tips?: string[];
  meetings?: {
    type?: string;
    title?: string;
    date?: string;
    regime24h?: string;
    summary?: string;
    downShare24h?: number;
    avgSigned24h?: number;
  }[];
  generatedAt?: string;
};

export type WeeklyBrief = {
  weekOf: string;
  generatedAt: string;
  windows: {
    days: number;
    hottestSlot: string | null;
    quietestSlot: string | null;
    hottestWeekday: string | null;
    quietestWeekday: string | null;
    buyLeanWeekday: string | null;
    sellLeanWeekday: string | null;
    clearestBuyCoin: string | null;
    clearestSellCoin: string | null;
    fillTakeaways: string[];
  }[];
  /** Primary charts (prefer 14d, else 28d) for Timing UI */
  chartSlots: { label: string; avgAbsPct: number; intensity: string }[];
  chartWeekdays: { label: string; upSharePct: number; avgAbsPct: number }[];
  /** Line chart: same poll slots across 7d / 14d / 28d windows */
  chartCompareSlots: {
    label: string;
    hour: number;
    avg7: number | null;
    avg14: number | null;
    avg28: number | null;
  }[];
  /** Donut: up vs down share on hottest weekday (primary window) */
  chartDonut: {
    weekdayLabel: string;
    upSharePct: number;
    downSharePct: number;
    windowDays: number;
  } | null;
  macroMeetings: {
    type: string;
    title: string;
    date: string;
    regime24h: string;
    summary: string;
  }[];
  macroTips: string[];
  didYouKnow: string[];
  monitorRules: string[];
  /** Soft book this week — net path losers / gainers (alts) + RSI oversold snapshot if available */
  softBook: {
    losers7d: { symbol: string; name: string; netPct: number }[];
    losers14d: { symbol: string; name: string; netPct: number }[];
    /** In both 7d and 14d loser lists (multi-week pressure) */
    consecutiveWeak: { symbol: string; name: string; net7: number; net14: number }[];
    rsiOversold: { symbol: string; name: string; rsi: number; detail: string }[];
  };
  /** Ready for Grok / agent: paste into Monday review */
  agentContext: string;
  fullRefresh?: boolean;
  refreshedRanges?: number[];
};

function manilaDateKey(d = new Date()): string {
  return new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

function appBase(req: NextApiRequest): string {
  const env =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (env) return env.replace(/\/$/, "");
  const host = req.headers.host || "localhost:3000";
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  return `${proto}://${host}`;
}

async function loadTiming(days: number): Promise<TimingCache | null> {
  try {
    const row = await prisma.catalystLog.findUnique({
      where: { promptId: `swing-timing-${days}` },
    });
    if (!row?.response) return null;
    return JSON.parse(row.response) as TimingCache;
  } catch {
    return null;
  }
}

async function loadMacro(): Promise<MacroCache | null> {
  try {
    const row = await prisma.catalystLog.findUnique({ where: { promptId: MACRO_ID } });
    if (!row?.response) return null;
    return JSON.parse(row.response) as MacroCache;
  } catch {
    return null;
  }
}

/** Force recompute Timing ranges + macro impact via same-origin API */
async function fullRefreshPipeline(
  req: NextApiRequest
): Promise<{ refreshedRanges: number[]; errors: string[] }> {
  const base = appBase(req);
  const errors: string[] = [];
  const refreshedRanges: number[] = [];

  for (const days of [7, 14, 28]) {
    try {
      const r = await fetch(`${base}/api/swing-timing?days=${days}&refresh=1`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!r.ok) {
        errors.push(`swing-timing ${days}d: HTTP ${r.status}`);
        continue;
      }
      refreshedRanges.push(days);
    } catch (e) {
      errors.push(`swing-timing ${days}d: ${(e as Error).message}`);
    }
  }

  try {
    const r = await fetch(`${base}/api/timing-macro-impact?refresh=1`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!r.ok) errors.push(`macro-impact: HTTP ${r.status}`);
  } catch (e) {
    errors.push(`macro-impact: ${(e as Error).message}`);
  }

  return { refreshedRanges, errors };
}

function summarizeWindow(days: number, t: TimingCache | null): WeeklyBrief["windows"][0] {
  const buyLean = t?.dayFlow?.find((d) => d.upSharePct >= 52);
  const sellLean = [...(t?.dayFlow || [])].sort((a, b) => a.upSharePct - b.upSharePct)[0];
  return {
    days,
    hottestSlot: t?.hottestSlot?.label
      ? `${t.hottestSlot.label}${t.hottestSlot.avgAbsPct != null ? ` · ${t.hottestSlot.avgAbsPct}% avg` : ""}`
      : null,
    quietestSlot: t?.quietestSlot?.label
      ? `${t.quietestSlot.label}${t.quietestSlot.avgAbsPct != null ? ` · ${t.quietestSlot.avgAbsPct}% avg` : ""}`
      : null,
    hottestWeekday: t?.hottestWeekday?.label ?? null,
    quietestWeekday: t?.quietestWeekday?.label ?? null,
    buyLeanWeekday: buyLean
      ? `${buyLean.label} (${buyLean.upSharePct}% up)`
      : t?.hottestWeekday?.label ?? null,
    sellLeanWeekday:
      sellLean && sellLean.upSharePct <= 48
        ? `${sellLean.label} (${sellLean.upSharePct}% up)`
        : t?.quietestWeekday?.label ?? null,
    clearestBuyCoin: t?.coinsBuyLean?.[0]
      ? `${t.coinsBuyLean[0].name} on ${t.coinsBuyLean[0].dayLabel} (${t.coinsBuyLean[0].upSharePct}% up)`
      : null,
    clearestSellCoin: t?.coinsSellLean?.[0]
      ? `${t.coinsSellLean[0].name} on ${t.coinsSellLean[0].dayLabel} (${t.coinsSellLean[0].upSharePct}% up)`
      : null,
    fillTakeaways: t?.fillAlignment?.takeaways?.slice(0, 3) || [],
  };
}

function buildBrief(
  t7: TimingCache | null,
  t14: TimingCache | null,
  t28: TimingCache | null,
  macro: MacroCache | null,
  meta?: { fullRefresh?: boolean; refreshedRanges?: number[] },
  rsiOversoldHits: { symbol: string; name: string; rsi: number; detail: string }[] = []
): WeeklyBrief {
  const windows = [7, 14, 28].map((d) =>
    summarizeWindow(d, d === 7 ? t7 : d === 14 ? t14 : t28)
  );
  const primary = t14 || t28 || t7;
  const didYouKnow: string[] = [];
  const monitorRules: string[] = [];

  if (primary?.hottestSlot?.label) {
    didYouKnow.push(
      `Hot poll window: ${primary.hottestSlot.label} — more movement to watch, not an auto-entry.`
    );
    monitorRules.push(
      `Near ${primary.hottestSlot.label}: only act if Spot is LONG and price is near support/ladder.`
    );
  }
  if (primary?.quietestSlot?.label) {
    monitorRules.push(
      `Quieter for limit staging: ${primary.quietestSlot.label} — less noise; still confirm on Spot.`
    );
  }
  const flow = primary?.dayFlow || [];
  const bestBuy = flow.find((d) => d.upSharePct >= 52);
  const bestSell = [...flow].sort((a, b) => a.upSharePct - b.upSharePct)[0];
  if (bestBuy) {
    didYouKnow.push(
      `Book buy-lean weekday: ${bestBuy.label} (${bestBuy.upSharePct}% prints up).`
    );
    monitorRules.push(
      `${bestBuy.label}: better day to stage limits if Spot bias is LONG and not extended.`
    );
  }
  if (bestSell && bestSell.upSharePct <= 48) {
    didYouKnow.push(
      `Book sell-lean weekday: ${bestSell.label} (${bestSell.upSharePct}% up). Avoid blind adds.`
    );
    monitorRules.push(
      `${bestSell.label}: higher red-print rate — do not average down on calendar alone.`
    );
  }
  if (primary?.coinsBuyLean?.[0]) {
    const c = primary.coinsBuyLean[0];
    didYouKnow.push(
      `Clearest UP lean coin/day: ${c.name} on ${c.dayLabel} (${c.upSharePct}% up).`
    );
  }
  if (primary?.coinsSellLean?.[0]) {
    const c = primary.coinsSellLean[0];
    didYouKnow.push(
      `Clearest DOWN lean coin/day: ${c.name} on ${c.dayLabel} (${c.upSharePct}% up / often red).`
    );
  }
  for (const tip of macro?.tips || []) {
    if (tip && didYouKnow.length < 12) {
      didYouKnow.push(String(tip).replace(/^Did you know ·\s*/i, "Macro · "));
    }
  }
  for (const line of primary?.fillAlignment?.takeaways || []) {
    if (line && monitorRules.length < 10) monitorRules.push(`Your timing: ${line}`);
  }

  if (!didYouKnow.length) {
    didYouKnow.push("No Timing data yet — run full weekly refresh once.");
  }
  if (!monitorRules.length) {
    monitorRules.push("Run full weekly refresh to populate monitor rules.");
  }

  const chartSource = t14 || t28 || t7;
  const chartSlots = (chartSource?.slots || [])
    .slice()
    .sort((a, b) => a.hour - b.hour)
    .map((s) => ({
      label: s.label,
      avgAbsPct: Number(s.avgAbsPct) || 0,
      intensity: s.intensity || "normal",
    }));
  const chartWeekdays = (chartSource?.weekdays || []).map((w) => ({
    label: w.label,
    upSharePct: Number(w.upSharePct) || 0,
    avgAbsPct: Number(w.avgAbsPct) || 0,
  }));

  // Align slots by hour across 7 / 14 / 28 for a multi-window line chart
  const hourMap = new Map<
    number,
    { label: string; hour: number; avg7: number | null; avg14: number | null; avg28: number | null }
  >();
  const ingest = (cache: TimingCache | null, key: "avg7" | "avg14" | "avg28") => {
    for (const s of cache?.slots || []) {
      const hour = Number(s.hour);
      if (!Number.isFinite(hour)) continue;
      const cur =
        hourMap.get(hour) ||
        ({ label: s.label, hour, avg7: null, avg14: null, avg28: null } as const);
      const next = { ...cur, label: s.label || cur.label };
      (next as Record<string, unknown>)[key] = Number(s.avgAbsPct) || 0;
      hourMap.set(hour, next as { label: string; hour: number; avg7: number | null; avg14: number | null; avg28: number | null });
    }
  };
  ingest(t7, "avg7");
  ingest(t14, "avg14");
  ingest(t28, "avg28");
  const chartCompareSlots = [...hourMap.values()].sort((a, b) => a.hour - b.hour);

  let chartDonut: WeeklyBrief["chartDonut"] = null;
  const hotWd =
    chartSource?.hottestWeekday?.label ||
    (chartWeekdays.length
      ? [...chartWeekdays].sort((a, b) => b.avgAbsPct - a.avgAbsPct)[0]?.label
      : null);
  if (hotWd) {
    const row = chartWeekdays.find((w) => w.label === hotWd) || chartWeekdays[0];
    if (row) {
      const up = Math.max(0, Math.min(100, Number(row.upSharePct) || 0));
      chartDonut = {
        weekdayLabel: row.label,
        upSharePct: up,
        downSharePct: Math.max(0, 100 - up),
        windowDays: t14 ? 14 : t28 ? 28 : 7,
      };
    }
  }

  const macroMeetings = (macro?.meetings || []).slice(0, 6).map((m) => ({
    type: String(m.type || "OTHER"),
    title: String(m.title || m.type || "Macro"),
    date: String(m.date || "").slice(0, 10),
    regime24h: String(m.regime24h || "thin"),
    summary: String(m.summary || "").slice(0, 280),
  }));

  const losers7 = (t7?.topWindowLosers || [])
    .filter((x) => (x.netPct ?? 0) < -1)
    .slice(0, 8)
    .map((x) => ({
      symbol: x.symbol,
      name: x.name,
      netPct: Number(x.netPct) || 0,
    }));
  const losers14 = (t14?.topWindowLosers || [])
    .filter((x) => (x.netPct ?? 0) < -1)
    .slice(0, 8)
    .map((x) => ({
      symbol: x.symbol,
      name: x.name,
      netPct: Number(x.netPct) || 0,
    }));
  const map14 = new Map(losers14.map((x) => [x.symbol.toUpperCase(), x]));
  const consecutiveWeak = losers7
    .filter((x) => map14.has(x.symbol.toUpperCase()))
    .map((x) => {
      const b = map14.get(x.symbol.toUpperCase())!;
      return {
        symbol: x.symbol,
        name: x.name,
        net7: x.netPct,
        net14: b.netPct,
      };
    })
    .slice(0, 8);

  const rsiOversold = rsiOversoldHits.slice(0, 8);

  if (consecutiveWeak.length) {
    didYouKnow.push(
      `Multi-week soft alts (weak in both 7d & 14d net path): ${consecutiveWeak
        .slice(0, 4)
        .map((c) => `${c.name} (${c.net7.toFixed(1)}% / ${c.net14.toFixed(1)}%)`)
        .join(", ")} — awareness only, not a buy signal.`
    );
    monitorRules.push(
      `Soft book (7d+14d): ${consecutiveWeak
        .slice(0, 5)
        .map((c) => c.name)
        .join(", ")} — only stage if Spot is constructive and news is clean; prefer pullbacks.`
    );
  } else if (losers7.length) {
    didYouKnow.push(
      `Weakest alts last ~7d net path: ${losers7
        .slice(0, 5)
        .map((c) => `${c.name} ${c.netPct.toFixed(1)}%`)
        .join(", ")}.`
    );
  }
  if (rsiOversold.length) {
    didYouKnow.push(
      `RSI oversold snapshot (last Home monitor scan): ${rsiOversold
        .slice(0, 5)
        .map((c) => `${c.name} RSI ${c.rsi}`)
        .join(", ")} — confirm on Spot; not automatic entries.`
    );
    monitorRules.push(
      `Oversold watchlist: ${rsiOversold
        .slice(0, 5)
        .map((c) => c.name)
        .join(", ")} — pair with catalyst check before any limit buy.`
    );
  }

  const softBook = {
    losers7d: losers7,
    losers14d: losers14,
    consecutiveWeak,
    rsiOversold,
  };

  const agentLines: string[] = [];
  agentLines.push(`## Timing weekly brief · ${manilaDateKey()} Manila`);
  agentLines.push(`Generated: ${new Date().toISOString()}`);
  for (const w of windows) {
    agentLines.push(
      `### ${w.days}d · hot ${w.hottestSlot || "—"} · buy-lean ${w.buyLeanWeekday || "—"} · sell-lean ${w.sellLeanWeekday || "—"}`
    );
    if (w.clearestBuyCoin) agentLines.push(`- Buy lean coin: ${w.clearestBuyCoin}`);
    if (w.clearestSellCoin) agentLines.push(`- Sell lean coin: ${w.clearestSellCoin}`);
  }
  if (macroMeetings.length) {
    agentLines.push(`### Macro impact (alts)`);
    for (const m of macroMeetings) {
      agentLines.push(`- ${m.date} ${m.type} · ${m.regime24h}: ${m.summary}`);
    }
  }
  agentLines.push(`### Soft book · week path (alts)`);
  if (consecutiveWeak.length) {
    agentLines.push(`Multi-week weak (in 7d and 14d losers):`);
    for (const c of consecutiveWeak) {
      agentLines.push(
        `- ${c.name} (${c.symbol}): 7d ${c.net7.toFixed(2)}% · 14d ${c.net14.toFixed(2)}%`
      );
    }
  }
  if (losers7.length) {
    agentLines.push(`Weakest ~7d net:`);
    for (const c of losers7.slice(0, 6)) {
      agentLines.push(`- ${c.name}: ${c.netPct.toFixed(2)}%`);
    }
  }
  if (rsiOversold.length) {
    agentLines.push(`RSI oversold (Home monitor snapshot):`);
    for (const c of rsiOversold) {
      agentLines.push(`- ${c.name}: RSI ${c.rsi} · ${c.detail}`);
    }
  }
  if (!consecutiveWeak.length && !losers7.length && !rsiOversold.length) {
    agentLines.push(`- none listed (run Full weekly analysis after Timing caches exist)`);
  }
  agentLines.push(`### Monitor rules`);
  for (const r of monitorRules) agentLines.push(`- ${r}`);
  agentLines.push(`### Did you know`);
  for (const r of didYouKnow) agentLines.push(`- ${r}`);

  return {
    weekOf: manilaDateKey(),
    generatedAt: new Date().toISOString(),
    windows,
    chartSlots,
    chartWeekdays,
    chartCompareSlots,
    chartDonut,
    macroMeetings,
    macroTips: (macro?.tips || []).slice(0, 6),
    didYouKnow: didYouKnow.slice(0, 12),
    monitorRules: monitorRules.slice(0, 10),
    softBook,
    agentContext: agentLines.join("\n"),
    fullRefresh: meta?.fullRefresh,
    refreshedRanges: meta?.refreshedRanges,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    const full =
      req.query.full === "1" ||
      req.query.full === "true" ||
      (req.body && typeof req.body === "object" && (req.body as { full?: boolean }).full === true);
    const refresh =
      full ||
      req.query.refresh === "1" ||
      req.query.refresh === "true" ||
      req.query.force === "1" ||
      req.method === "POST";

    if (req.method === "GET" && !refresh) {
      const row = await prisma.catalystLog.findUnique({ where: { promptId: BRIEF_ID } });
      if (!row?.response) {
        return res.status(200).json({
          brief: null,
          message: "No weekly brief yet. Trigger full refresh once (Monday review).",
        });
      }
      const brief = JSON.parse(row.response) as WeeklyBrief;
      return res.status(200).json({
        brief,
        updatedAt: row.updatedAt?.toISOString?.() ?? row.createdAt?.toISOString?.(),
      });
    }

    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    let refreshedRanges: number[] = [];
    let pipelineErrors: string[] = [];
    if (full) {
      const pipe = await fullRefreshPipeline(req);
      refreshedRanges = pipe.refreshedRanges;
      pipelineErrors = pipe.errors;
    }

    const [t7, t14, t28, macro] = await Promise.all([
      loadTiming(7),
      loadTiming(14),
      loadTiming(28),
      loadMacro(),
    ]);

    // Reuse last Home monitor scan for RSI oversold (no extra heavy scan)
    let rsiHits: { symbol: string; name: string; rsi: number; detail: string }[] = [];
    try {
      const mon = await prisma.catalystLog.findUnique({
        where: { promptId: "home-monitor-scan" },
      });
      if (mon?.response) {
        const snap = JSON.parse(mon.response) as {
          rsiOversold?: { symbol: string; name: string; rsi: number; detail?: string }[];
        };
        rsiHits = (snap.rsiOversold || []).slice(0, 8).map((h) => ({
          symbol: h.symbol,
          name: h.name,
          rsi: Number(h.rsi) || 0,
          detail: String(h.detail || `RSI ${h.rsi}`),
        }));
      }
    } catch {
      /* ignore */
    }

    const brief = buildBrief(
      t7,
      t14,
      t28,
      macro,
      {
        fullRefresh: full,
        refreshedRanges,
      },
      rsiHits
    );
    const payload = JSON.stringify(brief);

    await prisma.catalystLog.upsert({
      where: { promptId: BRIEF_ID },
      create: { promptId: BRIEF_ID, category: "Timing", response: payload },
      update: { response: payload, category: "Timing" },
    });

    try {
      const histRow = await prisma.catalystLog.findUnique({ where: { promptId: HISTORY_ID } });
      let hist: WeeklyBrief[] = [];
      if (histRow?.response) {
        try {
          hist = JSON.parse(histRow.response) as WeeklyBrief[];
          if (!Array.isArray(hist)) hist = [];
        } catch {
          hist = [];
        }
      }
      hist = [brief, ...hist].slice(0, 16);
      await prisma.catalystLog.upsert({
        where: { promptId: HISTORY_ID },
        create: {
          promptId: HISTORY_ID,
          category: "Timing",
          response: JSON.stringify(hist),
        },
        update: { response: JSON.stringify(hist), category: "Timing" },
      });
    } catch {
      /* optional */
    }

    return res.status(200).json({
      brief,
      saved: true,
      fullRefresh: full,
      refreshedRanges,
      pipelineErrors: pipelineErrors.length ? pipelineErrors : undefined,
    });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}
