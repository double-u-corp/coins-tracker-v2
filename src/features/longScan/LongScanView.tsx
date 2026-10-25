import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AlertBanner from "@/components/AlertBanner";
import { formatPhp } from "@/lib/format";

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

const MANILA_RUN_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];

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

function nextScheduledRun(from = new Date()): Date {
  const manilaMs = from.getTime() + 8 * 60 * 60 * 1000;
  const d = new Date(manilaMs);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const day = d.getUTCDate();

  for (let add = 0; add <= 1; add++) {
    const base = new Date(Date.UTC(y, mo, day + add));
    for (const hour of MANILA_RUN_HOURS) {
      const candidateManila = new Date(
        Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour, 10, 0)
      );
      const utc = new Date(candidateManila.getTime() - 8 * 60 * 60 * 1000);
      if (utc.getTime() > from.getTime() + 30_000) return utc;
    }
  }
  return new Date(from.getTime() + 3 * 60 * 60 * 1000);
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
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const nextRun = useMemo(() => nextScheduledRun(now), [now]);

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
      g.rows.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
      return g;
    });
    // Sort coins: most recent hit first, then symbol
    groups.sort((a, b) => {
      const at = a.rows[0]?.scannedAt || "";
      const bt = b.rows[0]?.scannedAt || "";
      if (at !== bt) return bt.localeCompare(at);
      return a.symbol.localeCompare(b.symbol);
    });
    return groups;
  }, [runs]);

  const emptyRunCount = useMemo(
    () => runs.filter((r) => !r.hits?.length).length,
    [runs]
  );

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

  useEffect(() => {
    void load();
  }, [load]);

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
          : `Done · no hits · next ~${formatWhen(nextScheduledRun().toISOString())}`
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">LONG scan log</h1>
          <p className="text-sm text-gray-600 mt-1">
            Schedule: every 3 hours at :10 Manila (14:10, 17:10, 20:10, …). Next:{" "}
            <span className="font-bold text-indigo-800">{formatWhen(nextRun.toISOString())}</span>
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
            {runs.length} run(s) logged · {emptyRunCount} empty. Next:{" "}
            <span className="font-semibold text-indigo-800">
              {formatWhen(nextRun.toISOString())}
            </span>
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-[11px] text-gray-500">
            {coinGroups.length} coin(s) · grouped by symbol · newest scan first inside each card
          </p>
          {coinGroups.map((g) => {
            return (
              <section
                key={g.symbol}
                className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gradient-to-r from-indigo-50/80 to-white px-4 py-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-extrabold text-slate-900 truncate">
                      {g.name}{" "}
                      <span className="font-mono text-sm font-bold text-indigo-700">
                        {g.symbol}
                      </span>
                    </h2>
                  </div>
                  <Link
                    href={`/chart?symbol=${encodeURIComponent(g.symbol)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-700"
                  >
                    Spot →
                  </Link>
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
                            <span className="text-[10px] font-bold text-slate-600">
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
                          <p className="mt-1.5 text-[10px] text-gray-500 line-clamp-2">
                            {h.signalsNote}
                          </p>
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
    </div>
  );
}
