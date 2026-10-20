import { useCallback, useEffect, useMemo, useState } from "react";
import {
  attachManilaFields,
  extractJsonArray,
  sortEventsChronologically,
  type MacroEvent,
} from "@/lib/macroEvents";

const PROMPT_ID = "macro-calendar-events";

const CALENDAR_PROMPT =
  "Build a trader event calendar for THIS month and NEXT month. Include only dates you can verify from search: US CPI, Core PCE, NFP (jobs), FOMC decision + press conference, major equity/crypto options expiries if found. For each: date, time (ET), severity (high/medium), 1-line why it can move BTC/alts. Output JSON array of events with fields title, date, type, severity, timeET. Do NOT invent dates. RULES: Stay on macro calendar only. Prefer forward-looking risk for crypto. Do not invent calendar dates.";

const SEARCH_QUERY =
  "US economic calendar CPI PCE NFP FOMC jobs report schedule this month next month";

function typeBadge(type: string): string {
  switch (type) {
    case "FOMC":
      return "bg-rose-100 text-rose-800 border-rose-200";
    case "CPI":
    case "PCE":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "NFP":
      return "bg-violet-100 text-violet-900 border-violet-200";
    case "EXPIRY":
      return "bg-sky-100 text-sky-900 border-sky-200";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

function parseEvents(raw: string): MacroEvent[] {
  try {
    const events = attachManilaFields(extractJsonArray(raw));
    return sortEventsChronologically(events);
  } catch {
    return [];
  }
}

/** Upcoming US macro that tends to shake crypto — Fed, CPI, jobs, etc. */
export default function HomeMacroWatch() {
  const [events, setEvents] = useState<MacroEvent[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCache = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/catalyst-ai");
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = (await res.json()) as {
        logs?: Record<string, { timestamp: number; response: string }>;
      };
      const log = data.logs?.[PROMPT_ID];
      if (log?.response) {
        setEvents(parseEvents(log.response));
        setUpdatedAt(log.timestamp);
      } else {
        setEvents([]);
        setUpdatedAt(null);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCache();
  }, [loadCache]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/catalyst-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptId: PROMPT_ID,
          prompt: CALENDAR_PROMPT,
          searchQuery: SEARCH_QUERY,
          category: "Macro",
          searchProfile: "authoritative",
          responseFormat: "json",
          forceRefresh: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Refresh failed (${res.status})`);
      if (data.response) {
        setEvents(parseEvents(data.response));
        setUpdatedAt(Date.now());
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const upcoming = useMemo(() => {
    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    // Prefer Manila date when present for "is it still ahead"
    return events
      .filter((e) => {
        const key = e.manilaDateKey || e.date;
        return key >= todayKey.slice(0, 10) || e.date >= todayKey;
      })
      .slice(0, 8);
  }, [events]);

  // Fallback: show soonest 6 from full list if filter empty but we have data
  const display = upcoming.length > 0 ? upcoming : events.slice(0, 6);

  return (
    <section className="mb-6 rounded-lg border border-indigo-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-indigo-900 flex items-center gap-2">
            📅 Macro watch
            <span className="normal-case font-normal text-[11px] text-slate-500 tracking-normal">
              Was Catalysts · Fed · CPI · jobs (NFP) · what can shake crypto
            </span>
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "↻ Refresh dates"}
        </button>
      </div>

      {error && (
        <p className="mb-2 text-xs text-rose-600">{error}</p>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : display.length === 0 ? (
        <p className="text-xs text-slate-500 py-2">
          No calendar loaded yet. Click <span className="font-semibold">Refresh dates</span> to
          pull verified FOMC / CPI / NFP (jobs) schedule. Spot coin research is separate — use Spot
          review when you need a single coin.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {display.map((evt, i) => {
            const high =
              evt.severity === "high" ||
              evt.type === "FOMC" ||
              /FOMC|CPI|NFP|jobs/i.test(evt.title);
            return (
              <div
                key={`${evt.date}-${evt.title}-${i}`}
                className={`rounded-lg border px-3 py-2.5 ${
                  high
                    ? "border-rose-200 bg-rose-50/50"
                    : "border-slate-100 bg-slate-50/80"
                }`}
              >
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${typeBadge(evt.type)}`}
                  >
                    {evt.type}
                  </span>
                  {high && (
                    <span className="text-[10px] font-bold uppercase text-rose-700">High impact</span>
                  )}
                </div>
                <div className="text-sm font-semibold text-slate-900 leading-snug">{evt.title}</div>
                <div className="mt-1 text-[11px] text-slate-600">
                  {evt.manilaDateKey || evt.date}
                  {evt.manilaTimeLabel
                    ? ` · ${evt.manilaTimeLabel}`
                    : evt.timeET
                      ? ` · ${evt.timeET} ET`
                      : ""}
                  <span className="text-slate-400"> · Manila when labeled</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {updatedAt && (
        <p className="mt-2 text-[10px] text-slate-400">
          Calendar updated{" "}
          {new Date(updatedAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      )}
    </section>
  );
}
