import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import AlertBanner from "@/components/AlertBanner";
import { formatPhp } from "@/lib/format";
import { useHomeLogic } from "./useHomeLogic";
import NewRecordModal from "./NewRecordModal";
import HomeMacroWatch from "./HomeMacroWatch";
import NewsSection from "./NewsSection";
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
  } = useHomeLogic();

  const [movePctBySymbol, setMovePctBySymbol] = useState<Record<string, number>>({});

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
          {canUpdatePrice && (
            <button
              type="button"
              onClick={triggerCronManually}
              disabled={cronTriggering}
              className="inline-flex items-center justify-center gap-1 rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50 transition-colors shadow-sm"
              title="Manually trigger cron job execution"
            >
              <span>{cronTriggering ? "⏳ Running..." : "⚡ Run Cron"}</span>
            </button>
          )}
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
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              href="/long-scan"
              className="text-xs font-bold text-indigo-700 hover:underline"
            >
              📡 LONG scan →
            </Link>
            <span className="text-xs text-gray-400">
              Targets near/hit · agent review-by dates
            </span>
          </div>
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {monitorCards.map((card) => {
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

              return (
                <div
                  key={card.symbol}
                  className={`rounded-lg border p-3 transition-all ${border}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-gray-900 truncate">
                        {card.name}{" "}
                        <span className="font-mono text-[10px] font-semibold text-gray-500">
                          {card.symbol}
                        </span>
                      </div>
                      {card.currentPrice != null && (
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-bold tabular-nums text-gray-900">
                            {formatPhp(card.currentPrice)}
                          </span>
                          {(() => {
                            // Same rules as Filter Coins pills: prefer % (color only, no ▲/▼);
                            // if no %, fall back to direction arrow.
                            const pct =
                              movePctBySymbol[card.symbol.toUpperCase()] ??
                              movePctBySymbol[card.symbol.replace(/PHP$/i, "").toUpperCase()];
                            if (pct != null && Number.isFinite(pct)) {
                              const up = pct > 0;
                              const down = pct < 0;
                              return (
                                <span
                                  className={`text-xs font-bold tabular-nums ${
                                    up ? "text-green-600" : down ? "text-red-600" : "text-gray-500"
                                  }`}
                                >
                                  {up ? "+" : ""}
                                  {pct.toFixed(1)}%
                                </span>
                              );
                            }
                            const coin = coins.find(
                              (c) => c.symbol.toUpperCase() === card.symbol.toUpperCase()
                            );
                            return (
                              <PriceDirectionArrow
                                direction={coin?.priceDirection ?? null}
                              />
                            );
                          })()}
                        </div>
                      )}
                    </div>
                    <Link
                      href={`/chart?symbol=${encodeURIComponent(card.symbol)}`}
                      className="shrink-0 text-[11px] font-bold text-brand-600 hover:underline"
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
                            ? "bg-rose-100 border-rose-200"
                            : card.review.urgency === "today"
                              ? "bg-amber-100 border-amber-200"
                              : "bg-indigo-50 border-indigo-100"
                        }`}
                      >
                        <span className="font-semibold text-indigo-950">
                          Review by {card.review.reviewUntil}
                        </span>
                        <span className="font-bold text-indigo-900">{reviewLabel}</span>
                      </div>
                    )}
                    {!card.high && !card.low && !card.review && (
                      <span className="text-gray-400">No flags</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Mobile chip filter */}
      {!loading && allCoins.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm font-medium text-gray-700">
              Filter Coins {selectedCoins.length > 0 ? `(${selectedCoins.length} selected)` : ""}
            </span>

            {selectedCoins.length > 0 && (
              <button
                onClick={() => setSelectedCoins([])}
                className="text-xs font-medium text-gray-500 hover:text-gray-900 underline"
              >
                Clear All
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {allCoins.map((coin) => {
              const isSelected = selectedCoins.includes(coin.symbol);

              const activePortfolio = portfolio?.find((p) => p.symbol === coin.symbol);
              const hasHoldings = activePortfolio && activePortfolio.holdings > 0;

              let chipClasses = "";
              if (isSelected) {
                chipClasses = "bg-brand-600 border-brand-600 text-white";
              } else if (hasHoldings) {
                chipClasses = "bg-indigo-50 border-indigo-300 text-indigo-800 hover:bg-indigo-100 shadow-sm font-bold";
              } else {
                chipClasses = "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 shadow-sm";
              }

              return (
                <button
                  key={coin.symbol}
                  onClick={() => {
                    if (isSelected) {
                      setSelectedCoins(selectedCoins.filter((c) => c !== coin.symbol));
                    } else {
                      setSelectedCoins([...selectedCoins, coin.symbol]);

                      setTimeout(() => {
                        document.getElementById(`coin-card-${coin.symbol}`)?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        });
                      }, 150);
                    }
                  }}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors border ${chipClasses}`}
                >
                  {hasHoldings && !isSelected && <span className="text-indigo-500">●</span>}

                  <span>{coin.symbol}</span>
                  <span className={isSelected ? "text-brand-300" : hasHoldings ? "text-indigo-300" : "text-gray-300"}>|</span>
                  <span>{formatPhp(coin.currentPrice)}</span>
                  {(() => {
                    const pct =
                      movePctBySymbol[coin.symbol.toUpperCase()] ??
                      movePctBySymbol[coin.symbol.replace(/PHP$/i, "").toUpperCase()];
                    if (pct == null || !Number.isFinite(pct)) {
                      // Fallback: direction only when no recent signal %
                      return (
                        <PriceDirectionArrow direction={coin.priceDirection} inverse={isSelected} />
                      );
                    }
                    const up = pct > 0;
                    const down = pct < 0;
                    const color = isSelected
                      ? up
                        ? "text-green-200"
                        : down
                        ? "text-red-200"
                        : "text-brand-200"
                      : up
                      ? "text-green-600"
                      : down
                      ? "text-red-600"
                      : "text-gray-500";
                    return (
                      <span className={`font-bold tabular-nums ${color}`}>
                        {up ? "+" : ""}
                        {pct.toFixed(1)}%
                      </span>
                    );
                  })()}
                </button>
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
            Use the card action buttons to view calendar schedules, interactive charts, or manually log coin prices.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {coins.map((coin) => (
              <CoinCard key={coin.id} coin={coin} canUpdatePrice={canUpdatePrice} onUpdatePriceClick={openPriceUpdateModal} />
            ))}
          </div>
        </>
      )}

      <p className="mt-2 text-xs text-gray-500">Target prices are set from the Manage Coins page.</p>

      <HomeMacroWatch />

      <NewsSection />
    </div>
  );
}