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

type TimingResponse = {
  days: number;
  generatedAt: string;
  slots: SlotStat[];
  weekdays: WeekdayStat[];
  hottestSlot: SlotStat | null;
  quietestSlot: SlotStat | null;
  hottestWeekday: WeekdayStat | null;
  quietestWeekday: WeekdayStat | null;
  topMoversByHotSlot: CoinSlotHighlight[];
  /** Biggest movers last ~2 days only */
  topMovers2d?: Coin2dMover[];
  guidance: string[];
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
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TimingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [agentCopied, setAgentCopied] = useState<"timing" | "macro" | "why" | null>(null);
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

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      // cache-bust so Refresh always hits the API
      const res = await fetch(`/api/swing-timing?days=${d}&_=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const json: TimingResponse = await res.json();
      setData(json);
      setRefreshedAt(new Date().toISOString());
    } catch (err) {
      setError((err as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
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
            Which of your <span className="font-semibold">~3h poll windows</span> and{" "}
            <span className="font-semibold">weekdays</span> usually move the most across monitored
            coins. Use this to know when to watch vs stage limits — not as a buy signal. Confirm on{" "}
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
          {[14, 30, 60].map((d) => (
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
            onClick={() => void load(days)}
            disabled={loading}
            className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
            title="Recompute from latest poll history"
          >
            {loading ? "Refreshing…" : "↻ Refresh"}
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
            onClick={() => void copyMacroPrompt()}
            className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-900 hover:bg-indigo-100"
            title="Copy: Macro watch calendar for agent validation"
          >
            {agentCopied === "macro" ? "✅ Copied" : "📋 Macro watch"}
          </button>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

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

          {data.guidance.length > 0 && (
            <ul className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-4 py-3 text-[12px] text-indigo-950 space-y-1.5 list-disc list-inside">
              {data.guidance.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          )}

          {/* Weekday section */}
          {data.weekdays && data.weekdays.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 mb-1">
                Weekday activity ({data.days} days · Manila)
              </h2>
              <p className="text-[11px] text-gray-500 mb-4">
                Average |% move| from the previous poll → this print, grouped by calendar day in
                Manila. Higher = more swing to monitor that day of the week.
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
                          <div className="flex items-center gap-3 text-gray-600 shrink-0">
                            <span className="font-mono font-bold text-gray-900">
                              {wd.avgAbsPct}% avg
                            </span>
                            <span className="hidden sm:inline">med {wd.medianAbsPct}%</span>
                            <span className="hidden md:inline">≥1%: {wd.pctMovesAbove1}%</span>
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
            <h2 className="text-sm font-bold text-gray-900 mb-1">
              Poll windows ranked by activity ({data.days} days)
            </h2>
            <p className="text-[11px] text-gray-500 mb-4">
              |% change| from the previous poll to this slot, averaged across all monitored coins.
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
                        <div className="flex items-center gap-3 text-gray-600 shrink-0">
                          <span className="font-mono font-bold text-gray-900">
                            {slot.avgAbsPct}% avg
                          </span>
                          <span className="hidden sm:inline">med {slot.medianAbsPct}%</span>
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


          <div className="rounded-lg border-2 border-teal-200 bg-teal-50/30 p-4 shadow-sm">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-teal-950">2d · biggest movers</h2>
                <p className="text-[11px] text-teal-900/80 mt-0.5">
                  Ranked by total |%| move over the <span className="font-semibold">last ~2 days only</span>
                  — not the 14/30/60 hot-slot list. Use for latest-news checks.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void copyWhyMovingPrompt()}
                disabled={!data || recentPollsLoading}
                className="rounded-md border border-teal-400 bg-teal-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {agentCopied === "why" ? "✅ Copied" : "📋 Why moving (2d)"}
              </button>
            </div>
            <p className="text-[11px] text-gray-600 mb-2">
              Path tiles = last ~16 Manila 3h prints for the 2d biggest movers. Green/red = up/down vs prior
              print.
            </p>
            {data.topMovers2d && data.topMovers2d.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {data.topMovers2d.map((m, i) => (
                  <span
                    key={m.symbol}
                    className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-teal-900"
                    title={`total |path| ${m.totalAbsPct}% · net ${m.netPct}%`}
                  >
                    <span className="text-teal-500">#{i + 1}</span>
                    {m.symbol.replace(/PHP$/i, "")}
                    <span
                      className={
                        m.netPct > 0 ? "text-emerald-600" : m.netPct < 0 ? "text-rose-600" : "text-gray-500"
                      }
                    >
                      {m.netPct >= 0 ? "+" : ""}
                      {m.netPct.toFixed(1)}%
                    </span>
                  </span>
                ))}
              </div>
            )}
            {recentPollsLoading ? (
              <p className="text-xs text-gray-400">Loading 3h series…</p>
            ) : recentPolls.length === 0 ? (
              <p className="text-xs text-gray-500">No 3h series available yet.</p>
            ) : (
              <div className="space-y-3 max-h-72 overflow-y-auto">
                {recentPolls.map((s) => (
                  <div key={s.symbol}>
                    <div className="text-xs font-bold text-indigo-900 mb-1 font-mono">{s.symbol}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {s.points.map((pt, i) => {
                        const prev = i > 0 ? s.points[i - 1].price : null;
                        const up = prev != null && pt.price > prev * 1.0005;
                        const down = prev != null && pt.price < prev * 0.9995;
                        return (
                          <div
                            key={`${pt.day}-${pt.slotLabel}-${i}`}
                            className={`rounded-md border px-1.5 py-1 text-center min-w-[4.25rem] ${
                              up
                                ? "border-emerald-200 bg-emerald-50"
                                : down
                                  ? "border-rose-200 bg-rose-50"
                                  : "border-gray-100 bg-gray-50"
                            }`}
                          >
                            <div className="text-[9px] font-semibold text-gray-500">
                              {pt.day.slice(5)} {pt.slotLabel}
                            </div>
                            <div className="text-[11px] font-bold tabular-nums text-gray-900">
                              {pt.price}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {data.topMoversByHotSlot.length > 0 && data.hottestSlot && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 mb-1">
                Most active coins in the hottest window
              </h2>
              <p className="text-[11px] text-gray-500 mb-3">
                {data.hottestSlot.label} — coins with the largest average |move| into that slot
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {data.topMoversByHotSlot.map((c) => (
                  <Link
                    key={c.symbol}
                    href={`/structure?symbol=${encodeURIComponent(c.symbol)}`}
                    className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2 text-xs hover:border-indigo-300 hover:bg-indigo-50/40 transition"
                  >
                    <span className="font-semibold text-gray-900">
                      {c.name}{" "}
                      <span className="font-normal text-gray-400">({c.symbol})</span>
                    </span>
                    <span className="font-mono font-bold text-indigo-800">{c.avgAbsPct}%</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

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
            {loading && <span className="text-indigo-600"> · updating…</span>}
          </p>
        </>
      )}
    </div>
  );
}
