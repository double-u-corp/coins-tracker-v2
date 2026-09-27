import { useMemo, useState } from "react";
import Link from "next/link";
import AlertBanner from "@/components/AlertBanner";
import FormattedAiResponse from "@/components/FormattedAiResponse";
import {
  useCatalystsLogic,
  buildPortablePrompt,
  type CatalystPrompt,
} from "./useCatalystsLogic";
import { extractJsonArray, attachManilaFields, sortEventsChronologically } from "../../lib/macroEvents";

/** Calendar strip from macro JSON AI response */
function EventCalendarStrip({ raw }: { raw: string }) {
  const events = useMemo(() => {
    try {
      const arr = extractJsonArray(raw);
      if (!Array.isArray(arr) || arr.length === 0) return [];
      return sortEventsChronologically(attachManilaFields(arr)).slice(0, 12);
    } catch {
      return [];
    }
  }, [raw]);

  if (events.length === 0) {
    return (
      <p className="text-xs text-slate-500 py-3 text-center">
        Run <span className="font-semibold text-slate-700">Event Calendar</span> to load verified dates (FOMC, CPI, NFP…).
      </p>
    );
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 snap-x">
      {events.map((evt: any, idx: number) => {
        const high = evt.severity === "high" || evt.type === "FOMC" || /FOMC|CPI|NFP/i.test(String(evt.title || ""));
        return (
          <div
            key={idx}
            className={`snap-start shrink-0 w-[220px] sm:w-[240px] rounded-2xl border p-4 sm:p-5 shadow-sm ${
              high
                ? "border-rose-200 bg-gradient-to-br from-rose-50 to-white"
                : "border-slate-200 bg-gradient-to-br from-slate-50 to-white"
            }`}
          >
            <div className={`text-[11px] font-bold uppercase tracking-wide ${high ? "text-rose-600" : "text-slate-400"}`}>
              {evt.type || "Event"}
            </div>
            <div className="mt-2 text-sm sm:text-base font-bold text-slate-900 line-clamp-3 leading-snug min-h-[3.25rem]">
              {evt.title}
            </div>
            <div className="mt-3 text-sm font-bold tabular-nums text-slate-800">
              {evt.manilaDateKey || evt.date || "—"}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {evt.manilaTimeLabel || evt.approximateTime || "time TBD"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const SECTION_META: Record<string, { title: string; blurb: string; emoji: string }> = {
  Macro: {
    title: "Calendar & macro weather",
    blurb: "Fed, CPI, geopolitics, yields — the backdrop for every spot long.",
    emoji: "📅",
  },
  Live: {
    title: "Live stress & security",
    blurb: "Liquidations, outages, confirmed hacks — last 72 hours.",
    emoji: "⚡",
  },
  Weekly: {
    title: "Week ahead",
    blurb: "Flows, unlocks, upgrades, PH platform rails.",
    emoji: "🗓️",
  },
};

function PromptCard({
  item,
  statusInfo,
  cachedData,
  isLoading,
  errorMsg,
  copiedId,
  savedStatus,
  onCopyPortable,
  onGoogle,
  onRun,
  onSaveJournal,
}: {
  item: CatalystPrompt;
  statusInfo: { status: string; label: string };
  cachedData?: { response: string; timestamp: number };
  isLoading: boolean;
  errorMsg?: string;
  copiedId: string | null;
  savedStatus: Record<string, boolean>;
  onCopyPortable: (id: string, text: string) => void;
  onGoogle: (q: string) => void;
  onRun: (item: CatalystPrompt, force: boolean) => void;
  onSaveJournal: (id: string, title: string, text: string) => void;
}) {
  const isCurrent = statusInfo.status === "current";
  const portable = buildPortablePrompt(item.prompt);

  return (
    <div className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-violet-500 to-sky-400 opacity-80" />
      <div className="pl-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 leading-snug">{item.title}</h3>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                {item.category}
              </span>
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-700">
                Market-wide
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  isCurrent ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                }`}
              >
                {statusInfo.label}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onGoogle(item.searchQuery)}
            className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] font-bold text-sky-800 hover:bg-sky-100"
          >
            🔍 Google
          </button>
          <button
            type="button"
            onClick={() => onCopyPortable(item.id, portable)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
          >
            {copiedId === item.id ? "✅ Copied" : "📋 Copy prompt"}
          </button>
          <button
            type="button"
            onClick={() => onRun(item, true)}
            disabled={isLoading}
            className="rounded-lg bg-violet-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {isLoading ? "Scanning…" : "✨ AI scan"}
          </button>
          {cachedData?.response && (
            <button
              type="button"
              onClick={() => onSaveJournal(item.id, item.title, cachedData.response)}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100"
            >
              {savedStatus[item.id] ? "✅ Saved" : "📓 Journal"}
            </button>
          )}
        </div>

        {errorMsg && (
          <p className="mt-2 text-[11px] font-medium text-rose-600">{errorMsg}</p>
        )}

        {cachedData?.response && (
          <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/80 p-3">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Latest scan · {new Date(cachedData.timestamp).toLocaleString()}
            </div>
            {item.responseFormat === "json" ? (
              <EventCalendarStrip raw={cachedData.response} />
            ) : (
              <div className="max-h-64 overflow-y-auto text-xs">
                <FormattedAiResponse text={cachedData.response} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CatalystsView() {
  const {
    selectedCategory,
    setSelectedCategory,
    filteredPrompts,
    copiedId,
    handleCopy,
    generalEntries,
    journalLoading,
    journalError,
    authenticated,
    aiCache,
    aiLoading,
    aiErrors,
    savedStatus,
    runAiSearch,
    getPromptStatus,
    saveAiResponseToJournal,
  } = useCatalystsLogic();

  const [activeHub, setActiveHub] = useState<"weather" | "notes">("weather");

  const openGoogleSearch = (query: string) => {
    window.open(
      `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  // Force market-wide: filter to global only in this redesign
  const marketPrompts = useMemo(
    () => filteredPrompts.filter((p) => p.scope === "global"),
    [filteredPrompts]
  );

  const calendarCache = aiCache["macro-calendar-events"];

  const bySection = useMemo(() => {
    const order = ["Macro", "Live", "Weekly"] as const;
    return order.map((cat) => ({
      cat,
      items: marketPrompts.filter((p) => p.category === cat),
    })).filter((s) => s.items.length > 0);
  }, [marketPrompts]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 pb-10">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 px-5 py-6 text-white shadow-lg sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-violet-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-8 left-1/3 h-32 w-32 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="relative">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-violet-300">Market weather</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Catalysts & calendar</h1>
          <p className="mt-2 max-w-xl text-sm text-slate-300 leading-relaxed">
            Macro and systemic risk only — Fed, CPI, geopolitics, hacks, weekly flows.
            Per-coin entry news lives on the <span className="text-white font-semibold">Chart</span> agent review.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveHub("weather")}
              className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${
                activeHub === "weather" ? "bg-white text-slate-900" : "bg-white/10 text-white hover:bg-white/20"
              }`}
            >
              🌐 Market weather
            </button>
            <button
              type="button"
              onClick={() => setActiveHub("notes")}
              className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${
                activeHub === "notes" ? "bg-white text-slate-900" : "bg-white/10 text-white hover:bg-white/20"
              }`}
            >
              📓 Macro notes
            </button>
            <Link
              href="/chart"
              className="rounded-full bg-violet-500/90 px-4 py-1.5 text-xs font-bold text-white hover:bg-violet-400"
            >
              Chart · coin review →
            </Link>
          </div>
        </div>
      </div>

      {activeHub === "weather" && (
        <>
          {/* Calendar strip */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-slate-900">📅 Upcoming schedule</h2>
                <p className="text-[11px] text-slate-500">
                  Verified macro dates · Manila labels when available · run Event Calendar to refresh
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const item = marketPrompts.find((p) => p.id === "macro-calendar-events");
                  if (item) runAiSearch(item, true);
                }}
                disabled={!!aiLoading["macro-calendar-events"]}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {aiLoading["macro-calendar-events"] ? "Refreshing…" : "Refresh calendar"}
              </button>
            </div>
            {aiErrors["macro-calendar-events"] && (
              <AlertBanner variant="error" message={aiErrors["macro-calendar-events"]} />
            )}
            <EventCalendarStrip raw={calendarCache?.response || ""} />
          </section>

          {/* Category chips */}
          <div className="flex flex-wrap gap-1.5">
            {(["All", "Macro", "Live", "Weekly"] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${
                  selectedCategory === cat
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Sections */}
          {bySection.map(({ cat, items }) => {
            const meta = SECTION_META[cat] || { title: cat, blurb: "", emoji: "•" };
            return (
              <section key={cat} className="space-y-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {meta.emoji} {meta.title}
                  </h2>
                  <p className="text-[11px] text-slate-500">{meta.blurb}</p>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {items.map((item) => (
                    <PromptCard
                      key={item.id}
                      item={item}
                      statusInfo={getPromptStatus(item.id, item.category)}
                      cachedData={aiCache[item.id]}
                      isLoading={!!aiLoading[item.id]}
                      errorMsg={aiErrors[item.id]}
                      copiedId={copiedId}
                      savedStatus={savedStatus}
                      onCopyPortable={handleCopy}
                      onGoogle={openGoogleSearch}
                      onRun={runAiSearch}
                      onSaveJournal={saveAiResponseToJournal}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {marketPrompts.length === 0 && (
            <p className="text-center text-sm text-slate-500 py-8">No prompts in this filter.</p>
          )}
        </>
      )}

      {activeHub === "notes" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">📓 Macro journal</h2>
          <p className="text-[11px] text-slate-500 mb-4">
            General notes (not tied to one coin). For coin-specific logs use Chart.
          </p>
          {journalError && <AlertBanner variant="error" message={journalError} />}
          {journalLoading ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : generalEntries.length === 0 ? (
            <p className="text-xs text-slate-500 py-4">No macro notes yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {generalEntries.slice(0, 20).map((e) => (
                <li key={e.id} className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                  <div className="text-[11px] text-slate-500">
                    {new Date(e.entryDate).toLocaleDateString()}
                  </div>
                  <div className="text-sm font-bold text-slate-900">{e.title}</div>
                  <div className="mt-1 text-xs text-slate-700 line-clamp-4 whitespace-pre-wrap">{e.notes}</div>
                </li>
              ))}
            </ul>
          )}
          {!authenticated && (
            <p className="mt-3 text-xs text-amber-700">Log in to add macro journal entries.</p>
          )}
        </section>
      )}

    </div>
  );
}
