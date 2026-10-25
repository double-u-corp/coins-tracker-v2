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
          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 font-bold text-slate-600 uppercase tracking-wide">
                    Domain
                  </th>
                  <th className="px-3 py-2 font-bold text-slate-600 uppercase tracking-wide">
                    Headline
                  </th>
                  <th className="px-3 py-2 font-bold text-slate-600 uppercase tracking-wide whitespace-nowrap">
                    Date
                  </th>
                  <th className="px-3 py-2 font-bold text-slate-600 uppercase tracking-wide w-10">
                    {" "}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => {
                  const scannedDay = row.scannedAt.slice(0, 10);
                  const same = row.newsDate === scannedDay;
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/80">
                      <td className="px-3 py-2 align-top">
                        <span className="font-semibold text-teal-900">{row.label}</span>
                        <div className="text-[10px] text-slate-400 font-mono">{row.domain}</div>
                      </td>
                      <td className="px-3 py-2 align-top max-w-[28rem]">
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-slate-900 underline decoration-dotted hover:text-teal-800"
                        >
                          {row.title}
                        </a>
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap text-slate-700">
                        <div className="font-mono text-xs">{row.newsDate}</div>
                        {!same && (
                          <div className="text-[10px] text-slate-400">
                            scanned {scannedDay}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <button
                          type="button"
                          onClick={() => void deleteRow(row)}
                          disabled={deletingId === row.id}
                          title="Delete this row"
                          className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                        >
                          {deletingId === row.id ? "…" : "✕"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
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
