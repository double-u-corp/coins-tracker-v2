import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Dropdown from "@/components/Dropdown";
import AlertBanner from "@/components/AlertBanner";
import JournalSidebar from "./JournalSidebar";
import TradingInsightCard from "./TradingInsightCard";
import { useChartLogic, type ChartRange } from "./useChartLogic";
import { formatPhp } from "@/lib/format";
import { getSupportResistance, BIAS_BADGE_CLASSES, BIAS_PRIORITY, isLongExtended, isWatchlistBuyLowHit, isNearSupportWorthCheck , buildStructureKeyLevels } from "./Technicals";
import { useCoinScanner, formatScanResultsForJournal, formatSingleScanResult } from "./useCoinScanner";
import MacroDayBanner from "./MacroDayBanner";
import PositionAndTradesCard from "./PositionAndTradesCard";

const PriceLineChart = dynamic(() => import("./PriceLineChart"), {
  ssr: false,
  loading: () => (
    <div className="flex h-96 items-center justify-center text-sm text-gray-500">
      Loading chart…
    </div>
  ),
});

const pageNavBtn =
  "inline-flex items-center justify-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] sm:text-xs font-semibold whitespace-nowrap transition-colors shadow-sm";
const pageNavHome =
  "inline-flex items-center justify-center gap-1 rounded-md border border-slate-200 bg-white text-slate-700 px-2.5 py-1.5 text-[11px] sm:text-xs font-semibold whitespace-nowrap transition-colors shadow-sm hover:bg-slate-50";

const RANGE_OPTIONS: { label: string; value: ChartRange }[] = [
  { label: "1M", value: "1m" },
  { label: "3M", value: "3m" },
  { label: "6M", value: "6m" },
  { label: "1Y", value: "1y" },
  { label: "3Y", value: "3y" },
];


function PollMiniLine({
  groups,
  dayLabel,
  todayKey,
}: {
  groups: {
    dayKey: string;
    tiles: {
      hour: number;
      label: string;
      price: number | null;
      isCurrent: boolean;
      isDayStart?: boolean;
      delta: number | null;
    }[];
  }[];
  dayLabel: (key: string) => string;
  todayKey: string;
}) {
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    label: string;
    price: number;
  } | null>(null);

  const series = groups.flatMap((g) =>
    g.tiles.map((tile) => ({
      ...tile,
      dayKey: g.dayKey,
      xLabel: `${dayLabel(g.dayKey)} ${tile.label}`,
    }))
  );
  const prices = series.map((s) => s.price).filter((p): p is number => p != null && Number.isFinite(p));
  if (prices.length < 2) {
    return <p className="text-xs text-gray-500">Not enough poll points for a line.</p>;
  }
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = (max - min) * 0.08 || max * 0.01 || 1;
  const y0 = min - pad;
  const y1 = max + pad;
  const left = 48; // room for price labels
  const right = 4;
  const top = 10;
  const bottom = 16;
  // Tall viewBox so phone screens get more vertical room when scaled to 100% width
  const w = 360;
  const h = 280;
  const plotW = w - left - right;
  const plotH = h - top - bottom;
  const n = series.length;
  const yAt = (price: number) => top + plotH - ((price - y0) / (y1 - y0)) * plotH;
  const pts = series
    .map((s, i) => {
      if (s.price == null || !Number.isFinite(s.price)) return null;
      const x = n <= 1 ? left + plotW / 2 : left + (i / (n - 1)) * plotW;
      const y = yAt(s.price);
      return { x, y, s };
    })
    .filter(Boolean) as { x: number; y: number; s: (typeof series)[0] }[];
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const ticks = [y1, (y0 + y1) / 2, y0];
  const fmt = (v: number) =>
    v >= 1000 ? v.toLocaleString("en-PH", { maximumFractionDigits: 0 }) : v.toLocaleString("en-PH", { maximumFractionDigits: 4 });

  return (
    <div className="relative -mx-1 flex w-[calc(100%+0.5rem)] max-w-none flex-col rounded-lg border border-violet-100 bg-violet-50/30 sm:-mx-2 sm:w-[calc(100%+1rem)]">
      <div className="w-full p-1 pb-0 sm:p-1.5 sm:pb-0">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-[min(58vw,320px)] w-full min-h-[240px] sm:h-64 sm:min-h-0"
        role="img"
        aria-label="3h poll prices"
        onMouseLeave={() => setHover(null)}
      >
        {/* Y-axis grid + labels */}
        {ticks.map((tv, i) => {
          const y = yAt(tv);
          return (
            <g key={i}>
              <line x1={left} x2={w - right} y1={y} y2={y} stroke="#e9d5ff" strokeWidth={1} />
              <text
                x={left - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-violet-800"
                style={{ fontSize: 11, fontWeight: 700 }}
              >
                {fmt(tv)}
              </text>
            </g>
          );
        })}
        {pts.map((p, i) =>
          p.s.isDayStart ? (
            <line
              key={`day-${i}`}
              x1={p.x}
              x2={p.x}
              y1={top}
              y2={h - bottom}
              stroke="#c4b5fd"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          ) : null
        )}
        <path d={path} fill="none" stroke="#7c3aed" strokeWidth={2} />
        {pts.map((p, i) => (
          <g key={i}>
            {/* larger hit area for touch/hover */}
            <circle
              cx={p.x}
              cy={p.y}
              r={18}
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={() =>
                setHover({
                  x: p.x,
                  y: p.y,
                  label: p.s.xLabel,
                  price: p.s.price as number,
                })
              }
              onMouseMove={() =>
                setHover({
                  x: p.x,
                  y: p.y,
                  label: p.s.xLabel,
                  price: p.s.price as number,
                })
              }
              onClick={() =>
                setHover({
                  x: p.x,
                  y: p.y,
                  label: p.s.xLabel,
                  price: p.s.price as number,
                })
              }
              onFocus={() =>
                setHover({
                  x: p.x,
                  y: p.y,
                  label: p.s.xLabel,
                  price: p.s.price as number,
                })
              }
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={p.s.isCurrent ? 5.5 : p.s.isDayStart ? 4.5 : 3.5}
              fill={p.s.isCurrent ? "#059669" : p.s.isDayStart ? "#7c3aed" : "#4c1d95"}
              className="pointer-events-none"
            />
          </g>
        ))}
        {hover && (
          <g pointerEvents="none">
            <line
              x1={hover.x}
              x2={hover.x}
              y1={top}
              y2={h - bottom}
              stroke="#a78bfa"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <rect
              x={Math.min(Math.max(hover.x - 70, left), w - right - 140)}
              y={Math.max(hover.y - 36, 4)}
              width={140}
              height={32}
              rx={6}
              fill="#1e1b4b"
              opacity={0.92}
            />
            <text
              x={Math.min(Math.max(hover.x - 70, left), w - right - 140) + 8}
              y={Math.max(hover.y - 36, 4) + 13}
              fill="#e9d5ff"
              style={{ fontSize: 9, fontWeight: 600 }}
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
      <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-violet-100 bg-white/70 px-2.5 py-1.5 text-[10px] text-gray-500">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="font-semibold text-violet-700">● day start (2:05)</span>
          <span className="font-semibold text-emerald-700">● now</span>
          <span className="tabular-nums text-gray-600">
            {dayLabel(series[0]?.dayKey || todayKey)} → {dayLabel(series[series.length - 1]?.dayKey || todayKey)}
          </span>
        </div>
        <span className="text-gray-400">Hover a point for price</span>
      </div>
    </div>
  );
}


export default function ChartView() {
  const {
    coinOptions,
    allCoins,
    symbol,
    setSymbol,
    range,
    setRange,
    points,
    chartLoading,
    chartError,
    intradayPoints,
    confluencePoints,
    entries,
    journalLoading,
    journalError,
    journalLabelsInView,
    addJournalEntry,
    deleteJournalEntry,
    updateJournalEntry,
    authenticated,
    transactions,
    portfolio,
  } = useChartLogic();

  const [showHigh, setShowHigh] = useState(true);
  const [showLow, setShowLow] = useState(true);
  const [showKeyLevels, setShowKeyLevels] = useState(false);
  const [showS1, setShowS1] = useState(false);
  const [showS2, setShowS2] = useState(false);
  const [showR1, setShowR1] = useState(false);
  const [showR2, setShowR2] = useState(false);
  /** Extra Manila days of 3h polls (each = 8 slots) loaded via "Load more". */
  const [pollExtraDays, setPollExtraDays] = useState(0);
  const [pollViewMode, setPollViewMode] = useState<"cards" | "line">("line");
  const [showAllScanResults, setShowAllScanResults] = useState(false);
  const [scanCopied, setScanCopied] = useState(false);
  const [cardCopiedSymbol, setCardCopiedSymbol] = useState<string | null>(null);

  const { scanResults, isScanning, scanProgress, scanError, hasScanned, runScan } = useCoinScanner(allCoins);

  const sortedScanResults = useMemo(() => {
    return [...scanResults].sort((a, b) => {
      // 0 = primary buy-low hit, 1 = near-support worth-check, 2 = other
      const tier = (r: (typeof scanResults)[number]) => {
        if (!r.confluence) return 2;
        if (isWatchlistBuyLowHit(r.confluence)) return 0;
        if (isNearSupportWorthCheck(r.confluence)) return 1;
        return 2;
      };
      const at = tier(a);
      const bt = tier(b);
      if (at !== bt) return at - bt;
      const aBias = a.confluence?.bias ?? "INSUFFICIENT DATA";
      const bBias = b.confluence?.bias ?? "INSUFFICIENT DATA";
      const priorityDiff = BIAS_PRIORITY[aBias] - BIAS_PRIORITY[bBias];
      if (priorityDiff !== 0) return priorityDiff;
      const aExt = a.confluence ? (isLongExtended(a.confluence) ? 1 : 0) : 0;
      const bExt = b.confluence ? (isLongExtended(b.confluence) ? 1 : 0) : 0;
      if (aExt !== bExt) return aExt - bExt;
      const aScore = a.confluence?.score ?? 0;
      const bScore = b.confluence?.score ?? 0;
      return bScore - aScore;
    });
  }, [scanResults]);

  const visibleScanResults = showAllScanResults
    ? sortedScanResults
    : sortedScanResults.filter((r) => {
        if (r.error) return true;
        if (!r.confluence) return false;
        // Primary hits + secondary near-support plugs (not priority)
        return isWatchlistBuyLowHit(r.confluence) || isNearSupportWorthCheck(r.confluence);
      });

  const directionalSignalCount = scanResults.filter(
    (r) => !!r.confluence && isWatchlistBuyLowHit(r.confluence)
  ).length;

  const worthCheckCount = scanResults.filter(
    (r) =>
      !!r.confluence &&
      !isWatchlistBuyLowHit(r.confluence) &&
      isNearSupportWorthCheck(r.confluence)
  ).length;

  const handleCopyScanResults = () => {
    const text = formatScanResultsForJournal(scanResults);
    navigator.clipboard.writeText(text);
    setScanCopied(true);
    setTimeout(() => setScanCopied(false), 2000);
  };

  const handleCopyCard = (r: (typeof scanResults)[number]) => {
    navigator.clipboard.writeText(formatSingleScanResult(r));
    setCardCopiedSymbol(r.symbol);
    setTimeout(() => setCardCopiedSymbol(null), 2000);
  };

  const selectedCoin = useMemo(() => {
    return allCoins.find((c) => c.symbol === symbol) || null;
  }, [allCoins, symbol]);

  const activePortfolio = useMemo(() => {
    if (!symbol || !portfolio) return null;
    const row = portfolio.find((p) => p.symbol === symbol);
    if (!row || !(row.holdings > 0)) return row ? { ...row, firstBuyAt: null, daysHeld: null } : null;

    // Position bridge: first buy date + days held from transaction history
    const buys = (transactions || [])
      .filter((tx) => tx.symbol === symbol && tx.type === "buy")
      .map((tx) => new Date(tx.transactedAt).getTime())
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b);
    const firstBuyMs = buys.length > 0 ? buys[0] : null;
    const firstBuyAt = firstBuyMs != null ? new Date(firstBuyMs).toISOString() : null;
    const daysHeld =
      firstBuyMs != null
        ? Math.max(0, Math.floor((Date.now() - firstBuyMs) / (24 * 60 * 60 * 1000)))
        : null;

    return { ...row, firstBuyAt, daysHeld };
  }, [symbol, portfolio, transactions]);

  const currentPrice = useMemo(() => {
    if (selectedCoin?.currentPrice != null) {
      return selectedCoin.currentPrice;
    }
    if (points.length === 0) return 0;
    const lastPoint = points[points.length - 1];
    return (lastPoint.high + lastPoint.low) / 2;
  }, [selectedCoin, points]);

  useEffect(() => {
    setPollExtraDays(0);
  }, [symbol]);

  /** Manila poll slots ending at current; +8 slots per Load more day. */
  const pollWindow = useMemo(() => {
    const SLOT_HOURS = [2, 5, 8, 11, 14, 17, 20, 23] as const;
    const SLOT_LABELS: Record<number, string> = {
      2: "2:05",
      5: "5:05",
      8: "8:05",
      11: "11:05",
      14: "14:05",
      17: "17:05",
      20: "20:05",
      23: "23:05",
    };
    const WINDOW = 16 + Math.max(0, pollExtraDays) * 8;

    const manilaNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const todayKey = manilaNow.toISOString().slice(0, 10);
    const manilaHour = manilaNow.getUTCHours();

    let currentSlotIdx = 0;
    for (let i = 0; i < SLOT_HOURS.length; i++) {
      if (SLOT_HOURS[i] <= manilaHour) currentSlotIdx = i;
    }

    type Hit = { price: number; dist: number; ts: number };
    const byDay = new Map<string, Map<number, Hit>>();

    const series = intradayPoints && intradayPoints.length > 0 ? intradayPoints : points;
    for (const pt of series) {
      const raw = (pt as { period?: string }).period;
      if (!raw) continue;
      const tms = new Date(raw).getTime();
      if (!Number.isFinite(tms)) continue;
      const manila = new Date(tms + 8 * 60 * 60 * 1000);
      const dayKey = manila.toISOString().slice(0, 10);
      const hour = manila.getUTCHours();
      let slot = -1;
      let best = 99;
      for (const h of SLOT_HOURS) {
        const d = Math.min(Math.abs(hour - h), 24 - Math.abs(hour - h));
        if (d < best && d <= 1) {
          best = d;
          slot = h;
        }
      }
      if (slot < 0) continue;
      const price =
        typeof (pt as { close?: number }).close === "number"
          ? (pt as { close: number }).close
          : typeof (pt as { high?: number }).high === "number"
            ? (pt as { high: number }).high
            : null;
      if (price == null || !Number.isFinite(price)) continue;
      if (!byDay.has(dayKey)) byDay.set(dayKey, new Map());
      const bucket = byDay.get(dayKey)!;
      const prev = bucket.get(slot);
      if (!prev || best < prev.dist || (best === prev.dist && tms >= prev.ts)) {
        bucket.set(slot, { price, dist: best, ts: tms });
      }
    }

    const shiftDay = (dayKey: string, delta: number) => {
      const d = new Date(`${dayKey}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + delta);
      return d.toISOString().slice(0, 10);
    };

    // Walk back WINDOW slots ending at today's current slot
    type Cursor = { dayKey: string; hourIdx: number };
    const cursors: Cursor[] = [];
    let cur: Cursor = { dayKey: todayKey, hourIdx: currentSlotIdx };
    for (let n = 0; n < WINDOW; n++) {
      cursors.push(cur);
      if (cur.hourIdx > 0) {
        cur = { dayKey: cur.dayKey, hourIdx: cur.hourIdx - 1 };
      } else {
        cur = { dayKey: shiftDay(cur.dayKey, -1), hourIdx: SLOT_HOURS.length - 1 };
      }
    }
    cursors.reverse();

    // Resolve prices with carry-forward; last tile = live current price
    let last: number | null = null;
    const tiles = cursors.map((c, i) => {
      const hour = SLOT_HOURS[c.hourIdx];
      const hit = byDay.get(c.dayKey)?.get(hour);
      let price: number | null = hit?.price ?? null;
      if (price != null) last = price;
      else if (last != null) price = last;
      const isCurrent = i === cursors.length - 1;
      if (isCurrent && currentPrice > 0) price = currentPrice;
      const sameHourAsNow = hour === SLOT_HOURS[currentSlotIdx];
      return {
        dayKey: c.dayKey,
        hour,
        label: SLOT_LABELS[hour],
        price,
        isCurrent,
        sameHourAsNow,
        /** First poll of the Manila calendar day (2:05) — day divider. */
        isDayStart: hour === SLOT_HOURS[0],
        delta: null as number | null,
      };
    });

    // Deltas vs previous tile in the window
    for (let i = 0; i < tiles.length; i++) {
      const prev = i > 0 ? tiles[i - 1].price : null;
      const px = tiles[i].price;
      if (prev != null && prev > 0 && px != null) {
        tiles[i].delta = ((px - prev) / prev) * 100;
      }
    }

    // Group by day (preserve order)
    const groups: {
      dayKey: string;
      tiles: typeof tiles;
      align: "end" | "start";
    }[] = [];
    for (const tile of tiles) {
      const g = groups[groups.length - 1];
      if (!g || g.dayKey !== tile.dayKey) {
        groups.push({ dayKey: tile.dayKey, tiles: [tile], align: "start" });
      } else {
        g.tiles.push(tile);
      }
    }
    // First group right-aligned if partial day; last (today) left-aligned
    if (groups.length > 0) {
      groups[0].align = groups[0].tiles.length < 8 ? "end" : "start";
      groups[groups.length - 1].align = "start";
    }

    const dayLabel = (key: string) =>
      new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });

    return { groups, dayLabel, todayKey, windowSize: WINDOW, extraDays: pollExtraDays };
  }, [intradayPoints, points, currentPrice, pollExtraDays]);

  const pollPriceLen = useMemo(() => {
    let max = 6;
    for (const g of pollWindow.groups) {
      for (const s of g.tiles) {
        if (s.price != null) max = Math.max(max, formatPhp(s.price).length);
      }
    }
    return max;
  }, [pollWindow]);

  const pollPriceFont = (maxRem: number) =>
    `max(0.5rem, min(${maxRem}rem, calc((100cqw - 0.35rem) / ${(pollPriceLen * 0.55).toFixed(2)})))`;

    const renderPollTile = (
    s: {
      hour: number;
      label: string;
      price: number | null;
      isCurrent: boolean;
      sameHourAsNow?: boolean;
      isDayStart?: boolean;
      delta: number | null;
    },
    dayTag: string,
    muted: boolean
  ) => {
    const hasPrice = s.price != null;
    const up = s.delta != null && s.delta > 0.005;
    const down = s.delta != null && s.delta < -0.005;
    const sameHour = Boolean(s.sameHourAsNow) && !s.isCurrent;
    const dayStart = Boolean(s.isDayStart);
    return (
      <div
        key={`${dayTag}-${s.hour}`}
        title={`${dayTag} ${s.label} Manila${dayStart ? " · day start" : ""}${sameHour ? " · same hour as now" : ""}`}
        style={{ containerType: "inline-size" }}
        className={`relative flex w-[5.75rem] sm:w-[6.75rem] flex-none flex-col items-center justify-center rounded-xl px-1.5 py-3 text-center shadow-sm transition-colors sm:px-2.5 ${
          s.isCurrent
            ? "border-2 border-emerald-500 bg-gradient-to-b from-emerald-50 to-emerald-100/80 ring-2 ring-emerald-200/80"
            : dayStart
              ? "border-2 border-violet-400 bg-violet-100/90 ring-1 ring-violet-200"
              : sameHour
              ? "border-2 border-emerald-300 bg-emerald-50/70 ring-1 ring-emerald-100"
              : hasPrice
                ? muted
                  ? "border border-gray-200 bg-gray-50"
                  : "border border-gray-200 bg-white hover:border-gray-300 hover:shadow"
                : "border border-dashed border-gray-200 bg-gray-50/60"
        }`}
      >
        {s.isCurrent && (
          <span className="absolute -top-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white shadow-sm">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            Now
          </span>
        )}

        <div
          className={`text-[11px] sm:text-xs font-bold tabular-nums tracking-wide ${
            s.isCurrent || sameHour ? "text-emerald-700" : "text-gray-500"
          }`}
        >
          {s.label}
        </div>

        <div
          style={{ fontSize: pollPriceFont(s.isCurrent ? 1.15 : 1.05) }}
          className={`mt-1 w-full whitespace-nowrap font-mono font-extrabold tabular-nums leading-tight ${
            s.isCurrent
              ? "text-emerald-900"
              : hasPrice
                ? muted
                  ? "text-gray-700"
                  : "text-gray-900"
                : "text-gray-300"
          }`}
        >
          {hasPrice ? formatPhp(s.price as number) : "—"}
        </div>

        <div
          className={`mt-1 min-h-[1rem] whitespace-nowrap text-[11px] sm:text-xs font-bold tabular-nums ${
            up ? "text-emerald-600" : down ? "text-red-500" : "text-gray-400"
          }`}
        >
          {s.delta != null
            ? `${up ? "▲" : down ? "▼" : "•"} ${Math.abs(s.delta).toFixed(2)}%`
            : ""}
        </div>
      </div>
    );
  };

    const swingRanks = useMemo(() => {
    if (!allCoins || allCoins.length === 0) return new Map<string, number>();

    const ranked = [...allCoins]
      .map((coin) => {
        const high = coin.targetHigh;
        const low = coin.targetLow;
        let swingPercent = 0;
        if (high != null && low != null && low > 0) {
          swingPercent = ((high - low) / low) * 100;
        }
        return { symbol: coin.symbol, swingPercent };
      })
      .sort((a, b) => b.swingPercent - a.swingPercent);

    const map = new Map<string, number>();
    ranked.forEach((item, idx) => {
      map.set(item.symbol, idx + 1);
    });
    return map;
  }, [allCoins]);

  const coinRank = useMemo(() => {
    if (!symbol) return null;
    return swingRanks.get(symbol) ?? null;
  }, [symbol, swingRanks]);

  const coinTransactions = useMemo(() => {
    if (!symbol || !transactions) return [];
    return transactions
      .filter((tx) => tx.symbol === symbol)
      .sort((a, b) => new Date(b.transactedAt).getTime() - new Date(a.transactedAt).getTime());
  }, [symbol, transactions]);

  const buyMarks = useMemo(() => {
    if (!coinTransactions?.length) return [] as { dayKey: string; price: number }[];
    const marks: { dayKey: string; price: number }[] = [];
    for (const tx of coinTransactions) {
      if (tx.type !== "buy" || !(tx.price > 0)) continue;
      const tms = new Date(tx.transactedAt).getTime();
      if (!Number.isFinite(tms)) continue;
      const dayKey = new Date(tms + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
      marks.push({ dayKey, price: tx.price });
    }
    return marks;
  }, [coinTransactions]);

  const technicals = useMemo(() => {
    if (points.length === 0) return { support: null, resistance: null };
    return getSupportResistance(points, 30);
  }, [points]);

  const structureExtraLevels = useMemo(() => {
    if (points.length < 5) return null;
    const anyLevel = showS1 || showS2 || showR1 || showR2;
    if (!anyLevel) return null;
    const sup = technicals.support ?? 0;
    const res = technicals.resistance ?? 0;
    const px =
      currentPrice > 0
        ? currentPrice
        : points[points.length - 1]
          ? (points[points.length - 1].high + points[points.length - 1].low) / 2
          : 0;
    const series = intradayPoints && intradayPoints.length > 10 ? intradayPoints : points;
    try {
      const all = buildStructureKeyLevels(series, px, sup, res);
      const allow = new Set<string>();
      if (showS1) allow.add("S1");
      if (showS2) allow.add("S2");
      if (showR1) allow.add("R1");
      if (showR2) allow.add("R2");
      return all
        .filter((l) => allow.has(l.shortLabel))
        .map((l) => ({
          price: l.price,
          label: l.label,
          shortLabel: l.shortLabel,
          color: l.color,
          dashed: l.dashed,
        }));
    } catch {
      return null;
    }
  }, [showS1, showS2, showR1, showR2, points, intradayPoints, technicals.support, technicals.resistance, currentPrice]);


  return (
    <div className="flex flex-col gap-6 relative pb-16 sm:pb-0">
      {symbol && currentPrice > 0 && (
        <div
          className="floating-spot-price fixed bottom-3 left-3 right-3 z-40 sm:sticky sm:top-2 sm:bottom-auto sm:left-auto sm:right-auto sm:self-end sm:w-auto sm:z-30"
          aria-live="polite"
        >
          <div className="mx-auto flex max-w-lg items-center justify-between gap-3 rounded-xl border border-sky-300 bg-sky-50/95 px-3 py-2.5 shadow-lg backdrop-blur sm:mx-0 sm:max-w-none sm:shadow-md">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wide text-sky-800">
                {coinRank != null ? `#${coinRank} · ` : ""}
                {selectedCoin?.name || symbol}
                <span className="font-mono font-semibold text-sky-700/80">
                  {" "}
                  {symbol}
                </span>
              </div>
              <div className="text-base sm:text-lg font-extrabold tabular-nums text-sky-950">
                {formatPhp(currentPrice)}
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
              Now
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <Link href="/" className={pageNavHome}>
          <span aria-hidden>←</span>
          <span>Home</span>
        </Link>
        {symbol && (
          <>
            <Link
              href={`/calendar?symbol=${encodeURIComponent(symbol)}`}
              className={`${pageNavBtn} border-purple-200 bg-purple-50 text-purple-800 hover:bg-purple-100`}
            >
              <span aria-hidden>📅</span>
              <span>Calendar</span>
            </Link>
            <Link
              href={`/manage?symbol=${encodeURIComponent(symbol)}`}
              className={`${pageNavBtn} border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}
            >
              <span aria-hidden>⚙️</span>
              <span>Manage</span>
            </Link>
            <Link
              href="/long-scan"
              className={`${pageNavBtn} border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100`}
              title="LONG scan log"
            >
              <span aria-hidden>📡</span>
              <span>LONG scan</span>
            </Link>
          </>
        )}
      </div>

      <MacroDayBanner />

      {/* Watchlist Scan — check every tracked coin's confluence signal at once
          instead of clicking through the dropdown one by one */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <span>📡</span> Watchlist Scan
            </h2>
            <p className="text-xs text-gray-500">
              Check every tracked coin's confluence signal at once — click a result to load its full chart below.
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Suggested: ~08:15 and ~20:15 Manila
            </p>
          </div>
          <button
            type="button"
            onClick={runScan}
            disabled={isScanning || allCoins.length === 0}
            className="px-4 py-2 rounded-md text-sm font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap shadow-sm"
          >
            {isScanning ? `Scanning ${scanProgress.completed}/${scanProgress.total}…` : "🔍 Scan All Coins"}
          </button>
        </div>

        {scanError && <AlertBanner variant="error" message={`Scan failed: ${scanError}`} />}

        {hasScanned && !isScanning && (
          <div className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-[11px] text-gray-400">
                {visibleScanResults.length} of {sortedScanResults.length} coins shown
                {!showAllScanResults && " (hits + near-support worth-check)"}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCopyScanResults}
                  disabled={directionalSignalCount === 0}
                  title={
                    directionalSignalCount === 0
                      ? "No LONG/SHORT signals to copy right now"
                      : "Copy full details of LONG/SHORT signals for your journal"
                  }
                  className="text-[11px] font-semibold text-white bg-gray-700 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed rounded px-2.5 py-1 transition"
                >
                  {scanCopied ? "✅ Copied!" : `📋 Copy for Journal (${directionalSignalCount})`}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAllScanResults((v) => !v)}
                  className="text-[11px] font-medium text-purple-700 hover:underline"
                >
                  {showAllScanResults ? "Show buy-low hits only" : "Show all coins"}
                </button>
              </div>
            </div>

            {visibleScanResults.length === 0 ? (
              <p className="text-xs text-gray-500 py-2">
                No buy-low watchlist hits right now — no LONG/NEUTRAL coin is near support or in the lower third of range.
                Try "Show all coins" to see the full breakdown.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {visibleScanResults.map((r) => (
                  <div
                    key={r.symbol}
                    className={`rounded-md border p-2.5 transition hover:shadow-sm ${
                      symbol === r.symbol ? "ring-2 ring-purple-400" : ""
                    } ${r.error ? "border-gray-200 bg-gray-50" : "border-gray-200 bg-white"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setSymbol(r.symbol)}
                        className="text-xs font-bold text-gray-900 hover:underline text-left"
                        title={`Load ${r.symbol} chart`}
                      >
                        {r.symbol}
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        {r.streak >= 2 && (
                          <span
                            className="rounded-md border border-orange-300 bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold text-orange-700"
                            title={`${r.streak} consecutive scan runs with the same signal direction`}
                          >
                            🔥{r.streak}
                          </span>
                        )}
                        {r.confluence &&
                          !isWatchlistBuyLowHit(r.confluence) &&
                          isNearSupportWorthCheck(r.confluence) && (
                            <span
                              className="rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-800"
                              title="Near support — secondary watch, not a priority hit"
                            >
                              📌 Check
                            </span>
                          )}
                        {r.confluence && (
                          <span
                            className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${
                              BIAS_BADGE_CLASSES[r.confluence.bias]
                            }`}
                          >
                            {r.confluence.bias}
                          </span>
                        )}
                        {r.confluence && (
                          <button
                            type="button"
                            onClick={() => handleCopyCard(r)}
                            title="Copy this coin's full details"
                            className="text-[11px] px-1.5 py-0.5 rounded hover:bg-gray-100 text-gray-500"
                          >
                            {cardCopiedSymbol === r.symbol ? "✅" : "📋"}
                          </button>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSymbol(r.symbol)}
                      className="block w-full text-left mt-1"
                      title={`Load ${r.symbol} chart`}
                    >
                      {r.error ? (
                        <p className="text-[10px] text-red-500">Failed to load</p>
                      ) : r.confluence ? (
                        <p className="text-[10px] text-gray-500">
                          Score {r.confluence.score >= 0 ? "+" : ""}
                          {r.confluence.score}/±{r.confluence.maxPossibleScore} ·{" "}
                          {(r.confluence.confidence * 100).toFixed(0)}% data
                          <br />
                          {isWatchlistBuyLowHit(r.confluence) ? (
                            isLongExtended(r.confluence) ? (
                              <span className="text-amber-700 font-semibold">
                                ⏳ Extended — wait for pullback into ladder
                              </span>
                            ) : r.confluence.bias.includes("LONG") ? (
                              <span className="text-emerald-700 font-medium">
                                Near ladder / ready to stage
                              </span>
                            ) : (
                              <span className="text-emerald-700/90 font-medium">
                                Buy-low zone — watch for confirmation
                              </span>
                            )
                          ) : isNearSupportWorthCheck(r.confluence) ? (
                            <span className="text-sky-700 font-medium">
                              📌 Worth to check — near support / key level
                            </span>
                          ) : r.confluence.bias.includes("SHORT") ? (
                            <span className="text-rose-600 font-medium">
                              Hold cash — do not buy
                            </span>
                          ) : isLongExtended(r.confluence) ? (
                            <span className="text-amber-700 font-semibold">
                              ⏳ Extended — wait for pullback into ladder
                            </span>
                          ) : r.confluence.bias.includes("LONG") ? (
                            <span className="text-emerald-700 font-medium">
                              Near ladder / ready to stage
                            </span>
                          ) : null}
                          <br />
                          <span className="text-gray-400">
                            {new Date(r.scannedAt).toLocaleTimeString("en-US", {
                              timeZone: "Asia/Manila",
                              hour: "numeric",
                              minute: "2-digit",
                            })}{" "}
                            Manila
                          </span>
                        </p>
                      ) : (
                        <p className="text-[10px] text-gray-400">No data</p>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {!symbol ? (
        <div className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <Dropdown
            label="Coin"
            placeholder="Select a coin to analyse"
            value={symbol}
            onChange={setSymbol}
            options={coinOptions.map((c) => ({
              label: `${c.name} (${c.symbol})`,
              value: c.symbol,
            }))}
          />
        </div>
      ) : null}

      {!symbol ? (
        <div className="space-y-6">
          <div className="flex min-h-[250px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center">
            <div className="text-4xl mb-4">📈</div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">No Coin Selected</h2>
            <p className="text-sm text-gray-500 max-w-sm">
              Use the dropdown above to select a cryptocurrency to view its chart history, technical insights, and your trade logs.
            </p>
          </div>

          {/* General Journal Block displayed when no coin is selected */}
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900">🌍 General Market Journal &amp; Notes</h3>
                <p className="text-xs text-gray-500 mt-0.5">Track macro updates, news, and notes not tied to a specific coin.</p>
              </div>
            </div>

            <JournalSidebar
              entries={entries}
              loading={journalLoading}
              error={journalError}
              defaultSymbol={symbol}
              authenticated={authenticated}
              onAdd={addJournalEntry}
              onDelete={deleteJournalEntry}
              onUpdate={updateJournalEntry}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {chartError && <AlertBanner variant="error" message={`Failed to load chart: ${chartError}`} />}

          <div className="flex flex-col gap-4 bg-white border border-purple-100 rounded-lg p-5 shadow-sm">
            <div className="flex flex-row items-center gap-3 flex-wrap sm:flex-nowrap">
              {coinRank !== null && (
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-1 rounded-md whitespace-nowrap">
                  <span>Rank #{coinRank}</span>
                  {coinRank === 1 && <span className="font-medium text-purple-600 hidden sm:inline">(Highest Swing)</span>}
                </div>
              )}

              <h2 className="text-xl font-bold text-gray-900 whitespace-nowrap">
                {selectedCoin?.name || symbol} ({symbol?.endsWith('PHP') ? symbol : `${symbol}PHP`})
              </h2>
            </div>

            {currentPrice > 0 && (
              <div className="border-t border-gray-100 pt-4">
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    3h Polls
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-medium text-gray-400">Manila</span>
                    <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
                      <button
                        type="button"
                        onClick={() => setPollViewMode("cards")}
                        className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                          pollViewMode === "cards"
                            ? "bg-violet-600 text-white"
                            : "text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        Cards
                      </button>
                      <button
                        type="button"
                        onClick={() => setPollViewMode("line")}
                        className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                          pollViewMode === "line"
                            ? "bg-violet-600 text-white"
                            : "text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        Line
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPollExtraDays((d) => Math.min(d + 1, 14))}
                      disabled={pollExtraDays >= 14}
                      className="rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-900 hover:bg-violet-100 disabled:opacity-40"
                      title="Load one more Manila day (8 slots) of history"
                    >
                      Load +1 day
                    </button>
                    {pollExtraDays > 0 && (
                      <button
                        type="button"
                        onClick={() => setPollExtraDays(0)}
                        className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-600 hover:bg-gray-50"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
                <p className="mb-2 text-[10px] text-gray-400">
                  Violet tile = day start (2:05 Manila) · {pollWindow.windowSize} slots
                  {pollExtraDays > 0 ? ` (+${pollExtraDays}d)` : ""}
                </p>

                {pollViewMode === "line" ? (
                  <PollMiniLine
                    groups={pollWindow.groups}
                    dayLabel={pollWindow.dayLabel}
                    todayKey={pollWindow.todayKey}
                  />
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5 sm:gap-2">
                    {pollWindow.groups.flatMap((g) => {
                      const muted = g.dayKey !== pollWindow.todayKey;
                      const dayTitle =
                        g.dayKey === pollWindow.todayKey
                          ? `Today · ${pollWindow.dayLabel(g.dayKey)}`
                          : pollWindow.dayLabel(g.dayKey);
                      return g.tiles.map((tile, ti) => (
                        <div key={`${g.dayKey}-${tile.hour}`} className="relative flex-none">
                          {ti === 0 && (
                            <div
                              className="pointer-events-none absolute -top-3.5 left-0 z-10 max-w-[5.25rem] truncate text-[9px] font-bold uppercase tracking-wide text-violet-600"
                              title={dayTitle}
                            >
                              {dayTitle}
                            </div>
                          )}
                          {renderPollTile(tile, g.dayKey, muted)}
                        </div>
                      ));
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <Dropdown
              label="Coin"
              placeholder="Select a coin to analyse"
              value={symbol}
              onChange={setSymbol}
              options={coinOptions.map((c) => ({
                label: `${c.name} (${c.symbol})`,
                value: c.symbol,
              }))}
            />
            <div className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              <span>Range</span>
              <div className="inline-flex rounded-md border border-gray-200 p-1 bg-white">
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setRange(opt.value)}
                    className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                      range === opt.value
                        ? "bg-brand-600 text-white"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="w-full rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            {chartLoading ? (
              <div className="flex h-96 items-center justify-center text-sm text-gray-500">
                Loading chart…
              </div>
            ) : (
              <PriceLineChart
                points={points}
                journalLabels={journalLabelsInView}
                showHigh={showHigh}
                showLow={showLow}
                showKeyLevels={showKeyLevels}
                currentPrice={currentPrice > 0 ? currentPrice : null}
                showBreakEven={!!activePortfolio && activePortfolio.holdings > 0 && activePortfolio.spent > 0}
                breakEvenPrice={
                  activePortfolio && activePortfolio.holdings > 0 && activePortfolio.spent > 0
                    ? activePortfolio.spent / activePortfolio.holdings
                    : null
                }
                support={technicals.support}
                resistance={technicals.resistance}
                extraLevels={structureExtraLevels}
                intradayPoints={intradayPoints}
                buyMarks={buyMarks}
                overlayControls={{
                  showHigh,
                  showLow,
                  showKey: showKeyLevels,
                  showS1,
                  showS2,
                  showR1,
                  showR2,
                  onToggleHigh: () => setShowHigh((v) => !v),
                  onToggleLow: () => setShowLow((v) => !v),
                  onToggleKey: () => setShowKeyLevels((v) => !v),
                  onToggleS1: () => setShowS1((v) => !v),
                  onToggleS2: () => setShowS2((v) => !v),
                  onToggleR1: () => setShowR1((v) => !v),
                  onToggleR2: () => setShowR2((v) => !v),
                }}
              />
            )}
          </div>

          <TradingInsightCard
            points={confluencePoints.length > 0 ? confluencePoints : points}
            symbol={symbol}
            activePortfolio={activePortfolio}
            support={undefined}
            resistance={undefined}
            currentPrice={currentPrice}
            intradayPoints={intradayPoints}
          />

          <PositionAndTradesCard
            symbol={symbol}
            currentPrice={currentPrice}
            portfolio={activePortfolio}
            transactions={coinTransactions}
            support={technicals.support}
            resistance={technicals.resistance}
            points={points}
          />

                    <JournalSidebar
            entries={entries}
            loading={journalLoading}
            error={journalError}
            defaultSymbol={symbol}
            authenticated={authenticated}
            onAdd={addJournalEntry}
            onDelete={deleteJournalEntry}
            onUpdate={updateJournalEntry}
          />
        </div>
      )}
    </div>
  );
}