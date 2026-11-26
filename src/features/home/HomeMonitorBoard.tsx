import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatPhp } from "@/lib/format";
import type { HomeMonitorSnapshot, MonitorHitBase } from "@/lib/homeMonitorScan";
import { compareByTier, getCoinTier } from "@/lib/coinPriorityTiers";

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

/** Combined research prompt: near support + RSI oversold + Watch/plan not held. */
function buildEntryMonitorPrompt(
  near: MonitorHitBase[],
  rsi: MonitorHitBase[],
  watchPlan: CoinPx[]
): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const lines: string[] = [];
  lines.push(
    `You are a neutral crypto research assistant (Philippines PHP spot context — research only).`
  );
  lines.push(`Analysis date (Manila): **${today}**.`);
  lines.push(``);
  lines.push(`## Task`);
  lines.push(
    `Gather **verified news, events, unlocks, listings/delistings, upgrades, and security items** for the coins below.`
  );
  lines.push(
    `Windows: **past ~30 days**, **present / ~72h**, and **next ~30 days**. Security incidents: last ~90 days if still relevant.`
  );
  lines.push(
    `Do **not** recommend buy, sell, hold, add, average down, or size. Do **not** rank for entry. Lists are only which tickers to research.`
  );
  lines.push(``);
  lines.push(
    `## Research priority (app labels — not buy signals): S core · A priority alts · B conditional · C low/pause`
  );
  lines.push(
    `When many names compete, prefer researching **A/S** first if a technical setup exists. Never force a buy.`
  );
  lines.push(``);
  lines.push(`## List A — Near 30-day support · top 8 (app context only)`);
  if (!near.length) lines.push(`(none in list right now)`);
  else {
    const sortedNear = [...near].sort((a, b) =>
      compareByTier(a.symbol, b.symbol, a.name, b.name)
    );
    sortedNear.forEach((h, i) => {
      const base = h.name || h.symbol.replace(/PHP$/i, "");
      const tier = getCoinTier(h.symbol);
      lines.push(
        `${i + 1}. **${base}** (\`${h.symbol}\`) · tier ${tier} — ${h.detail || "near support"}`
      );
    });
  }
  lines.push(``);
  lines.push(`## List B — Watch / plan · not held`);
  const plan = watchPlan
    .filter((c) => c && String(c.symbol || "").trim())
    .sort((a, b) =>
      compareByTier(String(a.symbol), String(b.symbol), a.name, b.name)
    );
  if (!plan.length) {
    lines.push(
      `(none on watch/plan right now — flag Monitor=yes on Manage for coins you plan to buy)`
    );
  } else {
    plan.forEach((c, i) => {
      const sym = String(c.symbol).toUpperCase();
      const base = (c.name && String(c.name).trim()) || sym.replace(/PHP$/i, "");
      const tier = getCoinTier(sym);
      const px =
        c.currentPrice != null && Number(c.currentPrice) > 0
          ? ` · ~${Number(c.currentPrice)}`
          : "";
      lines.push(`${i + 1}. **${base}** (\`${sym}\`) · tier ${tier}${px}`);
    });
  }
  lines.push(``);
  lines.push(`## List C — RSI oversold (app context only)`);
  if (!rsi.length) lines.push(`(none loaded)`);
  else {
    const sortedRsi = [...rsi].sort((a, b) =>
      compareByTier(a.symbol, b.symbol, a.name, b.name)
    );
    sortedRsi.forEach((r, i) => {
      const sym = (r.symbol || "").toUpperCase();
      const base = r.name || sym.replace(/PHP$/i, "");
      const tier = getCoinTier(sym);
      lines.push(
        `${i + 1}. **${base}** (\`${sym}\`) · tier ${tier} — ${r.detail || "RSI oversold"}`
      );
    });
  }
  lines.push(``);
  lines.push(`## Rules`);
  lines.push(`- Neutral research only — no trading verdicts.`);
  lines.push(`- Verified sources only; no training-memory headlines; no invented dates.`);
  lines.push(`- Search by **project name / base ticker** (e.g. XLM not XLMPHP).`);
  lines.push(`- Nothing found after search for a category → **none verified** (do not stay silent).`);
  lines.push(``);
  lines.push(`## Output (required)`);
  lines.push(`1. Short bullets or table: Coin | Past 30d | Present | Next 30d | Security`);
  lines.push(`2. **Watch date lines — critical.** For **every** dated catalyst, emit exactly:`);
  lines.push(
    `   \`- **Watch date:** YYYY-MM-DD · unlock|delisting|event|integration|listing|hardfork · short detail\``
  );
  lines.push(
    `   Example: \`- **Watch date:** 2026-11-19 · event · SKY governance executive vote (Nov 9 proposal)\``
  );
  lines.push(
    `   Our app saves these into **Coin watch dates**. Missing this format means the calendar will not update.`
  );
  lines.push(`3. Omit a coin's Watch date lines only when no dated item was verified.`);
  lines.push(`4. End with a fenced markdown block the trader can paste to journal:`);
  lines.push(``);
  lines.push("```markdown");
  lines.push(`## Entry monitor research · ${today} (Manila)`);
  lines.push(`- **Agent:** Spot Trading Desk AI (name model)`);
  lines.push(`- **Prompt:** Home · Entry monitor · news/events only`);
  lines.push(`- **Coins covered:** …`);
  lines.push(`- **Watch date:** YYYY-MM-DD · event · short detail`);
  lines.push(`- **Notes:** …`);
  lines.push("```");
  return lines.join("\n");
}

/**
 * Near support + RSI oversold from ONE saved bulk scan.
 * Home load = GET snapshot only. POST only when user clicks Run.
 * Entry monitor prompt = Lists A/B/C (support + watch/plan + RSI) ±30d research.
 */
export default function HomeMonitorBoard({
  universe,
  watchPlanCoins = [],
}: {
  universe: CoinPx[];
  /** Watch / plan · not held — included in Entry monitor prompt */
  watchPlanCoins?: CoinPx[];
}) {
  const [snap, setSnap] = useState<HomeMonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);

  const trackedUniverse = universe.filter(
    (c) => (c as { trackingEnabled?: boolean }).trackingEnabled !== false
  );

  const priceBySym = new Map<string, number | null>();
  for (const c of trackedUniverse) {
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
            Near 30d support · RSI oversold — one bulk scan, saved for reference.{" "}
            <span className="font-semibold">Entry monitor prompt</span> covers support + Watch/plan (
            {watchPlanCoins.length}) + RSI (past/present/next ~30d news). Home does not re-scan every
            visit. Compare <span className="font-semibold">price at scan</span> vs live price below.
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
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={
              !(snap?.nearSupport?.length || snap?.rsiOversold?.length || watchPlanCoins.length)
            }
            onClick={async () => {
              const text = buildEntryMonitorPrompt(
                snap?.nearSupport || [],
                snap?.rsiOversold || [],
                watchPlanCoins
              );
              try {
                await navigator.clipboard.writeText(text);
                setPromptCopied(true);
                window.setTimeout(() => setPromptCopied(false), 2000);
              } catch {
                /* ignore */
              }
            }}
            className="rounded-md border border-rose-400 bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
            title="Past 30d + next 30d research for Near support, Watch/plan, RSI oversold"
          >
            {promptCopied ? "✅ Copied" : "📋 Entry monitor prompt"}
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => void run()}
            className="rounded-md border border-indigo-300 bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {running ? "Scanning…" : "↻ Run monitor scan"}
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-rose-600">{error}</p>}
      {loading && <p className="text-xs text-slate-500">Loading last snapshot…</p>}

      {!loading && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Section
            title="Near 30-day support · top 8"
            subtitle="Discount zone vs 30d range at last scan"
            hits={snap?.nearSupport || []}
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
