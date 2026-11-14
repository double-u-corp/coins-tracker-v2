import Link from "next/link";
import {
  updateHoldMae,
  getHoldMae,
  formatMaeBadge,
  levelWasTouched,
  hydrateHoldMaeFromDb,
  type HoldMae,
} from "@/lib/holdMae";
import dynamic from "next/dynamic";
import HomeCoinWatchDates from "./HomeCoinWatchDates";
import { useState, useEffect, useMemo, type ReactNode } from "react";
import AlertBanner from "@/components/AlertBanner";
import { formatPhp } from "@/lib/format";
import { buildCoinNewsResearchPrompt } from "@/lib/coinNewsResearchPrompt";
import { buildCoinAnalytics, type CoinAnalytics } from "@/features/trade/useTradeLogic";

const ManageCoinsView = dynamic(() => import("@/features/manage/ManageCoinsView"), {
  ssr: false,
  loading: () => (
    <p className="py-6 text-center text-sm text-gray-500">Loading manage…</p>
  ),
});


import { useHomeLogic } from "./useHomeLogic";
import NewRecordModal from "./NewRecordModal";
import HomeMacroWatch from "./HomeMacroWatch";
import HomeRsiOversold from "./HomeRsiOversold";
import HomeWatchPlanCharts from "./HomeWatchPlanCharts";
import HomeNearSupportCharts from "./HomeNearSupportCharts";
import HomeExtendedAboveSma from "./HomeExtendedAboveSma";
import JournalSidebar from "@/features/chart/JournalSidebar";
import PriceUpdateModal from "./PriceUpdateModal";
import type { CoinSummary } from "@/validators/recordSchema";


type LadderLevel = { label: string; price: number; pct: number };

/** Research-only for open bags — no size/holdings, no add advice. Coin watch date format. */
function buildOnHoldNewsPrompt(
  coins: { symbol: string; name: string }[]
): string {
  return buildCoinNewsResearchPrompt({
    coins,
    mode: "holding",
    promptLabel: "Home · On hold · news/events (forward only)",
  });
}



/**
 * Upside tiers vs avg cost:
 *  L1: +3/+6/+10/+15  ·  L2: +15/+20/+25/+30  ·  L3: +30/+40/+50/+60 (trim zone)
 * Downside: stress path vs avg (−3/−6/−10/−15, deeper if already underwater).
 */
function buildProfitTargets(avg: number, price: number): {
  upside: LadderLevel[];
  downside: LadderLevel[];
  tier: 1 | 2 | 3;
  tierLabel: string;
  mode: "upside" | "downside";
} {
  if (!(avg > 0)) {
    return { upside: [], downside: [], tier: 1, tierLabel: "L1 · recovery", mode: "upside" as const };
  }
  const gain = price > 0 ? (price - avg) / avg : 0;

  const T1 = [0.03, 0.06, 0.1, 0.15];
  const T2 = [0.15, 0.2, 0.25, 0.3];
  const T3 = [0.3, 0.4, 0.5, 0.6];

  let tier: 1 | 2 | 3 = 1;
  let tierLabel = "L1 · +3→15%";
  let steps = T1;
  if (gain >= 0.3 - 1e-9) {
    tier = 3;
    tierLabel = "L3 · +30→60% (trim zone)";
    steps = T3;
  } else if (gain >= 0.15 - 1e-9) {
    tier = 2;
    tierLabel = "L2 · +15→30%";
    steps = T2;
  }

  const fmtPct = (pct: number) => {
    const p = pct * 100;
    const s =
      Math.abs(p - Math.round(p)) < 1e-6 ? String(Math.round(p)) : p.toFixed(1);
    return pct >= 0 ? `+${s}%` : `${s}%`;
  };

  const upside: LadderLevel[] = steps.map((pct) => ({
    label: fmtPct(pct),
    price: avg * (1 + pct),
    pct,
  }));

  // Downside mirrors upside tiers (fixed steps — not relative to current deep loss)
  // L1: −3/−6/−10/−15 · L2: −15/−20/−25/−30 · L3: −30/−40/−50/−60
  const D1 = [-0.03, -0.06, -0.1, -0.15];
  const D2 = [-0.15, -0.2, -0.25, -0.3];
  const D3 = [-0.3, -0.4, -0.5, -0.6];
  const loss = -gain; // positive when underwater

  let downTier: 1 | 2 | 3 = 1;
  let downTierLabel = "L1 · −3→15%";
  let downSteps = D1;
  if (loss >= 0.3 - 1e-9) {
    downTier = 3;
    downTierLabel = "L3 · −30→60%";
    downSteps = D3;
  } else if (loss >= 0.15 - 1e-9) {
    downTier = 2;
    downTierLabel = "L2 · −15→30%";
    downSteps = D2;
  }

  const downside: LadderLevel[] = downSteps.map((pct) => ({
    label: fmtPct(pct),
    price: avg * (1 + pct),
    pct,
  }));

  // Only one side: profit → upside; underwater → downside only
  if (gain >= 0) {
    return { upside, downside: [], tier, tierLabel, mode: "upside" as const };
  }
  return {
    upside: [],
    downside,
    tier: downTier,
    tierLabel: downTierLabel,
    mode: "downside" as const,
  };
}


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



/** Compact barometer for Watch/plan (and any MonitorCard): where price sits vs avg or journal levels. */
type MiniBarStep = {
  key: string;
  label: string;
  price: number;
  state: "here" | "recovered" | "passed" | "touched" | "ahead" | "neutral";
};

function MiniBarometer({
  symbol,
  price,
  avg,
  entry,
  exit,
  lowTarget,
  highTarget,
  tone,
}: {
  symbol: string;
  price: number | null;
  avg?: number | null;
  entry?: number | null;
  exit?: number | null;
  lowTarget?: number | null;
  highTarget?: number | null;
  /** outer strip only: green if free bag up, red if down */
  tone?: "up" | "down" | null;
}) {
  if (price == null || !(price > 0)) return null;

  const mae =
    avg != null && avg > 0
      ? updateHoldMae(symbol, avg, price)
      : getHoldMae(symbol);
  const steps: MiniBarStep[] = [];

  if (avg != null && avg > 0) {
    const ladder = buildProfitTargets(avg, price);
    const levels = ladder.mode === "downside" ? ladder.downside : ladder.upside;
    const isDown = ladder.mode === "downside";
    for (const tg of levels) {
      const already = isDown ? price <= tg.price : price >= tg.price;
      const touched = isDown && levelWasTouched(mae, tg.pct);
      const recovered = isDown && touched && price > tg.price;
      const reached = levels.filter((l) =>
        isDown ? price <= l.price : price >= l.price
      );
      const currentPct =
        reached.length > 0 ? reached[reached.length - 1].pct : null;
      const here = currentPct != null && tg.pct === currentPct;
      let state: MiniBarStep["state"] = "neutral";
      if (here) state = "here";
      else if (recovered) state = "recovered";
      else if (already) state = isDown ? "passed" : "ahead";
      else if (touched) state = "touched";
      else state = "neutral";
      steps.push({
        key: `a-${tg.label}`,
        label: tg.label,
        price: tg.price,
        state,
      });
    }
  } else {
    // Journal / target levels only (not held)
    const refs: { key: string; label: string; price: number }[] = [];
    if (entry != null && entry > 0)
      refs.push({ key: "entry", label: "Entry", price: entry });
    if (lowTarget != null && lowTarget > 0 && (entry == null || Math.abs(lowTarget - entry) / entry > 0.01))
      refs.push({ key: "low", label: "Low", price: lowTarget });
    if (exit != null && exit > 0)
      refs.push({ key: "exit", label: "Exit", price: exit });
    if (highTarget != null && highTarget > 0 && (exit == null || Math.abs(highTarget - exit) / exit > 0.01))
      refs.push({ key: "high", label: "High", price: highTarget });
    refs.sort((a, b) => a.price - b.price);
    if (refs.length === 0) {
      if (mae && mae.worstPct < -0.005) {
        const floorPx = mae.worstPrice;
        const need =
          floorPx > 0 ? ((price - floorPx) / floorPx) * 100 : null;
        return (
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-1.5">
            <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">
              Barometer
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-800">
                {formatMaeBadge(mae)}
              </span>
              {need != null && (
                <span className="text-slate-600">
                  Now {need >= 0 ? "+" : ""}
                  {need.toFixed(1)}% vs floor
                </span>
              )}
            </div>
          </div>
        );
      }
      return null;
    }
    // Find nearest level for "here"
    let nearest = refs[0];
    let nearestDist = Math.abs(price - nearest.price) / nearest.price;
    for (const r of refs) {
      const d = Math.abs(price - r.price) / r.price;
      if (d < nearestDist) {
        nearestDist = d;
        nearest = r;
      }
    }
    for (const r of refs) {
      const pctAway = ((price - r.price) / r.price) * 100;
      let state: MiniBarStep["state"] = "neutral";
      if (r.key === nearest.key && nearestDist <= 0.03) state = "here";
      else if (price >= r.price) state = "ahead";
      else state = "neutral";
      // Recovered past entry: price above entry after floor below entry
      if (
        (r.key === "entry" || r.key === "low") &&
        mae &&
        mae.worstPrice < r.price &&
        price > r.price
      ) {
        state = "recovered";
      }
      steps.push({
        key: r.key,
        label: `${r.label}${
          state === "here"
            ? ""
            : state === "recovered"
              ? ""
              : ` ${pctAway >= 0 ? "+" : ""}${pctAway.toFixed(0)}%`
        }`,
        price: r.price,
        state,
      });
    }
  }

  if (steps.length === 0) return null;

  const stateClass = (s: MiniBarStep["state"]) => {
    switch (s) {
      case "here":
        return "border-rose-500 bg-rose-50 ring-1 ring-rose-300";
      case "recovered":
        return "border-slate-200 bg-sky-50";
      case "passed":
        return "border-rose-300 bg-rose-50/80";
      case "touched":
        return "border-violet-300 bg-violet-50";
      case "ahead":
        return "border-emerald-400 bg-emerald-50";
      default:
        return "border-slate-200 bg-white";
    }
  };
  const stateLabel = (s: MiniBarStep["state"]) => {
    switch (s) {
      case "here":
        return "You are here";
      case "recovered":
        return "↑ Held · recovered";
      case "passed":
        return "Passed";
      case "touched":
        return "Touched";
      case "ahead":
        return "Above";
      default:
        return "Watch";
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 px-2 py-1.5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
        <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">
          Barometer
        </span>
        {formatMaeBadge(mae) && (
          <span className="rounded bg-rose-100 px-1 py-0.5 text-[9px] font-bold text-rose-800">
            {formatMaeBadge(mae)}
          </span>
        )}
      </div>
      <div
        className={`grid gap-1 ${
          steps.length <= 2
            ? "grid-cols-2"
            : steps.length === 3
              ? "grid-cols-3"
              : "grid-cols-2 sm:grid-cols-4"
        }`}
      >
        {steps.map((s) => (
          <div
            key={s.key}
            className={`rounded-md border px-1.5 py-1 text-center ${stateClass(s.state)}`}
          >
            <div className="text-[9px] font-bold text-slate-700">{s.label}</div>
            <div className="font-mono text-[10px] font-bold tabular-nums text-slate-900">
              {formatPhp(s.price)}
            </div>
            <div
              className={`mt-0.5 text-[9px] font-extrabold ${
                s.state === "recovered"
                  ? "rounded bg-sky-600 px-1 text-white"
                  : s.state === "here"
                    ? "rounded bg-rose-600 px-1 text-white"
                    : s.state === "ahead"
                      ? "text-emerald-700"
                      : "text-slate-500"
              }`}
            >
              {stateLabel(s.state)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function MonitorCard({
  card,
  portfolio,
  daysHeld,
  isRealized,
  onManage,
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
    journalReviews?: {
      entryId: number;
      date: string;
      daysUntil: number;
      urgency: string;
      title: string | null;
      agent?: string | null;
      targetEntry?: number | null;
      targetExit?: number | null;
    }[];
    journalTargetEntry?: number | null;
    journalTargetExit?: number | null;
    journalAgent?: string | null;
  };
  portfolio: { symbol?: string; holdings?: number; spent?: number }[] | null | undefined;
  daysHeld?: number | null;
  isRealized?: boolean;
  onManage?: (symbol: string, name: string) => void;
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
          {daysHeld != null && daysHeld >= 0 && holdings > 0 ? (
            <div className="mt-0.5 text-[11px] font-semibold text-slate-600">
              Held {daysHeld} day{daysHeld === 1 ? "" : "s"}
            </div>
          ) : null}
          {isRealized && !(holdings > 0) ? (
            <div className="mt-0.5 inline-flex rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
              Rebuy · prior cycle realized
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {onManage && (
            <button
              type="button"
              onClick={() => onManage(card.symbol, card.name)}
              className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100"
              title="Update high / low targets"
            >
              ⚙️ Manage
            </button>
          )}
          <Link
            href={`/chart?symbol=${encodeURIComponent(card.symbol)}`}
            className="text-sm font-bold text-brand-600 hover:underline"
          >
            Spot →
          </Link>
        </div>
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
              <span className="ml-1 text-[10px] font-normal text-violet-600">Manage</span>
            </span>
            <span className="font-mono text-gray-700">{card.review.reviewUntil}</span>
          </div>
        )}
        {(card.journalReviews || []).map((jr) => {
          const jl =
            jr.urgency === "overdue"
              ? `${Math.abs(jr.daysUntil)}d overdue`
              : jr.urgency === "today"
                ? "today"
                : jr.daysUntil === 1
                  ? "tomorrow"
                  : `In ${jr.daysUntil}d`;
          return (
            <div
              key={`${jr.entryId}-${jr.date}`}
              className={`flex flex-col gap-0.5 rounded-md border px-2 py-1 ${
                jr.urgency === "overdue"
                  ? "bg-rose-50 border-rose-200"
                  : jr.urgency === "today"
                    ? "bg-amber-50 border-amber-200"
                    : "bg-indigo-50/80 border-indigo-100"
              }`}
            >
              <div className="flex justify-between gap-2">
                <span className="font-semibold text-indigo-900">
                  Review {jl}
                  <span className="ml-1 text-[10px] font-normal text-indigo-600">Journal</span>
                </span>
                <span className="font-mono text-gray-700">{jr.date}</span>
              </div>
              {jr.agent ? (
                <span className="truncate text-[10px] text-indigo-800/90" title={jr.agent}>
                  {jr.agent}
                </span>
              ) : null}
              {(jr.targetEntry != null || jr.targetExit != null) && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-gray-800">
                  {jr.targetEntry != null && (
                    <span>
                      <span className="text-gray-500">Entry </span>
                      {formatPhp(jr.targetEntry)}
                    </span>
                  )}
                  {jr.targetExit != null && (
                    <span>
                      <span className="text-gray-500">Exit </span>
                      {formatPhp(jr.targetExit)}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


export default function HomeTable() {
  const [bookLeanSnippet, setBookLeanSnippet] = useState<string | null>(null);
  const [macroTriviaSnippet, setMacroTriviaSnippet] = useState<string | null>(null);
  const [didYouKnow, setDidYouKnow] = useState<string | null>(null);
  const [nextCronLabel, setNextCronLabel] = useState("Calculating…");

  useEffect(() => {
    void hydrateHoldMaeFromDb();
  }, []);

  useEffect(() => {
    // Manila wall clock (UTC+8, no DST) — same basis as Timing / cron slots
    const manila = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const h = manila.getUTCHours();
    const m = manila.getUTCMinutes();
    const currentTotalMinutes = h * 60 + m;

    const slots = [
      { h: 2, m: 5, label: "02:05 AM Manila" },
      { h: 5, m: 5, label: "05:05 AM Manila" },
      { h: 8, m: 5, label: "08:05 AM Manila (daily reset)" },
      { h: 11, m: 5, label: "11:05 AM Manila" },
      { h: 14, m: 5, label: "02:05 PM Manila" },
      { h: 17, m: 5, label: "05:05 PM Manila (London)" },
      { h: 20, m: 5, label: "08:05 PM Manila (US pre-market)" },
      { h: 23, m: 5, label: "11:05 PM Manila (US peak)" },
    ];

    let nextHour = 2;
    let nextLabel = "02:05 AM Manila (tomorrow)";
    for (const slot of slots) {
      if (currentTotalMinutes < slot.h * 60 + slot.m) {
        nextHour = slot.h;
        nextLabel = slot.label;
        break;
      }
    }
    setNextCronLabel(nextLabel);

    // Timing: fetch 7 / 14 / 28 caches (from Timing "Run analysis") and show every lean line we have.
    let cancelled = false;
    void (async () => {
      type TimingSnap = {
        days?: number;
        slots?: { hour: number; label: string; avgAbsPct: number; intensity: string }[];
        dayFlow?: { label: string; upSharePct: number; avgSignedPct: number }[];
        guidance?: string[];
        fromCache?: boolean;
      };
      const leanParts: string[] = [];
      let tipsPool: string[] = [];
      let slotsForNext: TimingSnap["slots"] | undefined;

      for (const d of [7, 14, 28] as const) {
        try {
          const r = await fetch(`/api/swing-timing?days=${d}&_=${Date.now()}`, {
            cache: "no-store",
          });
          if (!r.ok) continue;
          const json = (await r.json()) as TimingSnap;
          const usedDays =
            json.days && [7, 14, 28].includes(Number(json.days)) ? Number(json.days) : d;
          const flow = json.dayFlow;
          if (flow && flow.length >= 2 && flow[0]?.label && flow[flow.length - 1]?.label) {
            const buyDay = flow[0];
            const sellDay = flow[flow.length - 1];
            leanParts.push(
              `${usedDays}d book: lean buy ${buyDay.label} (${Number(buyDay.upSharePct).toFixed(0)}% up) · lean sell ${sellDay.label} (${Number(sellDay.upSharePct).toFixed(0)}% up)`
            );
          }
          if (json.slots?.length && !slotsForNext) slotsForNext = json.slots;
          const tips = (json.guidance || []).filter(
            (g) => g && !String(g).startsWith("No cached analysis") && String(g).length > 20
          );
          if (tips.length) tipsPool = tipsPool.concat(tips);
        } catch {
          /* try next window */
        }
      }
      if (cancelled) return;
      if (slotsForNext?.length) {
        const match = slotsForNext.find((s) => s.hour === nextHour);
        if (match) {
          const avg =
            match.avgAbsPct != null && Number.isFinite(match.avgAbsPct)
              ? `${Number(match.avgAbsPct).toFixed(3)}% avg`
              : null;
          const heat = match.intensity ? String(match.intensity) : null;
          setNextCronLabel(
            [match.label || nextLabel, avg, heat].filter(Boolean).join(" · ")
          );
        }
      }
      if (leanParts.length) {
        // One window only (7 / 14 / 28), random each Home load
        setBookLeanSnippet(leanParts[Math.floor(Math.random() * leanParts.length)]);
      }
      try {
        const mi = await fetch(`/api/timing-macro-impact?_=${Date.now()}`, {
          cache: "no-store",
        });
        if (mi.ok) {
          const body = (await mi.json()) as { tips?: string[] };
          const macroTips = (body.tips || []).filter(
            (tip) => tip && String(tip).length > 15
          );
          if (macroTips.length) {
            setMacroTriviaSnippet(
              macroTips[Math.floor(Math.random() * macroTips.length)]
            );
          }
        }
      } catch {
        /* optional */
      }
      if (tipsPool.length) {
        setDidYouKnow(tipsPool[Math.floor(Math.random() * tipsPool.length)]);
      }
    })();
    return () => {
      cancelled = true;
    };
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
    daysHeldBySymbol,
    cycleStartBySymbol,
    realizedSymbols,
    openHoldingsBySymbol,
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
    loadSummary,
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

  /** Open bag symbols (trade replay preferred). */
  const heldSyms = useMemo(() => {
    const EPS = 1e-8;
    const set = new Set<string>();
    const open = openHoldingsBySymbol || {};
    for (const [sym, u] of Object.entries(open)) {
      if ((u ?? 0) > EPS) set.add(sym.toUpperCase());
    }
    if (Object.keys(open).length === 0) {
      for (const p of portfolio || []) {
        const sym = (p.symbol || "").toUpperCase();
        if (sym && (p.holdings ?? 0) > EPS) set.add(sym);
      }
    }
    return set;
  }, [openHoldingsBySymbol, portfolio]);

  // Plan chart: onMonitor (or review targets) and NOT currently held
  const planMonitorCards = useMemo(() => {
    return (monitorCards || []).filter((card) => !heldSyms.has(card.symbol.toUpperCase()));
  }, [monitorCards, heldSyms]);

  /**
   * Held charts must use ALL open bags (not only onMonitor).
   * Before, only monitorCards appeared — so on phone you often only saw
   * "Watch / plan · not held" while BCH/ADA/etc. were missing from held/free.
   */
  const { heldCostCards, heldFreeCards } = useMemo(() => {
    type Mini = { symbol: string; name: string; currentPrice: number | null };
    const cost: Mini[] = [];
    const free: Mini[] = [];
    const seen = new Set<string>();

    for (const sym of heldSyms) {
      if (seen.has(sym)) continue;
      seen.add(sym);
      const coin =
        allCoins.find((c) => c.symbol.toUpperCase() === sym) ||
        coins.find((c) => c.symbol.toUpperCase() === sym);
      const pos = portfolio?.find((p) => p.symbol?.toUpperCase() === sym);
      const holdings = pos?.holdings ?? openHoldingsBySymbol?.[sym] ?? 0;
      const spent = pos?.spent ?? 0;
      const row: Mini = {
        symbol: sym,
        name: coin?.name || sym.replace(/PHP$/i, ""),
        currentPrice: coin?.currentPrice ?? null,
      };
      // House money: coins left but net spent already recovered
      if (holdings > 0 && spent <= 0) free.push(row);
      else cost.push(row);
    }
    const unrealizedPct = (sym: string) => {
      const pos = portfolio?.find((p) => p.symbol?.toUpperCase() === sym);
      const coin =
        allCoins.find((c) => c.symbol.toUpperCase() === sym) ||
        coins.find((c) => c.symbol.toUpperCase() === sym);
      const holdings = pos?.holdings ?? openHoldingsBySymbol?.[sym] ?? 0;
      const spent = pos?.spent ?? 0;
      const price = Number(coin?.currentPrice ?? pos?.currentPrice ?? 0) || 0;
      if (!(holdings > 0) || !(spent > 0) || !(price > 0)) return 0;
      const avg = spent / holdings;
      if (!(avg > 0)) return 0;
      return ((price - avg) / avg) * 100;
    };
    cost.sort((a, b) => unrealizedPct(a.symbol) - unrealizedPct(b.symbol)); // negative first
    return { heldCostCards: cost, heldFreeCards: free };
  }, [heldSyms, allCoins, coins, portfolio, openHoldingsBySymbol]);

  const [movePctBySymbol, setMovePctBySymbol] = useState<Record<string, number>>({});
  const [homeAnalyticsBySym, setHomeAnalyticsBySym] = useState<Record<string, CoinAnalytics>>({});

  const [directionCopied, setDirectionCopied] = useState(false);
  const [onHoldPromptCopied, setOnHoldPromptCopied] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageSymbol, setManageSymbol] = useState<string | null>(null);
  const [manageName, setManageName] = useState<string | null>(null);


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

  // Price % from coin summary (cron polls) — no /api/news fetch
  useEffect(() => {
    const map: Record<string, number> = {};
    for (const c of allCoins || []) {
      const sym = (c.symbol || "").toUpperCase();
      if (!sym) continue;
      const pct = c.priceChangePct;
      if (pct != null && Number.isFinite(Number(pct))) {
        map[sym] = Number(pct);
        map[sym.replace(/PHP$/i, "")] = Number(pct);
      }
    }
    setMovePctBySymbol(map);
  }, [allCoins, lastCronRun]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/transactions", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const rows = buildCoinAnalytics(data.portfolio || [], data.transactions || []);
        const map: Record<string, CoinAnalytics> = {};
        for (const r of rows) map[r.symbol.toUpperCase()] = r;
        setHomeAnalyticsBySym(map);
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

      {manageOpen && manageSymbol && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Manage coin"
          onClick={() => {
            setManageOpen(false);
            setManageSymbol(null);
            setManageName(null);
            void loadSummary?.();
          }}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl sm:rounded-xl border border-gray-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 shrink-0">
              <h2 className="text-base font-bold text-gray-900">
                ⚙️ Manage · {manageName || manageSymbol}{" "}
                <span className="font-mono text-sm text-indigo-700">{manageSymbol}</span>
              </h2>
              <button
                type="button"
                onClick={() => {
                  setManageOpen(false);
                  setManageSymbol(null);
                  setManageName(null);
                  void loadSummary?.();
                }}
                className="rounded-md border border-gray-200 px-2.5 py-1 text-sm font-bold text-gray-600 hover:bg-gray-50"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto px-3 py-3 sm:px-4">
              <ManageCoinsView modalMode focusSymbol={manageSymbol} />
            </div>
          </div>
        </div>
      )}
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

      {error ? (
        <AlertBanner variant="error" message={`Failed to load data: ${error}`} />
      ) : (
        <div className="mb-3 space-y-2">
          <AlertBanner
            variant={bannerVariant(lastCronStatus)}
            message={`Last cron run: ${formatDateTime(lastCronRun)} · Next: ${nextCronLabel}`}
          />
          {bookLeanSnippet && (
            <AlertBanner variant="info" message={bookLeanSnippet} />
          )}
          {macroTriviaSnippet && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-[12px] text-amber-950">
              <p className="leading-snug">
                <span className="font-bold text-amber-900">Macro trivia · </span>
                {macroTriviaSnippet}
              </p>
              <p className="mt-1 text-[10px] text-amber-800/80">
                From Timing · last CPI/NFP/FOMC impact · alts only ·{" "}
                <a href="/timing" className="font-bold underline">
                  Timing →
                </a>
              </p>
            </div>
          )}
          {didYouKnow && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 text-sm text-violet-950">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="font-bold text-violet-800">Did you know · </span>
                  <span className="text-violet-900/90">{didYouKnow}</span>
                </div>
                <Link
                  href="/timing"
                  className="shrink-0 rounded-md border border-violet-300 bg-white px-2.5 py-1 text-[11px] font-bold text-violet-900 hover:bg-violet-100"
                >
                  Timing →
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

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

      {/* Line charts: always show 1–3 shells (empty state if no coins) */}
      {!loading && (
        <div className="mb-6 space-y-4">
          <section className="scroll-mt-20 rounded-xl border-2 border-indigo-200 bg-indigo-50/40 p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-base font-extrabold text-indigo-950">1 · On hold · with cost</h2>
                <p className="mt-0.5 text-[11px] text-indigo-900/80">
                  Open bags with remaining cost basis — unrealized vs average, days held, and either upside
                  tiers (if in profit) or downside levels (if underwater) — never both. Confirm on Spot.
                </p>
              </div>
              <button
                type="button"
                disabled={heldCostCards.length === 0}
                onClick={async () => {
                  const text = buildOnHoldNewsPrompt(heldCostCards);
                  try {
                    await navigator.clipboard.writeText(text);
                    setOnHoldPromptCopied(true);
                    window.setTimeout(() => setOnHoldPromptCopied(false), 2000);
                  } catch {
                    /* ignore */
                  }
                }}
                className="shrink-0 rounded-md border border-indigo-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-indigo-900 hover:bg-indigo-100 disabled:opacity-50"
                title="Copy agent prompt: current + next 30d news only (no add advice)"
              >
                {onHoldPromptCopied ? "✅ Copied" : "📋 On-hold news prompt"}
              </button>
            </div>
            {heldCostCards.length === 0 ? (
              <p className="text-[11px] text-indigo-800/70">
                No open bags with remaining cost (or trades still loading).
              </p>
            ) : (
              <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:snap-none sm:pb-0 sm:px-0">
                {heldCostCards.map((card) => {
                  const sym = card.symbol.toUpperCase();
                  const coin =
                    allCoins.find((c) => c.symbol.toUpperCase() === sym) ||
                    coins.find((c) => c.symbol.toUpperCase() === sym);
                  const pos = (portfolio || []).find(
                    (p: { symbol?: string }) => (p.symbol || "").toUpperCase() === sym
                  ) as
                    | {
                        holdings?: number;
                        spent?: number;
                        currentPrice?: number | null;
                      }
                    | undefined;
                  const holdings = Number(pos?.holdings ?? openHoldingsBySymbol?.[sym] ?? 0) || 0;
                  const spent = Number(pos?.spent ?? 0) || 0;
                  const price =
                    Number(pos?.currentPrice ?? coin?.currentPrice ?? card.currentPrice ?? 0) || 0;
                  const avg = holdings > 0 && spent > 0 ? spent / holdings : null;
                  const mtm = holdings > 0 && price > 0 ? holdings * price : null;
                  const pnlPhp = mtm != null && spent > 0 ? mtm - spent : null;
                  const pnlPct =
                    avg != null && avg > 0 && price > 0 ? ((price - avg) / avg) * 100 : null;
                  const daysHeld = daysHeldBySymbol?.[sym] ?? null;
                  const cycleStart = cycleStartBySymbol?.[sym] ?? null;
                  const sinceLabel = cycleStart
                    ? new Date(cycleStart).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : null;
                  const ladder =
                    avg != null && avg > 0
                      ? buildProfitTargets(avg, price)
                      : { upside: [], downside: [], tier: 1 as const, tierLabel: "", mode: "upside" as const };
                  const targets = ladder.upside;
                  const downTargets = ladder.downside;
                  const mae: HoldMae | null =
                    typeof window !== "undefined" && avg != null && avg > 0 && price > 0
                      ? updateHoldMae(sym, avg, price)
                      : null;
                  const maeBadge = formatMaeBadge(mae);
                  return (
                    <div
                      key={sym}
                      className="snap-center shrink-0 w-[min(92vw,22rem)] sm:w-auto sm:shrink rounded-xl border border-indigo-200 bg-white p-3 shadow-sm"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-extrabold text-slate-900">
                            {card.name}{" "}
                            <span className="font-mono text-[11px] font-semibold text-indigo-700">
                              {sym}
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-600">
                            Now{" "}
                            <span className="font-semibold tabular-nums text-slate-900">
                              {price > 0 ? formatPhp(price) : "—"}
                            </span>
                            {avg != null && (
                              <>
                                {" "}
                                · Avg{" "}
                                <span className="font-semibold tabular-nums">{formatPhp(avg)}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <Link
                          href={`/chart?symbol=${encodeURIComponent(sym)}`}
                          className="shrink-0 rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-700"
                        >
                          Spot →
                        </Link>
                      </div>

                      <div className="mb-2 rounded-lg border border-slate-100 bg-slate-50/80 px-2.5 py-2">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                          Unrealized vs average
                        </div>
                        <div
                          className={`text-sm font-extrabold tabular-nums ${
                            (pnlPct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {pnlPct != null
                            ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`
                            : "—"}
                          {pnlPhp != null && (
                            <span className="ml-1 text-xs font-bold">
                              ({pnlPhp >= 0 ? "+" : ""}
                              {formatPhp(pnlPhp)})
                            </span>
                          )}
                        </div>
                        {maeBadge && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">
                              {maeBadge}
                            </span>
                            {pnlPct != null &&
                              mae &&
                              pnlPct / 100 > mae.worstPct + 0.01 && (
                                <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                                  {pnlPct >= 0
                                    ? "Recovered · wait paid off"
                                    : "Recovering toward avg"}
                                </span>
                              )}
                          </div>
                        )}
                        {(daysHeld != null || sinceLabel) && (
                          <div className="mt-1 text-[11px] text-slate-600">
                            Days held:{" "}
                            <span className="font-semibold text-slate-900">
                              {daysHeld != null ? `${daysHeld}d` : "—"}
                            </span>
                            {sinceLabel ? ` since ${sinceLabel}` : ""}
                          </div>
                        )}
                      </div>

                      {(targets.length > 0 || downTargets.length > 0) && (
                        <div>
                          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
                            <div
                              className={`text-[10px] font-bold uppercase tracking-wide ${
                                ladder.mode === "downside" ? "text-rose-700" : "text-slate-500"
                              }`}
                            >
                              {ladder.mode === "downside"
                                ? `Downside vs avg · ${ladder.tierLabel}`
                                : `Upside vs avg · ${ladder.tierLabel}`}
                            </div>
                            {ladder.mode === "upside" && ladder.tier === 3 && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                                Near +60% · consider trim
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                            {(ladder.mode === "downside" ? downTargets : targets).map((tg) => {
                              const bagValue = holdings * tg.price;
                              const profitPhp = bagValue - spent;
                              const isDown = ladder.mode === "downside";
                              const levels = isDown ? downTargets : targets;
                              const already = isDown
                                ? price > 0 && price <= tg.price
                                : price >= tg.price;
                              // Current stage = last reached level (deepest for down, highest for up)
                              const reached = levels.filter((l) =>
                                isDown
                                  ? price > 0 && price <= l.price
                                  : price >= l.price
                              );
                              const currentStagePct =
                                reached.length > 0 ? reached[reached.length - 1].pct : null;
                              const isCurrentStage =
                                currentStagePct != null && tg.pct === currentStagePct;
                              const touchedBefore =
                                isDown && levelWasTouched(mae, tg.pct);
                              const recoveredPast =
                                isDown &&
                                touchedBefore &&
                                price > 0 &&
                                price > tg.price;
                              const need =
                                price > 0 ? ((tg.price - price) / price) * 100 : null;
                              return (
                                <div
                                  key={`${isDown ? "dn" : "up"}-${tg.label}`}
                                  className={`rounded-lg border border-slate-200 px-2 py-2 text-center transition ${
                                    isCurrentStage
                                      ? isDown
                                        ? "bg-rose-100"
                                        : "bg-emerald-100"
                                      : recoveredPast
                                        ? "bg-sky-50"
                                        : already
                                          ? isDown
                                            ? "bg-rose-50"
                                            : "bg-emerald-50"
                                          : "bg-white"
                                  }`}
                                >
                                  <div
                                    className={`text-[10px] font-bold ${
                                      already
                                        ? isDown
                                          ? "text-rose-900"
                                          : "text-emerald-800"
                                        : isDown
                                          ? "text-rose-600"
                                          : "text-slate-500"
                                    }`}
                                  >
                                    {isCurrentStage
                                      ? "● "
                                      : recoveredPast
                                        ? "↑ "
                                        : already
                                          ? isDown
                                            ? "▼ "
                                            : "✓ "
                                          : touchedBefore && isDown
                                            ? "◇ "
                                            : ""}
                                    {tg.label}
                                  </div>
                                  <div
                                    className={`font-mono text-xs font-bold ${
                                      already
                                        ? isDown
                                          ? "text-rose-950"
                                          : "text-emerald-950"
                                        : "text-slate-900"
                                    }`}
                                  >
                                    {formatPhp(tg.price)}
                                  </div>
                                  <div
                                    className={`mt-0.5 text-[10px] font-semibold ${
                                      already
                                        ? isDown
                                          ? "text-rose-800"
                                          : "text-emerald-800"
                                        : isDown
                                          ? "text-rose-800"
                                          : "text-indigo-800"
                                    }`}
                                  >
                                    Bag {formatPhp(bagValue)}
                                  </div>
                                  <div
                                    className={`text-[10px] font-semibold ${
                                      profitPhp >= 0 ? "text-emerald-700" : "text-rose-700"
                                    }`}
                                  >
                                    {profitPhp >= 0 ? "+" : ""}
                                    {formatPhp(profitPhp)} P&L
                                  </div>
                                  <div
                                    className={`mt-0.5 text-[10px] font-extrabold ${
                                      isCurrentStage
                                        ? isDown
                                          ? "rounded bg-rose-600 px-1 py-0.5 text-white"
                                          : "rounded bg-emerald-600 px-1 py-0.5 text-white"
                                        : recoveredPast
                                          ? "rounded bg-sky-600 px-1.5 py-0.5 text-white shadow-sm"
                                          : already
                                            ? isDown
                                              ? "rounded bg-rose-500/90 px-1 py-0.5 text-white"
                                              : "rounded bg-emerald-600 px-1 py-0.5 text-white"
                                            : touchedBefore && isDown
                                              ? "rounded bg-violet-600 px-1 py-0.5 text-white"
                                              : isDown
                                                ? "text-rose-600"
                                                : "text-amber-700"
                                    }`}
                                  >
                                    {isCurrentStage
                                      ? "You are here"
                                      : recoveredPast
                                        ? "↑ Held · recovered"
                                        : already
                                          ? isDown
                                            ? touchedBefore
                                              ? "Passed · floor"
                                              : "Passed"
                                            : "Reached"
                                          : touchedBefore && isDown
                                            ? "Touched before"
                                            : need != null
                                              ? `${need >= 0 ? "+" : ""}${need.toFixed(1)}% from now`
                                              : "—"}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}


                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="scroll-mt-20 rounded-xl border-2 border-emerald-200 bg-emerald-50/40 p-4 shadow-sm">
            <div className="mb-3">
              <h2 className="text-base font-extrabold text-emerald-950">2 · Free / recovered</h2>
              <p className="mt-0.5 text-[11px] text-emerald-900/80">
                Open leftovers after cost recovered (house money) — still track mark, avg reference, and
                open P&L. Confirm on Spot.
              </p>
            </div>
            {heldFreeCards.length === 0 ? (
              <p className="text-[11px] text-emerald-800/70">No free / recovered leftovers right now.</p>
            ) : (
              <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:snap-none sm:pb-0 sm:px-0">
                {heldFreeCards.map((card) => {
                  const sym = card.symbol.toUpperCase();
                  const coin =
                    allCoins.find((c) => c.symbol.toUpperCase() === sym) ||
                    coins.find((c) => c.symbol.toUpperCase() === sym);
                  const an = homeAnalyticsBySym[sym];
                  const holdings =
                    an?.holdings ??
                    Number(openHoldingsBySymbol?.[sym] ?? 0) ??
                    0;
                  const price =
                    Number(an?.currentPrice ?? coin?.currentPrice ?? card.currentPrice ?? 0) || 0;
                  const avg = an?.avgCost ?? null;
                  const openPnl = an?.unrealizedPnl ?? null;
                  const openPct = an?.unrealizedPct ?? null;
                  const daysHeld = an?.daysSinceFirstBuy ?? daysHeldBySymbol?.[sym] ?? null;
                  const nowPx = price > 0 ? price : null;
                  return (
                    <div
                      key={sym}
                      className="snap-center shrink-0 w-[min(92vw,22rem)] sm:w-auto sm:shrink rounded-xl border border-emerald-200 bg-white p-3 shadow-sm"
                    >
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-extrabold text-slate-900">
                            {card.name}
                            <span className="ml-1 font-mono text-[11px] font-semibold text-emerald-700">
                              {sym}
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] font-semibold text-emerald-900">
                            {holdings > 0
                              ? `${holdings.toLocaleString(undefined, { maximumFractionDigits: 8 })} coins · Free`
                              : "Free"}
                          </div>
                        </div>
                        <Link
                          href={`/chart?symbol=${encodeURIComponent(sym)}`}
                          className="shrink-0 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-700"
                        >
                          Spot →
                        </Link>
                      </div>

                      <div
                        className={`mb-2 text-sm font-extrabold tabular-nums ${
                          (openPct ?? openPnl ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {openPct != null
                          ? `${openPct >= 0 ? "+" : ""}${openPct.toFixed(2)}%`
                          : "—"}
                        {openPnl != null && (
                          <span className="ml-1 text-xs font-bold">
                            ({openPnl >= 0 ? "+" : ""}
                            {formatPhp(openPnl)})
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-slate-700 sm:grid-cols-3">
                        <div>
                          <span className="text-slate-500">Held</span>{" "}
                          <span className="font-semibold text-slate-900">
                            {daysHeld != null ? `${daysHeld}d` : "—"}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500">Avg</span>{" "}
                          <span className="font-semibold tabular-nums text-slate-900">
                            {avg != null ? formatPhp(avg) : "—"}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500">Open</span>{" "}
                          <span
                            className={`font-semibold tabular-nums ${
                              (openPnl ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"
                            }`}
                          >
                            {openPnl != null
                              ? `${openPnl >= 0 ? "+" : ""}${formatPhp(openPnl)}`
                              : "—"}
                          </span>
                        </div>
                        <div className="col-span-2 sm:col-span-3">
                          <span className="text-slate-500">now</span>{" "}
                          <span className="font-semibold tabular-nums text-slate-900">
                            {nowPx != null ? formatPhp(nowPx) : "—"}
                          </span>
                        </div>
                      </div>

                      <MiniBarometer
                        symbol={sym}
                        price={nowPx}
                        avg={avg != null && avg > 0 ? avg : null}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="scroll-mt-20 rounded-xl border-2 border-sky-200 bg-sky-50/40 p-4 shadow-sm">
            <div className="mb-3">
              <h2 className="text-base font-extrabold text-sky-950">3 · Watch / plan · not held</h2>
              <p className="mt-0.5 text-[11px] text-sky-900/80">
                Monitored coins with no open bag — high/low targets, journal agent entry/exit, and
                review dates. Includes realized / rebuy if still on monitor.
              </p>
            </div>
            {planMonitorCards.length === 0 ? (
              <p className="text-[11px] text-sky-800/70">
                No monitored coins without an open holding. Flag coins on Manage → Monitor.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {planMonitorCards.map((card) => (
                  <MonitorCard
                    key={card.symbol}
                    card={card}
                    portfolio={portfolio}
                    daysHeld={daysHeldBySymbol?.[card.symbol.toUpperCase()] ?? null}
                    isRealized={!!realizedSymbols?.[card.symbol.toUpperCase()]}
                    onManage={(sym, name) => {
                      setManageSymbol(sym);
                      setManageName(name);
                      setManageOpen(true);
                    }}
                  />
                ))}
              </div>
            )}
          </section>
</div>
      )}

      {!loading && allCoins.length > 0 && (
        <div className="mb-6 space-y-4">
          <HomeNearSupportCharts
            universe={allCoins.map((c) => ({ symbol: c.symbol, name: c.name }))}
            watchPlanCoins={planMonitorCards.map((card) => {
              const coin =
                allCoins.find((c) => c.symbol.toUpperCase() === card.symbol.toUpperCase()) ||
                coins.find((c) => c.symbol.toUpperCase() === card.symbol.toUpperCase());
              return {
                symbol: card.symbol,
                name: card.name,
                currentPrice: card.currentPrice ?? coin?.currentPrice ?? null,
              };
            })}
          />
          <HomeExtendedAboveSma
            universe={allCoins.map((c) => ({ symbol: c.symbol, name: c.name }))}
          />
          <HomeRsiOversold
            universe={allCoins.map((c) => ({ symbol: c.symbol, name: c.name }))}
          />
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

      {/* 2a) Coin watch dates from journals */}
      <HomeCoinWatchDates journalEntries={journalEntries} allCoins={allCoins} />

      {/* 2b) Macro watch */}
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
          entries={(journalEntries || []).filter(
            (e) =>
              !e.symbol &&
              !/^LONG-SCAN\b/i.test((e.title || "").trim()) &&
              !(e.title || "").trim().startsWith("[LONG-SCAN]")
          )}
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
