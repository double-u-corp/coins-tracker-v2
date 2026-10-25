import { useCallback, useEffect, useMemo, useState } from "react";
import {
  attachManilaFields,
  extractJsonArray,
  sortEventsChronologically,
  type MacroEvent,
} from "@/lib/macroEvents";

const PROMPT_ID = "macro-calendar-events";
const META_ID = "macro-calendar-meta";

const CALENDAR_PROMPT =
  "Build a trader event calendar for THIS month and NEXT month. Include only dates you can verify from search: US CPI, Core PCE, NFP (jobs), FOMC decision + press conference, major equity/crypto options expiries if found. For each: date, time (ET), severity (high/medium), 1-line why it can move BTC/alts. Output JSON array of events with fields title, date, type, severity, timeET. Do NOT invent dates. RULES: Stay on macro calendar only. Prefer forward-looking risk for crypto. Do not invent calendar dates.";

const SEARCH_QUERY =
  "US economic calendar CPI PCE NFP FOMC jobs report schedule this month next month";

type HistorySnap = { at: number; eventCount: number; events: MacroEvent[] };

type MetaStore = {
  version: 1;
  deletedKeys: string[];
  history: HistorySnap[];
};

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

function eventKey(e: MacroEvent): string {
  return `${String(e.date).slice(0, 10)}|${(e.title || "").trim().toLowerCase()}`;
}

function parseEvents(raw: string): MacroEvent[] {
  try {
    const events = attachManilaFields(extractJsonArray(raw));
    return sortEventsChronologically(events);
  } catch {
    return [];
  }
}

function parseMeta(raw: string | undefined): MetaStore {
  if (!raw) return { version: 1, deletedKeys: [], history: [] };
  try {
    const j = JSON.parse(raw);
    return {
      version: 1,
      deletedKeys: Array.isArray(j.deletedKeys) ? j.deletedKeys.map(String) : [],
      history: Array.isArray(j.history)
        ? j.history
            .map((h: HistorySnap) => ({
              at: Number(h.at) || 0,
              eventCount: Number(h.eventCount) || (Array.isArray(h.events) ? h.events.length : 0),
              events: Array.isArray(h.events) ? h.events : [],
            }))
            .filter((h: HistorySnap) => h.at > 0)
        : [],
    };
  } catch {
    return { version: 1, deletedKeys: [], history: [] };
  }
}

function mergeEvents(existing: MacroEvent[], incoming: MacroEvent[], deleted: Set<string>): MacroEvent[] {
  const map = new Map<string, MacroEvent>();
  for (const e of existing) {
    const k = eventKey(e);
    if (deleted.has(k)) continue;
    map.set(k, e);
  }
  for (const e of incoming) {
    const k = eventKey(e);
    if (deleted.has(k)) continue;
    map.set(k, e); // newer scan wins same key
  }
  return sortEventsChronologically([...map.values()]);
}

/** Upcoming US macro that tends to shake crypto — Fed, CPI, jobs, etc. */
export default function HomeMacroWatch() {
  const [events, setEvents] = useState<MacroEvent[]>([]);
  const [meta, setMeta] = useState<MetaStore>({ version: 1, deletedKeys: [], history: [] });
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const saveEvents = async (next: MacroEvent[]) => {
    await fetch("/api/catalyst-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        promptId: PROMPT_ID,
        prompt: "persist",
        category: "Daily",
        forceRefresh: true,
        responseFormat: "json",
        // bypass AI: store raw JSON by using a special path - catalyst-ai always calls AI
        // So we use a direct upsert via watchlist-style: actually catalyst-ai always regenerates.
        // We'll POST the events as the "prompt" only if API supports raw - it doesn't.
      }),
    });
  };

  // Persist via dedicated helper endpoints using catalyst-ai force with precomputed - 
  // Better: save through a small local API pattern using GET logs + we need write.
  // Use /api/catalyst-ai only for AI refresh; for merge persist we call a light path.

  const persistMerged = async (merged: MacroEvent[], nextMeta: MetaStore) => {
    // Store events as JSON string by forceRefresh with response already known -
    // catalyst-ai always hits Tavily. Use prisma via a simple POST body hack:
    // POST /api/catalyst-ai/store is ideal but doesn't exist.
    // Work around: use watchlist-news style catalystLog upsert via existing POST with forceRefresh
    // and put merged JSON in searchQuery? No.
    //
    // Practical approach: call catalyst-ai with forceRefresh false after AI returns,
    // then client-side we need server store. Add POST body `rawResponse` optional.
    //
    // Minimal change: extend catalyst-ai - for now write META via second promptId
    // and events via forceRefresh AI only merges on client after AI, then
    // POST with forceRefresh true including special flag storeOnly.

    const res = await fetch("/api/catalyst-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        promptId: PROMPT_ID,
        prompt: CALENDAR_PROMPT,
        searchQuery: SEARCH_QUERY,
        category: "Daily",
        searchProfile: "authoritative",
        forceRefresh: true,
        responseFormat: "json",
        storeOnly: JSON.stringify(merged),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Save failed (${res.status})`);
    }

    const metaRes = await fetch("/api/catalyst-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        promptId: META_ID,
        prompt: "meta",
        category: "Daily",
        forceRefresh: true,
        responseFormat: "json",
        storeOnly: JSON.stringify(nextMeta),
      }),
    });
    if (!metaRes.ok) {
      console.warn("macro meta save failed");
    }
  };

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
      const metaLog = data.logs?.[META_ID];
      const m = parseMeta(metaLog?.response);
      setMeta(m);
      if (log?.response) {
        const deleted = new Set(m.deletedKeys);
        const parsed = parseEvents(log.response).filter((e) => !deleted.has(eventKey(e)));
        setEvents(parsed);
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

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/catalyst-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptId: `${PROMPT_ID}-fresh`,
          prompt: CALENDAR_PROMPT,
          searchQuery: SEARCH_QUERY,
          category: "Daily",
          searchProfile: "authoritative",
          forceRefresh: true,
          responseFormat: "json",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Refresh failed (${res.status})`);

      const incoming = parseEvents(typeof data.response === "string" ? data.response : "[]");
      const deleted = new Set(meta.deletedKeys);
      const merged = mergeEvents(events, incoming, deleted);

      const snap: HistorySnap = {
        at: Date.now(),
        eventCount: incoming.length,
        events: incoming,
      };
      const nextMeta: MetaStore = {
        version: 1,
        deletedKeys: meta.deletedKeys,
        history: [snap, ...meta.history].slice(0, 12),
      };

      await persistMerged(merged, nextMeta);
      setEvents(merged);
      setMeta(nextMeta);
      setUpdatedAt(Date.now());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const deleteHistorySnap = async (at: number) => {
    const nextMeta: MetaStore = {
      ...meta,
      history: meta.history.filter((h) => h.at !== at),
    };
    setMeta(nextMeta);
    try {
      await persistMerged(events, nextMeta);
    } catch (err) {
      setError((err as Error).message);
      void loadCache();
    }
  };

  const clearAllHistory = async () => {
    const nextMeta: MetaStore = { ...meta, history: [] };
    setMeta(nextMeta);
    try {
      await persistMerged(events, nextMeta);
    } catch (err) {
      setError((err as Error).message);
      void loadCache();
    }
  };

  const deleteEvent = async (evt: MacroEvent) => {
    const key = eventKey(evt);
    const nextEvents = events.filter((e) => eventKey(e) !== key);
    const nextMeta: MetaStore = {
      ...meta,
      deletedKeys: meta.deletedKeys.includes(key)
        ? meta.deletedKeys
        : [...meta.deletedKeys, key].slice(-200),
    };
    setEvents(nextEvents);
    setMeta(nextMeta);
    try {
      await persistMerged(nextEvents, nextMeta);
    } catch (err) {
      setError((err as Error).message);
      void loadCache();
    }
  };

  const display = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return events.filter((e) => {
      const d = new Date(e.date);
      if (Number.isNaN(d.getTime())) return true;
      return d.getTime() >= today.getTime() - 86400000;
    });
  }, [events]);

  return (
    <div className="mb-6 rounded-lg border border-indigo-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-indigo-900 flex items-center gap-2">
            📅 Macro watch
            <span className="normal-case font-normal text-[11px] text-slate-500 tracking-normal">
              Fed · CPI · jobs (NFP) · verified dates only
            </span>
          </h2>
          {updatedAt && (
            <p className="text-[11px] text-slate-400 mt-0.5">
              Updated {new Date(updatedAt).toLocaleString(undefined, { timeZone: "Asia/Manila" })}{" "}
              Manila
              {meta.deletedKeys.length > 0 && (
                <span className="ml-2">· {meta.deletedKeys.length} hidden (kept on rescan)</span>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {showHistory ? "Hide history" : `History (${meta.history.length})`}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "↻ Refresh dates"}
          </button>
        </div>
      </div>

      {error && <p className="mb-2 text-xs text-rose-600">{error}</p>}

      {showHistory && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 max-h-56 overflow-y-auto">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-bold text-slate-600">
              Past scan snapshots · Refresh only appends calendar dates
            </p>
            {meta.history.length > 0 && (
              <button
                type="button"
                onClick={() => void clearAllHistory()}
                className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 hover:bg-rose-100"
              >
                Clear all history
              </button>
            )}
          </div>
          {meta.history.length === 0 ? (
            <p className="text-xs text-slate-500">No history yet — run Refresh once.</p>
          ) : (
            <ul className="space-y-2">
              {meta.history.map((h) => (
                <li
                  key={h.at}
                  className="flex gap-2 items-start text-xs text-slate-700 border-b border-slate-100 pb-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold">
                      {new Date(h.at).toLocaleString(undefined, { timeZone: "Asia/Manila" })}
                    </span>
                    <span className="text-slate-500"> · {h.eventCount} events from scan</span>
                    <div className="mt-0.5 text-[10px] text-slate-500 line-clamp-2">
                      {h.events
                        .slice(0, 4)
                        .map((e) => `${String(e.date).slice(0, 10)} ${e.title}`)
                        .join(" · ")}
                      {h.events.length > 4 ? "…" : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteHistorySnap(h.at)}
                    className="shrink-0 rounded border border-rose-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-rose-600 hover:bg-rose-50"
                    title="Delete this snapshot"
                  >
                    🗑
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
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
          pull verified FOMC / CPI / NFP (jobs) schedule.
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
                className={`rounded-lg border px-3 py-2.5 relative ${
                  high ? "border-rose-200 bg-rose-50/50" : "border-slate-100 bg-slate-50/80"
                }`}
              >
                <button
                  type="button"
                  onClick={() => void deleteEvent(evt)}
                  className="absolute top-1.5 right-1.5 rounded border border-rose-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-rose-600 hover:bg-rose-50"
                  title="Remove this date (manual only — will not return on later scans)"
                >
                  ✕
                </button>
                <div className="flex items-center gap-1.5 flex-wrap mb-1 pr-6">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${typeBadge(evt.type)}`}
                  >
                    {evt.type}
                  </span>
                  {high && (
                    <span className="rounded border border-rose-300 bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">
                      HIGH
                    </span>
                  )}
                </div>
                <div className="text-sm font-bold text-slate-900 leading-snug">{evt.title}</div>
                <div className="mt-1 text-[11px] font-semibold text-slate-600">
                  {String(evt.date).slice(0, 10)}
                  {evt.timeET ? ` · ${evt.timeET} ET` : ""}
                  {evt.manilaTimeLabel ? ` · ${evt.manilaTimeLabel}` : ""}
                </div>
                {evt.severity === "high" && (
                  <p className="mt-1 text-[11px] text-rose-700/80">High impact for crypto risk</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
