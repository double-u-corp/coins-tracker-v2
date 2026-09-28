import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { extractJsonArray, attachManilaFields, sortEventsChronologically, type MacroEvent } from "../../lib/macroEvents";
import { nowInManila, getDateKeyInZone, TRADER_TIMEZONE } from "../../lib/timezone";

function addDaysManilaKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Soft awareness chip — no push notifications.
 * Reads last Catalysts "Event Calendar" AI scan and shows today / tomorrow (Manila).
 */
export default function MacroDayBanner() {
  const [raw, setRaw] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/catalyst-ai")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        let response: string | null = null;
        if (data.logs && !Array.isArray(data.logs) && data.logs["macro-calendar-events"]) {
          response = data.logs["macro-calendar-events"].response || null;
        } else if (Array.isArray(data.logs)) {
          const hit = data.logs.find(
            (log: { promptId?: string; id?: string }) =>
              (log.promptId || log.id) === "macro-calendar-events"
          );
          response = hit?.response || hit?.content || null;
        }
        setRaw(response);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const upcoming = useMemo(() => {
    if (!raw) return [] as MacroEvent[];
    try {
      const events = sortEventsChronologically(attachManilaFields(extractJsonArray(raw)));
      const today = getDateKeyInZone(nowInManila(), TRADER_TIMEZONE);
      const tomorrow = addDaysManilaKey(today, 1);
      return events.filter((e) => {
        const k = e.manilaDateKey || e.date;
        return k === today || k === tomorrow;
      });
    } catch {
      return [];
    }
  }, [raw]);

  if (!loaded) return null;

  if (upcoming.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 flex flex-wrap items-center justify-between gap-2">
        <span>
          📅 No macro prints tagged for <strong>today / tomorrow</strong> (Manila) in the last Catalysts calendar
          scan.
        </span>
        <Link href="/catalysts" className="font-semibold text-violet-700 hover:underline shrink-0">
          Catalysts →
        </Link>
      </div>
    );
  }

  const today = getDateKeyInZone(nowInManila(), TRADER_TIMEZONE);

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-950">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="font-bold text-amber-900">📅 Macro window (Manila)</span>
          <span className="ml-1.5 text-amber-800/80">— size down if you trade through the print</span>
        </div>
        <Link href="/catalysts" className="font-semibold text-violet-700 hover:underline shrink-0">
          Full calendar →
        </Link>
      </div>
      <ul className="mt-1.5 flex flex-col gap-1">
        {upcoming.slice(0, 4).map((e, i) => {
          const k = e.manilaDateKey || e.date;
          const when = k === today ? "Today" : "Tomorrow";
          const high = e.severity === "high" || /FOMC|CPI|NFP/i.test(e.title || "");
          return (
            <li key={`${k}-${e.title}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                  high ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-900"
                }`}
              >
                {when}
              </span>
              <span className="font-bold text-slate-900">{e.title}</span>
              <span className="text-slate-500">
                {e.type}
                {e.manilaTimeLabel || e.approximateTime ? ` · ${e.manilaTimeLabel || "time TBD"}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
