import { useCallback, useEffect, useState } from "react";
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

export default function LongScanView() {
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/long-scan?limit=150");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Load failed (${res.status})`);
      setHits(Array.isArray(data.hits) ? data.hits : []);
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
        `Scanned ${data.scanned} · saved ${data.saved} LONG · pruned ${data.pruned}` +
          (data.errors?.length ? ` · ${data.errors.length} error(s)` : "")
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const remove = async (id: number) => {
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

  const groups = hits.reduce<Record<string, Hit[]>>((acc, h) => {
    const day = new Date(h.scannedAt).toLocaleDateString("en-CA", {
      timeZone: "Asia/Manila",
    });
    (acc[day] ||= []).push(h);
    return acc;
  }, {});
  const days = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Daily LONG scan</h1>
          <p className="text-sm text-gray-500 max-w-xl">
            Auto-runs ~14:10 Manila · same filter as Spot{" "}
            <span className="font-semibold">Scan all coins</span> (buy-low LONGs near
            support / lower third — not extended mid-range). Price, ladder, stop &amp;
            target. 30-day retention · delete anytime.
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
            <div key={i} className="h-28 rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : hits.length === 0 ? (
        <p className="text-sm text-gray-500">
          No saved LONGs yet. Wait for the 14:10 cron or run a scan now.
        </p>
      ) : (
        <div className="space-y-8">
          {days.map((day) => (
            <section key={day}>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-600">
                {day} · {groups[day].length} hit{groups[day].length === 1 ? "" : "s"}
              </h2>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {groups[day].map((h) => (
                  <article
                    key={h.id}
                    className={`rounded-xl border bg-white p-4 shadow-sm ${
                      h.isExtended ? "border-amber-200" : "border-emerald-100"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-bold text-gray-900">{h.name}</span>
                          <span className="font-mono text-[10px] text-gray-500">{h.symbol}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              h.bias === "STRONG LONG"
                                ? "bg-emerald-600 text-white"
                                : "bg-emerald-100 text-emerald-900"
                            }`}
                          >
                            {h.bias}
                          </span>
                          {h.isExtended && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                              Extended — wait pullback
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          {formatWhen(h.scannedAt)} · score {h.score >= 0 ? "+" : ""}
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
                          onClick={() => void remove(h.id)}
                          disabled={deletingId === h.id}
                          className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                          title="Delete"
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
                        <span className="font-bold">Stop / invalidation:</span> ~{formatPhp(h.invalidation)}
                      </p>
                    )}
                    {h.target != null && (
                      <p className="text-xs text-emerald-800 mb-1">
                        <span className="font-bold">Target:</span> ~{formatPhp(h.target)}
                      </p>
                    )}
                    {h.macroTrend && (
                      <p className="text-[11px] text-gray-500">Macro: {h.macroTrend}</p>
                    )}
                    {h.signalsNote && (
                      <p className="mt-1 text-[10px] text-gray-400 line-clamp-2">{h.signalsNote}</p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
