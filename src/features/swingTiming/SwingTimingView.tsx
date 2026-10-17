import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AlertBanner from "@/components/AlertBanner";

type SlotStat = {
  hour: number;
  label: string;
  sampleCount: number;
  coinCount: number;
  avgAbsPct: number;
  medianAbsPct: number;
  pctMovesAbove1: number;
  rank: number;
  intensity: "quiet" | "normal" | "active" | "hot";
};

type CoinSlotHighlight = {
  symbol: string;
  name: string;
  avgAbsPct: number;
  samples: number;
};

type TimingResponse = {
  days: number;
  generatedAt: string;
  slots: SlotStat[];
  hottestSlot: SlotStat | null;
  quietestSlot: SlotStat | null;
  topMoversByHotSlot: CoinSlotHighlight[];
  guidance: string[];
};

const INTENSITY_STYLES: Record<
  SlotStat["intensity"],
  { bar: string; badge: string; label: string }
> = {
  quiet: {
    bar: "bg-slate-300",
    badge: "bg-slate-100 text-slate-700 border-slate-200",
    label: "Quiet",
  },
  normal: {
    bar: "bg-sky-400",
    badge: "bg-sky-50 text-sky-800 border-sky-200",
    label: "Normal",
  },
  active: {
    bar: "bg-amber-400",
    badge: "bg-amber-50 text-amber-900 border-amber-200",
    label: "Active",
  },
  hot: {
    bar: "bg-rose-500",
    badge: "bg-rose-50 text-rose-800 border-rose-200",
    label: "Hot",
  },
};

export default function SwingTimingView() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TimingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/swing-timing?days=${d}`);
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const json: TimingResponse = await res.json();
      setData(json);
    } catch (err) {
      setError((err as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const maxAvg = data ? Math.max(...data.slots.map((s) => s.avgAbsPct), 0.01) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-gray-600 max-w-2xl">
            Which of your <span className="font-semibold">~3h poll windows</span> usually move the
            most across all monitored coins. Use this to pick calmer times for limit entries vs
            noisier times to watch — not as a buy signal. Confirm bias on{" "}
            <Link href="/chart" className="font-semibold text-purple-700 hover:underline">
              Spot
            </Link>
            .
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[14, 30, 60].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold border transition-colors ${
                days === d
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {loading && (
        <p className="text-sm text-gray-500 py-8 text-center">Computing slot-to-slot swings…</p>
      )}

      {!loading && data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.hottestSlot && (
              <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wide text-rose-800">
                  Most swingy window
                </div>
                <div className="mt-1 text-lg font-bold text-rose-950">{data.hottestSlot.label}</div>
                <div className="mt-1 text-sm text-rose-900">
                  Avg |move| <span className="font-mono font-bold">{data.hottestSlot.avgAbsPct}%</span>
                  <span className="text-rose-700/80">
                    {" "}
                    · median {data.hottestSlot.medianAbsPct}% · {data.hottestSlot.pctMovesAbove1}% of
                    moves ≥1%
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-rose-800/90">
                  Higher noise — better for watching breaks/sweeps than for calm limit fills.
                </p>
              </div>
            )}
            {data.quietestSlot && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
                  Quietest window
                </div>
                <div className="mt-1 text-lg font-bold text-slate-900">{data.quietestSlot.label}</div>
                <div className="mt-1 text-sm text-slate-800">
                  Avg |move|{" "}
                  <span className="font-mono font-bold">{data.quietestSlot.avgAbsPct}%</span>
                  <span className="text-slate-600">
                    {" "}
                    · median {data.quietestSlot.medianAbsPct}%
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-slate-600">
                  Often better for staging ladder limits when Spot already supports a long.
                </p>
              </div>
            )}
          </div>

          {data.guidance.length > 0 && (
            <ul className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-4 py-3 text-[12px] text-indigo-950 space-y-1.5 list-disc list-inside">
              {data.guidance.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          )}

          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold text-gray-900 mb-1">
              Poll windows ranked by activity ({data.days} days)
            </h2>
            <p className="text-[11px] text-gray-500 mb-4">
              |% change| from the previous poll to this slot, averaged across all monitored coins.
              Bar length = relative heat.
            </p>
            <div className="space-y-3">
              {[...data.slots]
                .sort((a, b) => b.avgAbsPct - a.avgAbsPct)
                .map((slot) => {
                  const style = INTENSITY_STYLES[slot.intensity];
                  const widthPct = Math.max(6, (slot.avgAbsPct / maxAvg) * 100);
                  return (
                    <div key={slot.hour} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold ${style.badge}`}
                          >
                            #{slot.rank} {style.label}
                          </span>
                          <span className="font-semibold text-gray-900 truncate">{slot.label}</span>
                        </div>
                        <div className="flex items-center gap-3 text-gray-600 shrink-0">
                          <span className="font-mono font-bold text-gray-900">
                            {slot.avgAbsPct}% avg
                          </span>
                          <span className="hidden sm:inline">med {slot.medianAbsPct}%</span>
                          <span className="hidden md:inline">
                            ≥1%: {slot.pctMovesAbove1}%
                          </span>
                          <span className="text-gray-400">{slot.sampleCount} samples</span>
                        </div>
                      </div>
                      <div className="h-2.5 w-full rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${style.bar} transition-all`}
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {data.topMoversByHotSlot.length > 0 && data.hottestSlot && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 mb-1">
                Most active coins in the hottest window
              </h2>
              <p className="text-[11px] text-gray-500 mb-3">
                {data.hottestSlot.label} — coins with the largest average |move| into that slot
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {data.topMoversByHotSlot.map((c) => (
                  <Link
                    key={c.symbol}
                    href={`/structure?symbol=${encodeURIComponent(c.symbol)}`}
                    className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2 text-xs hover:border-indigo-300 hover:bg-indigo-50/40 transition"
                  >
                    <span className="font-semibold text-gray-900">
                      {c.name}{" "}
                      <span className="font-normal text-gray-400">({c.symbol})</span>
                    </span>
                    <span className="font-mono font-bold text-indigo-800">
                      {c.avgAbsPct}%
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-gray-400">
            Generated {new Date(data.generatedAt).toLocaleString()} · based on consecutive polls ≤5h
            apart · Manila hours
          </p>
        </>
      )}
    </div>
  );
}
