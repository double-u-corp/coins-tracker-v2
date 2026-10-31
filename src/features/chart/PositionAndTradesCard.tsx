import { useMemo, useState } from "react";
import { formatPhp } from "@/lib/format";
import { findLastPumpContext } from "./TradingInsightCard";

type Tx = {
  id: number | string;
  type: string;
  coinAmount: number;
  price: number;
  phpAmount: number;
  transactedAt: string;
};

type PortfolioRow = {
  holdings: number;
  spent: number;
  firstBuyAt?: string | null;
  daysHeld?: number | null;
} | null;

type Props = {
  symbol: string;
  currentPrice: number;
  portfolio: PortfolioRow;
  transactions: Tx[];
  support?: number | null;
  resistance?: number | null;
  /** Daily chart points — used for last local high / pump context in agent prompt */
  points?: { period?: string; high?: number; low?: number; close?: number }[] | null;
};

function recoveryTargets(avg: number) {
  // Price levels vs average cost
  return [
    { label: "+3%", pct: 0.03, price: avg * 1.03 },
    { label: "+6%", pct: 0.06, price: avg * 1.06 },
    { label: "+10%", pct: 0.1, price: avg * 1.1 },
    { label: "+15%", pct: 0.15, price: avg * 1.15 },
  ];
}

function buildAgentPrompt(args: {
  symbol: string;
  currentPrice: number;
  holding: boolean;
  /** Flat now but had prior buys — rebuy / re-entry */
  rebuy: boolean;
  holdings: number;
  spent: number;
  avg: number | null;
  pnlPct: number | null;
  daysHeld: number | null;
  support: number | null | undefined;
  resistance: number | null | undefined;
  txs: Tx[];
  points?: { period?: string; high?: number; low?: number; close?: number }[] | null;
}): string {
  const base = args.symbol.replace(/PHP$/i, "") || args.symbol;
  const price = args.currentPrice;
  const cheapCoin = Number.isFinite(price) && price > 0 && price < 10_000;
  const lines: string[] = [];
  lines.push(
    `You are a neutral crypto research assistant for a PHP **spot** trader (local exchanges — buy/sell coins only; no leverage products assumed).`
  );
  lines.push(`Asset: **${base}** (local pair **${args.symbol}**).`);
  lines.push(
    `When searching news, use the project name / ticker **${base}** — not “${args.symbol}” and not unrelated meanings of the ticker.`
  );
  lines.push(``);
  lines.push(`## Rules`);
  lines.push(`- **Neutral.** Never force a long/bullish read. Softening a weak/bearish case into BUY/HOLD is a failure mode.`);
  lines.push(`- **Spot only:** buy or sell coins. If bearish/unclear → **WAIT / SKIP / DO NOT ADD** and **hold cash**. Never recommend shorting or leverage.`);
  lines.push(`- Prefer pullbacks / staged buys over chasing.`);
  lines.push(`- **Anti-fabrication:** only claims with a current verifiable source. No training-memory headlines. No invented unlock dates or exploit details.`);
  lines.push(`- **"None verified" is only valid after an explicit search** for that category — not as a default when you skipped the scan.`);
  lines.push(`- Complete **Mandatory research** (security + category audit + past/forward windows) **before** any BUY / ADD / HOLD-style verdict.`);
  lines.push(`- Verified exploit or major security incident → do not treat technicals alone as enough to buy or average down.`);
  lines.push(``);
  lines.push(`## Market snapshot`);
  lines.push(`- Price now: ${price}`);
  if (args.support != null) lines.push(`- App support ref: ~${args.support}`);
  if (args.resistance != null) lines.push(`- App resistance ref: ~${args.resistance}`);

  const pump = findLastPumpContext(args.points || []);
  if (pump) {
    const pumpDate = pump.period
      ? new Date(pump.period).toLocaleDateString("en-CA", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
      : "unknown";
    lines.push(``);
    lines.push(`## Last local high / pump (app daily series)`);
    lines.push(`- Peak ~**${pump.peak}** on **${pumpDate}** Manila (~${pump.daysAgo}d ago).`);
    lines.push(
      `- Now vs that peak: **−${Math.abs(pump.dropPct).toFixed(2)}%** (our poll data).`
    );
    lines.push(
      `- Research: search **verified** news around **${pumpDate}** and after that may explain a run-up and why price is lower now (unlock, listing, exploit, regulatory, project news). Do not invent causes. If nothing verified, say "none verified".`
    );
  }

  if (args.holding && args.avg != null) {
    lines.push(``);
    lines.push(`## Open position (already bought)`);
    lines.push(`- Holdings: **${args.holdings}** ${base}`);
    lines.push(`- Total spent (PHP): **${args.spent}**`);
    lines.push(`- Average cost: **${args.avg}**`);
    lines.push(
      `- Unrealized vs avg: **${
        args.pnlPct != null
          ? `${args.pnlPct >= 0 ? "+" : ""}${args.pnlPct.toFixed(2)}%`
          : "n/a"
      }**`
    );
    if (args.daysHeld != null) lines.push(`- Days held (since first buy): **${args.daysHeld}**`);
    lines.push(`- Recent trades (newest first):`);
    for (const tx of args.txs.slice(0, 8)) {
      lines.push(
        `  - ${tx.type.toUpperCase()} ${tx.coinAmount} @ ${tx.price} (${tx.phpAmount} PHP) · ${new Date(
          tx.transactedAt
        )
          .toISOString()
          .slice(0, 10)}`
      );
    }
    lines.push(``);
    lines.push(`## Question`);
    lines.push(
      `Primary question: is it reasonable to **add / buy more** of ${base} now, or only on a deeper pullback, or **not add** at all?`
    );
    lines.push(
      `This is an **add / size** decision, not a default hold/exit review. Mention trim/exit only if the existing bag's thesis is clearly broken. Cover: levels for any add, size vs current holdings, invalidation, and risk if support fails. Stay neutral.`
    );
  } else {
    lines.push(``);
    lines.push(`## Position`);
    if (args.rebuy) {
      lines.push(
        `The trader does **not** hold ${base} right now, but **previously held and realized** this pair (closed cycle). This is a **rebuy / re-entry** setup — not a first-time buy.`
      );
      lines.push(
        `Journal must use **Target re-entry** (full PHP price). Consider prior trade history; do not force a rebuy if thesis is weak.`
      );
    } else {
      lines.push(`The trader does **not** hold ${base} right now.`);
    }
    lines.push(``);
    lines.push(`## Sizing intent (trader plan)`);
    if (cheapCoin) {
      lines.push(
        `- Coin price is **under ₱10,000** (now ~₱${price}). Planned starter size: about **₱10,000** notional (not a fixed coin count).`
      );
      lines.push(
        `- Rough coins for ₱10,000 ≈ **${(10000 / price).toFixed(4)}** ${base} at current price.`
      );
    } else {
      lines.push(
        `- Coin price is **₱10,000 or higher** (now ~₱${price}). Ask whether **1 coin** is enough to start, or **more than 1**, and at what total PHP risk.`
      );
    }
    lines.push(``);
    lines.push(`## Question`);
    if (args.rebuy) {
      lines.push(
        `Is it reasonable to **rebuy / re-enter** ${base} now (after a prior realized cycle), only on a deeper pullback, or **skip**?`
      );
      lines.push(
        `Advise **BUY / WAIT / SKIP**. Prefer staged **Target re-entry** levels over chasing. Stay neutral.`
      );
    } else if (cheapCoin) {
      lines.push(
        `Is it reasonable to **start a spot buy of about ₱10,000** in ${base} at/near current levels, based on verified research and levels?`
      );
      lines.push(
        `Advise **BUY / WAIT / SKIP**. If the setup is weak or bearish, choose WAIT or SKIP (hold cash) — do not invent a long. If BUY, suggest staging, invalidation, and a rough hold timeframe.`
      );
    } else {
      lines.push(
        `Is it better to **buy 1 ${base}** or **more than 1**, and is a buy justified at all right now based on verified research and levels?`
      );
      lines.push(
        `Advise **BUY / WAIT / SKIP**. If the setup is weak or bearish, choose WAIT or SKIP (hold cash) — do not invent a long. If BUY, suggest staging, invalidation, and a rough hold timeframe.`
      );
    }
  }

  lines.push(``);
  lines.push(`## Mandatory research (complete BEFORE any verdict — no silent skips)
Live search only. Training memory is not evidence. Do **not** invent events.
**Silence is not “none verified.”** For every category below you must either list a verified item or write **“searched, none found”** (never omit the line). Distinguish **searched, none found** from **not searched**.

### A) Security / exploit (last ~90 days) — MANDATORY
Search: project name, ticker, “exploit”, “hack”, “bridge”, “security incident”, “vulnerability”.
If a **verified** incident exists → flag it and lean **WAIT / SKIP / DO NOT ADD / TRIM** (as fits). Do not bury it under bullish technicals.

### B) Category audit (one line each — found or “searched, none found”)
1. Exploit / security
2. Unlocks / vesting / circulating supply
3. Listing / delisting
4. Partnership / official product launch
5. Regulatory / political (only if **asset-linked**)

### C) Catalyst windows
- **Past:** ~60 days before and after last local high (if provided); else last ~90 days of material news
- **Forward:** next **90 days** — dated unlocks, launches, governance; if no dated items → **“searched, none found”** for forward calendar (do not invent dates)

### D) Output shape for catalysts
1. **News audit** — the five category lines above (+ note of main queries used)
2. **Table ≤6 rows** — date | source URL | official vs reported | already-in-price? | uncertainty | spot implication (buy / wait pullback / cash / reduce — **never short**)
3. Then the trading verdict informed by this research`);
  lines.push(``);
  if (args.holding && args.pnlPct != null && args.daysHeld != null) {
    lines.push(`## Thesis health (open position)`);
    lines.push(
      `- Unrealized ~${args.pnlPct.toFixed(1)}% · held ~${args.daysHeld} day(s).`
    );
    lines.push(
      `- **If underwater worse than -40% AND held > 60 days:** HOLD/ADD is only justified with at least one **verified positive catalyst** that shows ongoing token utility (not a technical bounce alone). Otherwise lean **DO NOT ADD** / consider **TRIM** if thesis is broken.`
    );
    lines.push(``);
  }
  lines.push(`## Answer format`);

  lines.push(`1. **News audit** (required): exploit / unlock / listing / partnership / regulatory — each **found** or **searched, none found**; list main queries`);
  lines.push(`2. **Catalyst table** ≤6 rows (date · URL · official vs reported · in-price? · uncertainty · spot implication)`);
  lines.push(
    `3. Verdict: ` + (args.holding ? `ADD / ADD ONLY ON PULLBACK / DO NOT ADD / TRIM` : `BUY / WAIT / SKIP`) + ` — after audit; bearish/unclear → do not force long`
  );
  lines.push(`4. Why (max 3 bullets) — neutral; mix technical + catalyst; mention exploit/unlock if relevant`);
  lines.push(`5. Levels (entry / invalidation / take-profit) or "none — stay in cash"`);
  lines.push(
    `   → Copy levels into journal: **Target entry** (new buy) or **Target re-entry** (already holding / add) and **Target exit** (full PHP, no commas). Always include **Review by:** YYYY-MM-DD (future Manila date).`
  );
  lines.push(`6. Timeframe with ≥1 calendar recheck date (Manila)`);
  if (!args.holding) {
    lines.push(
      `7. Size note: ` +
        (cheapCoin
          ? `comment on ~₱10,000 starter (approx coins) or smaller`
          : `comment on 1 coin vs more, and total PHP at risk`)
    );
  }
  lines.push(
    `${!args.holding ? "8" : "7"}. Final **journal note** markdown (required).`
  );
  lines.push(``);
  const todayManila = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  lines.push(`## Final journal note (REQUIRED — pure markdown, copy-paste ready)`);
  lines.push(
    `End with ONLY the fenced markdown block below. Home Target monitor **parses these exact labels** — do not rename, translate, or merge them into one sentence.`
  );
  lines.push(`**STRICT field rules (machine-readable):**`);
  lines.push(
    `1. **Agent:** one line, start with \`Spot Trading Desk AI\` then product/model in parentheses. Example: \`Spot Trading Desk AI (Grok)\`. Never put the note title here.`
  );
  lines.push(
    `2. **Target entry** / **Target re-entry:** REQUIRED. One full PHP price from research + levels. If already holding / adding, prefer label **Target re-entry**. Optional ₱. Example: ₱16332.9 — never truncate; **no thousands commas**. n/a only if SKIP/WAIT with no buy level.`
  );
  lines.push(
    `3. **Target exit:** REQUIRED. One full PHP price from research + levels (resistance / trim / TP). Optional ₱. Example: ₱20036.1. **No thousands commas.** Use n/a only if no exit level applies.`
  );
  lines.push(
    `4. **Review by:** exactly \`YYYY-MM-DD\` (Manila calendar date). Example: \`2026-11-04\`. No extra words on that line.`
  );
  lines.push(
    `Keep each of those four as its own bullet: \`- **Label:** value\`. Do not bold the value. Do not use tables for these four.`
  );
  lines.push(``);
  lines.push("```markdown");

  if (args.holding) {
    lines.push(`## ${args.symbol} · add / size note · ${todayManila} (Manila)`);
    lines.push(``);
    lines.push(`- **Agent:** Spot Trading Desk AI (ChatGPT / Grok / Gemini — name model)`);
    lines.push(`- **Prompt:** Spot · Position & trades · add/size research`);
    lines.push(`- **Verdict:** ADD | ADD ONLY ON PULLBACK | DO NOT ADD | TRIM`);
    lines.push(`- **Price now:** …`);
    lines.push(`- **Avg cost / unrealized:** …`);
    lines.push(
      `- **Target re-entry:** ₱${args.support != null && Number.isFinite(args.support) ? Number(args.support).toFixed(2) : "…"}`
    );
    lines.push(
      `- **Target exit:** ₱${args.resistance != null && Number.isFinite(args.resistance) ? Number(args.resistance).toFixed(2) : "…"}`
    );
    lines.push(`- **Last pump / local high:** date · peak · why it may have faded (or n/a)`);
    lines.push(`- **Sell / trim if:** …`);
    lines.push(`- **Invalidation:** …`);
    lines.push(`- **Review by:** YYYY-MM-DD`);
    lines.push(`- **News (verified):** …`);
    lines.push(`- **Why:** …`);
  } else {
    lines.push(
      `## ${args.symbol} · ${args.rebuy ? "rebuy / re-entry" : "entry"} note · ${todayManila} (Manila)`
    );
    lines.push(``);
    lines.push(`- **Agent:** Spot Trading Desk AI (ChatGPT / Grok / Gemini — name model)`);
    lines.push(
      `- **Prompt:** Spot · Position & trades · ${args.rebuy ? "rebuy / re-entry research" : "buy/sizing research"}`
    );
    lines.push(`- **Verdict:** BUY | WAIT | SKIP`);
    lines.push(`- **Price now:** …`);
    lines.push(
      `- **${args.rebuy ? "Target re-entry" : "Target entry"}:** ₱${args.support != null && Number.isFinite(args.support) ? Number(args.support).toFixed(2) : "…"}`
    );
    lines.push(
      `- **Target exit:** ₱${args.resistance != null && Number.isFinite(args.resistance) ? Number(args.resistance).toFixed(2) : "…"}`
    );
    lines.push(`- **Last pump / local high:** date · peak · why price may be down now (or n/a)`);
    lines.push(`- **Entry / invalidation / TP:** …`);
    lines.push(`- **Size note:** …`);
    lines.push(`- **Review by:** YYYY-MM-DD`);
    lines.push(`- **News (verified):** …`);
    lines.push(`- **Why:** …`);
  }
  lines.push("```");
  return lines.join("\n");
}

export default function PositionAndTradesCard({
  symbol,
  currentPrice,
  portfolio,
  transactions,
  support,
  resistance,
  points = null,
}: Props) {
  const [copied, setCopied] = useState(false);

  const holdings = portfolio?.holdings ?? 0;
  const spent = portfolio?.spent ?? 0;
  const holding = holdings > 0 && spent > 0;
  const priorBuys = (transactions || []).some(
    (tx) =>
      String(tx.symbol || "").toUpperCase() === String(symbol || "").toUpperCase() &&
      String(tx.type || "").toLowerCase() === "buy"
  );
  const rebuy = !holding && priorBuys;
  const avg = holding ? spent / holdings : null;
  const mtm = holding && currentPrice > 0 ? holdings * currentPrice : null;
  const pnlPhp = mtm != null ? mtm - spent : null;
  const pnlPct =
    holding && avg != null && avg > 0 && currentPrice > 0
      ? ((currentPrice - avg) / avg) * 100
      : null;

  const targets = useMemo(() => (avg != null && avg > 0 ? recoveryTargets(avg) : []), [avg]);

  const prompt = useMemo(
    () =>
      buildAgentPrompt({
        symbol,
        currentPrice,
        holding,
        rebuy,
        holdings,
        spent,
        avg,
        pnlPct,
        points,
        daysHeld: portfolio?.daysHeld ?? null,
        support,
        resistance,
        txs: transactions,
      }),
    [
      symbol,
      currentPrice,
      holding,
      rebuy,
      holdings,
      spent,
      avg,
      pnlPct,
      portfolio?.daysHeld,
      support,
      resistance,
      transactions,
      points,
    ]
  );

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Position &amp; trades <span className="text-brand-600">({symbol})</span>
          </h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Spot bag, P&amp;L vs average, recovery targets, and agent review prompt
          </p>
        </div>
        <button
          type="button"
          onClick={() => void copyPrompt()}
          className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-900 hover:bg-indigo-100"
        >
          {copied ? "✅ Copied" : holding ? "📋 Agent: add more?" : rebuy ? "📋 Agent: rebuy?" : "📋 Agent: buy advice?"}
        </button>
      </div>

      {/* Position summary */}
      {holding && avg != null ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <div className="text-[10px] font-bold uppercase text-slate-400">Holdings</div>
              <div className="font-mono text-sm font-bold text-slate-900">{holdings}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase text-slate-400">Spent</div>
              <div className="font-mono text-sm font-bold text-slate-900">{formatPhp(spent)}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase text-slate-400">Avg cost</div>
              <div className="font-mono text-sm font-bold text-slate-900">{formatPhp(avg)}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase text-slate-400">Now</div>
              <div className="font-mono text-sm font-bold text-slate-900">
                {currentPrice > 0 ? formatPhp(currentPrice) : "—"}
              </div>
            </div>
          </div>

          <div
            className={`rounded-lg border px-3 py-2 ${
              pnlPct != null && pnlPct >= 0
                ? "border-emerald-200 bg-emerald-50"
                : "border-rose-200 bg-rose-50"
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Unrealized vs average
            </div>
            <div className="flex flex-wrap items-baseline gap-2 mt-0.5">
              <span
                className={`text-lg font-extrabold tabular-nums ${
                  pnlPct != null && pnlPct >= 0 ? "text-emerald-800" : "text-rose-800"
                }`}
              >
                {pnlPct != null
                  ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`
                  : "—"}
              </span>
              {pnlPhp != null && (
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    pnlPhp >= 0 ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                  ({pnlPhp >= 0 ? "+" : ""}
                  {formatPhp(pnlPhp)})
                </span>
              )}
            </div>
            {(portfolio?.daysHeld != null || portfolio?.firstBuyAt) && (
              <div className="text-[11px] text-slate-600 mt-1.5 font-medium">
                <span className="font-bold text-slate-800">
                  Days held: {portfolio?.daysHeld != null ? `${portfolio.daysHeld}d` : "—"}
                </span>
                {portfolio?.firstBuyAt && (
                  <span className="text-slate-500">
                    {" "}
                    since{" "}
                    {new Date(portfolio.firstBuyAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="text-[10px] font-bold uppercase text-slate-500 mb-1.5">
              Price to be profitable vs avg
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {targets.map((t) => {
                const need =
                  currentPrice > 0 ? ((t.price - currentPrice) / currentPrice) * 100 : null;
                const already = currentPrice >= t.price;
                const bagValue = holdings * t.price;
                const profitPhp = bagValue - spent;
                return (
                  <div
                    key={t.label}
                    className={`rounded-lg border px-2 py-2 text-center ${
                      already
                        ? "border-emerald-300 bg-emerald-50"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="text-[10px] font-bold text-slate-500">{t.label}</div>
                    <div className="font-mono text-xs font-bold text-slate-900">
                      {formatPhp(t.price)}
                    </div>
                    <div className="text-[10px] font-semibold text-indigo-800 mt-0.5">
                      Bag {formatPhp(bagValue)}
                    </div>
                    <div
                      className={`text-[10px] font-semibold ${
                        profitPhp >= 0 ? "text-emerald-700" : "text-rose-600"
                      }`}
                    >
                      {profitPhp >= 0 ? "+" : ""}
                      {formatPhp(profitPhp)} P&L
                    </div>
                    <div
                      className={`text-[10px] font-semibold ${
                        already ? "text-emerald-700" : "text-amber-700"
                      }`}
                    >
                      {already
                        ? "At / above"
                        : need != null
                          ? `+${need.toFixed(1)}% from now`
                          : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-3 py-3 text-xs text-slate-600">
          No open holdings for <span className="font-semibold">{symbol}</span>. Use the agent button for a
          small-size buy check (e.g. ~3 coins), or log buys on Buy / Sell.
        </div>
      )}

      {/* Trade cards */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
          Transaction history
        </h4>
        {transactions.length === 0 ? (
          <p className="text-xs text-gray-500">No transactions recorded yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {transactions.map((tx) => {
              const buy = tx.type === "buy";
              return (
                <div
                  key={tx.id}
                  className={`rounded-lg border p-3 ${
                    buy
                      ? "border-emerald-100 bg-emerald-50/40"
                      : "border-rose-100 bg-rose-50/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                        buy ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      {tx.type}
                    </span>
                    <span className="text-[11px] text-gray-500">
                      {new Date(tx.transactedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  <div className="font-mono text-sm font-bold text-gray-900">
                    {tx.coinAmount} @ {formatPhp(tx.price)}
                  </div>
                  <div className="text-[11px] text-gray-600 mt-0.5">
                    Value {formatPhp(tx.phpAmount)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
