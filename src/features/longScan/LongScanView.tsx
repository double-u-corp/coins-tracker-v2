import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AlertBanner from "@/components/AlertBanner";
import { formatPhp } from "@/lib/format";

type LadderLevel = { price: number; basis: string; allocationPct: number };

type Hit = {
  id: number;
  symbol: string;
  name: string;
  scannedAt: string;
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
  invalidationNote: string | null;
  target: number | null;
  targetNote: string | null;
  macroTrend: string | null;
  signalsNote: string | null;
};

type Run = {
  id: number;
  scannedAt: string;
  scanned: number;
  saved: number;
  pruned: number;
  message: string | null;
};

/** Manila hours (:10) every 3h — 02:10, 05:10, 08:10, 11:10, 14:10, 17:10, 20:10, 23:10. */
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

/** Next scheduled :10 slot in Asia/Manila. */
function nextScheduledRun(from = new Date()): Date {
  const manilaMs = from.getTime() + 8 * 60 * 60 * 1000;
  const d = new Date(manilaMs);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const day = d.getUTCDate();
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes();

  for (let add = 0; add <= 1; add++) {
    const base = new Date(Date.UTC(y, mo, day + add));
    for (const hour of MANILA_RUN_HOURS) {
      const candidateManila = new Date(
        Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour, 10, 0)
      );
      // convert Manila wall to UTC instant
      const utc = new Date(candidateManila.getTime() - 8 * 60 * 60 * 1000);
      if (utc.getTime() > from.getTime() + 30_000) return utc;
    }
  }
  // fallback +3h
  return new Date(from.getTime() + 3 * 60 * 60 * 1000);
}

function tierOf(h: Hit): "buy_low" | "watch" | "extended" | "near_cross" {
  const n = h.signalsNote || "";
  if (n.startsWith("[NEAR_CROSS]")) return "near_cross";
  if (n.startsWith("[BUY_LOW]")) return "buy_low";
  if (n.startsWith("[EXTENDED]") || h.isExtended) return "extended";
  if (n.startsWith("[LONG_WATCH]")) return "watch";
  return h.isExtended ? "extended" : "watch";
}

export default function LongScanView() {
  const [hits, setHits] = useState<Hit[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const nextRun = useMemo(() => nextScheduledRun(now), [now]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/long-scan?limit=150");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Load failed (${res.status})`);
      setHits(Array.isArray(data.hits) ? data.hits : []);
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
      const res = await fetch("/api/long-scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Run failed (${res.status})`);
      setInfo(
        data.saved > 0
          ? `Saved ${data.saved} LONG · checked ${data.scanned}`
          : `No LONG hits this run · checked ${data.scanned} · next schedule ~${formatWhen(nextScheduledRun().toISOString())}`
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const removeHit = async (id: number) => {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/long-scan?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setHits((prev) => prev.filter((h) => h.id !== id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  const removeRun = async (runId: number) => {
    setDeletingRunId(runId);
    setError(null);
    try {
      const res = await fetch(`/api/long-scan?runId=${runId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingRunId(null);
    }
  };

  // Prefer run log; fall back to unique hit times for older data
  const displayRuns = useMemo(() => {
    if (runs.length > 0) return runs;
    const byTime = new Map<string, Run>();
    for (const h of hits) {
      if (!byTime.has(h.scannedAt)) {
        byTime.set(h.scannedAt, {
          id: -byTime.size - 1,
          scannedAt: h.scannedAt,
          scanned: 0,
          saved: 0,
          pruned: 0,
          message: null,
        });
      }
      const r = byTime.get(h.scannedAt)!;
      r.saved += 1;
    }
    return Array.from(byTime.values()).sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
  }, [runs, hits]);

  const hitsFor = (scannedAt: string) =>
    hits.filter((h) => h.scannedAt === scannedAt || Math.abs(Date.parse(h.scannedAt) - Date.parse(scannedAt)) < 2000);

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
      ) : displayRuns.length === 0 ? (
        <p className="text-sm text-gray-500">
          No runs yet. Use <span className="font-semibold">Run scan now</span> or wait for the
          schedule.
        </p>
      ) : (
        <div className="space-y-8">
          {displayRuns.map((run) => {
            const runHits = hitsFor(run.scannedAt);
            const when = formatWhen(run.scannedAt);
            const empty = run.saved === 0 && runHits.length === 0;
            return (
              <section key={run.id + run.scannedAt}>
                <div
                  className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 px-3 py-2.5 shadow-sm ${
                    empty
                      ? "border-slate-200 bg-slate-50"
                      : "border-indigo-200 bg-indigo-50"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xl shrink-0" aria-hidden>
                      🕒
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-base font-extrabold text-slate-900 tracking-tight">
                        {when}
                      </h2>
                      <p className="text-[11px] font-semibold text-slate-600">
                        {empty
                          ? `No LONG hits · checked ${run.scanned || "—"} coins`
                          : `${runHits.length || run.saved} LONG · checked ${run.scanned || "—"}`}
                        {run.message ? ` · ${run.message}` : ""}
                      </p>
                    </div>
                  </div>
                  {run.id > 0 && (
                    <button
                      type="button"
                      onClick={() => void removeRun(run.id)}
                      disabled={deletingRunId === run.id}
                      className="rounded border border-gray-200 bg-white px-2 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    >
                      {deletingRunId === run.id ? "…" : "Delete run"}
                    </button>
                  )}
                </div>

                {empty ? (
                  <p className="text-sm text-slate-500 pl-1 mb-1">
                    No LONG / near-support·20SMA setups this pass. Next scheduled:{" "}
                    <span className="font-semibold text-indigo-800">
                      {formatWhen(nextRun.toISOString())}
                    </span>
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {runHits.map((h) => {
                      const tier = tierOf(h);
                      return (
                        <article
                          key={h.id}
                          className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-base font-bold text-gray-900">{h.name}</span>
                                <span className="font-mono text-[10px] text-gray-500">
                                  {h.symbol}
                                </span>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                    h.bias === "STRONG LONG"
                                      ? "bg-emerald-600 text-white"
                                      : "bg-emerald-100 text-emerald-900"
                                  }`}
                                >
                                  {h.bias}
                                </span>
                                {tier === "near_cross" ? (
                                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-900">
                                    Near support · 20 SMA
                                  </span>
                                ) : tier === "buy_low" ? (
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
                                    Buy-low
                                  </span>
                                ) : tier === "extended" ? (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                                    Extended
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                                    Watch
                                  </span>
                                )}
                              </div>
                              <p className="mt-1.5 inline-flex items-center rounded-md bg-slate-900 px-2 py-1 text-[11px] font-bold text-white">
                                {formatWhen(h.scannedAt)}
                              </p>
                              <p className="text-[11px] text-gray-500 mt-1">
                                score {h.score >= 0 ? "+" : ""}
                                {h.score}/±{h.maxScore} · {(h.confidence * 100).toFixed(0)}% data
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Link
                                href={`/chart?symbol=${encodeURIComponent(h.symbol)}`}
                                className="text-[11px] font-bold text-brand-600 hover:underline"
                              >
                                Spot →
                              </Link>
                              <button
                                type="button"
                                onClick={() => void removeHit(h.id)}
                                disabled={deletingId === h.id}
                                className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                              >
                                {deletingId === h.id ? "…" : "✕"}
                              </button>
                            </div>
                          </div>

                          <div className="text-sm font-semibold text-gray-900 mb-2">
                            Price {formatPhp(h.currentPrice)}
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

                          {h.ladder.length > 0 && (
                            <div className="mb-2">
                              <p className="text-[11px] font-bold uppercase text-gray-500 mb-1">
                                Entry ladder
                              </p>
                              <ul className="space-y-0.5 text-xs text-gray-800">
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
                            </div>
                          )}

                          {h.invalidation != null && (
                            <p className="text-xs text-rose-800 mb-1">
                              <span className="font-bold">Stop:</span> ~{formatPhp(h.invalidation)}
                            </p>
                          )}
                          {h.target != null && (
                            <p className="text-xs text-emerald-800 mb-1">
                              <span className="font-bold">Target:</span> ~{formatPhp(h.target)}
                            </p>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
