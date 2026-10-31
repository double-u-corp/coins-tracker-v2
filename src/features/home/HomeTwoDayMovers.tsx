import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatPhp } from "@/lib/format";
import { calculateSMASeries } from "@/features/chart/Technicals";


type Mover = {
  symbol: string;
  name?: string;
  totalAbsPct: number;
  netPct: number;
  samples?: number;
};

type PollPoint = {
  day: string;
  hour: number;
  label: string;
  price: number;
  isDayStart: boolean;
};

const SLOT_HOURS = [2, 5, 8, 11, 14, 17, 20, 23] as const;

async function fetchTopMovers2d(): Promise<Mover[]> {
  const res = await fetch(`/api/swing-timing?days=14&_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load movers");
  const data = await res.json();
  const list = Array.isArray(data.topMovers2d) ? data.topMovers2d : [];
  return list.slice(0, 10).map((m: any) => ({
    symbol: String(m.symbol),
    name: m.name ? String(m.name) : undefined,
    totalAbsPct: Number(m.totalAbsPct) || 0,
    netPct: Number(m.netPct) || 0,
    samples: m.samples != null ? Number(m.samples) : undefined,
  }));
}

async function fetchPollSeries(symbol: string): Promise<PollPoint[]> {
  const res = await fetch(
    `/api/coins?type=chart&symbol=${encodeURIComponent(symbol)}&granularity=3h&hours=48`
  );
  if (!res.ok) return [];
  const json = await res.json();
  const pointsRaw = Array.isArray(json.points) ? json.points : [];
  const out: PollPoint[] = [];
  for (const pt of pointsRaw.slice(-24)) {
    const raw = pt.period || pt.label;
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

type DailyPt = { period: string; high: number; low: number; close?: number };

async function fetchDailyForSma(symbol: string): Promise<DailyPt[]> {
  const res = await fetch(
    `/api/coins?type=chart&symbol=${encodeURIComponent(symbol)}&years=1.00&granularity=daily&_=${Date.now()}`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.points || []) as DailyPt[];
}

function MoverLineChart({
  points,
  symbol,
  dailyPoints = [],
}: {
  points: PollPoint[];
  symbol: string;
  dailyPoints?: DailyPt[];
}) {

  const [hover, setHover] = useState<{
    x: number;
    y: number;
    label: string;
    price: number;
  } | null>(null);

  const prices = points.map((p) => p.price).filter((p) => Number.isFinite(p));
  if (prices.length < 2) {
    return <p className="text-xs text-gray-500">Not enough 3h prints for a line.</p>;
  }

  const dailySmaList: { dayKey: string; v: number }[] = [];
  if (dailyPoints.length >= 20) {
    const smaSeries = calculateSMASeries(dailyPoints as any, 20);
    for (let i = 0; i < dailyPoints.length; i++) {
      const v = smaSeries[i];
      if (v == null || !Number.isFinite(v)) continue;
      dailySmaList.push({ dayKey: String(dailyPoints[i].period).slice(0, 10), v });
    }
  }
  const pollDaySet = new Set(points.map((s) => s.day));
  let smaAnchors = dailySmaList.filter((s) => pollDaySet.has(s.dayKey));
  if (smaAnchors.length < 2 && dailySmaList.length > 0) {
    smaAnchors = dailySmaList.slice(-Math.max(2, pollDaySet.size));
  }

  const allY = [...prices, ...smaAnchors.map((s) => s.v)];
  const min = Math.min(...allY);
  const max = Math.max(...allY);
  const pad = (max - min) * 0.08 || max * 0.01 || 1;
  const y0 = min - pad;
  const y1 = max + pad;
  const left = 72;
  const right = 8;
  const top = 18;
  const bottom = 28;
  const w = 960;
  const h = 360;
  const plotW = w - left - right;
  const plotH = h - top - bottom;
  const n = points.length;
  const yAt = (price: number) => top + plotH - ((price - y0) / (y1 - y0)) * plotH;
  const xAt = (i: number) => (n <= 1 ? left + plotW / 2 : left + (i / (n - 1)) * plotW);
  const pts = points.map((s, i) => {
    const x = xAt(i);
    return { x, y: yAt(s.price), s };
  });
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const currentIdx = n - 1;
  const smaPts = smaAnchors.map((anchor, ai) => {
    let idx = points.findIndex((s) => s.day === anchor.dayKey && s.isDayStart);
    if (idx < 0) idx = points.findIndex((s) => s.day === anchor.dayKey);
    if (idx < 0) {
      const dayStarts = points.map((s, i) => (s.isDayStart ? i : -1)).filter((i) => i >= 0);
      if (dayStarts.length > 0) {
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
      ? [{ x: p.xStart, y: p.y }, { x: p.x, y: p.y }]
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
  const last = points[points.length - 1];

  return (
    <div className="relative -mx-1 flex w-[calc(100%+0.5rem)] flex-col rounded-lg border border-teal-100 bg-teal-50/20 sm:-mx-2 sm:w-[calc(100%+1rem)]">
      <div className="w-full p-1 pb-0 sm:p-2 sm:pb-0">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="h-[min(100vw,560px)] w-full min-h-[440px] max-h-[70vh] sm:h-80 sm:max-h-none md:h-96"
          role="img"
          aria-label={`${symbol} 3h path`}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((tv, i) => {
            const y = yAt(tv);
            return (
              <g key={i}>
                <line x1={left} x2={w - right} y1={y} y2={y} stroke="#ccfbf1" strokeWidth={1} />
                <text
                  x={left - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-teal-900"
                  style={{ fontSize: 16, fontWeight: 800 }}
                >
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
                stroke="#99f6e4"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            ) : null
          )}
          <path d={path} fill="none" stroke="#0d9488" strokeWidth={2} />
          {smaPath ? <path d={smaPath} fill="none" stroke="#f59e0b" strokeWidth={2} /> : null}
          {smaPts.map((p, i) => {
            const isLast = i === smaPts.length - 1;
            const labelX = isLast ? Math.max(left + 4, p.x - 8) : p.x;
            const anchor = isLast ? "end" : i === 0 ? "start" : "middle";
            return (
              <g key={`sma-${p.dayKey}-${i}`}>
                <circle cx={p.x} cy={p.y} r={7} fill="#f59e0b" stroke="#fff" strokeWidth={1.5} />
                <text
                  x={labelX}
                  y={Math.min(h - bottom - 4, p.y + 14)}
                  textAnchor={anchor}
                  className="fill-amber-800"
                  style={{ fontSize: 14, fontWeight: 800 }}
                >
                  SMA {fmt(p.v)}
                </text>
              </g>
            );
          })}
          {pts.map((p, i) => {
            const isLast = i === pts.length - 1;
            return (
              <g key={i}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={28}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() =>
                    setHover({
                      x: p.x,
                      y: p.y,
                      label: `${p.s.day.slice(5)} ${p.s.label}`,
                      price: p.s.price,
                    })
                  }
                  onClick={() =>
                    setHover({
                      x: p.x,
                      y: p.y,
                      label: `${p.s.day.slice(5)} ${p.s.label}`,
                      price: p.s.price,
                    })
                  }
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isLast ? 7 : p.s.isDayStart ? 4.5 : 3.5}
                  fill={isLast ? "#059669" : p.s.isDayStart ? "#0d9488" : "#115e59"}
                  className="pointer-events-none"
                />
              </g>
            );
          })}
          {hover && (
            <g pointerEvents="none">
              <line
                x1={hover.x}
                x2={hover.x}
                y1={top}
                y2={h - bottom}
                stroke="#5eead4"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
              <rect
                x={Math.min(Math.max(hover.x - 70, left), w - right - 140)}
                y={Math.max(hover.y - 36, 4)}
                width={160}
                height={40}
                rx={6}
                fill="#134e4a"
                opacity={0.92}
              />
              <text
                x={Math.min(Math.max(hover.x - 70, left), w - right - 140) + 8}
                y={Math.max(hover.y - 36, 4) + 13}
                fill="#ccfbf1"
                style={{ fontSize: 13, fontWeight: 700 }}
              >
                {hover.label}
              </text>
              <text
                x={Math.min(Math.max(hover.x - 70, left), w - right - 140) + 8}
                y={Math.max(hover.y - 36, 4) + 25}
                fill="#fff"
                style={{ fontSize: 11, fontWeight: 700 }}
              >
                {formatPhp(hover.price)}
              </text>
            </g>
          )}
        </svg>
      </div>
      <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-teal-100 bg-white/70 px-2.5 py-2 text-[11px] sm:text-[10px] text-gray-500">
        <div className="flex flex-wrap items-center gap-x-3">
          <span className="font-semibold text-teal-800">● day start (2:05)</span>
          <span className="font-semibold text-emerald-700">● latest</span>
          <span className="tabular-nums text-gray-600">
            {points[0]?.day.slice(5)} → {last?.day.slice(5)} · {symbol}
          </span>
        </div>
        <span className="text-gray-400">Hover / tap for price</span>
      </div>
    </div>
  );
}


function buildWhyMovingPrompt(movers: Mover[], series: PollPoint[], selected: string): string {
  const lines: string[] = [];
  lines.push(`ROLE`);
  lines.push(
    `You are a neutral crypto research assistant for a Philippines spot LONG-only PHP trader (no short, no leverage).`
  );
  lines.push(``);
  lines.push(`PURPOSE`);
  lines.push(
    `Explain **why the biggest movers of the last ~2 days** moved, using our 3h Manila poll path + **verified crypto-specific news only**. Ranking is total |%| path over ~48h — not the 14/30/60 hot-slot list.`
  );
  lines.push(``);
  lines.push(`RULES`);
  lines.push(`- Live search only. No training-memory headlines. Do not invent news.`);
  lines.push(`- Unverified → "none verified".`);
  lines.push(`- Spot only: never recommend shorting or leverage.`);
  lines.push(`- Neutral: do not force a bullish read.`);
  lines.push(``);
  lines.push(`TOP MOVERS (2d)`);
  for (let i = 0; i < movers.length; i++) {
    const m = movers[i];
    lines.push(
      `${i + 1}. ${m.symbol.replace(/PHP$/i, "")} (${m.symbol}) · net ${m.netPct >= 0 ? "+" : ""}${m.netPct.toFixed(1)}% · path |%| ~${m.totalAbsPct.toFixed(1)}%`
    );
  }
  lines.push(``);
  lines.push(`3H PATH (selected: ${selected || "—"})`);
  if (!series.length) {
    lines.push(`(no series loaded)`);
  } else {
    for (const pt of series) {
      lines.push(`- ${pt.day} ${pt.label} · ${pt.price}`);
    }
  }
  lines.push(``);
  lines.push(`ANSWER`);
  lines.push(`1. Per coin (or top 5): verified drivers or "none verified"`);
  lines.push(`2. Shared theme if any (market-wide vs coin-specific)`);
  lines.push(`3. Spot posture: WATCH / IGNORE / RISK (no buy signal from news alone)`);
  lines.push(`Recheck by: (Manila date)`);
  return lines.join("\n");
}

export default function HomeTwoDayMovers() {
  const [movers, setMovers] = useState<Mover[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [series, setSeries] = useState<PollPoint[]>([]);
  const [dailyPoints, setDailyPoints] = useState<DailyPt[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [whyCopied, setWhyCopied] = useState(false);

  const copyWhyMoving = async () => {
    try {
      const text = buildWhyMovingPrompt(movers, series, selected);
      await navigator.clipboard.writeText(text);
      setWhyCopied(true);
      setTimeout(() => setWhyCopied(false), 2000);
    } catch {
      setError("Could not copy why-moving prompt");
    }
  };


  const loadMovers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchTopMovers2d();
      setMovers(list);
      setSelected((prev) => {
        if (prev && list.some((m) => m.symbol === prev)) return prev;
        return list[0]?.symbol || "";
      });
    } catch (e) {
      setError((e as Error).message || "Failed to load");
      setMovers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMovers();
  }, [loadMovers]);

  useEffect(() => {
    if (!selected) {
      setSeries([]);
      setDailyPoints([]);
      return;
    }
    let cancelled = false;
    setSeriesLoading(true);
    void Promise.all([fetchPollSeries(selected), fetchDailyForSma(selected)])
      .then(([pts, daily]) => {
        if (!cancelled) {
          setSeries(pts);
          setDailyPoints(daily);
        }
      })
      .finally(() => {
        if (!cancelled) setSeriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const selectedMover = useMemo(
    () => movers.find((m) => m.symbol === selected) || null,
    [movers, selected]
  );

  return (
    <section id="two-day-movers" className="scroll-mt-20 rounded-xl border-2 border-teal-200 bg-teal-50/40 p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-teal-950">2d · biggest movers</h2>
          <p className="mt-0.5 text-[11px] text-teal-900/80">
            Ranked by total |%| path over the last ~2 days (not the 14/30/60 hot-slot list). Pick a
            coin for its 3h line — for latest-news checks.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => void copyWhyMoving()}
            disabled={loading || movers.length === 0}
            className="rounded-md border border-teal-400 bg-teal-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {whyCopied ? "✅ Copied" : "📋 Why moving (2d)"}
          </button>
          <button
            type="button"
            onClick={() => void loadMovers()}
            className="rounded-md border border-teal-300 bg-white px-2.5 py-1 text-[11px] font-bold text-teal-900 hover:bg-teal-50"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && <p className="mb-2 text-xs text-rose-700">{error}</p>}
      {loading ? (
        <p className="text-xs text-gray-500">Loading movers…</p>
      ) : movers.length === 0 ? (
        <p className="text-xs text-gray-500">No 2d movers yet.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {movers.map((m, i) => {
              const active = m.symbol === selected;
              return (
                <button
                  key={m.symbol}
                  type="button"
                  onClick={() => setSelected(m.symbol)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition ${
                    active
                      ? "border-teal-600 bg-teal-600 text-white ring-2 ring-teal-300"
                      : "border-teal-200 bg-white text-teal-900 hover:bg-teal-50"
                  }`}
                  title={`total |path| ${m.totalAbsPct}% · net ${m.netPct}%`}
                >
                  <span className={active ? "text-teal-100" : "text-teal-500"}>#{i + 1}</span>
                  {m.symbol.replace(/PHP$/i, "")}
                  <span
                    className={
                      active
                        ? "text-white"
                        : m.netPct > 0
                          ? "text-emerald-600"
                          : m.netPct < 0
                            ? "text-rose-600"
                            : "text-gray-500"
                    }
                  >
                    {m.netPct >= 0 ? "+" : ""}
                    {m.netPct.toFixed(1)}%
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label className="text-[11px] font-bold text-teal-900">Coin</label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="rounded-md border border-teal-300 bg-white px-2 py-1 text-xs font-semibold text-teal-950"
            >
              {movers.map((m, i) => (
                <option key={m.symbol} value={m.symbol}>
                  #{i + 1} {m.symbol.replace(/PHP$/i, "")} ({m.netPct >= 0 ? "+" : ""}
                  {m.netPct.toFixed(1)}%)
                </option>
              ))}
            </select>
            {selectedMover && (
              <span className="text-[11px] text-gray-600">
                path |%| ~{selectedMover.totalAbsPct.toFixed(1)}%
              </span>
            )}
            {selected && (
              <Link
                href={`/chart?symbol=${encodeURIComponent(selected)}`}
                className="text-[11px] font-bold text-indigo-700 hover:underline"
              >
                Spot →
              </Link>
            )}
          </div>

          {seriesLoading ? (
            <p className="text-xs text-gray-500">Loading 3h series…</p>
          ) : (
            <MoverLineChart points={series} symbol={selected} dailyPoints={dailyPoints} />
          )}
        </>
      )}
    </section>
  );
}
