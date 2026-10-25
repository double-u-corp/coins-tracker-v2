import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Dropdown from "@/components/Dropdown";
import AlertBanner from "@/components/AlertBanner";
import JournalSidebar from "./JournalSidebar";
import TradingInsightCard from "./TradingInsightCard";
import DCACalculator from "./DCACalculator";
import { useChartLogic, type ChartRange } from "./useChartLogic";
import { formatPhp } from "@/lib/format";
import { getSupportResistance, BIAS_BADGE_CLASSES, BIAS_PRIORITY, isLongExtended, isWatchlistBuyLowHit, isNearSupportWorthCheck } from "./Technicals";
import { useCoinScanner, formatScanResultsForJournal, formatSingleScanResult } from "./useCoinScanner";
import MacroDayBanner from "./MacroDayBanner";

const PriceLineChart = dynamic(() => import("./PriceLineChart"), {
  ssr: false,
  loading: () => (
    <div className="flex h-96 items-center justify-center text-sm text-gray-500">
      Loading chart…
    </div>
  ),
});

const RANGE_OPTIONS: { label: string; value: ChartRange }[] = [
  { label: "1M", value: "1m" },
  { label: "3M", value: "3m" },
  { label: "6M", value: "6m" },
  { label: "1Y", value: "1y" },
  { label: "3Y", value: "3y" },
];

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
  const [showKeyLevels, setShowKeyLevels] = useState(true);
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

  /** Poll prints (Manila) for yesterday + today, 8 slots each in time order from 02:05 — null until a slot has data. */
  const { todayPollPrices, yesterdayPollPrices, todayKey, yesterdayKey } = useMemo(() => {
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

    const manilaNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const todayKey = manilaNow.toISOString().slice(0, 10);
    const yesterdayKey = new Date(manilaNow.getTime() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    type SlotRow = { hour: number; label: string; price: number | null; isCurrent: boolean };
    type Hit = { price: number; dist: number; ts: number };
    const byDay = new Map<string, Map<number, Hit>>([
      [todayKey, new Map()],
      [yesterdayKey, new Map()],
    ]);

    // 3h series covers 14 days, so yesterday is available. Falls back to daily points.
    const series = intradayPoints && intradayPoints.length > 0 ? intradayPoints : points;
    for (const pt of series) {
      const raw = (pt as { period?: string }).period;
      if (!raw) continue;
      const tms = new Date(raw).getTime();
      if (!Number.isFinite(tms)) continue;
      const manila = new Date(tms + 8 * 60 * 60 * 1000);
      const bucket = byDay.get(manila.toISOString().slice(0, 10));
      if (!bucket) continue;
      const hour = manila.getUTCHours();
      // Map to nearest scheduled slot hour
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
      const prev = bucket.get(slot);
      if (!prev || best < prev.dist || (best === prev.dist && tms >= prev.ts)) {
        bucket.set(slot, { price, dist: best, ts: tms });
      }
    }

    const build = (dayKey: string, markCurrent: boolean): SlotRow[] => {
      const bucket = byDay.get(dayKey)!;
      // Current slot = latest filled print of the day
      let currentHour: number | null = null;
      let latestTs = -1;
      if (markCurrent) {
        for (const [h, v] of bucket) {
          if (v.ts >= latestTs) {
            latestTs = v.ts;
            currentHour = h;
          }
        }
      }
      return SLOT_HOURS.map((hour) => {
        const row = bucket.get(hour);
        return {
          hour,
          label: SLOT_LABELS[hour],
          price: row?.price ?? null,
          isCurrent: markCurrent && currentHour === hour && row != null,
        };
      });
    };

    return {
      todayPollPrices: build(todayKey, true),
      yesterdayPollPrices: build(yesterdayKey, false),
      todayKey,
      yesterdayKey,
    };
  }, [intradayPoints, points]);

  /** Yesterday's price = last filled poll of yesterday. */
  const yesterdayPrice = useMemo(() => {
    for (let i = yesterdayPollPrices.length - 1; i >= 0; i--) {
      const v = yesterdayPollPrices[i].price;
      if (v != null) return v;
    }
    return null;
  }, [yesterdayPollPrices]);

  /** % change vs the previous poll in time order; today's first poll compares to yesterday's last price. */
  const withDeltas = (
    slots: { hour: number; label: string; price: number | null; isCurrent: boolean }[],
    seed: number | null
  ) => {
    const deltaByHour = new Map<number, number>();
    let prev: number | null = seed;
    for (const s of slots) {
      if (s.price == null) continue;
      if (prev != null && prev > 0) deltaByHour.set(s.hour, ((s.price - prev) / prev) * 100);
      prev = s.price;
    }
    return slots.map((s) => ({ ...s, delta: deltaByHour.get(s.hour) ?? null }));
  };
  const yesterdayTiles = useMemo(() => withDeltas(yesterdayPollPrices, null), [yesterdayPollPrices]);
  const pollTiles = useMemo(
    () => withDeltas(todayPollPrices, yesterdayPrice),
    [todayPollPrices, yesterdayPrice]
  );

  /** Today vs yesterday's last price (for the header chip). */
  const todayVsYesterday = useMemo(() => {
    if (yesterdayPrice == null || yesterdayPrice <= 0 || !(currentPrice > 0)) return null;
    return ((currentPrice - yesterdayPrice) / yesterdayPrice) * 100;
  }, [yesterdayPrice, currentPrice]);

  const dayLabel = (key: string) =>
    new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  /**
   * Tiles keep a FIXED size; only the price font shrinks to fit. The longest price across
   * both days drives one shared size so every tile matches (container units of each tile).
   */
  const pollPriceLen = useMemo(
    () =>
      [...yesterdayTiles, ...pollTiles].reduce(
        (max, s) => (s.price != null ? Math.max(max, formatPhp(s.price).length) : max),
        6
      ),
    [yesterdayTiles, pollTiles]
  );
  const pollPriceFont = (maxRem: number) =>
    `max(0.5rem, min(${maxRem}rem, calc((100cqw - 0.5rem) / ${(pollPriceLen * 0.62).toFixed(2)})))`;

  const renderPollTile = (s: (typeof pollTiles)[number], dayTag: string, muted: boolean) => {
    const hasPrice = s.price != null;
    const up = s.delta != null && s.delta > 0.005;
    const down = s.delta != null && s.delta < -0.005;
    return (
      <div
        key={`${dayTag}-${s.hour}`}
        title={`${dayTag} ${s.label} Manila`}
        style={{ containerType: "inline-size" }}
        className={`relative flex min-w-0 flex-col items-center justify-center rounded-lg px-1 py-2.5 text-center transition-colors sm:px-2 ${
          s.isCurrent
            ? "border border-emerald-400 bg-gradient-to-b from-emerald-50 to-emerald-100/60 shadow-sm ring-2 ring-emerald-200"
            : hasPrice
              ? muted
                ? "border border-gray-200 bg-gray-50"
                : "border border-gray-200 bg-white hover:border-gray-300"
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
          className={`text-[10px] font-semibold tabular-nums tracking-wide ${
            s.isCurrent ? "text-emerald-700" : "text-gray-400"
          }`}
        >
          {s.label}
        </div>

        <div
          style={{ fontSize: pollPriceFont(s.isCurrent ? 1 : 0.875) }}
          className={`mt-0.5 w-full whitespace-nowrap font-mono font-bold tabular-nums leading-tight ${
            s.isCurrent
              ? "text-emerald-800"
              : hasPrice
                ? muted
                  ? "text-gray-600"
                  : "text-gray-800"
                : "text-gray-300"
          }`}
        >
          {hasPrice ? formatPhp(s.price as number) : "—"}
        </div>

        <div
          className={`mt-0.5 h-3.5 whitespace-nowrap text-[9px] font-semibold tabular-nums sm:text-[10px] ${
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

  const technicals = useMemo(() => {
    if (points.length === 0) return { support: null, resistance: null };
    return getSupportResistance(points, 30);
  }, [points]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
        >
          <span>←</span>
          <span>Back to Home</span>
        </Link>

        {symbol && (
          <div className="flex items-center gap-2">
            <Link
              href={`/calendar?symbol=${symbol}`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-md hover:bg-purple-100 transition-colors"
            >
              <span>📅</span>
              <span>View Calendar</span>
            </Link>

            <Link
              href={`/manage?symbol=${symbol}`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-md hover:bg-emerald-100 transition-colors"
            >
              <span>⚙️</span>
              <span>Manage Coin</span>
            </Link>
            <Link
              href="/long-scan"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-3 py-1.5 rounded-md hover:bg-indigo-100 transition-colors"
              title="LONG scan log — near-support + rising setups"
            >
              <span>📡</span>
              <span>LONG scan</span>
            </Link>
          </div>
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
          <div
            className={`inline-flex rounded-md border border-gray-200 p-1 bg-white ${
              !symbol ? "opacity-50 pointer-events-none" : ""
            }`}
          >
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

        <div className="flex flex-col gap-1 text-sm font-medium text-gray-700">
          <span>Analysis Overlays</span>
          <div
            className={`flex flex-wrap items-center gap-1.5 rounded-md border border-gray-200 p-1 bg-white ${
              !symbol ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => setShowHigh(!showHigh)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                showHigh ? "bg-green-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              High
            </button>
            <button
              type="button"
              onClick={() => setShowLow(!showLow)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                showLow ? "bg-red-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              Low
            </button>
            <button
              type="button"
              onClick={() => setShowKeyLevels(!showKeyLevels)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                showKeyLevels
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              Key Levels
            </button>
          </div>
        </div>
      </div>

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
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    3h Polls
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-x-2 text-[11px] text-gray-400">
                    {yesterdayPrice != null && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-1.5 py-0.5 ring-1 ring-gray-200">
                        <span className="font-semibold uppercase tracking-wide text-gray-400">Yesterday</span>
                        <span className="font-mono font-bold tabular-nums text-gray-700">
                          {formatPhp(yesterdayPrice)}
                        </span>
                        {todayVsYesterday != null && (
                          <span
                            className={`font-semibold tabular-nums ${
                              todayVsYesterday > 0.005
                                ? "text-emerald-600"
                                : todayVsYesterday < -0.005
                                  ? "text-red-500"
                                  : "text-gray-400"
                            }`}
                          >
                            {todayVsYesterday > 0.005 ? "▲" : todayVsYesterday < -0.005 ? "▼" : "•"}{" "}
                            {Math.abs(todayVsYesterday).toFixed(2)}%
                          </span>
                        )}
                      </span>
                    )}
                    <span>Manila time</span>
                  </span>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Yesterday · {dayLabel(yesterdayKey)}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8 sm:gap-2">
                      {yesterdayTiles.map((t) => renderPollTile(t, "Yesterday", true))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Today · {dayLabel(todayKey)}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8 sm:gap-2">
                      {pollTiles.map((t) => renderPollTile(t, "Today", false))}
                    </div>
                  </div>
                </div>
              </div>
            )}
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
                intradayPoints={intradayPoints}
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

          <DCACalculator
            symbol={symbol}
            currentPrice={currentPrice}
            portfolio={activePortfolio}
            support={technicals.support}
            resistance={technicals.resistance}
          />

          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              Transaction History <span className="text-brand-600">({symbol})</span>
            </h3>
            {coinTransactions.length === 0 ? (
              <p className="text-xs text-gray-500">No transactions recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Price</th>
                      <th className="px-3 py-2 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {coinTransactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-500">
                          {new Date(tx.transactedAt).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              tx.type === "buy" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                            }`}
                          >
                            {tx.type}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-800">{tx.coinAmount}</td>
                        <td className="px-3 py-2 text-gray-600">{formatPhp(tx.price)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-900">
                          {formatPhp(tx.phpAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
      )}
    </div>
  );
}