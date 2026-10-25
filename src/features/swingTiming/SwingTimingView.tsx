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


function formatTimingPatternPrompt(data: TimingResponse): string {
  const lines: string[] = [];
  lines.push(
    `You are a neutral research assistant for a Philippines **spot LONG-only** PHP crypto trader (Coins.ph / Maya style — no shorting, no leverage).`
  );
  lines.push(``);
  lines.push(`## Goal`);
  lines.push(
    `Interpret our **poll-timing pattern** (3h checks) so the trader knows when to watch vs ignore noise. This is **not** a buy signal.`
  );
  lines.push(``);
  lines.push(`## How our data is built`);
  lines.push(
    `- Prices polled ~**8× per day** Manila: 02:05, 05:05, 08:05, 11:05, 14:05, 17:05, 20:05, 23:05.`
  );
  lines.push(
    `- Move = absolute % change between consecutive polls ≤5h apart (activity / liquidity timing).`
  );
  lines.push(`- Window: last **${data.days} days**. Generated: ${data.generatedAt}.`);
  lines.push(``);
  lines.push(`## Slot activity (${data.days} days · Manila)`);
  if (data.hottestSlot) {
    lines.push(
      `- Hottest slot: **${data.hottestSlot.label}** — avg |move| ${data.hottestSlot.avgAbsPct}%, median ${data.hottestSlot.medianAbsPct}%, >1% moves ${data.hottestSlot.pctMovesAbove1}%, n=${data.hottestSlot.sampleCount}.`
    );
  }
  if (data.quietestSlot) {
    lines.push(
      `- Quietest slot: **${data.quietestSlot.label}** — avg |move| ${data.quietestSlot.avgAbsPct}%.`
    );
  }
  lines.push(`- Full ranking (hot → quiet):`);
  for (const s of [...data.slots].sort((a, b) => a.rank - b.rank)) {
    lines.push(
      `  ${s.rank}. ${s.label} — avg ${s.avgAbsPct}% · med ${s.medianAbsPct}% · >1% ${s.pctMovesAbove1}% · ${s.intensity} · samples ${s.sampleCount}`
    );
  }
  lines.push(``);
  lines.push(`## Weekday activity (${data.days} days · Manila)`);
  if (data.hottestWeekday) {
    lines.push(
      `- Hottest weekday: **${data.hottestWeekday.label}** — avg |move| ${data.hottestWeekday.avgAbsPct}%, >1% ${data.hottestWeekday.pctMovesAbove1}%.`
    );
  }
  if (data.quietestWeekday) {
    lines.push(
      `- Quietest weekday: **${data.quietestWeekday.label}** — avg |move| ${data.quietestWeekday.avgAbsPct}%.`
    );
  }
  if (data.weekdays?.length) {
    lines.push(`- Full ranking (hot → quiet):`);
    for (const w of [...data.weekdays].sort((a, b) => a.rank - b.rank)) {
      lines.push(
        `  ${w.rank}. ${w.label} — avg ${w.avgAbsPct}% · med ${w.medianAbsPct}% · >1% ${w.pctMovesAbove1}% · ${w.intensity} · samples ${w.sampleCount}`
      );
    }
  } else {
    lines.push(`- No weekday breakdown available.`);
  }
  lines.push(``);
  if (data.topMoversByHotSlot?.length && data.hottestSlot) {
    lines.push(`## Most active coins in hottest window (${data.hottestSlot.label})`);
    for (const c of data.topMoversByHotSlot.slice(0, 10)) {
      lines.push(`- ${c.name} (${c.symbol}): avg |move| ${c.avgAbsPct}% · samples ${c.samples}`);
    }
    lines.push(``);
  }
  if (data.guidance?.length) {
    lines.push(`## App notes`);
    for (const g of data.guidance) lines.push(`- ${g}`);
    lines.push(``);
  }
  lines.push(`## Rules`);
  lines.push(`- Be neutral. Do not force a long.`);
  lines.push(`- Do not invent news. Timing ≠ entry signal.`);
  lines.push(`- Spot only — no short / no leverage.`);
  lines.push(``);
  lines.push(`## Answer format`);
  lines.push(`1. **Pattern read** (session-driven vs noise vs thin data)`);
  lines.push(`2. **Which Manila slots / weekdays** deserve attention`);
  lines.push(`3. **Practical watch plan** for a spot buyer`);
  lines.push(`4. **Recheck by** (date)`);
  return lines.join("\n");
}

function formatMacroWatchAgentPrompt(macroLines: string[]): string {
  const lines: string[] = [];
  lines.push(
    `You are a neutral research assistant for a Philippines **spot LONG-only** PHP crypto trader.`
  );
  lines.push(``);
  lines.push(`## Goal`);
  lines.push(
    `Validate and enrich the **Macro watch** calendar below (Fed, CPI, PCE, NFP, and any manual notes). Help the trader know what can shake crypto and when (Manila time).`
  );
  lines.push(``);
  lines.push(`## Macro watch — upcoming dates already in our app`);
  lines.push(
    `From Home → Macro watch. Validate times; do **not** invent dates. Mark stale or wrong items.`
  );
  lines.push(``);
  if (macroLines.length) {
    for (const L of macroLines) lines.push(`- ${L}`);
  } else {
    lines.push(`- (No events loaded from the app.)`);
  }
  lines.push(``);
  lines.push(`## Rules`);
  lines.push(`- Be neutral. Do not lean bullish without evidence.`);
  lines.push(`- Do **not** invent news. Do **NOT** use training-memory headlines (often stale).`);
  lines.push(`- Unverified → "none verified".`);
  lines.push(`- Philippines / Manila context for “when to watch”.`);
  lines.push(``);
  lines.push(`## Answer format`);
  lines.push(`1. **Calendar audit** — keep / fix time / stale (per item above)`);
  lines.push(`2. **Any missing high-impact macro** next 14 days (verified only)`);
  lines.push(`3. **Manila watch windows** around each high-priority event`);
  lines.push(`4. **Recheck by** (date)`);
  return lines.join("\n");
}

async function loadMacroLinesFromApp(): Promise<string[]> {
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

  const macroLines: string[] = [];
  if (!macroLog?.response) return macroLines;

  try {
    let raw = String(macroLog.response).trim();
    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : [];
    arr.sort((a: { date?: string }, b: { date?: string }) =>
      String(a.date || "").localeCompare(String(b.date || ""))
    );
    for (const e of arr) {
      const date = String(e.date || "").slice(0, 10);
      const title = (e.title || "").trim();
      const key = `${date}|${title.toLowerCase()}`;
      if (deletedKeys.has(key)) continue;
      const bits = [
        date || "?",
        e.type || "OTHER",
        e.severity === "high" ? "HIGH" : e.severity || "",
        title,
      ].filter(Boolean);
      let line = bits.join(" · ");
      if (e.timeET) line += ` · ${e.timeET} ET`;
      if (e.manilaTimeLabel) line += ` · ${e.manilaTimeLabel}`;
      if (e.coinSymbol) line += ` · coin ${e.coinSymbol}`;
      if (e.detail) line += ` — ${String(e.detail).slice(0, 180)}`;
      if (e.source === "manual") line += " [manual]";
      macroLines.push(line);
    }
  } catch {
    macroLines.push("(Macro watch response could not be parsed)");
  }
  return macroLines;
}

export default function SwingTimingView() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TimingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [agentCopied, setAgentCopied] = useState<"timing" | "macro" | null>(null);

  const copyTimingPrompt = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(formatTimingPatternPrompt(data));
      setAgentCopied("timing");
      setTimeout(() => setAgentCopied(null), 2000);
    } catch {
      setError("Could not copy timing prompt");
    }
  };

  const copyMacroPrompt = async () => {
    try {
      const macroLines = await loadMacroLinesFromApp();
      await navigator.clipboard.writeText(formatMacroWatchAgentPrompt(macroLines));
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
