import { readChartCache, writeChartCache } from "./homeChartCache";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatPhp } from "@/lib/format";
import {
  MoverLineChart,
  fetchPollSeries,
  fetchDailyForSma,
  type PollPoint,
  type DailyPt,
} from "./HomeTwoDayMovers";

type RangeHit = {
  symbol: string;
  name: string;
  positionPct: number; // 0–100+ of 30d range (support = 0)
  price: number;
  support: number;
  resistance: number;
  detail: string;
};

type DailyPtFull = DailyPt & { high?: number; low?: number };

/** Agent prompt: rank top near-support coins for spot entry monitoring. */
function buildNearSupportEntryPrompt(
  hits: RangeHit[],
    watchPlan: { symbol: string; name: string; currentPrice?: number | null }[] = [],
  movers2d: { symbol: string; name?: string; netPct?: number; totalAbsPct?: number }[] = [],
): string {
  const lines: string[] = [];
  lines.push(
    `You are a neutral research assistant for a Philippines **spot LONG-only** PHP crypto trader (buy/sell coins only — no shorting, no leverage, no margin).`
  );
  lines.push(``);
  lines.push(`## Task`);
  lines.push(
    `Help the trader **monitor** and rank which coin is **better to stage a spot buy** from Lists A+B+C (not market-chase). One top pick or HOLD CASH. Do not force a bullish bias. Weak/unclear -> WAIT / SKIP and hold cash.`
  );
  lines.push(``);
  lines.push(`## List A — Near 30-day support · top 8 (app ranking)`);
  lines.push(
    `Lowest % of 30-day range first. Technical discount zone only — not an automatic buy.`
  );
  if (hits.length === 0) {
    lines.push(`(none in list right now)`);
  } else {
    hits.forEach((h, i) => {
      const base = h.name || h.symbol.replace(/PHP$/i, "");
      lines.push(
        `${i + 1}. **${base}** (\`${h.symbol}\`) — price ${h.price} · support ~${h.support} · resistance ~${h.resistance} · **${h.positionPct.toFixed(1)}%** of 30d range · ${h.detail}`
      );
    });
  }
  lines.push(``);
  lines.push(`## List B — Watch / plan · not held (monitored, no open bag)`);
  lines.push(
    `Coins on the trader's watchlist that are **not currently held**. Include these in research even if they are not in List A.`
  );
  const hitSyms = new Set(hits.map((h) => h.symbol.toUpperCase()));
  const planOnly = watchPlan.filter((c) => c.symbol && !hitSyms.has(c.symbol.toUpperCase()));
  const planAll = watchPlan.filter((c) => c.symbol);
  if (planAll.length === 0) {
    lines.push(`(none on watch/plan right now)`);
  } else {
    planAll.forEach((c, i) => {
      const sym = c.symbol.toUpperCase();
      const base = c.name || sym.replace(/PHP$/i, "");
      const px =
        c.currentPrice != null && Number.isFinite(Number(c.currentPrice))
          ? String(c.currentPrice)
          : "n/a";
      const alsoNear = hitSyms.has(sym) ? " · also on List A" : "";
      lines.push(`${i + 1}. **${base}** (\`${sym}\`) — price ${px}${alsoNear}`);
    });
  }
  lines.push(``);
  lines.push(`## List C — 2d · biggest movers (path |%| over ~2 days)`);
  lines.push(
    `Most movement recently — may be news-driven. Rank for spot entry only if not extended chase; prefer pullbacks.`
  );
  if (!movers2d.length) {
    lines.push(`(none loaded)`);
  } else {
    movers2d.slice(0, 10).forEach((m, i) => {
      const sym = String(m.symbol).toUpperCase();
      const base = m.name || sym.replace(/PHP$/i, "");
      const net =
        m.netPct != null && Number.isFinite(Number(m.netPct))
          ? `${Number(m.netPct) >= 0 ? "+" : ""}${Number(m.netPct).toFixed(1)}% net`
          : "";
      const abs =
        m.totalAbsPct != null && Number.isFinite(Number(m.totalAbsPct))
          ? `${Number(m.totalAbsPct).toFixed(1)}% path`
          : "";
      lines.push(
        `${i + 1}. **${base}** (\`${sym}\`) — ${[abs, net].filter(Boolean).join(" · ") || "mover"}`
      );
    });
  }
  lines.push(``);
  lines.push(`## Mandatory research (before any ranking)`);
  lines.push(
    `For **each** coin in List A, List B, and List C, search **verified** sources only (no training-memory headlines; do not invent events):`
  );
  lines.push(
    `1. **Past ~30 calendar days** — news, listings/delistings, unlocks, exploits, hacks, governance, partnerships, regulatory hits tied to the **project ticker/name** (not the local PHP pair suffix).`
  );
  lines.push(
    `2. **Next ~30 calendar days** — scheduled unlocks, launches, conferences, token events, known court/regulatory dates if dated and sourced.`
  );
  lines.push(
    `3. **Security** — any exploit / bridge / protocol incident in the last ~90 days for that project.`
  );
  lines.push(
    `If a category has nothing verifiable after search, write **none verified** for that coin/category — never silent omission.`
  );
  lines.push(``);
  lines.push(`## X (Twitter) follows`);
  lines.push(
    `For each coin, suggest **1–3 official or high-signal X accounts** to follow (project official, lead/dev if known, or one reputable research/on-chain desk). Label **official vs community**. Prefer handles you can verify; if unsure, say **none verified** rather than guessing.`
  );
  lines.push(``);
  lines.push(`## Rules`);
  lines.push(`- Neutral. Weak or unclear → **WAIT / SKIP** and hold cash — never recommend shorting.`);
  lines.push(`- Prefer pullbacks / staged limit buys over chasing.`);
  lines.push(`- Near support is **not** an automatic buy; catalysts and risk can override.`);
  lines.push(`- Use project names for search (e.g. SUI not SUIPHP; TRUMP the token not politics noise unless token-linked).`);
  lines.push(``);
  lines.push(`## Answer format`);
  lines.push(
    `1. **Table** (one row per coin from A∪B): Rank | Coin | Source (A / B / both) | Monitor posture (PRIORITY WATCH / WATCH / WAIT / SKIP) | 1-line why | Key verified catalyst or "none verified" | X accounts`
  );
  lines.push(
    `2. **Best relative entry candidates** (max 3) across both lists — only if research supports staging; else say none.`
  );
  lines.push(`3. **Avoid / deprioritize** (if any) with reason.`);
  lines.push(`4. **Recheck by** (Manila date, within ~7 days).`);
  lines.push(``);
  lines.push(`## Final journal note (REQUIRED — pure markdown, copy-paste ready)`);
  lines.push(
    `End with ONLY a fenced markdown block the trader can copy into their journal. Use this shape:`
  );
  lines.push(``);
  lines.push("```markdown");
  lines.push(`## Entry monitor · YYYY-MM-DD (Manila)`);
  lines.push(`- **Agent:** Spot Trading Desk AI (ChatGPT / Grok / Gemini — name model)`);
  lines.push(`- **Prompt:** Home · Near support + Watch/plan entry monitor`);
  lines.push(`- **Priority watch:** …`);
  lines.push(`- **Candidates to stage (max 3):** … or none`);
  lines.push(`- **Avoid:** … or none`);
  lines.push(`- **X accounts to follow:** coin — @handles`);
  lines.push(`- **Recheck by:** YYYY-MM-DD`);
  lines.push(`- **Notes:** …`);
  lines.push("```");
  lines.push(``);
  lines.push(`Keep the prose above the fence practical. No price prediction guarantees.`);
  return lines.join("\n");
}


async function fetchDailyPoints(symbol: string, force = false): Promise<DailyPtFull[]> {
  const cacheKey = `daily:${symbol.toUpperCase()}`;
  if (!force) {
    const cached = readChartCache<DailyPtFull[]>(cacheKey);
    if (cached && cached.length > 0) return cached;
  }
  // years=1 so we always have ≥30 daily bars when the coin has history
  const res = await fetch(
    `/api/coins?type=chart&symbol=${encodeURIComponent(symbol)}&years=1.00&granularity=daily`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const pts = (data.points || []) as DailyPtFull[];
  if (pts.length > 0) writeChartCache(cacheKey, pts);
  return pts;
}

function positionIn30d(points: DailyPtFull[]): Omit<RangeHit, "symbol" | "name"> | null {
  if (!points || points.length < 8) return null;
  const slice = points.slice(-30);
  const chartPts = slice
    .map((p) => {
      const high = Number(p.high);
      const low = Number(p.low);
      const closeRaw = p.close != null ? Number(p.close) : NaN;
      const close = Number.isFinite(closeRaw)
        ? closeRaw
        : Number.isFinite(high) && Number.isFinite(low)
          ? (high + low) / 2
          : Number.isFinite(high)
            ? high
            : NaN;
      const hi = Number.isFinite(high) && high > 0 ? high : close;
      const lo = Number.isFinite(low) && low > 0 ? low : close;
      if (!Number.isFinite(close) || close <= 0) return null;
      return { period: p.period, high: hi, low: lo, close };
    })
    .filter((p): p is { period: string; high: number; low: number; close: number } => p != null);

  if (chartPts.length < 8) return null;

  const last = chartPts[chartPts.length - 1];
  const price = last.close;

  // Structural 30d range: support from prior days only so a new low does not
  // force Support === current price (looked broken on the label). Resistance
  // still uses the full window including today.
  const prior = chartPts.length > 1 ? chartPts.slice(0, -1) : chartPts;
  const support = Math.min(...prior.map((p) => p.low));
  const resistance = Math.max(...chartPts.map((p) => p.high));

  // Need a real range (not a flat line of identical prints)
  if (!(support > 0) || !(resistance > support) || !(price > 0)) return null;
  const range = resistance - support;
  if (range / support < 0.002) return null; // <0.2% range → skip

  const position = (price - support) / range;
  const positionPct = position * 100;
  let detail: string;
  if (position < 0) detail = `Below prior support (${Math.abs(positionPct).toFixed(0)}% under · new low)`;
  else if (position <= 0.25) detail = `Near range support (${positionPct.toFixed(0)}% of 30d range)`;
  else if (position >= 0.75) detail = `Near resistance (${positionPct.toFixed(0)}% of 30d range)`;
  else detail = `Mid-range (${positionPct.toFixed(0)}% of 30d range)`;
  return { positionPct, price, support, resistance, detail };
}

/**
 * Top 8 coins closest to 30-day support (lowest % of range).
 * Same 3h + 20 SMA line chart as other Home blocks.
 */
export default function HomeNearSupportCharts({
  universe,
    watchPlanCoins = []
}: {
  /** Prefer full watchlist symbols from Home (symbol + name). */
  universe: { symbol: string; name?: string }[];
    /** Watch/plan coins not currently held (List B in the agent prompt). */
  watchPlanCoins?: { symbol: string; name: string; currentPrice?: number | null }[];
}) {
  const [hits, setHits] = useState<RangeHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [series, setSeries] = useState<PollPoint[]>([]);
  const [dailyPoints, setDailyPoints] = useState<DailyPt[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [movers2d, setMovers2d] = useState<
    { symbol: string; name?: string; netPct?: number; totalAbsPct?: number }[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let list: any[] = [];
        for (const d of [14, 28, 7]) {
          const res = await fetch(`/api/swing-timing?days=${d}&_=${Date.now()}`, {
            cache: "no-store",
          });
          if (!res.ok) continue;
          const data = await res.json();
          if (Array.isArray(data.topMovers2d) && data.topMovers2d.length) {
            list = data.topMovers2d;
            break;
          }
        }
        if (!cancelled) {
          setMovers2d(
            list.slice(0, 10).map((m: any) => ({
              symbol: String(m.symbol),
              name: m.name ? String(m.name) : undefined,
              netPct: m.netPct != null ? Number(m.netPct) : undefined,
              totalAbsPct: m.totalAbsPct != null ? Number(m.totalAbsPct) : undefined,
            }))
          );
        }
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);


  const scan = useCallback(async (force = false) => {
    const list = universe.filter((u) => u.symbol && !/^(BTC|ETH|XAUT)PHP$/i.test(u.symbol));
    if (list.length === 0) {
      setHits([]);
      return;
    }
    setLoading(true);
    setError(null);
    if (!force) {
      const cachedHits = readChartCache<any[]>("scan:nearSupport");
      if (cachedHits && cachedHits.length > 0) {
        setHits(cachedHits as any);
        setSelected((prev) =>
          prev && cachedHits.some((h: any) => h.symbol === prev) ? prev : cachedHits[0]?.symbol || ""
        );
        setLoading(false);
        return;
      }
    }
    try {
      const results = await Promise.all(
        list.map(async (u) => {
          const pts = await fetchDailyPoints(u.symbol);
          const pos = positionIn30d(pts);
          if (!pos) return null;
          return {
            symbol: u.symbol.toUpperCase(),
            name: u.name || u.symbol.replace(/PHP$/i, ""),
            ...pos,
          } as RangeHit;
        })
      );
      const ranked = results
        .filter((r): r is RangeHit => r != null)
        .sort((a, b) => a.positionPct - b.positionPct)
        .slice(0, 8);
      setHits(ranked);
      if (ranked.length > 0) writeChartCache("scan:nearSupport", ranked);
      setSelected((prev) =>
        prev && ranked.some((h) => h.symbol === prev) ? prev : ranked[0]?.symbol || ""
      );
    } catch (e) {
      setError((e as Error).message || "Scan failed");
    } finally {
      setLoading(false);
    }
  }, [universe]);

  useEffect(() => {
    void scan();
  }, [scan]);

  useEffect(() => {
    if (!selected) {
      setSeries([]);
      setDailyPoints([]);
      return;
    }
    let cancelled = false;
    setSeriesLoading(true);
    Promise.all([fetchPollSeries(selected), fetchDailyForSma(selected)])
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

  const active = hits.find((h) => h.symbol === selected) || null;

  return (
    <section
      id="near-support-charts"
      className="scroll-mt-20 rounded-xl border-2 border-rose-200 bg-rose-50/30 p-4 shadow-sm"
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-rose-950">
            Near 30-day support · top 8
          </h2>
          <p className="mt-0.5 text-[11px] text-rose-900/80">
            Lowest % of the 30-day range first (near support / discount zone). Same 3h + 20 SMA
            chart. Use <span className="font-semibold">Entry monitor prompt</span> for agent research on this
            top 8 <span className="font-semibold">+ Watch / plan + 2d movers</span> (±30d news/events,
            X accounts, copy-ready markdown). Confirm on Spot — not a buy signal by itself.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {active && (
            <Link
              href={`/chart?symbol=${encodeURIComponent(active.symbol)}`}
              className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-bold text-rose-900 hover:bg-rose-50"
            >
              Spot → {active.name}
            </Link>
          )}
          <button
            type="button"
            disabled={hits.length === 0}
            onClick={async () => {
              const text = buildNearSupportEntryPrompt(hits, watchPlanCoins, movers2d);
              try {
                await navigator.clipboard.writeText(text);
                setPromptCopied(true);
                window.setTimeout(() => setPromptCopied(false), 2000);
              } catch {
                /* ignore */
              }
            }}
            className="rounded-md border border-rose-400 bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {promptCopied ? "✅ Copied" : "📋 Entry monitor prompt"}
          </button>
        </div>
      </div>

      {error && <p className="mb-2 text-xs text-rose-700">{error}</p>}
      {loading && hits.length === 0 ? (
        <p className="text-xs text-gray-500">Scanning 30-day range…</p>
      ) : hits.length === 0 ? (
        <p className="text-xs text-gray-500">No range data yet.</p>
      ) : (
        <>
<div className="mb-3 flex flex-wrap gap-1.5">
            {hits.map((h, i) => {
              const on = h.symbol === selected;
              const near = h.positionPct <= 25;
              return (
                <button
                  key={h.symbol}
                  type="button"
                  onClick={() => setSelected(h.symbol)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition ${
                    on
                      ? "border-rose-600 bg-rose-600 text-white shadow-sm"
                      : "border-rose-200 bg-white text-rose-950 hover:bg-rose-50"
                  }`}
                >
                  <span className="opacity-70">#{i + 1}</span>
                  <span>{h.name}</span>
                  <span className={on ? "text-rose-100" : near ? "text-emerald-700" : "text-slate-600"}>
                    {h.positionPct.toFixed(0)}%
                  </span>
                </button>
              );
            })}
          </div>

          {active && (
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-rose-950">
              <span className="font-bold">{active.name}</span>
              <span className="font-mono text-[10px] text-rose-800/80">{active.symbol}</span>
              <span className="font-semibold text-slate-700">{active.detail}</span>
              <span className="tabular-nums text-slate-600">
                now {formatPhp(active.price)} · S {formatPhp(active.support)} · R{" "}
                {formatPhp(active.resistance)}
              </span>
            </div>
          )}

          {seriesLoading ? (
            <p className="text-xs text-gray-500">Loading 3h path…</p>
          ) : (
            <MoverLineChart points={series} symbol={selected} dailyPoints={dailyPoints} />
          )}
        </>
      )}
    </section>
  );
}
