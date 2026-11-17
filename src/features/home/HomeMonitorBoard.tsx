import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatPhp } from "@/lib/format";
import type { HomeMonitorSnapshot, MonitorHitBase } from "@/lib/homeMonitorScan";

type CoinPx = { symbol: string; name?: string; currentPrice?: number | null };

function pctChange(atScan: number, now: number | null | undefined): number | null {
  if (!(atScan > 0) || now == null || !(now > 0)) return null;
  return ((now - atScan) / atScan) * 100;
}

function HitRow({
  hit,
  nowPrice,
}: {
  hit: MonitorHitBase;
  nowPrice: number | null | undefined;
}) {
  const ch = pctChange(hit.priceAtScan, nowPrice);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2">
      <div className="min-w-0">
        <div className="text-sm font-bold text-slate-900 truncate">
          {hit.name}{" "}
          <span className="font-mono text-[10px] font-semibold text-slate-500">{hit.symbol}</span>
        </div>
        <p className="text-[11px] text-slate-600 leading-snug">{hit.detail}</p>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[10px] font-bold uppercase text-slate-400">At scan → now</div>
        <div className="font-mono text-xs font-bold text-slate-800">
          {formatPhp(hit.priceAtScan)}
          <span className="text-slate-400"> → </span>
          {nowPrice != null && nowPrice > 0 ? formatPhp(nowPrice) : "—"}
        </div>
        {ch != null && (
          <div
            className={`text-[11px] font-extrabold tabular-nums ${
              ch >= 0 ? "text-emerald-700" : "text-rose-700"
            }`}
          >
            {ch >= 0 ? "+" : ""}
            {ch.toFixed(2)}% since scan
          </div>
        )}
        <Link
          href={`/chart?symbol=${encodeURIComponent(hit.symbol)}`}
          className="text-[11px] font-bold text-indigo-600 hover:underline"
        >
          Spot →
        </Link>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  hits,
  priceBySym,
  empty,
}: {
  title: string;
  subtitle: string;
  hits: MonitorHitBase[];
  priceBySym: Map<string, number | null>;
  empty: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-2">
      <div>
        <h3 className="text-sm font-extrabold text-slate-900">{title}</h3>
        <p className="text-[11px] text-slate-500">{subtitle}</p>
      </div>
      {hits.length === 0 ? (
        <p className="text-xs text-slate-500 py-2">{empty}</p>
      ) : (
        <div className="space-y-1.5">
          {hits.map((h) => (
            <HitRow
              key={h.symbol}
              hit={h}
              nowPrice={priceBySym.get(h.symbol.toUpperCase()) ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Near support + fast pump + RSI oversold from ONE saved bulk scan.
 * Home load = GET snapshot only. POST only when user clicks Run.
 */
export default function HomeMonitorBoard({ universe }: { universe: CoinPx[] }) {
  const [snap, setSnap] = useState<HomeMonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceBySym = new Map<string, number | null>();
  for (const c of universe) {
    if (c.symbol) priceBySym.set(c.symbol.toUpperCase(), c.currentPrice ?? null);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/home-monitor-scan");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setSnap(data.snapshot ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/home-monitor-scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setSnap(data.snapshot ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="mb-6 rounded-xl border border-indigo-100 bg-white p-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-indigo-950">Monitor board</h2>
          <p className="text-[11px] text-slate-500 max-w-xl">
            Near 30d support · Fast pump · RSI oversold — one bulk scan, saved for reference.
            Home does not re-scan on every visit. Compare <span className="font-semibold">price at scan</span>{" "}
            vs live price below.
          </p>
          {snap?.scannedAt && (
            <p className="mt-1 text-[11px] font-bold text-indigo-800">
              Last run: {snap.scannedAtManila || new Date(snap.scannedAt).toLocaleString()} ·{" "}
              {snap.coinCount} coins
            </p>
          )}
          {!snap && !loading && (
            <p className="mt-1 text-[11px] font-semibold text-amber-800">
              No saved run yet — click Run monitor scan once.
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={running}
          onClick={() => void run()}
          className="rounded-md border border-indigo-300 bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {running ? "Scanning…" : "↻ Run monitor scan"}
        </button>
      </div>

      {error && <p className="text-xs text-rose-600">{error}</p>}
      {loading && <p className="text-xs text-slate-500">Loading last snapshot…</p>}

      {!loading && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Section
            title="Near 30-day support · top 8"
            subtitle="Discount zone vs 30d range at last scan"
            hits={snap?.nearSupport || []}
            priceBySym={priceBySym}
            empty="None in snapshot — run scan."
          />
          <Section
            title="Fast pump above 20 SMA · top 3"
            subtitle="Quick lift / fresh cross — watch cool-down"
            hits={snap?.fastPump || []}
            priceBySym={priceBySym}
            empty="None in snapshot — run scan."
          />
          <Section
            title="RSI oversold · top 8"
            subtitle="RSI-14 ≤ 40 at last scan"
            hits={snap?.rsiOversold || []}
            priceBySym={priceBySym}
            empty="None in snapshot — run scan."
          />
        </div>
      )}
    </section>
  );
}
