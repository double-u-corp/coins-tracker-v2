import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatPhp } from "@/lib/format";
import { calculateSMASeries } from "@/features/chart/Technicals";

type PollPt = {
  day: string;
  hour: number;
  label: string;
  price: number;
  isDayStart: boolean;
};

type DailyPt = { period: string; high: number; low: number; close?: number };

const SLOT_HOURS = [2, 5, 8, 11, 14, 17, 20, 23] as const;

async function fetchPoll3h(symbol: string): Promise<PollPt[]> {
  const res = await fetch(
    `/api/coins?type=chart&symbol=${encodeURIComponent(symbol)}&granularity=3h&hours=48&_=${Date.now()}`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const points = (data.points || []) as {
    period?: string;
    label?: string;
    high?: number;
    close?: number;
  }[];
  const out: PollPt[] = [];
  for (const pt of points) {
    const raw = pt.period || pt.label;
    if (!raw) continue;
    const tms = new Date(raw).getTime();
    if (!Number.isFinite(tms)) continue;
    const manila = new Date(tms + 8 * 3600000);
    const day = manila.toISOString().slice(0, 10);
    const hour = manila.getUTCHours();
    let slot = 2;
    let best = 99;
    for (const h of SLOT_HOURS) {
      const d = Math.min(Math.abs(hour - h), 24 - Math.abs(hour - h));
      if (d < best) {
        best = d;
        slot = h;
      }
    }
    const px =
      typeof pt.close === "number" ? pt.close : typeof pt.high === "number" ? pt.high : null;
    if (px == null || !Number.isFinite(px)) continue;
    out.push({
      day,
      hour: slot,
      label: `${slot}:05`,
      price: px,
      isDayStart: slot === 2,
    });
  }
  return out;
}

async function fetchDaily(symbol: string): Promise<DailyPt[]> {
  const res = await fetch(
    `/api/coins?type=chart&symbol=${encodeURIComponent(symbol)}&years=1.00&granularity=daily&_=${Date.now()}`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.points || []) as DailyPt[];
}

type Props = {
  symbol: string;
  /** Live price from /api/coins — preferred over scan-hit price */
  livePrice: number | null;
};

/**
 * One 3h poll path per long-scan coin + daily 20 SMA.
 * Lazy-loads when the card scrolls into view.
 */
export default function LongScanPollChart({ symbol, livePrice }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [points, setPoints] = useState<PollPt[]>([]);
  const [daily, setDaily] = useState<DailyPt[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "120px", threshold: 0.05 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !symbol) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void Promise.all([fetchPoll3h(symbol), fetchDaily(symbol)])
      .then(([poll, d]) => {
        if (cancelled) return;
        setPoints(poll);
        setDaily(d);
      })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message || "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, symbol]);

  // Prefer live price on the last print
  const series = (() => {
    if (!points.length) return points;
    if (livePrice == null || !Number.isFinite(livePrice)) return points;
    const copy = points.map((p) => ({ ...p }));
    copy[copy.length - 1] = { ...copy[copy.length - 1], price: livePrice };
    return copy;
  })();

  const prices = series.map((p) => p.price).filter((p) => Number.isFinite(p));

  // Daily 20 SMA anchors in window
  const dailySmaList: { dayKey: string; v: number }[] = [];
  if (daily.length >= 20) {
    const smaSeries = calculateSMASeries(daily as any, 20);
    for (let i = 0; i < daily.length; i++) {
      const v = smaSeries[i];
      if (v == null || !Number.isFinite(v)) continue;
      dailySmaList.push({ dayKey: String(daily[i].period).slice(0, 10), v });
    }
  }
  const pollDays = new Set(series.map((s) => s.day));
  let smaAnchors = dailySmaList.filter((s) => pollDays.has(s.dayKey));
  if (smaAnchors.length < 2 && dailySmaList.length > 0) {
    smaAnchors = dailySmaList.slice(-Math.max(2, pollDays.size));
  }

  let chart: ReactNode = null;
  if (loading && !series.length) {
    chart = <p className="px-2 py-3 text-[11px] text-slate-500">Loading 3h…</p>;
  } else if (err) {
    chart = <p className="px-2 py-2 text-[11px] text-rose-600">{err}</p>;
  } else if (prices.length < 2) {
    chart = (
      <p className="px-2 py-2 text-[11px] text-slate-500">
        {visible ? "Not enough 3h prints yet." : "Scroll to load 3h chart…"}
      </p>
    );
  } else {
    const allY = [...prices, ...smaAnchors.map((s) => s.v)];
    const min = Math.min(...allY);
    const max = Math.max(...allY);
    const pad = (max - min) * 0.1 || max * 0.01 || 1;
    const y0 = min - pad;
    const y1 = max + pad;
    const left = 52;
    const right = 6;
    const top = 10;
    const bottom = 18;
    const w = 640;
    const h = 160;
    const plotW = w - left - right;
    const plotH = h - top - bottom;
    const n = series.length;
    const yAt = (price: number) => top + plotH - ((price - y0) / (y1 - y0)) * plotH;
    const xAt = (i: number) => (n <= 1 ? left + plotW / 2 : left + (i / (n - 1)) * plotW);
    const pts = series.map((s, i) => ({ x: xAt(i), y: yAt(s.price), s }));
    const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const currentIdx = n - 1;
    const smaPts = smaAnchors.map((anchor, ai) => {
      let idx = series.findIndex((s) => s.day === anchor.dayKey && s.isDayStart);
      if (idx < 0) idx = series.findIndex((s) => s.day === anchor.dayKey);
      if (idx < 0) {
        const dayStarts = series.map((s, i) => (s.isDayStart ? i : -1)).filter((i) => i >= 0);
        if (dayStarts.length) {
          const off = smaAnchors.length - 1 - ai;
          idx = dayStarts[Math.max(0, dayStarts.length - 1 - off)] ?? dayStarts[dayStarts.length - 1];
        } else idx = n - 1;
      }
      const isLatest = ai === smaAnchors.length - 1;
      const xStart = xAt(idx);
      const x = isLatest ? xAt(currentIdx) : xStart;
      return { x, xStart, y: yAt(anchor.v), v: anchor.v, dayKey: anchor.dayKey, isLatest };
    });
    const smaPathPts = smaPts.flatMap((p) =>
      p.isLatest && Math.abs(p.x - p.xStart) > 1
        ? [
            { x: p.xStart, y: p.y },
            { x: p.x, y: p.y },
          ]
        : [{ x: p.x, y: p.y }]
    );
    const smaPath =
      smaPathPts.length >= 2
        ? smaPathPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")
        : "";
    const ticks = [y1, (y0 + y1) / 2, y0];
    const fmt = (v: number) =>
      v >= 1000
        ? v.toLocaleString("en-PH", { maximumFractionDigits: 0 })
        : v.toLocaleString("en-PH", { maximumFractionDigits: 4 });
    const last = series[series.length - 1];

    chart = (
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[140px] w-full sm:h-[160px]" role="img" aria-label={`${symbol} 3h + 20 SMA`}>
        {ticks.map((tv, i) => {
          const y = yAt(tv);
          return (
            <g key={i}>
              <line x1={left} x2={w - right} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text x={left - 4} y={y + 3} textAnchor="end" className="fill-slate-600" style={{ fontSize: 10, fontWeight: 700 }}>
                {fmt(tv)}
              </text>
            </g>
          );
        })}
        {pts.map((p, i) =>
          p.s.isDayStart ? (
            <line
              key={`d-${i}`}
              x1={p.x}
              x2={p.x}
              y1={top}
              y2={h - bottom}
              stroke="#cbd5e1"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          ) : null
        )}
        <path d={path} fill="none" stroke="#4f46e5" strokeWidth={2} />
        {smaPath ? <path d={smaPath} fill="none" stroke="#f59e0b" strokeWidth={2} /> : null}
        {smaPts.map((p, i) => {
          const isLast = i === smaPts.length - 1;
          const labelX = isLast ? Math.max(left + 4, p.x - 6) : p.x;
          const anchor = isLast ? "end" : i === 0 ? "start" : "middle";
          return (
            <g key={`sma-${p.dayKey}-${i}`}>
              <circle cx={p.x} cy={p.y} r={4} fill="#f59e0b" stroke="#fff" strokeWidth={1} />
              <text
                x={labelX}
                y={Math.min(h - 4, p.y + 12)}
                textAnchor={anchor}
                className="fill-amber-800"
                style={{ fontSize: 10, fontWeight: 700 }}
              >
                SMA {fmt(p.v)}
              </text>
            </g>
          );
        })}
        {pts.map((p, i) => {
          const isLast = i === pts.length - 1;
          return (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={isLast ? 5 : p.s.isDayStart ? 3.5 : 2.5}
              fill={isLast ? "#059669" : "#4f46e5"}
              stroke={isLast ? "#fff" : undefined}
              strokeWidth={isLast ? 1.5 : 0}
            />
          );
        })}
        {last && (
          <text
            x={Math.max(left + 4, xAt(currentIdx) - 6)}
            y={Math.max(top + 10, yAt(last.price) - 8)}
            textAnchor="end"
            className="fill-emerald-800"
            style={{ fontSize: 11, fontWeight: 800 }}
          >
            {formatPhp(last.price)}
          </text>
        )}
      </svg>
    );
  }

  return (
    <div ref={rootRef} className="border-b border-slate-100 bg-slate-50/50 px-2 py-1.5">
      <div className="mb-0.5 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-slate-500">
        <span>3h poll · live price</span>
        <span className="text-amber-700">● 20 SMA (daily)</span>
        {livePrice != null && Number.isFinite(livePrice) ? (
          <span className="tabular-nums text-emerald-800">Now {formatPhp(livePrice)}</span>
        ) : null}
      </div>
      {chart}
    </div>
  );
}
