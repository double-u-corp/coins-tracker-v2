import React, { useCallback, useEffect, useState } from "react";
import AlertBanner from "@/components/AlertBanner";
import { useNewsLogic } from "./useNewsLogic";
import { isPriceMoveSignalHeadline } from "./priceMoveSignals";

interface NewsSectionProps {
  refreshSignal?: number;
}

const SENTIMENT_STYLES: Record<string, string> = {
  bullish: "bg-emerald-100 text-emerald-800",
  bearish: "bg-rose-100 text-rose-800",
  neutral: "bg-gray-100 text-gray-700",
};

type Outlet = { id: string; host: string; label: string };

type OutletNewsRow = {
  id: string;
  url: string;
  title: string;
  domain: string;
  label: string;
  scannedAt: string;
  newsDate: string;
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

const FALLBACK_OUTLETS: Outlet[] = [
  { id: "theblock", host: "theblock.co", label: "The Block" },
  { id: "decrypt", host: "decrypt.co", label: "Decrypt" },
  { id: "bitcoinmagazine", host: "bitcoinmagazine.com", label: "Bitcoin Magazine" },
  { id: "dlnews", host: "dlnews.com", label: "DL News" },
];

/** Market Signals: outlet news table + cron RSS */
export default function NewsSection({ refreshSignal }: NewsSectionProps) {
  const { items, loading, loadingMore, error, hasMore, loadMore, removeItem } = useNewsLogic(refreshSignal);

  const [rows, setRows] = useState<OutletNewsRow[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>(FALLBACK_OUTLETS);
  const [lastScrapedAt, setLastScrapedAt] = useState<number | null>(null);
  const [watchLoading, setWatchLoading] = useState(true);
  const [watchScanning, setWatchScanning] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [outletCopied, setOutletCopied] = useState(false);
  const [rssCopied, setRssCopied] = useState(false);

  const applyPayload = (data: {
    items?: OutletNewsRow[];
    lastScrapedAt?: number | null;
    outlets?: Outlet[];
    message?: string;
    added?: number;
  }) => {
    if (Array.isArray(data.items)) setRows(data.items);
    if (data.lastScrapedAt !== undefined) setLastScrapedAt(data.lastScrapedAt);
    if (Array.isArray(data.outlets) && data.outlets.length) setOutlets(data.outlets);
    if (data.message) setInfoMsg(data.message);
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

  const scan = useCallback(async () => {
    setWatchScanning(true);
    setWatchError(null);
    setInfoMsg(null);
    try {
      const res = await fetch("/api/watchlist-news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Scan failed (${res.status})`);
      applyPayload(data);
    } catch (err) {
      setWatchError((err as Error).message);
    } finally {
      setWatchScanning(false);
    }
  }, []);

  const deleteRow = useCallback(async (row: OutletNewsRow) => {
    setDeletingId(row.id);
    setWatchError(null);
    try {
      const res = await fetch(
        `/api/watchlist-news?id=${encodeURIComponent(row.id)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Delete failed (${res.status})`);
      applyPayload(data);
      setInfoMsg("Row deleted");
    } catch (err) {
      setWatchError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }, []);

  const articleItems = items.filter((item) => !isPriceMoveSignalHeadline(item.headline));

  const copyOutletAgent = async () => {
    const lines: string[] = [];
    lines.push("ROLE: Neutral crypto news assistant for a Philippines spot LONG-only PHP trader (no short/leverage).");
    lines.push("PURPOSE: Summarize Core outlet headlines. Verdict BULLISH / BEARISH / NEUTRAL for **crypto** risk appetite only.");
    lines.push("RULES: Focus on crypto-specific themes (protocol, exchange, regulation, ETF, stablecoin, unlocks). Ignore pure equity/macro noise unless a clear crypto link. Do not invent news. No buy signals.");
    lines.push("");
    lines.push("HEADLINES:");
    for (const row of rows.slice(0, 20)) {
      lines.push(`- [${row.label || row.domain}] ${row.title || row.url} (${row.newsDate || "date n/a"})`);
      if (row.url) lines.push(`  URL: ${row.url}`);
    }
    if (!rows.length) lines.push("- (none)");
    lines.push("");
    lines.push("ANSWER: 1) Verdict 2) 3 bullet themes 3) What a spot buyer should watch (not chase)");
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setOutletCopied(true);
      setTimeout(() => setOutletCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const copyRssAgent = async () => {
    const lines: string[] = [];
    lines.push("ROLE: Neutral crypto news assistant for a Philippines spot LONG-only PHP trader (no short/leverage).");
    lines.push("PURPOSE: Summarize Price & RSS signals. Verdict BULLISH / BEARISH / NEUTRAL for crypto only.");
    lines.push("RULES: Emphasize coin/protocol/exchange/regulatory items. Skip unrelated non-crypto noise. Do not invent news. Not a buy signal.");
    lines.push("");
    lines.push("SIGNALS:");
    for (const item of articleItems.slice(0, 20)) {
      lines.push(`- ${item.symbol || "?"} · ${item.sentiment || "neutral"} · ${item.headline}`);
      if (item.summary) lines.push(`  ${String(item.summary).slice(0, 200)}`);
      if (item.url) lines.push(`  URL: ${item.url}`);
    }
    if (!articleItems.length) lines.push("- (none)");
    lines.push("");
    lines.push("ANSWER: 1) Verdict 2) Themes (max 3) 3) Coins mentioned that need caution");
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setRssCopied(true);
      setTimeout(() => setRssCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };


  return (
    <section className="mt-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Market Signals</h2>
        <CoinsPhAgentButton />
      </div>

      <div className="rounded-lg border border-teal-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-teal-900">Core outlet news</h3>
            <p className="text-[11px] text-slate-500 max-w-xl">
              Today &amp; yesterday only · URLs deduped on save · delete rows when stale. Not a buy
              signal.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void scan()}
            disabled={watchScanning}
            className="rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50"
          >
            {watchScanning ? "Scanning…" : "↻ Scan"}
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5 items-center">
          {outlets.map((o) => (
            <span
              key={o.id}
              className="rounded-full border border-teal-100 bg-teal-50/80 px-2 py-0.5 text-[10px] font-semibold text-teal-900"
              title={o.host}
            >
              {o.label}
            </span>
          ))}
          <a
            href="https://cryptoslate.com/top-news/"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 hover:underline"
          >
            CryptoSlate top-news ↗
          </a>
        </div>

        {lastScrapedAt && (
          <p className="mb-2 text-[11px] text-slate-500">
            Last scan:{" "}
            <span className="font-semibold text-slate-700">
              {new Date(lastScrapedAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </p>
        )}

        {infoMsg && (
          <p className="mb-2 text-[11px] text-teal-800 bg-teal-50 border border-teal-100 rounded-md px-2 py-1.5">
            {infoMsg}
          </p>
        )}
        {watchError && <AlertBanner variant="error" message={watchError} />}

        {(watchLoading || watchScanning) && (
          <div className="mb-3 space-y-2" aria-busy="true">
            <div className="flex items-center gap-2 text-xs font-semibold text-teal-800">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
              {watchScanning ? "Scanning outlets…" : "Loading…"}
            </div>
            <div className="animate-pulse space-y-2">
              <div className="h-9 w-full rounded bg-slate-100" />
              <div className="h-9 w-full rounded bg-slate-100" />
              <div className="h-9 w-full rounded bg-slate-100" />
            </div>
          </div>
        )}

        {!watchLoading && !watchScanning && rows.length === 0 ? (
          <p className="text-xs text-slate-500">
            No saved links yet. Click <span className="font-semibold">Scan</span> to pull today /
            yesterday from core outlets.
          </p>
        ) : rows.length > 0 ? (
          <div className="space-y-2">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void copyOutletAgent()}
                className="rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-bold text-teal-900 hover:bg-teal-100"
              >
                {outletCopied ? "✅ Copied" : "📋 Summarize outlet news"}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {rows.map((row) => (
                <article
                  key={row.id}
                  className="relative rounded-lg border border-teal-100 bg-white p-3 shadow-sm hover:border-teal-200"
                >
                  <button
                    type="button"
                    onClick={() => void deleteRow(row)}
                    disabled={deletingId === row.id}
                    className="absolute top-2 right-2 rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                    title="Delete"
                  >
                    {deletingId === row.id ? "…" : "🗑"}
                  </button>
                  <div className="pr-8">
                    <span className="inline-block rounded-full bg-teal-50 border border-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-800">
                      {row.label || row.domain}
                    </span>
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 block text-sm font-semibold text-gray-900 hover:text-teal-800 hover:underline leading-snug"
                    >
                      {row.title || row.url}
                    </a>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {[row.newsDate, row.scannedAt ? `scanned ${String(row.scannedAt).slice(0, 10)}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Price & RSS signals — hidden while auto-fetch is paused */}
      {false && (
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-800">Price &amp; RSS signals</h3>
          <button
            type="button"
            onClick={() => void copyRssAgent()}
            disabled={articleItems.length === 0}
            className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
          >
            {rssCopied ? "✅ Copied" : "📋 Summarize RSS signals"}
          </button>
        </div>
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
            Price &amp; RSS auto-fetch is paused. Section kept for later — no news requests are made.
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
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
                      <span>
                        {item.source} · {formatDateTime(item.publishedAt)}
                      </span>
                      <button
                        type="button"
                        onClick={() => void removeItem(item.id)}
                        className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100"
                        title="Delete this signal"
                      >
                        🗑 Delete
                      </button>
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
      )}
    </section>
  );
}


const COINS_PH_PROMPT = `You are a neutral research assistant for a Philippines spot crypto trader who uses **Coins.ph** (coins.ph) for PHP pairs.

## Task
Summarize **current and upcoming** Coins.ph platform issues, specifically auditing inbound PHP funding (bank transfers / InstaPay / PESONet restrictions), delistings, new listings, and spot trading service health. Stay factual.

## Cover (only if verified)
1. **PHP Cash-In / Cash-Out & Banking Rails** — Status of direct bank transfers (InstaPay / PESONet), e-wallet gateways, or DCPay Philippines processing limitations impacting retail fiat onboarding.
2. **Delistings** — Coins removed or scheduled for removal; final trade / withdrawal deadlines.
3. **New listings** — Coins newly added or announced for Coins.ph PHP pairs.
4. **Service & Trading Issues** — Maintenance windows, app outages, convert/spot engine latency, or KYC blocks.
5. **Fees or Policy Changes** — Any adjustments affecting retail PHP spot users.

## Rules
- Be neutral. Do not invent outages or restrictions.
- Prefer official Coins.ph announcements, support help center notices, status pages, and reputable local/crypto news.
- Do **not** invent news. Do **NOT** use training-memory headlines (often stale).
- If nothing verified, say **"none verified"** per section.
- Philippines / PHP context. Not investment advice.

## Answer format
1. **Verdict:** All clear / Caution / Major issues
2. **PHP Cash-In & Banking Rails** (status & details)
3. **Delistings** (bullet list or none verified)
4. **New coins** (bullet list or none verified)
5. **Trading & service issues** (bullet list or none verified)
6. **Sources** (links if found)
7. **Recheck by** (date)
`;

function CoinsPhAgentButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(COINS_PH_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-100"
      title="Copy a Coins.ph status research prompt for your agent"
    >
      {copied ? "✅ Copied" : "📋 Coins.ph agent prompt"}
    </button>
  );
}
