import Link from "next/link";
import { useState, useEffect, useMemo, type ReactNode } from "react";
import AlertBanner from "@/components/AlertBanner";
import { formatPhp } from "@/lib/format";
import { useHomeLogic } from "./useHomeLogic";
import NewRecordModal from "./NewRecordModal";
import HomeMacroWatch from "./HomeMacroWatch";
import NewsSection from "./NewsSection";
import JournalSidebar from "@/features/chart/JournalSidebar";
import PriceUpdateModal from "./PriceUpdateModal";
import type { CoinSummary } from "@/validators/recordSchema";
import { parsePriceMovePercents } from "./priceMoveSignals";

function formatDateTime(iso: string | null): string {
  if (!iso) return "No cron runs recorded yet";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function bannerVariant(status: string | null): "info" | "success" | "warning" | "error" {
  if (status === "success") return "success";
  if (status === "partial") return "warning";
  if (status === "error") return "error";
  return "info";
}

function PriceDirectionArrow({ direction, inverse = false }: { direction: "up" | "down" | "flat" | null; inverse?: boolean }) {
  if (direction === "up") return <span className={inverse ? "text-green-300" : "text-green-600"}>▲</span>;
  if (direction === "down") return <span className={inverse ? "text-red-300" : "text-red-600"}>▼</span>;
  return null;
}

interface CoinCardProps {
  coin: CoinSummary;
  canUpdatePrice: boolean;
  onUpdatePriceClick: (coin: { symbol: string; name: string }) => void;
}

function CoinCard({ coin, canUpdatePrice, onUpdatePriceClick }: CoinCardProps) {
  return (
    <div id={`coin-card-${coin.symbol}`} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900">
          {coin.name} <span className="font-normal text-gray-400">({coin.symbol})</span>
        </span>

        <div className="flex items-center gap-1.5">
          <Link
            href={`/chart?symbol=${encodeURIComponent(coin.symbol)}`}
            className="rounded bg-indigo-50 border border-indigo-200 px-2.5 py-1 text-xs font-bold text-indigo-800 hover:bg-indigo-100 transition-colors"
            title={`Open Spot for ${coin.symbol}`}
          >
            Spot →
          </Link>
        </div>
      </div>

      <div className="mb-4 flex items-baseline gap-1.5">
        <span className="text-xl font-bold text-gray-900">{formatPhp(coin.currentPrice)}</span>
        <PriceDirectionArrow direction={coin.priceDirection} />
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-3 border-t border-gray-100 pt-3 text-sm">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">High</div>
          <div className="mt-1 text-green-700">Recorded: {formatPhp(coin.recordedHigh)}</div>
          <div className="text-gray-500">Target: {formatPhp(coin.targetHigh)}</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Low</div>
          <div className="mt-1 text-red-700">Recorded: {formatPhp(coin.recordedLow)}</div>
          <div className="text-gray-500">Target: {formatPhp(coin.targetLow)}</div>
        </div>
      </div>
    </div>
  );
}


function MonitorCard({
  card,
  portfolio,
}: {
  card: {
    symbol: string;
    name: string;
    currentPrice: number | null;
    high: {
      alertType: string;
      targetPrice: number;
      distance: number;
    } | null;
    low: {
      alertType: string;
      targetPrice: number;
      distance: number;
    } | null;
    review: {
      urgency: string;
      daysUntil: number;
      reviewUntil: string;
    } | null;
  };
  portfolio: { symbol?: string; holdings?: number; spent?: number }[] | null | undefined;
}) {
  const hit =
    card.high?.alertType === "reached" || card.low?.alertType === "reached";
  const reviewU = card.review?.urgency;
  const border =
    hit || reviewU === "overdue"
      ? "border-rose-200 bg-rose-50/40"
      : reviewU === "today"
        ? "border-amber-200 bg-amber-50/50"
        : "border-gray-200 bg-white hover:shadow-md";

  const reviewLabel = card.review
    ? card.review.urgency === "overdue"
      ? `${Math.abs(card.review.daysUntil)}d overdue`
      : card.review.urgency === "today"
        ? "Review today"
        : card.review.daysUntil === 1
          ? "Tomorrow"
          : `In ${card.review.daysUntil}d`
    : null;

  const pos = portfolio?.find(
    (p) => p.symbol?.toUpperCase() === card.symbol.toUpperCase()
  );
  const holdings = pos?.holdings ?? 0;
  const spent = pos?.spent ?? 0;
  let pnl: ReactNode = null;
  if (holdings > 0 && spent > 0 && card.currentPrice != null && card.currentPrice > 0) {
    const avg = spent / holdings;
    const pnlPhp = holdings * card.currentPrice - spent;
    const pnlPct = ((card.currentPrice - avg) / avg) * 100;
    const up = pnlPct >= 0;
    pnl = (
      <div
        className={`mt-1 text-[11px] font-semibold tabular-nums ${
          up ? "text-emerald-700" : "text-rose-700"
        }`}
        title="P&L vs average cost"
      >
        <span className="font-bold">
          {up ? "+" : ""}
          {pnlPct.toFixed(2)}%
        </span>
        <span className="text-gray-500 font-medium">
          {" "}
          ({up ? "+" : "−"}
          {formatPhp(Math.abs(pnlPhp))})
        </span>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border p-3 transition-all ${border}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-base font-bold text-gray-900 truncate">
            {card.name}{" "}
            <span className="font-mono text-sm font-semibold text-gray-500">
              {card.symbol}
            </span>
          </div>
          {card.currentPrice != null && (
            <div className="mt-0.5 text-sm font-bold tabular-nums text-gray-900">
              {formatPhp(card.currentPrice)}
            </div>
          )}
          {pnl}
        </div>
        <Link
          href={`/chart?symbol=${encodeURIComponent(card.symbol)}`}
          className="shrink-0 text-sm font-bold text-brand-600 hover:underline"
        >
          Spot →
        </Link>
      </div>

      <div className="space-y-1.5 text-[11px]">
        {card.high && (
          <div className="flex justify-between gap-2 rounded-md bg-emerald-50/80 border border-emerald-100 px-2 py-1">
            <span className="text-emerald-800 font-semibold">
              High{" "}
              {card.high.alertType === "reached"
                ? "HIT"
                : card.high.distance <= 5
                  ? "near"
                  : "target"}
            </span>
            <span className="font-mono text-gray-900">
              {formatPhp(card.high.targetPrice)}
              {card.high.alertType !== "reached" && (
                <span className="text-gray-500">
                  {" "}
                  · {card.high.distance.toFixed(1)}% away
                </span>
              )}
            </span>
          </div>
        )}
        {card.low && (
          <div className="flex justify-between gap-2 rounded-md bg-rose-50/80 border border-rose-100 px-2 py-1">
            <span className="text-rose-800 font-semibold">
              Low{" "}
              {card.low.alertType === "reached"
                ? "HIT"
                : card.low.distance <= 5
                  ? "near"
                  : "target"}
            </span>
            <span className="font-mono text-gray-900">
              {formatPhp(card.low.targetPrice)}
              {card.low.alertType !== "reached" && (
                <span className="text-gray-500">
                  {" "}
                  · {card.low.distance.toFixed(1)}% away
                </span>
              )}
            </span>
          </div>
        )}
        {card.review && (
          <div
            className={`flex justify-between gap-2 rounded-md border px-2 py-1 ${
              card.review.urgency === "overdue"
                ? "bg-rose-50 border-rose-200"
                : card.review.urgency === "today"
                  ? "bg-amber-50 border-amber-200"
                  : "bg-violet-50/80 border-violet-100"
            }`}
          >
            <span className="font-semibold text-violet-900">
              Review {reviewLabel}
            </span>
            <span className="font-mono text-gray-700">{card.review.reviewUntil}</span>
          </div>
        )}
      </div>
    </div>
  );
}


export default function HomeTable() {
  const [nextCronLabel, setNextCronLabel] = useState("Calculating...");

  useEffect(() => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const currentTotalMinutes = h * 60 + m;

    const slots = [
      { h: 2, m: 5, label: "02:05 AM" },
      { h: 5, m: 5, label: "05:05 AM" },
      { h: 8, m: 5, label: "08:05 AM (Daily Candle Reset)" },
      { h: 11, m: 5, label: "11:05 AM" },
      { h: 14, m: 5, label: "02:05 PM" },
      { h: 17, m: 5, label: "05:05 PM (London Open)" },
      { h: 20, m: 5, label: "08:05 PM (US Pre-Market)" },
      { h: 23, m: 5, label: "11:05 PM (US Peak)" },
    ];

    let nextLabel = "02:05 AM (Tomorrow)";
    for (const slot of slots) {
      if (currentTotalMinutes < slot.h * 60 + slot.m) {
        nextLabel = slot.label;
        break;
      }
    }
    setNextCronLabel(nextLabel);
  }, []);

  const {
    coins,
    allCoins,
    targetAlerts,
    reviewSchedule,
    monitorCards,
    selectedCoins,
    setSelectedCoins,
    portfolio,
    lastCronRun,
    lastCronStatus,
    loading,
    error,
    canUpdatePrice,
    priceUpdateCoin,
    priceUpdateModalOpen,
    priceUpdateValue,
    setPriceUpdateValue,
    priceUpdateSubmitting,
    priceUpdateError,
    openPriceUpdateModal,
    closePriceUpdateModal,
    submitPriceUpdate,
    recentManualRecords,
    recentManualLoading,
    recentManualError,
    editingRecordId,
    editRecordValue,
    setEditRecordValue,
    editRecordSaving,
    editRecordError,
    startEditRecord,
    cancelEditRecord,
    saveEditRecord,
    alertRecords,
    alertModalOpen,
    closeAlertModal,
    cronTriggering,
    triggerCronManually,
    authenticated,
    journalEntries,
    journalLoading,
    journalError,
    addJournalEntry,
    updateJournalEntry,
    deleteJournalEntry,
} = useHomeLogic();

  const { heldMonitorCards, planMonitorCards } = useMemo(() => {
    const heldSyms = new Set(
      (portfolio || [])
        .filter((p: { holdings?: number }) => (p.holdings ?? 0) > 0)
        .map((p: { symbol?: string }) => (p.symbol || "").toUpperCase())
    );
    const held: typeof monitorCards = [];
    const plan: typeof monitorCards = [];
    for (const card of monitorCards || []) {
      if (heldSyms.has(card.symbol.toUpperCase())) held.push(card);
      else plan.push(card);
    }
    return { heldMonitorCards: held, planMonitorCards: plan };
  }, [monitorCards, portfolio]);


  const [movePctBySymbol, setMovePctBySymbol] = useState<Record<string, number>>({});
  const [directionCopied, setDirectionCopied] = useState(false);

  const copyDirectionAgent = async () => {
    const anchors = (["BTCPHP", "ETHPHP", "XAUTPHP"] as const).map((sym) => {
      const coin =
        allCoins.find((c) => c.symbol.toUpperCase() === sym) ||
        coins.find((c) => c.symbol.toUpperCase() === sym);
      const pctNews =
        movePctBySymbol[sym] ?? movePctBySymbol[sym.replace(/PHP$/i, "")];
      const pctPoll =
        coin?.priceChangePct != null && Number.isFinite(coin.priceChangePct)
          ? coin.priceChangePct
          : null;
      const pct =
        pctPoll != null ? pctPoll : pctNews != null && Number.isFinite(pctNews) ? pctNews : null;
      return {
        sym,
        name: coin?.name || sym.replace(/PHP$/i, ""),
        price: coin?.currentPrice ?? null,
        pct,
        dir: coin?.priceDirection ?? null,
      };
    });
    const manilaNow = new Date().toLocaleString("en-US", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const lines: string[] = [];
    lines.push("ROLE");
    lines.push(
      "You are a neutral market-regime analyst for a Philippines-based crypto trader using PHP spot pairs. The trader is LONG-only: no shorting, leverage, or margin."
    );
    lines.push("");
    lines.push("PURPOSE");
    lines.push(
      "Assess whether the current market environment favors taking altcoin risk, staying selective, or protecting cash."
    );
    lines.push(
      "Use BTC, ETH, and XAUT (tokenized gold) as market-direction anchors only. Do NOT recommend buying, selling, or trading BTC, ETH, or XAUT. Do not provide an altcoin buy signal."
    );
    lines.push("");
    lines.push("INPUT DATA");
    lines.push("My app's current readings:");
    for (const a of anchors) {
      const px = a.price != null ? String(a.price) : "n/a";
      const dir = a.dir || "n/a";
      const ch = a.pct != null ? `${a.pct >= 0 ? "+" : ""}${a.pct.toFixed(2)}%` : "n/a";
      lines.push(
        `* ${a.name} (${a.sym}): ${px} · direction ${dir} · change ${ch} · measurement period: recent app signal / last price update (exact horizon may be partial)`
      );
    }
    lines.push(`Snapshot timestamp: ${manilaNow} Manila`);
    lines.push("");
    lines.push("Optional historical readings:");
    lines.push("* Previous 3-hour snapshot: not provided by app in this copy");
    lines.push("* Previous 24-hour change: only if reflected in change % above; otherwise n/a");
    lines.push("* Previous 7-day change: not provided");
    lines.push("");
    lines.push("ANALYSIS RULES");
    lines.push(
      "1. Check data quality first. Identify missing timestamps, measurement periods, percentage changes, or conflicting readings. Never assume that \"up\" means a sustained uptrend."
    );
    lines.push("2. Assess three horizons separately:");
    lines.push("  * Short-term: approximately 3 hours");
    lines.push("  * Daily: approximately 24 hours");
    lines.push("  * Broader context: approximately 7 days, if data is available");
    lines.push("3. Interpret BTC and ETH together.");
    lines.push("  * Both rising with sustained strength: potentially supportive of altcoin risk.");
    lines.push("  * Diverging directions: mixed conditions.");
    lines.push("  * Both weakening: defensive conditions.");
    lines.push("  * A single upward snapshot is not sufficient to establish a trend.");
    lines.push("4. Use XAUT as a secondary context signal.");
    lines.push(
      "  * BTC/ETH rising while XAUT is flat or falling may be consistent with stronger crypto risk appetite, but does not prove it."
    );
    lines.push(
      "  * BTC/ETH rising alongside XAUT may indicate mixed demand or independent asset-specific moves."
    );
    lines.push(
      "  * BTC/ETH falling while XAUT rises may be consistent with defensive positioning."
    );
    lines.push("  * Do not infer causation from correlation or direction alone.");
    lines.push(
      "5. Verify market context when web search is available. Prefer recent, credible sources from the last 24–72 hours for ETF flows, macroeconomic developments, liquidations, regulatory events, and major crypto-specific news. Cite sources and publication dates. Distinguish verified facts from speculation. If you cannot verify a catalyst, state \"none verified.\""
    );
    lines.push(
      "6. Do not invent missing market data. If only prices and direction labels are provided, give a provisional verdict with low confidence as appropriate. Do not fabricate percentage changes, technical levels, news, or trend confirmation."
    );
    lines.push(
      "7. Do not confuse anchor strength with altcoin strength. BTC and ETH can rise while individual altcoins remain weak. State whether the available evidence supports broad risk-taking, selective exposure, or waiting for confirmation."
    );
    lines.push("8. This is a market-regime assessment, not investment advice or a buy signal.");
    lines.push("");
    lines.push("VERDICT RULES");
    lines.push("Choose exactly one:");
    lines.push(
      "* RISK-ON: Multiple horizons support sustained BTC/ETH strength, with no strong contradictory evidence."
    );
    lines.push(
      "* MIXED: Conflicting anchors, conflicting time horizons, insufficient confirmation, or meaningful uncertainty."
    );
    lines.push(
      "* RISK-OFF: Sustained BTC/ETH weakness or verified broad risk deterioration outweighs supportive evidence."
    );
    lines.push(
      "When evidence is insufficient, prefer MIXED rather than forcing a directional conclusion."
    );
    lines.push("");
    lines.push("REQUIRED OUTPUT");
    lines.push("1. Verdict");
    lines.push("RISK-ON / MIXED / RISK-OFF");
    lines.push("Confidence: Low / Medium / High");
    lines.push("Data quality: Good / Partial / Poor");
    lines.push("2. Evidence");
    lines.push("Maximum 3 bullets. Explain:");
    lines.push("* BTC and ETH alignment and persistence");
    lines.push("* What XAUT adds or fails to confirm");
    lines.push("* The strongest verified supporting or opposing market factor, if available");
    lines.push("Label observations separately from interpretations.");
    lines.push("3. Implication for PHP spot altcoin exposure");
    lines.push("Choose one:");
    lines.push("* WAIT: Insufficient confirmation or deteriorating conditions.");
    lines.push(
      "* SELECTIVE: Conditions are mixed; evaluate individual altcoins independently and keep risk controlled."
    );
    lines.push(
      "* RISK-ON, NOT A BUY SIGNAL: Broad conditions are supportive, but individual entries still require their own confirmation."
    );
    lines.push(
      "* DEFENSIVE: Broad conditions are weak; prioritize capital preservation and avoid chasing rebounds."
    );
    lines.push(
      "Give 1–2 specific observable conditions that would strengthen or weaken this stance. Do not prescribe position sizes or guarantee outcomes."
    );
    lines.push("4. Next recheck");
    lines.push(
      "Give the next practical Manila-time checkpoint and explain which readings should be compared. Do not imply that a specific time predicts a market move."
    );
    lines.push("");
    lines.push("STYLE");
    lines.push(
      "Concise, neutral, evidence-led. No hype, no unsupported price targets, no buy signals for BTC, ETH, XAUT, or individual altcoins."
    );
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setDirectionCopied(true);
      setTimeout(() => setDirectionCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/news?limit=40")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { items?: { headline?: string }[] } | null) => {
        if (cancelled || !data?.items) return;
        const headlines = data.items.map((i) => i.headline || "").filter(Boolean);
        setMovePctBySymbol(parsePriceMovePercents(headlines));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lastCronRun]);

  const openHoldings = useMemo(() => {
    return (portfolio || []).filter(
      (row: { symbol?: string; holdings?: number }) =>
        row.symbol && row.symbol !== "PHP" && (row.holdings ?? 0) > 0
    ) as { symbol: string; holdings?: number; currentPrice?: number | null }[];
  }, [portfolio]);

  return (
    <div>
      <NewRecordModal open={alertModalOpen} records={alertRecords} onClose={closeAlertModal} />
      <PriceUpdateModal
        open={priceUpdateModalOpen}
        coin={priceUpdateCoin}
        value={priceUpdateValue}
        onValueChange={setPriceUpdateValue}
        onSave={submitPriceUpdate}
        saving={priceUpdateSubmitting}
        error={priceUpdateError}
        onClose={closePriceUpdateModal}
        recentRecords={recentManualRecords}
        recentLoading={recentManualLoading}
        recentError={recentManualError}
        editingId={editingRecordId}
        editValue={editRecordValue}
        onEditValueChange={setEditRecordValue}
        editSaving={editRecordSaving}
        editError={editRecordError}
        onStartEdit={startEditRecord}
        onCancelEdit={cancelEditRecord}
        onSaveEdit={saveEditRecord}
      />

      {/* Attention board — not a second chart */}
      {/* <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px]">
        <Link
          href="/chart"
          className="rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 font-semibold text-purple-800 hover:bg-purple-100"
        >
          📈 Spot
        </Link>
        <Link
          href="/structure"
          className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-800 hover:bg-indigo-100"
        >
          🔎 3h Structure
        </Link>
        <Link
          href="/catalysts"
          className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 font-semibold text-sky-800 hover:bg-sky-100"
        >
          🌐 Catalysts
        </Link>
        <Link
          href="/trade"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800 hover:bg-emerald-100"
        >
          💼 Portfolio
        </Link>
        <span className="text-gray-400 ml-1">
          Suggested Spot scan: ~08:15 &amp; ~20:15 Manila
        </span>
      </div> */}

      {/* {openHoldings.length > 0 && (
        <div className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-indigo-900">
              Open positions ({openHoldings.length})
            </span>
            <Link href="/trade" className="text-[11px] font-semibold text-indigo-700 hover:underline">
              Portfolio →
            </Link>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {openHoldings.slice(0, 16).map((row) => (
              <span
                key={row.symbol}
                className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-white px-2 py-1 text-[11px]"
              >
                <span className="font-bold text-indigo-950">{row.symbol}</span>
                <Link
                  href={`/chart?symbol=${encodeURIComponent(row.symbol)}`}
                  className="font-semibold text-purple-700 hover:underline"
                >
                  Spot
                </Link>
                <span className="text-gray-300">|</span>
                <Link
                  href={`/structure?symbol=${encodeURIComponent(row.symbol)}`}
                  className="font-semibold text-indigo-700 hover:underline"
                >
                  3h
                </Link>
              </span>
            ))}
          </div>
        </div>
      )} */}

      {/* Header section with Title and Run Cron Button */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Coin Prices</h1>
        </div>
      </div>

      <AlertBanner
        variant={error ? "error" : bannerVariant(lastCronStatus)}
        message={error ? `Failed to load data: ${error}` : `Last cron run: ${formatDateTime(lastCronRun)} | Next run: ${nextCronLabel}`}
      />

      {/* Unified monitor: one card per coin (high + low + review date) */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-700 flex items-center gap-2">
            🎯 Target &amp; review monitor
            {loading && (
              <span className="h-3 w-16 animate-pulse rounded bg-violet-100" aria-hidden />
            )}
          </h2>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-gray-100 bg-gray-50/80 p-3 animate-pulse">
                <div className="h-4 w-28 rounded bg-gray-200 mb-2" />
                <div className="h-3 w-full rounded bg-gray-200 mb-1" />
                <div className="h-3 w-2/3 rounded bg-gray-200" />
              </div>
            ))}
          </div>
        
        ) : !monitorCards || monitorCards.length === 0 ? (
          <p className="text-xs text-gray-500 py-1">
            No target proximity alerts and no review dates set. Set targets / review-by on Manage.
          </p>
        ) : (
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-800">
                On hold · open positions
              </h3>
              {heldMonitorCards.length === 0 ? (
                <p className="text-xs text-gray-500">No held coins in this monitor list.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {heldMonitorCards.map((card) => (
                    <MonitorCard key={card.symbol} card={card} portfolio={portfolio} />
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-sky-800">
                Watch / plan to buy · not held
              </h3>
              {planMonitorCards.length === 0 ? (
                <p className="text-xs text-gray-500">No watchlist / plan-to-buy cards right now.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {planMonitorCards.map((card) => (
                    <MonitorCard key={card.symbol} card={card} portfolio={portfolio} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Direction anchors — not trade ideas */}
      {!loading && (
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Market direction anchors</h3>
              <p className="text-[11px] text-slate-500 max-w-xl">
                BTC · ETH · XAUT only — <span className="font-semibold">do not buy these here</span>.
                Use them to read crypto risk direction before staging alts.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void copyDirectionAgent()}
              className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-900 hover:bg-indigo-100"
            >
              {directionCopied ? "✅ Copied" : "📋 Direction agent"}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(["BTCPHP", "ETHPHP", "XAUTPHP"] as const).map((sym) => {
              const coin =
                allCoins.find((c) => c.symbol.toUpperCase() === sym) ||
                coins.find((c) => c.symbol.toUpperCase() === sym);
              const pct =
                movePctBySymbol[sym] ??
                movePctBySymbol[sym.replace(/PHP$/i, "")];
              const up = pct != null && pct > 0;
              const down = pct != null && pct < 0;
              return (
                <div
                  key={sym}
                  className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-slate-900">
                      {coin?.name || sym.replace("PHP", "")}{" "}
                      <span className="font-mono text-[10px] text-slate-500">{sym}</span>
                    </span>
                    <Link
                      href={`/chart?symbol=${encodeURIComponent(sym)}`}
                      className="text-[10px] font-bold text-indigo-700 hover:underline"
                    >
                      Spot →
                    </Link>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold tabular-nums text-slate-900">
                      {coin?.currentPrice != null ? formatPhp(coin.currentPrice) : "—"}
                    </span>
                    {(() => {
                      const change =
                        pct != null && Number.isFinite(pct)
                          ? pct
                          : coin?.priceChangePct != null && Number.isFinite(coin.priceChangePct)
                            ? coin.priceChangePct
                            : null;
                      if (change == null) {
                        return (
                          <PriceDirectionArrow direction={coin?.priceDirection ?? null} />
                        );
                      }
                      const isUp = change > 0;
                      const isDown = change < 0;
                      return (
                        <span
                          className={`inline-flex items-center gap-0.5 text-xs font-bold tabular-nums ${
                            isUp ? "text-green-600" : isDown ? "text-red-600" : "text-gray-500"
                          }`}
                        >
                          <span aria-hidden>{isUp ? "▲" : isDown ? "▼" : ""}</span>
                          {isUp ? "+" : ""}
                          {change.toFixed(2)}%
                        </span>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading coins">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm animate-pulse">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <div className="h-4 w-28 rounded bg-gray-200 mb-1.5" />
                  <div className="h-3 w-16 rounded bg-gray-100" />
                </div>
                <div className="h-6 w-16 rounded bg-gray-200" />
              </div>
              <div className="h-7 w-32 rounded bg-gray-200 mb-3" />
              <div className="space-y-2 mb-3">
                <div className="h-3 w-full rounded bg-gray-100" />
                <div className="h-3 w-4/5 rounded bg-gray-100" />
              </div>
              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                <div className="h-7 w-16 rounded bg-gray-100" />
                <div className="h-7 w-16 rounded bg-gray-100" />
                <div className="h-7 w-20 rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      ) : coins.length === 0 && !error ? (
        <>
          {selectedCoins.length > 0 && (
            <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500 shadow-sm">
              No coins match your filter.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mb-3 text-xs text-gray-500">
            Open Spot on a card for chart and technicals. Direction anchors above are not buy targets.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {coins.map((coin) => (
              <CoinCard key={coin.id} coin={coin} canUpdatePrice={canUpdatePrice} onUpdatePriceClick={openPriceUpdateModal} />
            ))}
          </div>
        </>
      )}

                  <p className="mt-2 text-xs text-gray-500">Target prices are set from the Manage Coins page.</p>

      {/* 1) Market Signals (Core outlet + Price & RSS) */}
      <NewsSection />

      {/* 2) Macro watch — after market signals */}
      <HomeMacroWatch />

      {/* 3) General journal */}
      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              🌍 General Market Journal &amp; Notes
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Track macro updates, news, and notes not tied to a specific coin.
            </p>
          </div>
        </div>
        <JournalSidebar
          entries={journalEntries}
          loading={journalLoading}
          error={journalError}
          defaultSymbol=""
          authenticated={authenticated}
          onAdd={addJournalEntry}
          onDelete={deleteJournalEntry}
          onUpdate={updateJournalEntry}
        />
      </div>
    </div>
  );
}
