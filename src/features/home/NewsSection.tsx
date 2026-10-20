import React, { useCallback, useEffect, useState } from "react";
import AlertBanner from "@/components/AlertBanner";
import { useNewsLogic } from "./useNewsLogic";
import { isPriceMoveSignalHeadline } from "./priceMoveSignals";

/** Strip fences and turn markdown links into anchors — readable + clickable. */
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
    if (m.index > last) {
      nodes.push(boldify(line.slice(last, m.index), key++));
    }
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

type Channel = "web" | "social";

/** Market Signals: selectable watchlist Tavily/AI news + cron RSS signals */
export default function NewsSection({ refreshSignal }: NewsSectionProps) {
  const { items, loading, loadingMore, error, hasMore, loadMore } = useNewsLogic(refreshSignal);

  const [allTickers, setAllTickers] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [channel, setChannel] = useState<Channel>("web");
  const [watchMd, setWatchMd] = useState("");
  const [watchUpdated, setWatchUpdated] = useState<number | null>(null);
  const [watchLoading, setWatchLoading] = useState(true);
  const [watchRefreshing, setWatchRefreshing] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const loadWatchlist = useCallback(async () => {
    setWatchLoading(true);
    setWatchError(null);
    try {
      const res = await fetch("/api/watchlist-news");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setWatchMd(data.markdown || "");
      setWatchUpdated(data.updatedAt ?? null);
      const tickers: string[] = Array.isArray(data.tickers) ? data.tickers : [];
      setAllTickers(tickers);
      if (Array.isArray(data.lastSymbols) && data.lastSymbols.length > 0) {
        setSelected(data.lastSymbols);
      } else if (tickers.length && selected.length === 0) {
        const defaults = ["SOL", "ONDO", "TX"].filter((t) => tickers.includes(t));
        setSelected(defaults.length ? defaults : tickers.slice(0, 3));
      }
      if (data.lastChannel === "social" || data.lastChannel === "web") {
        setChannel(data.lastChannel);
      }
    } catch (err) {
      setWatchError((err as Error).message);
    } finally {
      setWatchLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only hydrate selection once from cache
  }, []);

  useEffect(() => {
    void loadWatchlist();
  }, [loadWatchlist]);

  const toggleTicker = (t: string) => {
    setSelected((prev) => {
      if (prev.includes(t)) return prev.filter((x) => x !== t);
      if (prev.length >= 8) return prev; // hard cap matches API
      return [...prev, t];
    });
  };

  const refreshWatchlist = useCallback(async () => {
    if (selected.length === 0) {
      setWatchError("Select at least one coin");
      return;
    }
    setWatchRefreshing(true);
    setWatchError(null);
    try {
      const res = await fetch("/api/watchlist-news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: selected, channel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Refresh failed (${res.status})`);
      setWatchMd(data.markdown || "");
      setWatchUpdated(data.updatedAt ?? null);
      if (Array.isArray(data.tickers)) setAllTickers(data.tickers);
      if (Array.isArray(data.lastSymbols)) setSelected(data.lastSymbols);
    } catch (err) {
      setWatchError((err as Error).message);
    } finally {
      setWatchRefreshing(false);
    }
  }, [selected, channel]);

  const articleItems = items.filter((item) => !isPriceMoveSignalHeadline(item.headline));

  return (
    <section className="mt-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Market Signals</h2>
      </div>

      <div className="rounded-lg border border-teal-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-teal-900">Watchlist news (Tavily / AI)</h3>
            <p className="text-[11px] text-slate-500">
              Pick coins · up to 8 · ~10 results · names disambiguated (e.g. TRUMP = coin, not
              president). Neutral — not a buy signal.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshWatchlist()}
            disabled={watchRefreshing || selected.length === 0}
            className="rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50"
          >
            {watchRefreshing ? "Scanning…" : "↻ Scan selected"}
          </button>
        </div>

        {/* Channel */}
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setChannel("web")}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
              channel === "web"
                ? "border-teal-600 bg-teal-600 text-white"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            🌐 Web (news)
          </button>
          <button
            type="button"
            onClick={() => setChannel("social")}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
              channel === "social"
                ? "border-sky-600 bg-sky-600 text-white"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            💬 Social (X / LinkedIn / Reddit)
          </button>
        </div>

        {/* Coin multi-select */}
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="w-full sm:w-auto rounded-md border border-gray-300 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-100"
          >
            {pickerOpen ? "Hide coins ▲" : "Select coins ▼"}{" "}
            <span className="font-normal text-gray-500">
              ({selected.length}/8)
              {selected.length > 0 ? `: ${selected.join(", ")}` : ""}
            </span>
          </button>
          {pickerOpen && (
            <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-gray-200 bg-white p-2 flex flex-wrap gap-1.5">
              {allTickers.map((t) => {
                const on = selected.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTicker(t)}
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      on
                        ? "border-teal-600 bg-teal-50 text-teal-900"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {on ? "✓ " : ""}
                    {t}
                  </button>
                );
              })}
              {allTickers.length === 0 && (
                <span className="text-xs text-gray-400">Loading coin list…</span>
              )}
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button
              type="button"
              className="text-[10px] font-semibold text-teal-700 hover:underline"
              onClick={() =>
                setSelected(
                  ["BTC", "ETH", "SOL", "ONDO", "TX"].filter((t) => allTickers.includes(t)).slice(0, 8)
                )
              }
            >
              Quick: majors + ONDO/TX
            </button>
            <button
              type="button"
              className="text-[10px] font-semibold text-gray-500 hover:underline"
              onClick={() => setSelected([])}
            >
              Clear
            </button>
          </div>
        </div>

        {watchError && <AlertBanner variant="error" message={watchError} />}

        {watchLoading ? (
          <div className="space-y-2 animate-pulse" aria-busy="true">
            <div className="h-4 w-2/3 rounded bg-slate-100" />
            <div className="h-3 w-full rounded bg-slate-100" />
            <div className="h-3 w-5/6 rounded bg-slate-100" />
          </div>
        ) : !watchMd ? (
          <p className="text-xs text-slate-500">
            Select coins, choose Web or Social, then <span className="font-semibold">Scan selected</span>.
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
          <ul className="space-y-3" aria-busy="true" aria-label="Loading news">
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
