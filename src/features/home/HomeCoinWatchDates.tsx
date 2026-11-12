import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CoinWatchLabel } from "@/lib/coinWatchDates";

type StoredEvent = {
  id: string;
  symbol: string | null;
  coinId: number | null;
  date: string;
  label: CoinWatchLabel | string;
  description: string;
  journalEntryId: number;
  journalTitle?: string;
  sourceLine?: string;
  createdAt?: string;
};

type CoinMini = { symbol: string; name?: string };

function labelBadge(label: string): string {
  switch (String(label).toLowerCase()) {
    case "unlock":
      return "border-violet-300 bg-violet-100 text-violet-900";
    case "delisting":
      return "border-rose-300 bg-rose-100 text-rose-900";
    case "listing":
      return "border-emerald-300 bg-emerald-100 text-emerald-900";
    case "integration":
      return "border-sky-300 bg-sky-100 text-sky-900";
    case "hardfork":
      return "border-amber-300 bg-amber-100 text-amber-950";
    case "event":
      return "border-indigo-300 bg-indigo-100 text-indigo-900";
    default:
      return "border-slate-300 bg-slate-100 text-slate-800";
  }
}

export default function HomeCoinWatchDates({
  allCoins,
  filterSymbols,
  compact = false,
}: {
  journalEntries?: unknown;
  allCoins?: CoinMini[] | null;
  /** When set, only show rows for these symbols (e.g. LONG-scan board). */
  filterSymbols?: string[] | null;
  /** Smaller chrome for embedding under LONG-scan. */
  compact?: boolean;
}) {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const manilaToday = useMemo(
    () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10),
    []
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/coin-watch?_=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as { events?: StoredEvent[] };
      setEvents(Array.isArray(j.events) ? j.events : []);
    } catch (e) {
      setError((e as Error).message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredEvents = useMemo(() => {
    if (!filterSymbols?.length) return events;
    const set = new Set(filterSymbols.map((s) => s.toUpperCase()));
    return events.filter((e) => e.symbol && set.has(String(e.symbol).toUpperCase()));
  }, [events, filterSymbols]);

  const byDate = useMemo(() => {
    const map = new Map<string, StoredEvent[]>();
    for (const e of filteredEvents) {
      const d = String(e.date).slice(0, 10);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(e);
    }
    const keys = [...map.keys()].sort((a, b) => {
      const aT = a === manilaToday ? 0 : a < manilaToday ? 2 : 1;
      const bT = b === manilaToday ? 0 : b < manilaToday ? 2 : 1;
      if (aT !== bT) return aT - bT;
      return a.localeCompare(b);
    });
    return keys.map((date) => ({
      date,
      items: (map.get(date) || []).sort((a, b) =>
        (a.symbol || "").localeCompare(b.symbol || "")
      ),
    }));
  }, [events, manilaToday]);

  const upcomingDates = useMemo(
    () => byDate.filter((g) => g.date >= manilaToday),
    [byDate, manilaToday]
  );
  const archivedDates = useMemo(
    () => byDate.filter((g) => g.date < manilaToday),
    [byDate, manilaToday]
  );

  const nameFor = (sym: string | null) => {
    if (!sym) return "—";
    const c = (allCoins || []).find((x) => x.symbol.toUpperCase() === sym.toUpperCase());
    return c?.name || sym.replace(/PHP$/i, "");
  };

  const delId = async (id: string) => {
    if (!window.confirm("Delete this coin watch row?")) return;
    setBusy(id);
    try {
      const r = await fetch(`/api/coin-watch?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(await r.text());
      setEvents((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const delDate = async (date: string) => {
    if (!window.confirm(`Delete ALL coin watch rows on ${date}?`)) return;
    setBusy(date);
    try {
      const r = await fetch(`/api/coin-watch?date=${encodeURIComponent(date)}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(await r.text());
      setEvents((prev) => prev.filter((e) => e.date !== date));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const delDateSymbol = async (date: string, symbol: string) => {
    if (!window.confirm(`Delete ${symbol} on ${date}?`)) return;
    setBusy(`${date}-${symbol}`);
    try {
      const r = await fetch(
        `/api/coin-watch?date=${encodeURIComponent(date)}&symbol=${encodeURIComponent(symbol)}`,
        { method: "DELETE" }
      );
      if (!r.ok) throw new Error(await r.text());
      setEvents((prev) =>
        prev.filter(
          (e) =>
            !(e.date === date && (e.symbol || "").toUpperCase() === symbol.toUpperCase())
        )
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-6 rounded-lg border border-violet-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-violet-900 flex flex-wrap items-center gap-2">
            🪙 Coin watch dates
            <span className="normal-case font-normal text-[11px] text-slate-500 tracking-normal">
              Unlock · delisting · event · integration — calendar from journals
            </span>
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Auto-scraped when you save/edit a journal on Spot, LONG-scan, or Home. Grouped by
            date. Delete a whole day or one coin. Prefer:{" "}
            <span className="font-mono text-[10px] text-violet-800">
              Watch date: YYYY-MM-DD · unlock · short note
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-900 hover:bg-violet-100"
        >
          ↻ Refresh
        </button>
      </div>

      {error && (
        <p className="mb-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-800">
          {error}
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : byDate.length === 0 ? (
        <p className="py-2 text-xs text-slate-500">
          No saved coin watch dates yet. Add a journal with a <span className="font-semibold">Watch date:</span>{" "}
          line and it will appear here after save.
        </p>
      ) : (
        <>
        <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 sm:mx-0 sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:overflow-visible sm:snap-none sm:pb-0 sm:px-0">
          {upcomingDates.map(({ date, items }) => {
            const isToday = date === manilaToday;
            return (
              <div
                key={date}
                className={`snap-center shrink-0 w-[min(92vw,20rem)] sm:w-auto sm:shrink rounded-lg border px-3 py-2.5 ${
                  isToday
                    ? "border-amber-400 bg-amber-50 ring-2 ring-amber-300/80 shadow-md"
                    : "border-violet-100 bg-violet-50/40"
                }`}
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {isToday && (
                      <span className="rounded border border-amber-500 bg-amber-400 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-amber-950">
                        Today
                      </span>
                    )}
                    <span className="font-mono text-sm font-extrabold text-slate-900">{date}</span>
                    <span className="text-[10px] font-semibold text-slate-500">
                      {items.length} item{items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy === date}
                    onClick={() => void delDate(date)}
                    className="rounded border border-rose-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    title="Delete entire date"
                  >
                    Delete day
                  </button>
                </div>

                <ul className="space-y-2">
                  {items.map((ev) => (
                    <li
                      key={ev.id}
                      className="relative rounded-md border border-white/80 bg-white/90 px-2 py-1.5 pr-8 shadow-sm"
                    >
                      <button
                        type="button"
                        disabled={busy === ev.id}
                        onClick={() => void delId(ev.id)}
                        className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white text-xs font-bold text-slate-600 shadow-sm hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                        title="Delete this row only"
                        aria-label="Delete watch date row"
                      >
                        ✕
                      </button>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1 pr-1">
                          <span
                            className={`rounded border px-1 py-0.5 text-[9px] font-bold uppercase ${labelBadge(
                              String(ev.label || "event")
                            )}`}
                          >
                            {!ev.label || String(ev.label).trim() === "-" || String(ev.label).trim() === "—"
                              ? "event"
                              : ev.label}
                          </span>
                          <span className="text-xs font-bold text-slate-900">
                            {nameFor(ev.symbol)}{" "}
                            {ev.symbol ? (
                              <span className="font-mono text-[10px] text-violet-700">
                                {ev.symbol}
                              </span>
                            ) : null}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-slate-700">
                          {String(ev.description || "")
                            .replace(/^[\s·•|—–\-]+/, "")
                            .trim() || "—"}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                          <span>Journal #{ev.journalEntryId}</span>
                          {ev.symbol ? (
                            <Link
                              href={`/chart?symbol=${encodeURIComponent(ev.symbol)}`}
                              className="font-bold text-violet-700 hover:underline"
                            >
                              Spot →
                            </Link>
                          ) : null}
                          {ev.symbol ? (
                            <button
                              type="button"
                              disabled={busy === `${date}-${ev.symbol}`}
                              onClick={() => void delDateSymbol(date, ev.symbol!)}
                              className="font-bold text-rose-600 hover:underline disabled:opacity-50"
                              title="Delete all rows for this coin on this date"
                            >
                              Del coin
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        {archivedDates.length > 0 && (
          <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
            <summary className="cursor-pointer text-xs font-bold text-slate-700">
              Archived · past dates ({archivedDates.length}) — auto-hidden from main board
            </summary>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {archivedDates.map(({ date, items }) => (
                <div
                  key={date}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 opacity-90"
                >
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
                    <span className="font-mono text-sm font-bold text-slate-700">{date}</span>
                    <button
                      type="button"
                      disabled={busy === date}
                      onClick={() => void delDate(date)}
                      className="rounded border border-rose-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-rose-700 hover:bg-rose-50"
                    >
                      Delete date
                    </button>
                  </div>
                  <ul className="space-y-1.5">
                    {items.map((ev) => (
                      <li key={ev.id} className="text-[11px] text-slate-700">
                        <span className="font-semibold">{nameFor(ev.symbol)}</span>
                        {ev.symbol ? (
                          <span className="ml-1 font-mono text-[10px] text-slate-500">{ev.symbol}</span>
                        ) : null}
                        <span className="ml-1 rounded bg-slate-100 px-1 text-[9px] uppercase text-slate-600">
                          {ev.label}
                        </span>
                        <p className="mt-0.5 text-slate-600">{ev.description}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        )}
        </>
      )}
    </div>
  );
}
