import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AlertBanner from "@/components/AlertBanner";
import { formatPhp } from "@/lib/format";
import type { JournalEntryView } from "@/validators/journalSchema";
import FormattedAiResponse from "@/components/FormattedAiResponse";

type LadderLevel = { price: number; basis: string; allocationPct: number };

type Hit = {
  symbol: string;
  name: string;
  bias: string;
  score: number;
  maxScore: number;
  confidence: number;
  currentPrice: number;
  support: number | null;
  resistance: number | null;
  isExtended: boolean;
  ladder: LadderLevel[];
  invalidation: number | null;
  target: number | null;
  signalsNote: string | null;
  tier: string;
};

type Run = {
  id: string;
  scannedAt: string;
  scanned: number;
  saved: number;
  pruned: number;
  message: string;
  hits: Hit[];
};

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      timeZone: "Asia/Manila",
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** Lower = higher priority (LONG bias first). */
function biasRank(bias: string): number {
  const b = (bias || "").toUpperCase();
  if (b.includes("STRONG LONG")) return 0;
  if (b.includes("LONG") && !b.includes("SHORT")) return 1;
  if (b.includes("NEUTRAL")) return 2;
  if (b.includes("SHORT")) return 3;
  return 4;
}

type CoinFlag = "bad" | "monitor" | "nochase" | "neutral" | "";

function parseCompactSignals(note: string | null): string[] {
  if (!note) return [];
  // Prefer explicit segments after optional [TIER] prefix
  const body = note.replace(/^\[[^\]]+\]\s*/, "");
  const parts = body.split(" · ").map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (/^RSI/i.test(p)) {
      out.push(p.replace(/\s*\([+\-]\d+\)\s*$/, "").trim());
    } else if (/support|range|Position/i.test(p) && /%/.test(p)) {
      // keep "Near range support (3% of range)" style without trailing weight
      out.push(p.replace(/\s*—\s*discount zone.*/i, "").replace(/\s*\([+\-]\d+\)\s*$/, "").trim());
    } else if (/20 SMA|50 SMA|20\/50 SMA/i.test(p)) {
      out.push(p);
    }
  }
  // Fallback: take first 3 short parts if nothing matched
  if (out.length === 0) return parts.slice(0, 3).map((p) => p.slice(0, 80));
  return out.slice(0, 3);
}

function tierLabel(tier: string) {
  if (tier === "NEAR_SUPPORT_UP" || tier === "near_support_up") {
    return {
      text: "Near support · rising",
      cls: "bg-sky-100 text-sky-900",
    };
  }
  if (tier === "NEAR_CROSS" || tier === "near_cross") {
    return {
      text: "Near support · rising",
      cls: "bg-sky-100 text-sky-900",
    };
  }
  if (tier === "BUY_LOW" || tier === "buy_low") {
    return { text: "Buy-low", cls: "bg-emerald-100 text-emerald-900" };
  }
  if (tier === "EXTENDED" || tier === "extended") {
    return { text: "Extended", cls: "bg-amber-100 text-amber-900" };
  }
  return { text: "Watch", cls: "bg-slate-100 text-slate-700" };
}

export default function LongScanView() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [journalOpen, setJournalOpen] = useState(false);
  const [journalSymbol, setJournalSymbol] = useState<string | null>(null);
  const [journalPrice, setJournalPrice] = useState<number | null>(null);
  const [journalName, setJournalName] = useState<string | null>(null);
  const [priceBySymbol, setPriceBySymbol] = useState<Record<string, number>>({});
  const [journalCountBySymbol, setJournalCountBySymbol] = useState<Record<string, number>>({});
  const [journalEntries, setJournalEntries] = useState<JournalEntryView[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);
  const [journalDeletingId, setJournalDeletingId] = useState<number | null>(null);
  const [coinFlags, setCoinFlags] = useState<Record<string, CoinFlag>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/coin-flags");
        if (!res.ok) return;
        const data = (await res.json()) as { flags?: Record<string, string> };
        if (cancelled || !data.flags) return;
        const mapped: Record<string, CoinFlag> = {};
        for (const [k, v] of Object.entries(data.flags)) {
          if (v === "bad" || v === "monitor" || v === "nochase" || v === "neutral") {
            mapped[k.toUpperCase()] = v;
          }
        }
        setCoinFlags(mapped);
      } catch {
        /* offline — leave empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setCoinFlag = (symbol: string, flag: CoinFlag) => {
    const key = symbol.toUpperCase();
    setCoinFlags((prev) => {
      const next = { ...prev };
      const clearing = next[key] === flag;
      if (clearing) delete next[key];
      else next[key] = flag;
      const payloadFlag = clearing ? "" : flag;
      void fetch("/api/coin-flags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: key, flag: payloadFlag }),
      }).catch(() => {
        /* keep optimistic UI */
      });
      return next;
    });
  };



  /** Flatten hits across runs → group by coin (newest first). */
  const coinGroups = useMemo(() => {
    type Row = Hit & { scannedAt: string; runId: string };
    const map = new Map<string, { symbol: string; name: string; rows: Row[] }>();
    for (const run of runs) {
      for (const h of run.hits || []) {
        const key = h.symbol.toUpperCase();
        let g = map.get(key);
        if (!g) {
          g = { symbol: h.symbol, name: h.name, rows: [] };
          map.set(key, g);
        }
        g.rows.push({ ...h, scannedAt: run.scannedAt, runId: run.id });
      }
    }
    const groups = [...map.values()].map((g) => {
      g.rows.sort((a, b) => {
        const biasCmp = biasRank(a.bias) - biasRank(b.bias);
        if (biasCmp !== 0) return biasCmp;
        return b.scannedAt.localeCompare(a.scannedAt);
      });
      return g;
    });
    // Sort: STRONG LONG / LONG first (among them: stronger bias, then newest).
    // All other biases: newest result only (no score ranking).
    groups.sort((a, b) => {
      const bestBias = (rows: typeof a.rows) =>
        Math.min(...rows.map((r) => biasRank(r.bias)), 99);
      const newest = (rows: typeof a.rows) =>
        rows.reduce((m, r) => (r.scannedAt > m ? r.scannedAt : m), "");
      const aRank = bestBias(a.rows);
      const bRank = bestBias(b.rows);
      const aIsLong = aRank <= 1;
      const bIsLong = bRank <= 1;
      if (aIsLong !== bIsLong) return aIsLong ? -1 : 1;
      if (aIsLong && bIsLong) {
        if (aRank !== bRank) return aRank - bRank; // STRONG LONG before LONG
        const at = newest(a.rows);
        const bt = newest(b.rows);
        if (at !== bt) return bt.localeCompare(at);
        return a.symbol.localeCompare(b.symbol);
      }
      // Non-LONG: pure newest scan first
      const at = newest(a.rows);
      const bt = newest(b.rows);
      if (at !== bt) return bt.localeCompare(at);
      return a.symbol.localeCompare(b.symbol);
    });
    return groups;
  }, [runs]);

  const emptyRunCount = useMemo(
    () => runs.filter((r) => !r.hits?.length).length,
    [runs]
  );

  const lastScanAt = useMemo(() => {
    if (!runs.length) return null;
    return runs
      .map((r) => r.scannedAt)
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a))[0] || null;
  }, [runs]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/long-scan");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Load failed (${res.status})`);
      setRuns(Array.isArray(data.runs) ? data.runs : []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLivePrices = useCallback(async () => {
    try {
      const res = await fetch("/api/coins");
      if (!res.ok) return;
      const data = (await res.json()) as {
        coins?: { symbol: string; currentPrice: number | null }[];
      };
      const map: Record<string, number> = {};
      for (const c of data.coins || []) {
        if (c.currentPrice != null && Number.isFinite(c.currentPrice)) {
          map[c.symbol.toUpperCase()] = c.currentPrice;
        }
      }
      setPriceBySymbol(map);
    } catch {
      /* ignore — journal still works without live price */
    }
  }, []);

  const loadJournalCounts = useCallback(async (symbols: string[]) => {
    const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
    if (!unique.length) return;
    const from = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const next: Record<string, number> = {};
    await Promise.all(
      unique.map(async (sym) => {
        try {
          const res = await fetch(
            `/api/journal?symbol=${encodeURIComponent(sym)}&from=${from}`
          );
          if (!res.ok) return;
          const data = (await res.json()) as { entries?: { symbol: string | null }[] };
          const n = (data.entries || []).filter(
            (e) => e.symbol && e.symbol.toUpperCase() === sym
          ).length;
          next[sym] = n;
        } catch {
          /* ignore */
        }
      })
    );
    setJournalCountBySymbol((prev) => ({ ...prev, ...next }));
  }, []);

  useEffect(() => {
    void load();
    void loadLivePrices();
  }, [load, loadLivePrices]);

  useEffect(() => {
    const syms = runs.flatMap((r) => (r.hits || []).map((h) => h.symbol));
    if (syms.length) void loadJournalCounts(syms);
  }, [runs, loadJournalCounts]);

  const runNow = async () => {
    setRunning(true);
    setError(null);
    setInfo(null);
    try {
      // 4 chunks so each request stays under short host timeouts
      const CHUNKS = 10;
      let totalSaved = 0;
      for (let c = 0; c < CHUNKS; c++) {
        setInfo(`Scanning chunk ${c + 1}/${CHUNKS}…`);
        const res = await fetch(
          `/api/long-scan?chunks=${CHUNKS}&chunk=${c}&fast=1`,
          { method: "POST" }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Run failed (${res.status})`);
        totalSaved = data.totalSaved ?? totalSaved + (data.saved || 0);
      }
      setInfo(
        totalSaved > 0
          ? `Done · ${totalSaved} hit(s) across ${CHUNKS} chunks`
          : `Done · no hits · last scan ${formatWhen(new Date().toISOString())}`
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
      await load();
    } finally {
      setRunning(false);
    }
  };

  const removeRun = async (runId: string) => {
    setDeletingKey(runId);
    setError(null);
    const prev = runs;
    // Optimistic: drop run locally — no full page reload
    setRuns((r) => r.filter((x) => x.id !== runId));
    try {
      const res = await fetch(`/api/long-scan?runId=${encodeURIComponent(runId)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Delete failed");
    } catch (err) {
      setRuns(prev);
      setError((err as Error).message);
    } finally {
      setDeletingKey(null);
    }
  };

  const removeHit = async (runId: string, symbol: string) => {
    const key = `${runId}:${symbol}`;
    setDeletingKey(key);
    setError(null);
    const prev = runs;
    // Optimistic: remove hit from that run; drop run if no hits left
    setRuns((list) =>
      list
        .map((run) => {
          if (run.id !== runId) return run;
          const hits = (run.hits || []).filter(
            (h) => h.symbol.toUpperCase() !== symbol.toUpperCase()
          );
          return {
            ...run,
            hits,
            saved: hits.length,
            message:
              hits.length > 0
                ? run.message
                : "No near-support + rising setups this run.",
          };
        })
        .filter((run) => run.hits.length > 0 || run.message)
    );
    try {
      const res = await fetch(
        `/api/long-scan?runId=${encodeURIComponent(runId)}&symbol=${encodeURIComponent(symbol)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Delete failed");
    } catch (err) {
      setRuns(prev);
      setError((err as Error).message);
    } finally {
      setDeletingKey(null);
    }
  };

  const loadJournalForSymbol = useCallback(async (symbol: string) => {
    setJournalLoading(true);
    setJournalError(null);
    try {
      const from = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const sym = encodeURIComponent(symbol.toUpperCase());
      const res = await fetch(`/api/journal?symbol=${sym}&from=${from}`);
      if (!res.ok) throw new Error(`Failed to load journal (${res.status})`);
      const data = (await res.json()) as { entries: JournalEntryView[] };
      const all = data.entries || [];
      // API may include general (null symbol) when filtering by coin — keep only this coin
      const only = all.filter(
        (e) => e.symbol && e.symbol.toUpperCase() === symbol.toUpperCase()
      );
      setJournalEntries(only);
    } catch (err) {
      setJournalError((err as Error).message);
      setJournalEntries([]);
    } finally {
      setJournalLoading(false);
    }
  }, []);

  const openJournal = (symbol: string, opts?: { name?: string | null }) => {
    const key = symbol.toUpperCase();
    setJournalSymbol(symbol);
    setJournalName(opts?.name ?? null);
    setJournalPrice(priceBySymbol[key] ?? null);
    setJournalOpen(true);
    void loadJournalForSymbol(symbol);
    // refresh live price when opening
    void (async () => {
      try {
        const res = await fetch("/api/coins");
        if (!res.ok) return;
        const data = (await res.json()) as {
          coins?: { symbol: string; currentPrice: number | null }[];
        };
        const coin = (data.coins || []).find((c) => c.symbol.toUpperCase() === key);
        if (coin?.currentPrice != null && Number.isFinite(coin.currentPrice)) {
          setJournalPrice(coin.currentPrice);
          setPriceBySymbol((prev) => ({ ...prev, [key]: coin.currentPrice as number }));
        }
      } catch {
        /* keep prior */
      }
    })();
  };

  const closeJournal = () => {
    setJournalOpen(false);
    setJournalSymbol(null);
    setJournalName(null);
    setJournalPrice(null);
    setJournalEntries([]);
    setJournalError(null);
  };



  const deleteJournalEntry = async (id: number) => {
    if (!window.confirm("Delete this journal note? This cannot be undone.")) return;
    setJournalDeletingId(id);
    setJournalError(null);
    try {
      const res = await fetch("/api/journal", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `Delete failed (${res.status})`);
      }
      setJournalEntries((prev) => prev.filter((e) => e.id !== id));
      if (journalSymbol) {
        const key = journalSymbol.toUpperCase();
        setJournalCountBySymbol((prev) => ({
          ...prev,
          [key]: Math.max(0, (prev[key] ?? 1) - 1),
        }));
      }
    } catch (err) {
      setJournalError((err as Error).message);
    } finally {
      setJournalDeletingId(null);
    }
  };


  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">LONG scan log</h1>
          <p className="text-sm text-gray-600 mt-1">
            {lastScanAt ? (
              <>
                Last scan:{" "}
                <span className="font-bold text-indigo-800">{formatWhen(lastScanAt)}</span>
                <span className="text-gray-500"> · Manila</span>
              </>
            ) : (
              <>No scans yet — use Run scan now.</>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runNow()}
          disabled={running}
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
        >
          {running ? "Scanning…" : "↻ Run scan now"}
        </button>
      </div>

      {error && <AlertBanner variant="error" message={error} />}
      {info && (
        <p className="mb-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-md px-3 py-2">
          {info}
        </p>
      )}

      {loading ? (
        <div className="space-y-3 animate-pulse" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : coinGroups.length === 0 && runs.length === 0 ? (
        <p className="text-sm text-gray-500">
          No runs yet. Use <span className="font-semibold">Run scan now</span> or wait for the
          schedule.
        </p>
      ) : coinGroups.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <p className="font-semibold text-slate-800">No coin hits stored yet</p>
          <p className="mt-1 text-xs">
            {runs.length} run(s) logged · {emptyRunCount} empty
            {lastScanAt ? (
              <>
                {" "}
                · Last scan:{" "}
                <span className="font-semibold text-indigo-800">{formatWhen(lastScanAt)}</span>
              </>
            ) : null}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-[11px] text-gray-500">
            {coinGroups.length} coin(s) with saved hits (not full watchlist size — BTC/ETH/XAUT skipped in
            scan; only coins that matched a run appear here) ·{" "}
            <span className="font-semibold text-slate-700">STRONG LONG / LONG first</span>, then newest
            non-LONG · newest hit first inside each card
          </p>
          {coinGroups.map((g) => {
            return (
              <section
                key={g.symbol}
                className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gradient-to-r from-indigo-50/80 to-white px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-extrabold text-slate-900 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate">
                        {g.name}{" "}
                        <span className="font-mono text-sm font-bold text-indigo-700">
                          {g.symbol}
                        </span>
                      </span>
                      {priceBySymbol[g.symbol.toUpperCase()] != null ? (
                        <span className="font-bold tabular-nums text-sky-800">
                          {formatPhp(priceBySymbol[g.symbol.toUpperCase()])}
                        </span>
                      ) : null}
                      <span
                        className="inline-flex items-center gap-1"
                        role="group"
                        aria-label="Coin status flag"
                      >
                        {(
                          [
                            { id: "bad" as const, label: "Bad", title: "Bad news", cls: "bg-red-500 border-red-600", idle: "bg-red-200 border-red-300" },
                            { id: "monitor" as const, label: "Watch", title: "Monitor", cls: "bg-orange-500 border-orange-600", idle: "bg-orange-200 border-orange-300" },
                            { id: "nochase" as const, label: "No chase", title: "Don't chase", cls: "bg-purple-500 border-purple-600", idle: "bg-purple-200 border-purple-300" },
                            { id: "neutral" as const, label: "Neutral", title: "Neutral", cls: "bg-slate-500 border-slate-600", idle: "bg-slate-300 border-slate-400" },
                          ] as const
                        ).map((f) => {
                          const active = (coinFlags[g.symbol.toUpperCase()] || "") === f.id;
                          return (
                            <button
                              key={f.id}
                              type="button"
                              title={f.title}
                              aria-pressed={active}
                              onClick={() => setCoinFlag(g.symbol, f.id)}
                              className={`h-5 w-5 sm:h-6 sm:w-6 rounded-full border-2 transition ${
                                active
                                  ? `${f.cls} ring-2 ring-offset-1 ring-slate-400 scale-110 opacity-100`
                                  : `${f.idle} opacity-40 hover:opacity-70`
                              }`}
                            >
                              <span className="sr-only">{f.label}</span>
                            </button>
                          );
                        })}
                      </span>
                    </h2>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openJournal(g.symbol, { name: g.name })}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-800 hover:bg-slate-50"
                      title={`Journal notes for ${g.symbol}`}
                    >
                      📓 Journal
                      {(journalCountBySymbol[g.symbol.toUpperCase()] ?? 0) > 0 ? (
                        <span className="ml-1 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {journalCountBySymbol[g.symbol.toUpperCase()]}
                        </span>
                      ) : (
                        <span className="ml-1 text-[10px] font-semibold text-slate-400">0</span>
                      )}
                    </button>
                    <Link
                      href={`/chart?symbol=${encodeURIComponent(g.symbol)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-700"
                    >
                      Spot →
                    </Link>
                  </div>
                </div>

                <div className="divide-y divide-gray-100">
                  {g.rows.map((h) => {
                    const tlab = tierLabel(h.tier);
                    return (
                      <article
                        key={`${h.runId}-${h.symbol}-${h.scannedAt}`}
                        className="px-4 py-3 hover:bg-slate-50/60"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <time className="text-xs font-bold text-indigo-900 tabular-nums">
                            🕒 {formatWhen(h.scannedAt)}
                          </time>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${tlab.cls}`}
                            >
                              {tlab.text}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                biasRank(h.bias) <= 1
                                  ? "bg-emerald-600 text-white"
                                  : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {h.bias} · {h.score >= 0 ? "+" : ""}
                              {h.score}/±{h.maxScore}
                            </span>
                            <button
                              type="button"
                              onClick={() => void removeHit(h.runId, h.symbol)}
                              disabled={deletingKey === `${h.runId}:${h.symbol}`}
                              className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 shadow-sm hover:bg-rose-100 disabled:opacity-50"
                              title="Remove this hit"
                            >
                              {deletingKey === `${h.runId}:${h.symbol}` ? "…" : "🗑 Delete"}
                            </button>
                          </div>
                        </div>

                        <div className="text-sm font-bold text-slate-900 mb-1">
                          {formatPhp(h.currentPrice)}
                          {h.support != null && (
                            <span className="text-xs font-normal text-gray-500">
                              {" "}
                              · S {formatPhp(h.support)}
                            </span>
                          )}
                          {h.resistance != null && (
                            <span className="text-xs font-normal text-gray-500">
                              {" "}
                              · R {formatPhp(h.resistance)}
                            </span>
                          )}
                        </div>

                        {h.ladder?.length > 0 && (
                          <ul className="mb-1 space-y-0.5 text-xs text-gray-800">
                            {h.ladder.map((lvl, i) => (
                              <li key={i} className="flex justify-between gap-2 font-mono">
                                <span>
                                  ~{formatPhp(lvl.price)}{" "}
                                  <span className="text-gray-500 font-sans">({lvl.basis})</span>
                                </span>
                                <span className="text-gray-600">{lvl.allocationPct}%</span>
                              </li>
                            ))}
                          </ul>
                        )}

                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                          {h.invalidation != null && (
                            <span className="text-rose-800">
                              <span className="font-bold">Stop</span> ~{formatPhp(h.invalidation)}
                            </span>
                          )}
                          {h.target != null && (
                            <span className="text-emerald-800">
                              <span className="font-bold">Target</span> ~{formatPhp(h.target)}
                            </span>
                          )}
                        </div>
                        {h.signalsNote && (
                          <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-600">
                            {parseCompactSignals(h.signalsNote).map((line, i) => (
                              <li key={i} className="leading-snug">
                                {line}
                              </li>
                            ))}
                          </ul>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {journalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Journal notes"
          onClick={closeJournal}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-t-2xl sm:rounded-xl border border-gray-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
              <div>
                <h2 className="text-base font-bold text-gray-900">
                  Journal · {journalName || journalSymbol || "—"}
                  {journalSymbol ? (
                    <span className="ml-1 font-mono text-sm font-bold text-indigo-700">
                      {journalSymbol}
                    </span>
                  ) : null}
                </h2>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {journalPrice != null ? (
                    <>
                      Current price:{" "}
                      <span className="font-bold tabular-nums text-slate-800">
                        {formatPhp(journalPrice)}
                      </span>
                      {" · "}
                    </>
                  ) : null}
                  Notes for this coin only · read-only · delete if outdated. Add/edit on Spot or Home.
                </p>
              </div>
              <button
                type="button"
                onClick={closeJournal}
                className="rounded-md border border-gray-200 px-2 py-1 text-sm font-bold text-gray-600 hover:bg-gray-50"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto px-4 py-3 space-y-3">
              {journalError && (
                <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-2 py-1.5">
                  {journalError}
                </p>
              )}
              {journalLoading ? (
                <div className="space-y-2 animate-pulse">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 rounded-lg bg-gray-100" />
                  ))}
                </div>
              ) : journalEntries.length === 0 ? (
                <p className="text-sm text-gray-500 py-6 text-center">No journal notes for this coin yet.</p>
              ) : (
                journalEntries.map((e) => (
                  <article
                    key={e.id}
                    className="rounded-lg border border-gray-200 bg-slate-50/80 p-3"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-gray-900 truncate">{e.title?.trim() || ""}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {e.symbol ? (
                            <span className="font-semibold text-indigo-700">{e.symbol}</span>
                          ) : (
                            <span className="font-semibold text-slate-600">General</span>
                          )}
                          {" · "}
                          {new Date(e.entryDate).toLocaleDateString(undefined, {
                            timeZone: "Asia/Manila",
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                          {" · saved "}
                          {new Date(e.createdAt).toLocaleString(undefined, {
                            timeZone: "Asia/Manila",
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void deleteJournalEntry(e.id)}
                        disabled={journalDeletingId === e.id}
                        className="shrink-0 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                        title="Delete this note"
                      >
                        {journalDeletingId === e.id ? "…" : "🗑 Delete"}
                      </button>
                    </div>
                    <div className="mt-2">
                      <FormattedAiResponse text={e.notes} />
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}