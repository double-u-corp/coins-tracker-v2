import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AlertBanner from "@/components/AlertBanner";

type SlotStat = {
  hour: number;
  label: string;
  sampleCount: number;
  coinCount: number;
  avgAbsPct: number;
  medianAbsPct: number;
  pctMovesAbove1: number;
  upSharePct?: number;
  avgUpPct?: number;
  avgDownPct?: number;
  upCount?: number;
  downCount?: number;
  rank: number;
  intensity: "quiet" | "normal" | "active" | "hot";
};

type WeekdayStat = {
  day: number;
  label: string;
  sampleCount: number;
  avgAbsPct: number;
  medianAbsPct: number;
  pctMovesAbove1: number;
  upSharePct?: number;
  avgUpPct?: number;
  avgDownPct?: number;
  upCount?: number;
  downCount?: number;
  rank: number;
  intensity: "quiet" | "normal" | "active" | "hot";
};

type CoinSlotHighlight = {
  symbol: string;
  name: string;
  avgAbsPct: number;
  samples: number;
};

type Coin2dMover = {
  symbol: string;
  name: string;
  totalAbsPct: number;
  netPct: number;
  samples: number;
  lastPrice: number;
};

type DayFlowSummary = {
  day: number;
  label: string;
  upSharePct: number;
  avgSignedPct: number;
  topBuyLeanCoins: { symbol: string; name: string; upSharePct: number; samples: number }[];
  topSellLeanCoins: { symbol: string; name: string; upSharePct: number; samples: number }[];
};

type CoinWeekdayBias = {
  symbol: string;
  name: string;
  day: number;
  dayLabel: string;
  samples: number;
  upSharePct: number;
  avgSignedPct: number;
  lean: "buy-lean" | "sell-lean" | "mixed";
};

type TimingResponse = {
  days: number;
  generatedAt: string;
  slots: SlotStat[];
  weekdays: WeekdayStat[];
  hottestSlot: SlotStat | null;
  quietestSlot: SlotStat | null;
  hottestWeekday: WeekdayStat | null;
  quietestWeekday: WeekdayStat | null;
  strongestUpSlot?: SlotStat | null;
  strongestDownSlot?: SlotStat | null;
  strongestUpWeekday?: WeekdayStat | null;
  strongestDownWeekday?: WeekdayStat | null;
  topMoversByHotSlot: CoinSlotHighlight[];
  userFills?: {
    type: "buy" | "sell";
    symbol: string;
    name: string;
    phpAmount: number;
    price: number;
    coinAmount: number;
    transactedAt: string;
    manilaLabel: string;
    weekdayLabel: string;
    path24hPct: number | null;
    path72hPct: number | null;
    pathToLatestPct: number | null;
  }[];
  /** Biggest movers last ~2 days only */
  topMovers2d?: Coin2dMover[];
  dayFlow?: DayFlowSummary[];
  coinsBuyLean?: CoinWeekdayBias[];
  coinsSellLean?: CoinWeekdayBias[];
  coinWeekdayTable?: {
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

const INTENSITY_STYLES: Record<
  SlotStat["intensity"],
  { bar: string; badge: string; label: string }
> = {
  quiet: {
    bar: "bg-slate-300",
    badge: "bg-slate-100 text-slate-700 border-slate-200",
    label: "Quiet",
  },
  normal: {
    bar: "bg-sky-400",
    badge: "bg-sky-50 text-sky-800 border-sky-200",
    label: "Normal",
  },
  active: {
    bar: "bg-amber-400",
    badge: "bg-amber-50 text-amber-900 border-amber-200",
    label: "Active",
  },
  hot: {
    bar: "bg-rose-500",
    badge: "bg-rose-50 text-rose-800 border-rose-200",
    label: "Hot",
  },
};


/** Manila hour → slot label for the poll that ends that window */
const SLOT_HOURS = [2, 5, 8, 11, 14, 17, 20, 23] as const;
const SLOT_LABEL: Record<number, string> = {
  2: "02:05",
  5: "05:05",
  8: "08:05",
  11: "11:05",
  14: "14:05",
  17: "17:05",
  20: "20:05",
  23: "23:05",
};

function manilaNowLabel(): string {
  return new Date().toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function recheckByLabel(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86400000);
  return d.toLocaleDateString("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Map an ET clock time on a given ET date to Manila date+time and nearest poll slot after release. */
function etToManilaSlot(
  dateYmd: string,
  timeET?: string
): { manilaLine: string; slotLabel: string } {
  const [hh, mm] = (timeET || "00:00").split(":").map((x) => parseInt(x, 10) || 0);
  // EDT until 2026-11-01: UTC-4 → Manila = +12h; after: EST UTC-5 → +13h
  const edCutoff = new Date("2026-11-01T00:00:00Z").getTime();
  const etApprox = new Date(`${dateYmd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  const offsetH = etApprox.getTime() < edCutoff ? 12 : 13;
  const manila = new Date(etApprox.getTime() + offsetH * 3600000);
  const manilaY = manila.toISOString().slice(0, 10);
  const mH = manila.getUTCHours();
  const mM = manila.getUTCMinutes();
  // Slot window that would capture reaction: first poll label at or after Manila time
  let slot: number = SLOT_HOURS[0];
  for (const h of SLOT_HOURS) {
    if (h * 60 + 5 >= mH * 60 + mM) {
      slot = h;
      break;
    }
    slot = h;
  }
  // if release after 23:05, next day's 02:05
  if (mH * 60 + mM > 23 * 60 + 5) slot = 2;
  const manilaLine = `${manilaY} ${String(mH).padStart(2, "0")}:${String(mM).padStart(2, "0")} MNL`;
  return { manilaLine, slotLabel: SLOT_LABEL[slot] || "02:05" };
}

function slotWindowBefore(label: string): string {
  const map: Record<string, string> = {
    "02:05": "23:05–02:05",
    "05:05": "02:05–05:05",
    "08:05": "05:05–08:05",
    "11:05": "08:05–11:05",
    "14:05": "11:05–14:05",
    "17:05": "14:05–17:05",
    "20:05": "17:05–20:05",
    "23:05": "20:05–23:05",
  };
  // labels from API may be longer ("11:05 PM …")
  for (const [k, v] of Object.entries(map)) {
    if (label.includes(k.replace(/^0/, "")) || label.includes(k)) return v;
  }
  return "3h before label";
}

function formatTimingPatternPrompt(
  data: TimingResponse,
  macroSlotLines: string[],
  heldCoins: string
): string {
  const allAvg =
    data.slots.length > 0
      ? data.slots.reduce((s, x) => s + x.avgAbsPct, 0) / data.slots.length
      : 0;
  const lines: string[] = [];
  lines.push(`ROLE`);
  lines.push(
    `You are a neutral research assistant for a Philippines spot LONG-only PHP crypto trader (Coins.ph / Maya style: no shorting, no leverage). You give no buy signals, price targets, or predictions. "No action" is a valid answer.`
  );
  lines.push(``);
  lines.push(`PURPOSE`);
  lines.push(
    `Turn our poll-timing stats into a short watch plan, and check live news for the coins that are unusually active in the hot window. Timing is activity/liquidity, never an entry signal. "Stage" applies only if the trader's own Spot page already shows a long bias, which you cannot see.`
  );
  lines.push(``);
  lines.push(`HOW THE DATA IS BUILT`);
  lines.push(
    `- Polls ~8×/day, Manila: 02:05, 05:05, 08:05, 11:05, 14:05, 17:05, 20:05, 23:05.`
  );
  lines.push(
    `- A slot's stat = |% move| over the ~3 hours BEFORE its label (11:05 PM ≈ activity into that print).`
  );
  lines.push(`- It cannot see moves shorter than ~3h, or which direction price went.`);
  lines.push(
    `- Generated: ${manilaNowLabel()} · Window: ${data.days} days · All-slot avg |move| ${allAvg.toFixed(2)}%.`
  );
  lines.push(`- Slot gaps under ~0.15 percentage points are noise.`);
  lines.push(``);
  lines.push(`PRECOMPUTED READ (from the app; do not recompute)`);
  if (data.hottestSlot) {
    lines.push(
      `- Hottest slot: ${data.hottestSlot.label} (avg ${data.hottestSlot.avgAbsPct}%, >1% ${data.hottestSlot.pctMovesAbove1}%, n=${data.hottestSlot.sampleCount}).`
    );
  }
  if (data.quietestSlot) {
    lines.push(
      `- Quietest slot: ${data.quietestSlot.label} (avg ${data.quietestSlot.avgAbsPct}%).`
    );
  }
  if (data.hottestWeekday) {
    lines.push(
      `- Hottest weekday: ${data.hottestWeekday.label} (avg ${data.hottestWeekday.avgAbsPct}%).`
    );
  }
  if (data.quietestWeekday) {
    lines.push(
      `- Quietest weekday: ${data.quietestWeekday.label} (avg ${data.quietestWeekday.avgAbsPct}%).`
    );
  }
  for (const g of data.guidance || []) lines.push(`- ${g}`);
  lines.push(``);
  lines.push(`SLOT TABLE (Manila; window ≈ 3h before label)`);
  lines.push(`label | window | avg | median | >1% | n | intensity`);
  for (const s of [...data.slots].sort((a, b) => a.rank - b.rank)) {
    lines.push(
      `${s.label} | ${slotWindowBefore(s.label)} | ${s.avgAbsPct}% | ${s.medianAbsPct}% | ${s.pctMovesAbove1}% | ${s.sampleCount} | ${s.intensity}`
    );
  }
  lines.push(``);
  lines.push(`WEEKDAY SUMMARY (${data.days} days · Manila)`);
  if (data.weekdays?.length) {
    lines.push(`day | avg | median | >1% | n | intensity`);
    for (const w of [...data.weekdays].sort((a, b) => a.rank - b.rank)) {
      lines.push(
        `${w.label} | ${w.avgAbsPct}% | ${w.medianAbsPct}% | ${w.pctMovesAbove1}% | ${w.sampleCount} | ${w.intensity}`
      );
    }
  } else {
    lines.push(`(no weekday breakdown)`);
  }
  lines.push(``);
  lines.push(
    `MACRO LANDING IN SLOT WINDOWS, next 14 days (context only; verified separately in the Macro watch prompt)`
  );
  if (macroSlotLines.length) {
    for (const L of macroSlotLines) lines.push(`- ${L}`);
  } else {
    lines.push(`- none loaded`);
  }
  lines.push(``);
  lines.push(
    `COINS TO CHECK (top active in hottest slot — search news; BTC/ETH/SOL if present in list)`
  );
  lines.push(`ticker | pair | hot-slot avg | samples`);
  const coins = data.topMoversByHotSlot || [];
  for (const c of coins.slice(0, 10)) {
    lines.push(`${c.name} | ${c.symbol} | ${c.avgAbsPct}% | ${c.samples}`);
  }
  if (!coins.length) lines.push(`(none)`);
  lines.push(``);
  lines.push(`Held coins: ${heldCoins || "none provided"}`);
  lines.push(``);
  lines.push(`RESEARCH TASKS (live search required; no training memory)`);
  lines.push(
    `1. **Crypto-only news** for each coin above (last 14d / next 14d): unlocks, upgrades/forks, listings/delists, exploits, ETF/regulatory, exchange/stablecoin incidents. Skip routine macro unless a clear crypto link.`
  );
  lines.push(
    `2. If scheduled, convert to Manila and map to poll slots 02:05–23:05. Poll = check time, not guaranteed move.`
  );
  lines.push(
    `3. Coins.ph/Maya notices only if primary-sourced.`
  );
  lines.push(
    `4. Prefer primary sources + URL + date checked. Unverified → "none verified". No invented events.`
  );
  lines.push(``);
  lines.push(`VERIFICATION RULES`);
  lines.push(
    `- Each item needs source name, publish date, and URL. No source: do not list it; write "none verified".`
  );
  lines.push(
    `- Hacks/exploits/delistings need an official post OR two independent outlets. Otherwise label "Unconfirmed" and keep it out of the posture column.`
  );
  lines.push(`- No historical analogs, no sentiment summaries, no memory headlines.`);
  lines.push(
    `- If you have no live search, say so in one line and answer only the Pattern read.`
  );
  lines.push(``);
  lines.push(`POSTURE LABELS (use only these)`);
  lines.push(
    `IGNORE · WATCH (check price/news at the slot, no order) · STAGE (only if Spot already shows a long bias; prefer resting limit orders before the window, not market orders inside it) · RISK (verified negative item on a coin above or held; review exposure, do not add)`
  );
  lines.push(``);
  lines.push(`RULES`);
  lines.push(
    `Neutral. Do not lean bullish. Spot only. Do not restate the tables. Under ~300 words excluding tables.`
  );
  lines.push(``);
  lines.push(`ANSWER FORMAT`);
  lines.push(`0. Data status (1 line: search available? thin data?)`);
  lines.push(
    `1. Pattern read (max 3 bullets: what stands out vs noise, using PRECOMPUTED READ; say if the hot slot overlaps a macro event)`
  );
  lines.push(`2. Slots/weekdays worth attention (max 3 lines, each with a posture)`);
  lines.push(
    `3. Coin news table: Coin | Item | Type | Date | Source | Posture (one row per coin; "none verified" if empty)`
  );
  lines.push(`4. Do (max 3) / Don't (max 3) for a spot buyer this week`);
  lines.push(`Recheck by: ${recheckByLabel(7)}`);
  return lines.join("\n");
}

function formatMacroWatchAgentPrompt(
  eventTableLines: string[],
  slotStatsHint: string
): string {
  const lines: string[] = [];
  lines.push(`ROLE`);
  lines.push(
    `You are a neutral research assistant for a Philippines spot LONG-only PHP crypto trader (no shorting, no leverage). No buy signals, targets, or predictions. "No action" is a valid answer.`
  );
  lines.push(``);
  lines.push(`PURPOSE`);
  lines.push(
    `Verify the macro calendar below, find missing high-impact events, and tell the trader which Manila windows to watch. Hot windows are activity, not direction.`
  );
  lines.push(``);
  lines.push(`TIME RULES (given facts; use them)`);
  lines.push(`- Manila is UTC+8, no daylight saving.`);
  lines.push(
    `- US Eastern is EDT (UTC-4) until Nov 1, 2026, so ET→Manila = +12h. After that it is EST (UTC-5), so ET→Manila = +13h.`
  );
  lines.push(
    `- Always state the Manila DATE as well as the time. Evening ET events can fall on the next Manila date.`
  );
  lines.push(``);
  lines.push(`TODAY`);
  lines.push(manilaNowLabel());
  lines.push(``);
  lines.push(
    `CALENDAR FROM THE APP (already converted by the app; verify, do not assume it is right)`
  );
  lines.push(
    `name | impact | ET date+time | Manila date+time | poll-slot window | slot avg / >1% (if known)`
  );
  if (eventTableLines.length) {
    for (const L of eventTableLines) lines.push(L);
  } else {
    lines.push(`(no events in app)`);
  }
  lines.push(``);
  lines.push(
    `Manual notes without a verifiable event type (OTHER with no primary source) should be treated cautiously.`
  );
  lines.push(``);
  lines.push(`APP POLL SLOTS (Manila; each stat covers the ~3h BEFORE its label)`);
  lines.push(`02:05, 05:05, 08:05, 11:05, 14:05, 17:05, 20:05, 23:05.`);
  lines.push(`Polls cannot see moves shorter than ~3h or their direction.`);
  if (slotStatsHint) {
    lines.push(slotStatsHint);
  }
  lines.push(``);
  lines.push(`RESEARCH TASKS (live search required; no training memory)`);
  lines.push(
    `1. Verify each event's date and time against the primary source (federalreserve.gov, bls.gov, bea.gov). Reply KEEP / FIX (give correct ET AND Manila date+time) / STALE. Also check the Manila date and the slot mapping.`
  );
  lines.push(
    `2. Prefer **crypto-specific** additions next 21 days (regulation, ETF material flows, major exchange/protocol events). Include routine macro (GDP, PPI, auctions, speeches) **only** with a concrete crypto relevance — otherwise omit.`
  );
  lines.push(
    `3. Philippines: BSP decisions or USD/PHP items only when they can move local PHP crypto liquidity or risk appetite.`
  );
  lines.push(
    `4. For each HIGH event, state when the release lands relative to the app's poll slots, including sub-slot timing (e.g. a statement landing minutes before a poll).`
  );
  lines.push(``);
  lines.push(`VERIFICATION RULES`);
  lines.push(
    `- Each claim needs a primary source, its URL, and the date you checked.`
  );
  lines.push(
    `- Unverified: write "none verified". Do not guess a date or time.`
  );
  lines.push(
    `- No memory headlines, no "last time CPI came in hot…" history, no forecasts or consensus numbers unless sourced and dated.`
  );
  lines.push(
    `- If you have no live search, say so in one line and only check the arithmetic of the conversions above.`
  );
  lines.push(``);
  lines.push(`POSTURE LABELS (use only these)`);
  lines.push(
    `IGNORE · WATCH (check price at the time, no order) · STAGE (only if the trader's Spot page already shows a long bias; prefer resting limit orders before the window, not market orders inside it) · RISK (verified item that raises event risk for coins held; review exposure, do not add)`
  );
  lines.push(``);
  lines.push(`RULES`);
  lines.push(
    `Neutral. Do not lean bullish. Spot only. Under ~300 words excluding tables.`
  );
  lines.push(``);
  lines.push(`ANSWER FORMAT`);
  lines.push(`0. Data status (1 line: search available? primary sources checked?)`);
  lines.push(
    `1. Calendar audit table: Event | Manila date+time | Slot window | Verdict (KEEP/FIX/STALE) | Source | Posture`
  );
  lines.push(
    `2. Missing macro, next 21 days (verified only; same columns) or "none verified"`
  );
  lines.push(
    `3. Manila watch windows: for each HIGH event, one line: "watch from [time] to [time] Manila" (about 30 min before to the next poll after release), plus whether the poll stats will capture the reaction`
  );
  lines.push(`4. Do (max 3) / Don't (max 3) for a spot buyer around these dates`);
  lines.push(
    `5. App corrections (wrong dates, ET/Manila mismatches, stale rows) or "none"`
  );
  lines.push(`Recheck by: ${recheckByLabel(7)}`);
  return lines.join("\n");
}

type MacroEventRow = {
  date: string;
  title: string;
  type?: string;
  severity?: string;
  timeET?: string;
  manilaTimeLabel?: string;
  coinSymbol?: string;
  detail?: string;
  source?: string;
};

async function loadMacroEventsFromApp(): Promise<{
  eventTableLines: string[];
  macroSlotLines: string[];
  slotByLabel: Map<string, SlotStat>;
}> {
  const catRes = await fetch("/api/catalyst-ai")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const logs = catRes?.logs || {};
  const macroLog = logs["macro-calendar-events"];
  const metaLog = logs["macro-calendar-meta"];

  let deletedKeys = new Set<string>();
  if (metaLog?.response) {
    try {
      const meta = JSON.parse(String(metaLog.response));
      if (Array.isArray(meta.deletedKeys)) {
        deletedKeys = new Set(meta.deletedKeys.map(String));
      }
    } catch {
      /* ignore */
    }
  }

  const eventTableLines: string[] = [];
  const macroSlotLines: string[] = [];
  if (!macroLog?.response) {
    return { eventTableLines, macroSlotLines, slotByLabel: new Map() };
  }

  try {
    let raw = String(macroLog.response).trim();
    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const parsed = JSON.parse(raw);
    const arr: MacroEventRow[] = Array.isArray(parsed) ? parsed : [];
    arr.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    for (const e of arr) {
      const date = String(e.date || "").slice(0, 10);
      const title = (e.title || "").trim();
      const key = `${date}|${title.toLowerCase()}`;
      if (deletedKeys.has(key)) continue;
      const impact = e.severity === "high" ? "HIGH" : e.severity || "medium";
      const { manilaLine, slotLabel } = etToManilaSlot(date, e.timeET);
      const etPart = e.timeET ? `${date} ${e.timeET} ET` : `${date} (time unknown) ET`;
      eventTableLines.push(
        `${title} | ${impact} | ${etPart} | ${manilaLine} | ~${slotLabel} window | ${e.type || "OTHER"}${e.source === "manual" ? " [manual]" : ""}`
      );
      macroSlotLines.push(
        `${date} ${title} (${impact}) → Manila ${manilaLine} → slot ~${slotLabel}`
      );
    }
  } catch {
    eventTableLines.push("(Macro watch response could not be parsed)");
  }
  return { eventTableLines, macroSlotLines, slotByLabel: new Map() };
}


type RecentPollPoint = { day: string; slotLabel: string; price: number };
type RecentPollSeries = { symbol: string; points: RecentPollPoint[] };

async function fetchRecentPollsStructured(symbols: string[]): Promise<RecentPollSeries[]> {
  const SLOT = [2, 5, 8, 11, 14, 17, 20, 23];
  const out: RecentPollSeries[] = [];
  for (const symbol of symbols.slice(0, 5)) {
    try {
      const res = await fetch(
        `/api/coins?type=chart&symbol=${encodeURIComponent(symbol)}&granularity=3h&hours=48`
      );
      if (!res.ok) continue;
      const json = await res.json();
      const pointsRaw = Array.isArray(json.points) ? json.points : [];
      if (!pointsRaw.length) continue;
      const points: RecentPollPoint[] = [];
      for (const pt of pointsRaw.slice(-16)) {
        const raw = pt.period || pt.label;
        const tms = new Date(raw).getTime();
        if (!Number.isFinite(tms)) continue;
        const manila = new Date(tms + 8 * 3600000);
        const day = manila.toISOString().slice(0, 10);
        const hour = manila.getUTCHours();
        let slot = hour;
        let best = 99;
        for (const h of SLOT) {
          const d = Math.min(Math.abs(hour - h), 24 - Math.abs(hour - h));
          if (d < best) {
            best = d;
            slot = h;
          }
        }
        const px =
          typeof pt.close === "number"
            ? pt.close
            : typeof pt.high === "number"
              ? pt.high
              : null;
        if (px == null) continue;
        points.push({
          day,
          slotLabel: `${String(slot).padStart(2, "0")}:05`,
          price: px,
        });
      }
      if (points.length) out.push({ symbol, points });
    } catch {
      /* skip */
    }
  }
  return out;
}

function formatRecentPollsBlock(series: RecentPollSeries[]): string {
  if (!series.length) return "";
  return series
    .map((s) => {
      const lines = [`### ${s.symbol}`];
      for (const pt of s.points) {
        lines.push(`- ${pt.day} ${pt.slotLabel} · ${pt.price}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}



function formatSlotsSnapshot(data: TimingResponse): string {
  const when = new Date(data.generatedAt).toLocaleString("en-CA", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const lines: string[] = [];
  lines.push(`### Poll windows (${data.days}d · Manila)`);
  lines.push(`*Snapshot: ${when} Manila*`);
  lines.push(``);
  lines.push(`| # | Slot | Intensity | Avg % | Med % | ≥1% | n |`);
  lines.push(`| -: | --- | --- | -: | -: | -: | -: |`);
  for (const s of [...data.slots].sort((a, b) => a.rank - b.rank)) {
    lines.push(
      `| ${s.rank} | ${s.label} | ${s.intensity} | ${s.avgAbsPct} | ${s.medianAbsPct} | ${s.pctMovesAbove1} | ${s.sampleCount} |`
    );
  }
  lines.push(``);
  if (data.hottestSlot) {
    lines.push(`- **Hottest:** ${data.hottestSlot.label} (${data.hottestSlot.avgAbsPct}% avg)`);
  }
  if (data.quietestSlot) {
    lines.push(`- **Quietest:** ${data.quietestSlot.label} (${data.quietestSlot.avgAbsPct}% avg)`);
  }
  return lines.join("\n");
}

function formatWeekdaysSnapshot(data: TimingResponse): string {
  const when = new Date(data.generatedAt).toLocaleString("en-CA", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const lines: string[] = [];
  lines.push(`### Weekday activity (${data.days}d · Manila)`);
  lines.push(`*Snapshot: ${when} Manila*`);
  lines.push(``);
  if (!data.weekdays?.length) {
    lines.push(`*(no weekday data)*`);
    return lines.join("\n");
  }
  lines.push(`| # | Day | Intensity | Avg % | Med % | ≥1% | n |`);
  lines.push(`| -: | --- | --- | -: | -: | -: | -: |`);
  for (const w of [...data.weekdays].sort((a, b) => a.rank - b.rank)) {
    lines.push(
      `| ${w.rank} | ${w.label} | ${w.intensity} | ${w.avgAbsPct} | ${w.medianAbsPct} | ${w.pctMovesAbove1} | ${w.sampleCount} |`
    );
  }
  lines.push(``);
  if (data.hottestWeekday) {
    lines.push(`- **Hottest weekday:** ${data.hottestWeekday.label} (${data.hottestWeekday.avgAbsPct}% avg)`);
  }
  if (data.quietestWeekday) {
    lines.push(`- **Quietest weekday:** ${data.quietestWeekday.label} (${data.quietestWeekday.avgAbsPct}% avg)`);
  }
  return lines.join("\n");
}

function formatMonthlyTimingJournal(data: TimingResponse): string {
  return [
    formatSlotsSnapshot(data),
    ``,
    formatWeekdaysSnapshot(data),
    ``,
    `> Monthly timing snapshot (slots + weekdays). **Not a trade signal.**`,
  ].join("\n");
}

function formatWhyMovingPrompt(
  data: TimingResponse,
  series: RecentPollSeries[]
): string {
  const lines: string[] = [];
  lines.push(`ROLE`);
  lines.push(
    `You are a neutral crypto-market research assistant for a Philippines-based spot LONG-only trader. No shorting, leverage, or margin.`
  );
  lines.push(``);
  lines.push(`GOAL`);
  lines.push(
    `Explain **why the biggest movers of the last ~2 days** moved, using our 3h Manila poll path + **verified crypto-specific news only**. Ranking is total |%| path over ~48h — not the 14/30/60 hot-slot list.`
  );
  lines.push(``);
  lines.push(`BIGGEST MOVERS LAST ~2 DAYS`);
  if (data.topMovers2d?.length) {
    for (const m of data.topMovers2d) {
      lines.push(
        `- ${m.name} (${m.symbol}): total |path| ${m.totalAbsPct}% · net ${m.netPct >= 0 ? "+" : ""}${m.netPct}% · samples ${m.samples} · last ${m.lastPrice}`
      );
    }
  } else {
    lines.push(`- (ranking not available — use path series only)`);
  }
  lines.push(``);
  lines.push(`RECENT 3h POLL PATH (~2 days, Manila)`);
  lines.push(`Each line is one poll print. Compare consecutive prints for grind / dump / chop.`);
  lines.push(``);
  if (series.length) {
    for (const s of series) {
      lines.push(`### ${s.symbol}`);
      let prev: number | null = null;
      for (const pt of s.points) {
        let tag = "";
        if (prev != null && prev > 0) {
          const pct = ((pt.price - prev) / prev) * 100;
          tag = ` · ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
        }
        lines.push(`- ${pt.day} ${pt.slotLabel} · ${pt.price}${tag}`);
        prev = pt.price;
      }
      lines.push(``);
    }
  } else {
    lines.push(`- (no poll series)`);
    lines.push(``);
  }
  lines.push(`SEARCH PRIORITY (crypto first)`);
  lines.push(
    `Tier 1: regulation/enforcement, protocol upgrades/incidents, exchange outages/hacks/withdrawals, stablecoin issues, material ETF flows, major unlocks/migrations, verified exploits.`
  );
  lines.push(
    `Tier 2: official project/issuer announcements for these coins, credible listings/delistings, tokenomics or ecosystem moves likely to affect liquidity.`
  );
  lines.push(
    `Tier 3 macro: ONLY if a concrete, timely crypto link (e.g. FOMC when rates clearly drive risk assets). Do NOT auto-list GDP, NFP, auctions, elections, speeches.`
  );
  lines.push(``);
  lines.push(`VERIFICATION`);
  lines.push(`- Prefer official blogs, exchange notices, regulators, primary data; confirm secondary leads.`);
  lines.push(`- No rumors, price predictions, recycled commentary, or unconfirmed social claims.`);
  lines.push(`- Do not invent events, times, unlocks, impact, or URLs. Unverified → "none verified".`);
  lines.push(`- State date checked + source URL for every included item.`);
  lines.push(``);
  lines.push(`TIME`);
  lines.push(`- Manila (PHT, UTC+8). Polls: 02:05, 05:05, 08:05, 11:05, 14:05, 17:05, 20:05, 23:05.`);
  lines.push(`- A poll slot is when to check the market, not when price must move.`);
  lines.push(``);
  lines.push(`POSTURE (use only these)`);
  lines.push(`IGNORE · WATCH (check next poll — not a buy) · RISK (verified item raises risk for a coin already held)`);
  lines.push(`Do not use STAGE from news alone.`);
  lines.push(``);
  lines.push(`ANSWER FORMAT`);
  lines.push(`0. Data status (sources checked · limitations)`);
  lines.push(`1. Per-coin path read (max 3 bullets each from our polls)`);
  lines.push(
    `2. Event table: Manila time | Coin | Item | Why it matters | Confidence | First poll after | Posture | Source URL`
  );
  lines.push(`3. Exclusions (tempting non-crypto noise you skipped)`);
  lines.push(`4. Monitoring tips (max 3) — no buy-from-news`);
  lines.push(`If nothing material: "No verified high-impact crypto-specific events found for this period."`);
  return lines.join("\n");
}

function symbolsFor2dPath(data: TimingResponse): string[] {
  const from2d = (data.topMovers2d || []).map((c) => c.symbol);
  if (from2d.length) return from2d.slice(0, 8);
  // Fallback only if API old
  return [
    ...new Set(
      [
        ...(data.topMoversByHotSlot || []).map((c) => c.symbol),
        "BTCPHP",
        "ETHPHP",
      ].filter(Boolean)
    ),
  ].slice(0, 8);
}

export default function SwingTimingView() {
  const [days, setDays] = useState(28);
  const [data, setData] = useState<TimingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [macroImpactLoading, setMacroImpactLoading] = useState(false);
  const [macroImpact, setMacroImpact] = useState<{
    generatedAt?: string | null;
    tips?: string[];
    meetings?: {
      type: string;
      title: string;
      date: string;
      downShare24h: number;
      downShare72h?: number;
      avgSigned24h: number;
      avgSigned72h?: number;
      sampleCoins: number;
      regime24h?: string;
      summary?: string;
      topMoves?: {
        symbol: string;
        name: string;
        priceBefore: number;
        price24h: number | null;
        pct24h: number | null;
        pct72h: number | null;
      }[];
    }[];
    message?: string;
  } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [patternCoin, setPatternCoin] = useState<string>("");
  const [coinOptions, setCoinOptions] = useState<{ symbol: string; name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/coins");
        if (!res.ok) throw new Error("list failed");
        const j = await res.json();
        const list = (j.coins || []) as { symbol?: string; name?: string }[];
        if (cancelled) return;
        const opts = list
          .filter((c) => c.symbol)
          .map((c) => ({ symbol: String(c.symbol), name: String(c.name || c.symbol) }))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (opts.length) setCoinOptions(opts);
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [agentCopied, setAgentCopied] = useState<"timing" | "macro" | "why" | "slots" | "weekdays" | "journal" | null>(null);
  const [recentPolls, setRecentPolls] = useState<RecentPollSeries[]>([]);
  const [recentPollsLoading, setRecentPollsLoading] = useState(false);

  const copyTimingPrompt = async () => {
    if (!data) return;
    try {
      const { macroSlotLines } = await loadMacroEventsFromApp();
      const enriched = macroSlotLines.map((line) => {
        const slot = data.slots.find(
          (s) =>
            line.includes(s.label.slice(0, 5)) ||
            (line.includes("23:05") && s.label.includes("23"))
        );
        if (!slot) return line;
        return `${line} (slot avg ${slot.avgAbsPct}%, >1% ${slot.pctMovesAbove1}%)`;
      });
      const text = formatTimingPatternPrompt(data, enriched, "none provided");
      await navigator.clipboard.writeText(text);
      setAgentCopied("timing");
      setTimeout(() => setAgentCopied(null), 2000);
    } catch {
      setError("Could not copy timing prompt");
    }
  };

  const copyWhyMovingPrompt = async () => {
    if (!data) return;
    try {
      let series = recentPolls;
      if (!series.length) {
        series = await fetchRecentPollsStructured(symbolsFor2dPath(data));
        setRecentPolls(series);
      }
      const text = formatWhyMovingPrompt(data, series);
      await navigator.clipboard.writeText(text);
      setAgentCopied("why");
      setTimeout(() => setAgentCopied(null), 2000);
    } catch {
      setError("Could not copy why-moving prompt");
    }
  };

  const copySlotsSnapshot = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(formatSlotsSnapshot(data));
      setAgentCopied("slots");
      setTimeout(() => setAgentCopied(null), 2000);
    } catch {
      setError("Could not copy poll windows");
    }
  };

  const copyWeekdaysSnapshot = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(formatWeekdaysSnapshot(data));
      setAgentCopied("weekdays");
      setTimeout(() => setAgentCopied(null), 2000);
    } catch {
      setError("Could not copy weekday activity");
    }
  };

  
  const loadMacroImpact = async (refresh = false) => {
    setMacroImpactLoading(true);
    try {
      const url = refresh
        ? `/api/timing-macro-impact?refresh=1&_=${Date.now()}`
        : `/api/timing-macro-impact?_=${Date.now()}`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(await r.text());
      setMacroImpact(await r.json());
    } catch (e) {
      setMacroImpact({ tips: [], message: (e as Error).message });
    } finally {
      setMacroImpactLoading(false);
    }
  };

  const saveTimingSnapshotToJournal = async (kind: "manual" | "monthly") => {
    if (!data) return;
    try {
      const todayManila = new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const ym = todayManila.slice(0, 7);
      // Cross-device dedupe key in CatalystLog (shared DB — not localStorage)
      const promptId = `timing-activity-${ym}`;

      if (kind === "monthly") {
        const logsRes = await fetch("/api/catalyst-ai");
        if (logsRes.ok) {
          const logsJson = await logsRes.json();
          if (logsJson?.logs?.[promptId]) {
            // Already saved this Manila month on any device
            return;
          }
        }
      }

      const title =
        kind === "monthly"
          ? `Timing activity · ${ym} (month-end)`
          : `Timing activity · ${todayManila}`;
      const notes = formatMonthlyTimingJournal(data);

      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryDate: todayManila,
          title,
          notes,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Journal save failed (${res.status})`);
      }

      // Mark month in CatalystLog so other devices skip auto-save
      await fetch("/api/catalyst-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptId,
          category: "Monthly",
          storeOnly: notes,
        }),
      });

      setAgentCopied("journal");
      setTimeout(() => setAgentCopied(null), 2500);
    } catch (e) {
      setError((e as Error).message || "Could not save to journal");
    }
  };

  // Month-end timing journal auto-save (once per Manila calendar month, last 2 days)
  useEffect(() => {
    if (!data || typeof window === "undefined") return;
    const manila = new Date(Date.now() + 8 * 3600 * 1000);
    const y = manila.getUTCFullYear();
    const m = manila.getUTCMonth();
    const d = manila.getUTCDate();
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    if (d < lastDay - 1) return;
    const ym = `${y}-${String(m + 1).padStart(2, "0")}`;
    void saveTimingSnapshotToJournal("monthly");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.generatedAt]);


  const copyMacroPrompt = async () => {
    try {
      const { eventTableLines } = await loadMacroEventsFromApp();
      let slotHint = "";
      if (data?.slots?.length) {
        const bits = data.slots
          .slice()
          .sort((a, b) => a.rank - b.rank)
          .slice(0, 3)
          .map((s) => `${s.label}: avg ${s.avgAbsPct}%, >1% ${s.pctMovesAbove1}%`);
        slotHint = `Hottest slots (from Timing, ${data.days}d): ${bits.join(" · ")}`;
      }
      const text = formatMacroWatchAgentPrompt(eventTableLines, slotHint);
      await navigator.clipboard.writeText(text);
      setAgentCopied("macro");
      setTimeout(() => setAgentCopied(null), 2000);
    } catch {
      setError("Could not copy macro prompt");
    }
  };

  const load = useCallback(async (d: number, opts?: { refresh?: boolean }) => {
    const refresh = !!opts?.refresh;
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        days: String(d),
        _: String(Date.now()),
      });
      if (refresh) q.set("refresh", "1");
      const res = await fetch(`/api/swing-timing?${q}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const json: TimingResponse = await res.json();
      setData(json);
      setRefreshedAt(json.cacheUpdatedAt || new Date().toISOString());
    } catch (err) {
      setError((err as Error).message);
      if (refresh) setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load cached snapshot only — full recompute is "Run analysis"
  useEffect(() => { void loadMacroImpact(false); void load(days, { refresh: false });
  }, [days, load]);


  useEffect(() => {
    if (!data) {
      setRecentPolls([]);
      return;
    }
    let cancelled = false;
    const symbols = symbolsFor2dPath(data);
    setRecentPollsLoading(true);
    void fetchRecentPollsStructured(symbols)
      .then((rows) => {
        if (!cancelled) setRecentPolls(rows);
      })
      .finally(() => {
        if (!cancelled) setRecentPollsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data]);

  const maxSlotAvg = data ? Math.max(...data.slots.map((s) => s.avgAbsPct), 0.01) : 1;
  const maxDayAvg = data?.weekdays?.length
    ? Math.max(...data.weekdays.map((s) => s.avgAbsPct), 0.01)
    : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-gray-600 max-w-2xl">
            Cached snapshot loads by default (no heavy recompute). Click <span className="font-semibold">Run analysis</span> to rebuild
            for 7 / 14 / 28 days. Use to watch vs stage limits — not a buy signal. Confirm on{" "}
            <Link href="/chart" className="font-semibold text-purple-700 hover:underline">
              Spot
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mr-1">
            Activity (slots/weekdays)
          </span>
          {[7, 14, 28].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              disabled={loading}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold border transition-colors ${
                days === d
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              } disabled:opacity-50`}
            >
              {d}d
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load(days, { refresh: true })}
            disabled={loading}
            className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
            title="Recompute from latest poll history"
          >
            {loading ? "Refreshing…" : "↻ Run analysis"}
          </button>
          <button
            type="button"
            onClick={() => void loadMacroImpact(true)}
            disabled={macroImpactLoading}
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
            title="Compare watchlist moves after past CPI / NFP / FOMC / PCE — saved for Home Did you know"
          >
            {macroImpactLoading ? "Analyzing…" : "📊 Last CPI/NFP/FOMC impact"}
          </button>

          <button
            type="button"
            onClick={() => void copyTimingPrompt()}
            disabled={!data || loading}
            className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-900 hover:bg-violet-100 disabled:opacity-50"
            title="Copy: slot + weekday activity pattern"
          >
            {agentCopied === "timing" ? "✅ Copied" : "📋 Timing pattern"}
          </button>
          <button
            type="button"
            onClick={() => void saveTimingSnapshotToJournal("manual")}
            disabled={!data || loading}
            className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
            title="Save slots + weekdays snapshot to global journal (no coin)"
          >
            {agentCopied === "journal" ? "✅ Saved" : "📓 Save to journal"}
          </button>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

            {macroImpact && (macroImpact.tips?.length || macroImpact.meetings?.length || macroImpact.message) ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-amber-950">Macro impact · alts only</h2>
              <p className="text-[10px] text-amber-900/75">
                Latest meetings only (max 4). Details not kept forever — re-run after next print. Home uses short trivia.
              </p>
            </div>
            {macroImpact.generatedAt ? (
              <span className="text-[10px] text-amber-900/60">
                {new Date(macroImpact.generatedAt).toLocaleString(undefined, { timeZone: "Asia/Manila" })} MNL
              </span>
            ) : null}
          </div>
          {macroImpact.message && !(macroImpact.meetings && macroImpact.meetings.length) ? (
            <p className="text-xs text-amber-900">{macroImpact.message}</p>
          ) : null}

          {/* Mobile carousel · desktop compact grid */}
          {(macroImpact.meetings || []).length > 0 ? (
            <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-1 -mx-1 px-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:snap-none sm:pb-0 sm:px-0">
              {(macroImpact.meetings || []).map((m, i) => {
                const reg = m.regime24h || "mixed";
                const regCls =
                  reg === "risk-off"
                    ? "border-rose-300 bg-rose-50/90"
                    : reg === "risk-on"
                      ? "border-emerald-300 bg-emerald-50/90"
                      : "border-amber-200 bg-white";
                return (
                  <div
                    key={`${m.type}-${m.date}-${i}`}
                    className={`snap-center shrink-0 w-[min(88vw,18rem)] sm:w-auto sm:shrink rounded-lg border px-2.5 py-2 ${regCls}`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-amber-950">
                        {m.type}
                      </span>
                      <span className="font-mono text-[11px] font-bold">{m.date}</span>
                      <span className="text-[10px] font-bold uppercase text-slate-600">{reg}</span>
                    </div>
                    <p className="mt-1 text-[11px] font-semibold text-slate-800 line-clamp-2">{m.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-600">
                      24h ↓{m.downShare24h}% · avg {m.avgSigned24h}%
                      {m.downShare72h != null ? ` · 72h ↓${m.downShare72h}%` : ""}
                    </p>
                    {m.topMoves && m.topMoves.length > 0 ? (
                      <ul className="mt-1.5 space-y-0.5 text-[10px]">
                        {m.topMoves.slice(0, 4).map((c) => (
                          <li key={c.symbol} className="flex justify-between gap-2 tabular-nums">
                            <span className="truncate font-semibold text-slate-700">{c.name}</span>
                            <span
                              className={
                                (c.pct24h ?? 0) >= 0 ? "font-bold text-emerald-700" : "font-bold text-rose-700"
                              }
                            >
                              {c.pct24h != null
                                ? `${c.pct24h >= 0 ? "+" : ""}${c.pct24h.toFixed(1)}%`
                                : "—"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {(macroImpact.tips || []).length > 0 ? (
            <p className="text-[11px] text-amber-950/90 rounded-md border border-amber-100 bg-white/70 px-2 py-1.5">
              <span className="font-bold">Trivia · </span>
              {(macroImpact.tips || [])[0]}
            </p>
          ) : null}
        </div>
      ) : null}


      {loading && !data && (
        <p className="text-sm text-gray-500 py-8 text-center">Computing slot-to-slot swings…</p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {data.hottestSlot && (
              <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wide text-rose-800">
                  Hottest time
                </div>
                <div className="mt-1 text-sm font-bold text-rose-950 leading-snug">
                  {data.hottestSlot.label}
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-rose-900">
                  {data.hottestSlot.avgAbsPct}% avg
                </div>
              </div>
            )}
            {data.quietestSlot && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
                  Quietest time
                </div>
                <div className="mt-1 text-sm font-bold text-slate-900 leading-snug">
                  {data.quietestSlot.label}
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-slate-800">
                  {data.quietestSlot.avgAbsPct}% avg
                </div>
              </div>
            )}
            {data.hottestWeekday && (
              <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wide text-violet-800">
                  Hottest weekday
                </div>
                <div className="mt-1 text-sm font-bold text-violet-950">
                  {data.hottestWeekday.label}
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-violet-900">
                  {data.hottestWeekday.avgAbsPct}% avg
                </div>
                <p className="mt-1 text-[10px] text-violet-800/80">Be more aware this day</p>
              </div>
            )}
            {data.quietestWeekday && (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">
                  Quietest weekday
                </div>
                <div className="mt-1 text-sm font-bold text-emerald-950">
                  {data.quietestWeekday.label}
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-emerald-900">
                  {data.quietestWeekday.avgAbsPct}% avg
                </div>
              </div>
            )}
          </div>

          {(data.strongestUpSlot || data.strongestDownSlot) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data.strongestUpSlot && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                    Strongest avg UP window
                  </div>
                  <div className="mt-1 text-sm font-bold text-emerald-950">
                    {data.strongestUpSlot.label}
                  </div>
                  <div className="mt-1 font-mono text-sm font-bold text-emerald-800">
                    ↑{data.strongestUpSlot.avgUpPct}% · {data.strongestUpSlot.upSharePct}% of samples up
                  </div>
                </div>
              )}
              {data.strongestDownSlot && (
                <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-rose-800">
                    Strongest avg DOWN window
                  </div>
                  <div className="mt-1 text-sm font-bold text-rose-950">
                    {data.strongestDownSlot.label}
                  </div>
                  <div className="mt-1 font-mono text-sm font-bold text-rose-800">
                    ↓{data.strongestDownSlot.avgDownPct}% when falling
                  </div>
                </div>
              )}
            </div>
          )}

          {data.guidance.length > 0 && (
            <ul className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-4 py-3 text-[12px] text-indigo-950 space-y-1.5 list-disc list-inside">
              {data.guidance.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          )}

          {/* Buy / sell day patterns */}

          {(data.userFills && data.userFills.length > 0) && (
            <div className="rounded-xl border-2 border-slate-200 bg-white p-4 shadow-sm space-y-3">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  Your fills · path after (Manila · {data.days}d)
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-600">
                  Logged buys/sells in this window. Path % is vs fill price using 3h polls — not a scorecard guarantee.
                </p>
              </div>
              <div className="space-y-2">
                {data.userFills.map((f, i) => {
                  const pathCls = (v: number | null) => {
                    if (v == null) return "text-slate-500";
                    if (f.type === "buy") return v >= 0 ? "text-emerald-700" : "text-rose-700";
                    // sell: price down after sell is good
                    return v <= 0 ? "text-emerald-700" : "text-amber-700";
                  };
                  const fmt = (v: number | null) =>
                    v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
                  return (
                    <div
                      key={`${f.transactedAt}-${f.symbol}-${i}`}
                      className={`rounded-lg border px-3 py-2 text-[11px] ${
                        f.type === "buy"
                          ? "border-emerald-100 bg-emerald-50/40"
                          : "border-rose-100 bg-rose-50/40"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="font-bold text-slate-900">
                          {f.type === "buy" ? "BUY" : "SELL"} {f.name}{" "}
                          <span className="font-mono font-semibold text-slate-500">{f.symbol}</span>
                        </span>
                        <span className="text-slate-600">{f.manilaLabel} · {f.weekdayLabel}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-slate-700">
                        <span>
                          ₱{f.phpAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} @{" "}
                          {f.price}
                        </span>
                        <span className={pathCls(f.path24hPct)}>24h {fmt(f.path24hPct)}</span>
                        <span className={pathCls(f.path72hPct)}>72h {fmt(f.path72hPct)}</span>
                        <span className={pathCls(f.pathToLatestPct)}>
                          to now {fmt(f.pathToLatestPct)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {data.dayFlow && data.dayFlow.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-4">
              <div>
                <h2 className="text-sm font-bold text-gray-900">
                  Buy vs sell days (Manila · {data.days}d)
                </h2>
                <p className="mt-1 text-[11px] text-gray-500">
                  From your 3h polls: which weekdays the book more often rises (buy-lean) vs falls
                  (sell-lean), and which coins show that pattern most. Not a trade signal — monitor
                  only; confirm on Spot.
                </p>
              </div>

              <div className="space-y-2">
                {[...data.dayFlow].map((d) => {
                  const buyLean = d.upSharePct >= 52;
                  const sellLean = d.upSharePct <= 48;
                  return (
                    <div
                      key={d.day}
                      className={`rounded-md border px-3 py-2 ${
                        buyLean
                          ? "border-emerald-200 bg-emerald-50/50"
                          : sellLean
                            ? "border-rose-200 bg-rose-50/50"
                            : "border-slate-100 bg-slate-50/50"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-slate-900">{d.label}</span>
                        <span className="font-mono text-slate-800">
                          {d.upSharePct}% up · signed {d.avgSignedPct > 0 ? "+" : ""}
                          {d.avgSignedPct}%
                        </span>
                      </div>
                      {(d.topBuyLeanCoins.length > 0 || d.topSellLeanCoins.length > 0) && (
                        <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                          {d.topBuyLeanCoins.length > 0 && (
                            <div>
                              <span className="font-semibold text-emerald-800">Often up: </span>
                              {d.topBuyLeanCoins.map((c) => (
                                <span key={c.symbol} className="mr-2 text-slate-700">
                                  {c.name} ({c.upSharePct}%)
                                </span>
                              ))}
                            </div>
                          )}
                          {d.topSellLeanCoins.length > 0 && (
                            <div>
                              <span className="font-semibold text-rose-800">Often down: </span>
                              {d.topSellLeanCoins.map((c) => (
                                <span key={c.symbol} className="mr-2 text-slate-700">
                                  {c.name} ({c.upSharePct}%)
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="rounded-md border border-indigo-100 bg-indigo-50/30 p-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-[11px] font-bold text-indigo-950" htmlFor="pattern-coin">
                    Coin pattern
                  </label>
                  <select
                    id="pattern-coin"
                    value={patternCoin}
                    onChange={(e) => setPatternCoin(e.target.value)}
                    className="min-w-[10rem] flex-1 rounded-md border border-indigo-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-900"
                  >
                    <option value="">Select a coin…</option>
                    {(() => {
                      const fromTable = (data.coinWeekdayTable || []).map((c) => ({
                        symbol: c.symbol,
                        name: c.name,
                      }));
                      const map = new Map<string, { symbol: string; name: string }>();
                      for (const c of [...fromTable, ...coinOptions]) {
                        if (!c.symbol) continue;
                        map.set(c.symbol.toUpperCase(), {
                          symbol: c.symbol,
                          name: c.name || c.symbol,
                        });
                      }
                      return [...map.values()]
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((c) => (
                          <option key={c.symbol} value={c.symbol}>
                            {c.name} ({c.symbol})
                          </option>
                        ));
                    })()}
                  </select>
                </div>
                {(() => {
                  const row = (data.coinWeekdayTable || []).find(
                    (c) => c.symbol === patternCoin
                  );
                  if (!patternCoin) {
                    return (
                      <p className="text-[11px] text-slate-500">
                        Pick a coin to see which Manila weekdays it more often rises vs falls.
                      </p>
                    );
                  }
                  if (!row || row.days.length === 0) {
                    return (
                      <p className="text-[11px] text-slate-500">
                        Not enough samples for this coin in the window.
                      </p>
                    );
                  }
                  const bestBuy = [...row.days]
                    .filter((d) => d.lean === "buy-lean")
                    .sort((a, b) => b.upSharePct - a.upSharePct)[0];
                  const bestSell = [...row.days]
                    .filter((d) => d.lean === "sell-lean")
                    .sort((a, b) => a.upSharePct - b.upSharePct)[0];
                  return (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2 text-[11px]">
                        {bestBuy && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-900">
                            Most up: {bestBuy.dayLabel} ({bestBuy.upSharePct}%)
                          </span>
                        )}
                        {bestSell && (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-900">
                            Most down: {bestSell.dayLabel} ({bestSell.upSharePct}% up)
                          </span>
                        )}
                        {!bestBuy && !bestSell && (
                          <span className="text-slate-500">Mixed across weekdays — no strong lean.</span>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {row.days.map((d) => (
                          <div
                            key={d.day}
                            className={`flex flex-wrap items-center justify-between gap-2 rounded px-2 py-1.5 text-xs ${
                              d.lean === "buy-lean"
                                ? "bg-emerald-50 text-emerald-950"
                                : d.lean === "sell-lean"
                                  ? "bg-rose-50 text-rose-950"
                                  : "bg-white text-slate-800"
                            }`}
                          >
                            <span className="font-semibold">{d.dayLabel}</span>
                            <span className="font-mono">
                              {d.upSharePct}% up · signed {d.avgSignedPct > 0 ? "+" : ""}
                              {d.avgSignedPct}% · n={d.samples}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-slate-500">
                        Buy-lean ≥55% up · sell-lean ≤45% up · mixed otherwise. Confirm on Spot before
                        acting.
                      </p>
                    </div>
                  );
                })()}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.coinsBuyLean && data.coinsBuyLean.length > 0 && (
                  <div className="rounded-md border border-emerald-100 bg-emerald-50/40 p-3">
                    <h3 className="text-[11px] font-bold uppercase tracking-wide text-emerald-900">
                      Coins that most often rise on a day
                    </h3>
                    <ul className="mt-2 space-y-1.5 text-xs">
                      {data.coinsBuyLean.map((c) => (
                        <li key={`${c.symbol}-buy`} className="flex justify-between gap-2">
                          <span className="font-semibold text-slate-900">
                            {c.name}{" "}
                            <span className="font-normal text-slate-500">· {c.dayLabel}</span>
                          </span>
                          <span className="font-mono text-emerald-800 shrink-0">
                            {c.upSharePct}% up
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {data.coinsSellLean && data.coinsSellLean.length > 0 && (
                  <div className="rounded-md border border-rose-100 bg-rose-50/40 p-3">
                    <h3 className="text-[11px] font-bold uppercase tracking-wide text-rose-900">
                      Coins that most often fall on a day
                    </h3>
                    <ul className="mt-2 space-y-1.5 text-xs">
                      {data.coinsSellLean.map((c) => (
                        <li key={`${c.symbol}-sell`} className="flex justify-between gap-2">
                          <span className="font-semibold text-slate-900">
                            {c.name}{" "}
                            <span className="font-normal text-slate-500">· {c.dayLabel}</span>
                          </span>
                          <span className="font-mono text-rose-800 shrink-0">
                            {c.upSharePct}% up
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Weekday section */}
          {data.weekdays && data.weekdays.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-gray-900">
                  Weekday activity ({data.days} days · Manila)
                </h2>
                <button
                  type="button"
                  onClick={() => void copyWeekdaysSnapshot()}
                  className="rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-900 hover:bg-violet-100"
                >
                  {agentCopied === "weekdays" ? "✅ Copied" : "📋 Copy weekdays"}
                </button>
              </div>
              <p className="text-[11px] text-gray-500 mb-4">
                |move| by Manila weekday. ↑ / ↓ = average up vs down size; % up = how often price
                rose into the next print. Use to plan attention — not automatic buys.
              </p>
              <div className="space-y-3">
                {[...data.weekdays]
                  .sort((a, b) => b.avgAbsPct - a.avgAbsPct)
                  .map((wd) => {
                    const style = INTENSITY_STYLES[wd.intensity];
                    const widthPct = Math.max(6, (wd.avgAbsPct / maxDayAvg) * 100);
                    return (
                      <div key={wd.day} className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold ${style.badge}`}
                            >
                              #{wd.rank} {style.label}
                            </span>
                            <span className="font-semibold text-gray-900">{wd.label}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-gray-600 shrink-0 justify-end">
                            <span className="font-mono font-bold text-gray-900">
                              {wd.avgAbsPct}% |move|
                            </span>
                            {wd.avgUpPct != null && (
                              <span className="font-mono text-emerald-700 font-semibold">
                                ↑{wd.avgUpPct}%
                              </span>
                            )}
                            {wd.avgDownPct != null && (
                              <span className="font-mono text-rose-700 font-semibold">
                                ↓{wd.avgDownPct}%
                              </span>
                            )}
                            {wd.upSharePct != null && (
                              <span className="hidden sm:inline text-[10px] text-slate-500">
                                {wd.upSharePct}% up
                              </span>
                            )}
                            <span className="hidden md:inline">med {wd.medianAbsPct}%</span>
                            <span className="text-gray-400">{wd.sampleCount} samples</span>
                          </div>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${style.bar} transition-all`}
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Time-of-day section */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-gray-900">
                Poll windows ranked by activity ({data.days} days)
              </h2>
              <button
                type="button"
                onClick={() => void copySlotsSnapshot()}
                className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-900 hover:bg-indigo-100"
              >
                {agentCopied === "slots" ? "✅ Copied" : "📋 Copy poll windows"}
              </button>
            </div>
            <p className="text-[11px] text-gray-500 mb-4">
              |move| = avg absolute change into this slot. ↑ avg up size · ↓ avg down size · % up = share of rising prints. Watch windows only — not entry signals.
            </p>
            <div className="space-y-3">
              {[...data.slots]
                .sort((a, b) => b.avgAbsPct - a.avgAbsPct)
                .map((slot) => {
                  const style = INTENSITY_STYLES[slot.intensity];
                  const widthPct = Math.max(6, (slot.avgAbsPct / maxSlotAvg) * 100);
                  return (
                    <div key={slot.hour} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold ${style.badge}`}
                          >
                            #{slot.rank} {style.label}
                          </span>
                          <span className="font-semibold text-gray-900 truncate">{slot.label}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-gray-600 shrink-0 justify-end">
                          <span className="font-mono font-bold text-gray-900">
                            {slot.avgAbsPct}% |move|
                          </span>
                          {slot.avgUpPct != null && (
                            <span className="font-mono text-emerald-700 font-semibold">
                              ↑{slot.avgUpPct}%
                            </span>
                          )}
                          {slot.avgDownPct != null && (
                            <span className="font-mono text-rose-700 font-semibold">
                              ↓{slot.avgDownPct}%
                            </span>
                          )}
                          {slot.upSharePct != null && (
                            <span className="hidden sm:inline text-[10px] text-slate-500">
                              {slot.upSharePct}% up
                            </span>
                          )}
                          <span className="hidden md:inline">med {slot.medianAbsPct}%</span>
                          <span className="hidden md:inline">≥1%: {slot.pctMovesAbove1}%</span>
                          <span className="text-gray-400">{slot.sampleCount} samples</span>
                        </div>
                      </div>
                      <div className="h-2.5 w-full rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${style.bar} transition-all`}
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          <p className="text-[11px] text-gray-400">
            Data as of{" "}
            {new Date(data.generatedAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {refreshedAt && (
              <>
                {" "}
                · last refresh{" "}
                {new Date(refreshedAt).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </>
            )}{" "}
            · consecutive polls ≤5h apart · Manila time/day
            {data.fromCache ? " · cached" : " · freshly computed"}
            {loading && <span className="text-indigo-600"> · updating…</span>}
          </p>
        </>
      )}
    </div>
  );
}
