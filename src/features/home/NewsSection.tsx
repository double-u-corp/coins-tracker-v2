import React, { useCallback, useEffect, useState } from "react";
import AlertBanner from "@/components/AlertBanner";
import { useNewsLogic } from "./useNewsLogic";
import { isPriceMoveSignalHeadline } from "./priceMoveSignals";

function stripFences(raw: string): string {
  let s = (raw || "").trim();
  s = s.replace(/^```(?:markdown|md)?\s*/i, "");
  s = s.replace(/\s*```$/i, "");
  return s.trim();
}

function linkifyLine(line: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) nodes.push(boldify(line.slice(last, m.index), key++));
    if (m[1] && m[2]) {
      nodes.push(
        <a
          key={key++}
          href={m[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-teal-700 underline font-medium hover:text-teal-900 break-all"
        >
          {m[1]}
        </a>
      );
    } else if (m[3]) {
      nodes.push(
        <a
          key={key++}
          href={m[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-teal-700 underline hover:text-teal-900 break-all"
        >
          {m[3].replace(/^https?:\/\//, "").slice(0, 48)}
          {m[3].length > 56 ? "…" : ""}
        </a>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) nodes.push(boldify(line.slice(last), key++));
  return nodes;
}

function boldify(text: string, keyBase: number): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={`${keyBase}-${i}`} className="font-semibold text-slate-900">
          {p.slice(2, -2)}
        </strong>
      );
    }
    return <span key={`${keyBase}-${i}`}>{p}</span>;
  });
}

function WatchlistBody({ text }: { text: string }) {
  const clean = stripFences(text);
  const lines = clean.split(/\n/);
  return (
    <div className="space-y-1.5 text-sm text-slate-800">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-2" />;
        if (/^([*\-]|\d+\.)\s+/.test(trimmed)) {
          const content = trimmed.replace(/^([*\-]|\d+\.)\s+/, "");
          return (
            <div key={idx} className="flex gap-2 pl-1 leading-relaxed">
              <span className="text-teal-600 shrink-0">•</span>
              <span className="min-w-0">{linkifyLine(content)}</span>
            </div>
          );
        }
        if (/^sources?:?\s*$/i.test(trimmed)) {
          return (
            <p
              key={idx}
              className="pt-2 text-[11px] font-bold uppercase tracking-wide text-slate-500"
            >
              Sources
            </p>
          );
        }
        return (
          <p key={idx} className="leading-relaxed">
            {linkifyLine(trimmed)}
          </p>
        );
      })}
    </div>
  );
}

interface NewsSectionProps {
  refreshSignal?: number;
}

const SENTIMENT_STYLES: Record<string, string> = {
  bullish: "bg-emerald-100 text-emerald-800",
  bearish: "bg-rose-100 text-rose-800",
  neutral: "bg-gray-100 text-gray-700",
};

type RangeKey = "since_last" | "1" | "3" | "7";

type Outlet = { id: string; host: string; label: string };

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** Market Signals: core-outlet news (Tavily) + cron RSS */
export default function NewsSection({ refreshSignal }: NewsSectionProps) {
  const { items, loading, loadingMore, error, hasMore, loadMore } = useNewsLogic(refreshSignal);

  const [watchMd, setWatchMd] = useState("");
  const [watchUpdated, setWatchUpdated] = useState<number | null>(null);
  const [lastScrapedAt, setLastScrapedAt] = useState<number | null>(null);
  const [alreadyScrapedToday, setAlreadyScrapedToday] = useState(false);
  const [range, setRange] = useState<RangeKey>("since_last");
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [watchLoading, setWatchLoading] = useState(true);
  const [watchRefreshing, setWatchRefreshing] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [hitCounts, setHitCounts] = useState<Record<string, number>>({});

  const applyPayload = (data: {
    markdown?: string;
    updatedAt?: number | null;
    lastScrapedAt?: number | null;
    range?: RangeKey;
    outlets?: Outlet[];
    alreadyScrapedToday?: boolean;
    message?: string;
    skipped?: boolean;
    outletHitCounts?: Record<string, number>;
  }) => {
    setWatchMd(data.markdown || "");
    setWatchUpdated(data.updatedAt ?? null);
    setLastScrapedAt(data.lastScrapedAt ?? null);
    setAlreadyScrapedToday(Boolean(data.alreadyScrapedToday));
    if (data.range) setRange(data.range);
    if (Array.isArray(data.outlets)) setOutlets(data.outlets);
    if (data.message) setInfoMsg(data.message);
    if (data.outletHitCounts) setHitCounts(data.outletHitCounts);
  };

  const loadWatchlist = useCallback(async () => {
    setWatchLoading(true);
    setWatchError(null);
    try {
      const res = await fetch("/api/watchlist-news");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      applyPayload(data);
      setInfoMsg(null);
    } catch (err) {
      setWatchError((err as Error).message);
    } finally {
      setWatchLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWatchlist();
  }, [loadWatchlist]);

  const scan = useCallback(
    async (force: boolean) => {
      setWatchRefreshing(true);
      setWatchError(null);
      setInfoMsg(null);
      try {
        const res = await fetch("/api/watchlist-news", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ range, force }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Scan failed (${res.status})`);
        applyPayload(data);
      } catch (err) {
        setWatchError((err as Error).message);
      } finally {
        setWatchRefreshing(false);
      }
    },
    [range]
  );

  const articleItems = items.filter((item) => !isPriceMoveSignalHeadline(item.headline));

  return (
    <section className="mt-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Market Signals</h2>
      </div>

      <div className="rounded-lg border border-teal-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-teal-900">Core outlet news (Tavily / AI)</h3>
            <p className="text-[11px] text-slate-500 max-w-xl">
              Default sites only — not per-coin search. One scan per Manila day is enough; we skip
              re-scrape unless you force. Neutral summary — not a buy signal.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void scan(false)}
              disabled={watchRefreshing}
              className="rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50"
            >
              {watchRefreshing
                ? "Scanning…"
                : alreadyScrapedToday
                  ? "↻ Use cache / scan"
                  : "↻ Scan outlets"}
            </button>
            <button
              type="button"
              onClick={() => void scan(true)}
              disabled={watchRefreshing}
              title="Ignore same-day skip and pull fresh"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Force scan
            </button>
          </div>
        </div>

        {/* Outlets */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(outlets.length
            ? outlets
            : [
                { id: "coindesk", host: "coindesk.com", label: "CoinDesk" },
                { id: "theblock", host: "theblock.co", label: "The Block" },
                { id: "cointelegraph", host: "cointelegraph.com", label: "Cointelegraph" },
                { id: "decrypt", host: "decrypt.co", label: "Decrypt" },
                { id: "blockworks", host: "blockworks.co", label: "Blockworks" },
              ]
          ).map((o) => {
            const n = hitCounts[o.label];
            return (
              <span
                key={o.id}
                className="rounded-full border border-teal-100 bg-teal-50/80 px-2 py-0.5 text-[10px] font-semibold text-teal-900"
                title={o.host}
              >
                {o.label}
                {typeof n === "number" ? ` · ${n}` : ""}
              </span>
            );
          })}
          <a
            href="https://cryptoslate.com/top-news/"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 hover:underline"
            title="Open CryptoSlate top news (not auto-scraped)"
          >
            CryptoSlate top-news ↗
          </a>
        </div>

        {/* Date range */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-600">Window:</span>
          {(
            [
              ["since_last", "Since last scrape"],
              ["1", "1 day"],
              ["3", "3 days"],
              ["7", "7 days"],
            ] as [RangeKey, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(key)}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                range === key
                  ? "border-teal-600 bg-teal-600 text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {lastScrapedAt && (
          <p className="mb-2 text-[11px] text-slate-500">
            Last scrape:{" "}
            <span className="font-semibold text-slate-700">
              {new Date(lastScrapedAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
            {alreadyScrapedToday && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                Already scraped today
              </span>
            )}
          </p>
        )}

        {infoMsg && (
          <p className="mb-2 text-[11px] text-teal-800 bg-teal-50 border border-teal-100 rounded-md px-2 py-1.5">
            {infoMsg}
          </p>
        )}
        {watchError && <AlertBanner variant="error" message={watchError} />}

        {(watchLoading || watchRefreshing) ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading outlet news">
            <div className="flex items-center gap-2 text-xs font-semibold text-teal-800">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
              {watchRefreshing ? "Scanning outlets…" : "Loading…"}
            </div>
            <div className="space-y-2 animate-pulse">
              <div className="h-4 w-2/3 rounded bg-slate-100" />
              <div className="h-3 w-full rounded bg-slate-100" />
              <div className="h-3 w-5/6 rounded bg-slate-100" />
              <div className="h-3 w-4/5 rounded bg-slate-100" />
              <div className="h-8 w-full rounded-md bg-slate-50 border border-slate-100" />
              <div className="h-8 w-full rounded-md bg-slate-50 border border-slate-100" />
            </div>
          </div>
        ) : !watchMd ? (
          <p className="text-xs text-slate-500">
            No outlet news yet. Pick a window and <span className="font-semibold">Scan outlets</span>.
          </p>
        ) : (
          <WatchlistBody text={watchMd} />
        )}

        {watchUpdated && (
          <p className="mt-2 text-[10px] text-slate-400">
            Updated{" "}
            {new Date(watchUpdated).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-800">Price &amp; RSS signals</h3>
        {error && <AlertBanner variant="error" message={`Failed to load signals: ${error}`} />}

        {loading ? (
          <ul className="space-y-3" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <li
                key={i}
                className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm animate-pulse"
              >
                <div className="h-4 w-48 rounded bg-gray-200 mb-2" />
                <div className="h-3 w-full rounded bg-gray-100" />
              </li>
            ))}
          </ul>
        ) : articleItems.length === 0 ? (
          <p className="text-sm text-gray-500">
            No article signals yet — price % moves show on the coin filter chips above.
          </p>
        ) : (
          <ul className="space-y-3">
            {articleItems.map((item, idx) => {
              const previous = articleItems[idx - 1];
              const isNewRun = idx > 0 && previous.cronLogId !== item.cronLogId;
              return (
                <li key={item.id}>
                  {isNewRun && (
                    <div className="relative my-6 flex items-center justify-center">
                      <div className="absolute inset-0 flex items-center" aria-hidden="true">
                        <div className="w-full border-t-2 border-gray-300" />
                      </div>
                      <div className="relative rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                        Run #{item.cronLogId}
                      </div>
                    </div>
                  )}
                  <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SENTIMENT_STYLES[item.sentiment] || SENTIMENT_STYLES.neutral}`}
                      >
                        {item.sentiment === "bullish"
                          ? "▲ Bullish"
                          : item.sentiment === "bearish"
                            ? "▼ Bearish"
                            : "● Neutral"}
                      </span>
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-semibold text-gray-900 underline decoration-dotted hover:text-brand-700"
                        >
                          {item.headline}
                        </a>
                      ) : (
                        <span className="text-sm font-semibold text-gray-900">{item.headline}</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{item.summary}</p>
                    <div className="mt-1 text-xs text-gray-400">
                      {item.source} · {formatDateTime(item.publishedAt)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {hasMore && !loading && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="mt-3 w-full rounded-md border border-gray-300 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {loadingMore ? "Loading more…" : "Load more"}
          </button>
        )}
      </div>
    </section>
  );
}
