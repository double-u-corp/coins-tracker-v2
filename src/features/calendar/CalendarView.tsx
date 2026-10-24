import { useMemo, useState } from "react";
import Link from "next/link";
import Dropdown from "@/components/Dropdown";
import AlertBanner from "@/components/AlertBanner";
import { formatPhp } from "@/lib/format";
import { useCalendarLogic } from "./useCalendarLogic";

// Chronological within the Manila day: 2:05 first, 23:05 last.
const POLL_SLOT_HOURS = [2, 5, 8, 11, 14, 17, 20, 23] as const;
const POLL_SLOT_LABELS: Record<number, string> = {
  8: "8:05",
  11: "11:05",
  14: "14:05",
  17: "17:05",
  20: "20:05",
  23: "23:05",
  2: "2:05",
  5: "5:05",
};

type PollHit = { price: number; dist: number; ts: number };

/** Groups 3h points into Manila calendar days → nearest scheduled poll slot (same rules as Chart page). */
function buildPollsByDay(points: unknown[] | null): Map<string, Map<number, PollHit>> {
  const byDay = new Map<string, Map<number, PollHit>>();
  if (!points) return byDay;
  for (const pt of points as { period?: string; close?: number; high?: number }[]) {
    if (!pt.period) continue;
    const tms = new Date(pt.period).getTime();
    if (!Number.isFinite(tms)) continue;
    const manila = new Date(tms + 8 * 60 * 60 * 1000);
    const dayKey = manila.toISOString().slice(0, 10);
    const hour = manila.getUTCHours();
    let slot = -1;
    let best = 99;
    for (const h of POLL_SLOT_HOURS) {
      const d = Math.min(Math.abs(hour - h), 24 - Math.abs(hour - h));
      if (d < best && d <= 1) {
        best = d;
        slot = h;
      }
    }
    if (slot < 0) continue;
    const price = typeof pt.close === "number" ? pt.close : typeof pt.high === "number" ? pt.high : null;
    if (price == null || !Number.isFinite(price)) continue;
    const day = byDay.get(dayKey) ?? new Map<number, PollHit>();
    const prev = day.get(slot);
    if (!prev || best < prev.dist || (best === prev.dist && tms >= prev.ts)) {
      day.set(slot, { price, dist: best, ts: tms });
    }
    byDay.set(dayKey, day);
  }
  return byDay;
}

export default function CalendarView() {
  const {
    coinOptions,
    selectedSymbol,
    setSelectedSymbol,
    monthCursor,
    goToPreviousMonth,
    goToNextMonth,
    days,
    allCoinsData,
    intradayPoints,
    loading,
    error,
  } = useCalendarLogic();

  const [marketSortBy, setMarketSortBy] = useState<string>("volatility-desc");
  const [copied, setCopied] = useState(false);

  const monthLabel = monthCursor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const formatDateShort = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const recordsWithData = useMemo(
    () =>
      days
        .filter((d) => d.high != null && d.low != null)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [days]
  );

  const monthHighest =
    recordsWithData.length > 0 ? Math.max(...recordsWithData.map((d) => d.high as number)) : null;
  const monthLowest =
    recordsWithData.length > 0 ? Math.min(...recordsWithData.map((d) => d.low as number)) : null;
  const highestRecord = recordsWithData.find((d) => d.high === monthHighest);
  const lowestRecord = recordsWithData.find((d) => d.low === monthLowest);
  const volatilitySpread =
    monthHighest && monthLowest && monthLowest > 0
      ? ((monthHighest - monthLowest) / monthLowest) * 100
      : 0;

  const nowPrice = coinOptions.find((c) => c.symbol === selectedSymbol)?.currentPrice ?? null;

  /** Per-day breakdown: swing %, midpoint, change vs previous day, range-bar position. */
  const dailyTiles = useMemo(() => {
    const span =
      monthHighest != null && monthLowest != null ? monthHighest - monthLowest : 0;
    const pos = (v: number) =>
      span > 0 && monthLowest != null
        ? Math.min(100, Math.max(0, ((v - monthLowest) / span) * 100))
        : 0;
    const todayStr = new Date().toDateString();
    const pollsByDay = buildPollsByDay(intradayPoints);

    return recordsWithData.map((record, i) => {
      const high = record.high as number;
      const low = record.low as number;
      const mid = (high + low) / 2;
      const swing = low > 0 ? ((high - low) / low) * 100 : 0;
      const prev = recordsWithData[i + 1]; // list is newest → oldest
      const prevMid = prev ? ((prev.high as number) + (prev.low as number)) / 2 : null;
      const delta = prevMid != null && prevMid > 0 ? ((mid - prevMid) / prevMid) * 100 : null;
      const isToday = new Date(record.date).toDateString() === todayStr;
      const barLeft = pos(low);
      const barWidth = Math.max(3, pos(high) - barLeft);
      const nowPos =
        isToday && nowPrice != null && nowPrice > 0 ? pos(nowPrice) : null;

      // Poll tiles for this day. Change is vs the previous poll in time order.
      const hits = pollsByDay.get(String(record.date).slice(0, 10));
      let latestHour: number | null = null;
      let latestTs = -1;
      const deltaByHour = new Map<number, number>();
      if (hits) {
        let prevPrice: number | null = null;
        for (const h of [...POLL_SLOT_HOURS].sort((a, b) => a - b)) {
          const hit = hits.get(h);
          if (!hit) continue;
          if (prevPrice != null && prevPrice > 0) {
            deltaByHour.set(h, ((hit.price - prevPrice) / prevPrice) * 100);
          }
          prevPrice = hit.price;
          if (hit.ts >= latestTs) {
            latestTs = hit.ts;
            latestHour = h;
          }
        }
      }
      const polls = POLL_SLOT_HOURS.map((hour) => {
        const hit = hits?.get(hour);
        return {
          hour,
          label: POLL_SLOT_LABELS[hour],
          price: hit?.price ?? null,
          delta: deltaByHour.get(hour) ?? null,
          isCurrent: isToday && latestHour === hour && hit != null,
        };
      });
      const hasPolls = polls.some((p) => p.price != null);

      return { record, mid, swing, delta, isToday, barLeft, barWidth, nowPos, polls, hasPolls };
    });
  }, [recordsWithData, monthHighest, monthLowest, nowPrice, intradayPoints]);

  /** Min poll-tile width (rem) so the longest price fits; columns auto-fit to the card width. */
  const pollTileMinRem = useMemo(() => {
    let longest = 0;
    for (const d of dailyTiles) {
      for (const p of d.polls) {
        if (p.price != null) longest = Math.max(longest, formatPhp(p.price).length);
      }
    }
    return Math.max(3.5, longest * 0.42 + 0.75);
  }, [dailyTiles]);

  const coinCardsData = coinOptions.map((coin) => {
    const coinDays = (allCoinsData[coin.symbol] || []).filter(
      (d) => d.high != null && d.low != null
    );
    const coinHigh = coinDays.length > 0 ? Math.max(...coinDays.map((d) => d.high as number)) : null;
    const coinLow = coinDays.length > 0 ? Math.min(...coinDays.map((d) => d.low as number)) : null;
    const highRec = coinDays.find((d) => d.high === coinHigh);
    const lowRec = coinDays.find((d) => d.low === coinLow);
    const spread =
      coinHigh && coinLow && coinLow > 0 ? ((coinHigh - coinLow) / coinLow) * 100 : 0;
    return { coin, coinDays, coinHigh, coinLow, highRec, lowRec, spread };
  });

  const sortedCoinCards = [...coinCardsData]
    .sort((a, b) => {
      if (marketSortBy === "volatility-desc") return b.spread - a.spread;
      if (marketSortBy === "volatility-asc") return a.spread - b.spread;
      if (marketSortBy === "name") return a.coin.name.localeCompare(b.coin.name);
      return 0;
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));

  const currentSortedCoin = sortedCoinCards.find((c) => c.coin.symbol === selectedSymbol);

  const coinDropdownOptions = [
    { label: "🌐 All Coins (Overview)", value: "" },
    ...sortedCoinCards.map(({ coin, rank, spread }) => ({
      label: `#${rank} ${coin.name} (${coin.symbol})${spread > 0 ? ` — ${spread.toFixed(1)}%` : ""}`,
      value: coin.symbol,
    })),
  ];

  const handleCopySummary = async () => {
    const rankText = currentSortedCoin ? `Rank #${currentSortedCoin.rank}` : "Rank #N/A";
    const summaryText =
      `👑 ${rankText}\n` +
      `${currentSortedCoin?.coin.name || selectedSymbol} (${selectedSymbol})\n` +
      `Month: ${monthLabel}\n` +
      `🏆 Month High ${highestRecord ? formatDateShort(highestRecord.date) : "N/A"}\n` +
      `${monthHighest != null ? formatPhp(monthHighest) : "—"}\n` +
      `📉 Month Low ${lowestRecord ? formatDateShort(lowestRecord.date) : "N/A"}\n` +
      `${monthLowest != null ? formatPhp(monthLowest) : "—"}\n` +
      `📊 Monthly Swing ${volatilitySpread.toFixed(1)}%`;

    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 pb-10">
      {/* Top bar — same button style as Chart page (rounded-md, not pills) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
        >
          <span>←</span>
          <span>Back to Home</span>
        </Link>

        {selectedSymbol && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopySummary}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-md hover:bg-purple-100 transition-colors"
            >
              <span>📋</span>
              <span>{copied ? "Copied!" : "Copy Summary"}</span>
            </button>
            <Link
              href={`/chart?symbol=${encodeURIComponent(selectedSymbol)}`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-md hover:bg-blue-100 transition-colors"
            >
              <span>📈</span>
              <span>View Chart</span>
            </Link>
            <Link
              href={`/manage?symbol=${encodeURIComponent(selectedSymbol)}`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-md hover:bg-emerald-100 transition-colors"
            >
              <span>⚙️</span>
              <span>Manage Coin</span>
            </Link>
            <button
              type="button"
              onClick={() => setSelectedSymbol("")}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-md hover:bg-purple-100 transition-colors"
            >
              <span>🌐</span>
              <span>Market Overview</span>
            </button>
          </div>
        )}
      </div>


      {/* Controls */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 flex-1 min-w-0">
          <div className="min-w-0">
            <Dropdown
              label="Coin"
              placeholder="Choose a coin"
              value={selectedSymbol}
              onChange={setSelectedSymbol}
              options={coinDropdownOptions}
            />
          </div>
          <div className="min-w-0">
            <Dropdown
              label="Sort rank"
              placeholder="Sort order"
              value={marketSortBy}
              onChange={setMarketSortBy}
              options={[
                { label: "🔥 Highest swing", value: "volatility-desc" },
                { label: "❄️ Lowest swing", value: "volatility-asc" },
                { label: "🔤 Name A–Z", value: "name" },
              ]}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-2 py-1.5 sm:justify-center">
          <button
            type="button"
            onClick={goToPreviousMonth}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-white"
          >
            ← Prev
          </button>
          <span className="min-w-[7.5rem] text-center text-xs font-bold text-slate-900">{monthLabel}</span>
          <button
            type="button"
            onClick={goToNextMonth}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-white"
          >
            Next →
          </button>
        </div>
      </div>

      {!loading && coinOptions.length === 0 && (
        <AlertBanner variant="info" message="No coins monitored yet — add one from Manage Coins." />
      )}
      {error && <AlertBanner variant="error" message={`Failed to load data: ${error}`} />}
      {loading && <AlertBanner variant="info" message="Loading record data…" />}

      {/* Single-coin stats */}
      {!loading && !error && selectedSymbol && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              {currentSortedCoin && (
                <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-bold text-violet-800">
                  #{currentSortedCoin.rank}{" "}
                  {marketSortBy === "volatility-desc"
                    ? "highest swing"
                    : marketSortBy === "volatility-asc"
                    ? "lowest swing"
                    : "A–Z"}
                </span>
              )}
              <h2 className="text-lg font-bold text-slate-900 truncate">
                {currentSortedCoin?.coin.name || selectedSymbol}
                <span className="ml-1.5 text-sm font-semibold text-slate-400">{selectedSymbol}</span>
              </h2>
            </div>
            {currentSortedCoin?.coin.currentPrice != null && (
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase text-slate-400">Now</div>
                <div className="text-xl font-bold tabular-nums text-slate-900">
                  {formatPhp(currentSortedCoin.coin.currentPrice)}
                </div>
              </div>
            )}
          </div>

          {recordsWithData.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-3.5">
                <div className="text-[10px] font-bold uppercase text-emerald-700">🏆 Month high</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-emerald-800">
                  {formatPhp(monthHighest as number)}
                </div>
                {highestRecord && (
                  <div className="text-[11px] text-slate-500">{formatDateShort(highestRecord.date)}</div>
                )}
              </div>
              <div className="rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50 to-white p-3.5">
                <div className="text-[10px] font-bold uppercase text-rose-700">📉 Month low</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-rose-800">
                  {formatPhp(monthLowest as number)}
                </div>
                {lowestRecord && (
                  <div className="text-[11px] text-slate-500">{formatDateShort(lowestRecord.date)}</div>
                )}
              </div>
              <div className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-3.5">
                <div className="text-[10px] font-bold uppercase text-sky-700">📊 Monthly swing</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-sky-800">
                  {volatilitySpread.toFixed(1)}%
                </div>
                <div className="text-[11px] text-slate-500">High → low spread</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Overview banner */}
      {!loading && !error && !selectedSymbol && (
        <div className="rounded-2xl border border-violet-100 bg-violet-50/80 p-4 text-xs text-violet-950">
          <h4 className="font-bold text-sm text-violet-900">🌐 Market overview · {monthLabel}</h4>
          <p className="mt-1 text-violet-800/90">
            Ranked by monthly high–low swing. Tap a card for daily highs/lows. High swing (&gt;25–30%) → dip-ladder
            candidates; tight swing (&lt;15%) → range / breakout watch.
          </p>
        </div>
      )}

      {/* Daily grid */}
      {!loading && !error && selectedSymbol && recordsWithData.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {dailyTiles.map(({ record, mid, swing, delta, isToday, barLeft, barWidth, nowPos, polls, hasPolls }) => {
            const formattedDate = new Date(record.date).toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            const isMonthHigh = record.high === monthHighest;
            const isMonthLow = record.low === monthLowest;
            const up = delta != null && delta > 0.005;
            const down = delta != null && delta < -0.005;

            return (
              <div
                key={record.date}
                className={`relative rounded-xl border bg-white p-3.5 shadow-sm transition ${
                  isToday
                    ? "border-emerald-400 bg-gradient-to-b from-emerald-50/60 to-white ring-2 ring-emerald-200"
                    : isMonthHigh || isMonthLow
                      ? "border-slate-400 shadow-md ring-1 ring-slate-200"
                      : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="mb-2.5 flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-bold text-slate-900">{formattedDate}</span>
                  {isToday ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
                      </span>
                      Today
                    </span>
                  ) : (
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                      {selectedSymbol}
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 text-sm">
                  <div
                    className={`flex items-baseline justify-between rounded-lg px-2 py-1.5 ${
                      isMonthHigh ? "border border-emerald-200 bg-emerald-50" : "bg-slate-50"
                    }`}
                  >
                    <span className={`text-[10px] font-bold uppercase ${isMonthHigh ? "text-emerald-800" : "text-slate-400"}`}>
                      {isMonthHigh ? "🏆 " : ""}High
                    </span>
                    <span className={`font-mono text-sm font-bold tabular-nums ${isMonthHigh ? "text-emerald-700" : "text-emerald-600"}`}>
                      {formatPhp(record.high)}
                    </span>
                  </div>
                  <div
                    className={`flex items-baseline justify-between rounded-lg px-2 py-1.5 ${
                      isMonthLow ? "border border-rose-200 bg-rose-50" : "bg-slate-50"
                    }`}
                  >
                    <span className={`text-[10px] font-bold uppercase ${isMonthLow ? "text-rose-800" : "text-slate-400"}`}>
                      {isMonthLow ? "📉 " : ""}Low
                    </span>
                    <span className={`font-mono text-sm font-bold tabular-nums ${isMonthLow ? "text-rose-700" : "text-rose-600"}`}>
                      {formatPhp(record.low)}
                    </span>
                  </div>
                </div>

                {/* 3h poll prints for the day */}
                {hasPolls && (
                  <div className="mt-2.5">
                    <div className="mb-1 flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      <span>Polls</span>
                      <span className="font-medium normal-case tracking-normal">Manila</span>
                    </div>
                    <div
                      className="grid gap-1"
                      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${pollTileMinRem}rem, 1fr))` }}
                    >
                      {polls.map((p) => {
                        const pUp = p.delta != null && p.delta > 0.005;
                        const pDown = p.delta != null && p.delta < -0.005;
                        return (
                          <div
                            key={p.hour}
                            title={`${p.label} Manila`}
                            className={`rounded-md px-1 py-1 text-center ${
                              p.isCurrent
                                ? "border border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200"
                                : p.price != null
                                  ? "border border-slate-200 bg-white"
                                  : "border border-dashed border-slate-200 bg-slate-50/60"
                            }`}
                          >
                            <div
                              className={`text-[9px] font-semibold tabular-nums ${
                                p.isCurrent ? "text-emerald-700" : "text-slate-400"
                              }`}
                            >
                              {p.label}
                            </div>
                            <div
                              className={`whitespace-nowrap font-mono text-[11px] font-bold tabular-nums leading-tight ${
                                p.isCurrent
                                  ? "text-emerald-800"
                                  : p.price != null
                                    ? "text-slate-700"
                                    : "text-slate-300"
                              }`}
                            >
                              {p.price != null ? formatPhp(p.price) : "—"}
                            </div>
                            <div
                              className={`h-3 text-[9px] font-semibold tabular-nums ${
                                pUp ? "text-emerald-600" : pDown ? "text-red-500" : "text-slate-400"
                              }`}
                            >
                              {p.delta != null
                                ? `${pUp ? "▲" : pDown ? "▼" : "•"} ${Math.abs(p.delta).toFixed(1)}%`
                                : ""}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Swing + midpoint with day-over-day change */}
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <div className="rounded-lg border border-sky-100 bg-sky-50/70 px-2 py-1.5 text-center">
                    <div className="text-[9px] font-bold uppercase tracking-wide text-sky-700">Swing</div>
                    <div className="font-mono text-xs font-bold tabular-nums text-sky-800">
                      {swing.toFixed(1)}%
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5 text-center">
                    <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Mid</div>
                    <div className="font-mono text-xs font-bold tabular-nums text-slate-700">
                      {formatPhp(mid)}
                    </div>
                    <div
                      className={`h-3 text-[10px] font-semibold tabular-nums ${
                        up ? "text-emerald-600" : down ? "text-red-500" : "text-slate-400"
                      }`}
                    >
                      {delta != null
                        ? `${up ? "▲" : down ? "▼" : "•"} ${Math.abs(delta).toFixed(2)}%`
                        : ""}
                    </div>
                  </div>
                </div>

                {/* Where this day's range sits inside the month's range */}
                <div className="mt-2.5">
                  <div className="relative h-1.5 rounded-full bg-slate-100">
                    <div
                      className={`absolute top-0 h-1.5 rounded-full ${
                        isToday ? "bg-emerald-400" : "bg-slate-300"
                      }`}
                      style={{ left: `${barLeft}%`, width: `${Math.min(barWidth, 100 - barLeft)}%` }}
                    />
                    {nowPos != null && (
                      <div
                        className="absolute -top-1 h-3.5 w-1 -translate-x-1/2 rounded-full bg-emerald-600 ring-2 ring-white"
                        style={{ left: `${nowPos}%` }}
                        title={`Now ${formatPhp(nowPrice as number)}`}
                      />
                    )}
                  </div>
                  <div className="mt-1 flex justify-between text-[9px] font-medium text-slate-400">
                    <span>Month low</span>
                    <span>Month high</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* All-coins grid */}
      {!loading && !error && !selectedSymbol && sortedCoinCards.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedCoinCards.map(({ coin, coinDays, coinHigh, coinLow, highRec, lowRec, spread, rank }) => (
            <button
              key={coin.symbol}
              type="button"
              onClick={() => setSelectedSymbol(coin.symbol)}
              className="flex flex-col rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition hover:border-violet-400 hover:shadow-md"
            >
              <div className="mb-2.5 flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-800">
                    #{rank}
                  </span>
                  <span className="truncate text-sm font-bold text-slate-900">{coin.name}</span>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[10px] font-bold text-slate-400">{coin.symbol}</div>
                  {coin.currentPrice != null && (
                    <div className="text-[11px] font-bold tabular-nums text-slate-700">
                      {formatPhp(coin.currentPrice)}
                    </div>
                  )}
                </div>
              </div>

              {coinDays.length === 0 ? (
                <div className="py-5 text-center text-[11px] italic text-slate-400">No data · {monthLabel}</div>
              ) : (
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50/80 px-2 py-1.5">
                    <div>
                      <div className="text-[10px] font-bold uppercase text-emerald-800">🏆 High</div>
                      {highRec && (
                        <div className="text-[10px] text-slate-500">{formatDateShort(highRec.date)}</div>
                      )}
                    </div>
                    <span className="font-mono text-xs font-bold text-emerald-700">
                      {coinHigh != null ? formatPhp(coinHigh) : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-rose-100 bg-rose-50/80 px-2 py-1.5">
                    <div>
                      <div className="text-[10px] font-bold uppercase text-rose-800">📉 Low</div>
                      {lowRec && (
                        <div className="text-[10px] text-slate-500">{formatDateShort(lowRec.date)}</div>
                      )}
                    </div>
                    <span className="font-mono text-xs font-bold text-rose-700">
                      {coinLow != null ? formatPhp(coinLow) : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-sky-100 bg-sky-50/80 px-2 py-1.5">
                    <div className="text-[10px] font-bold uppercase text-sky-800">📊 Swing</div>
                    <span className="font-mono text-xs font-bold text-sky-700">{spread.toFixed(1)}%</span>
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {!loading && !error && selectedSymbol && recordsWithData.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500">
          No records for {selectedSymbol} in {monthLabel}.
        </div>
      )}
    </div>
  );
}
