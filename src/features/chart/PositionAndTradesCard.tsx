import { useMemo, useState } from "react";
import { formatPhp } from "@/lib/format";

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
  holdings: number;
  spent: number;
  avg: number | null;
  pnlPct: number | null;
  daysHeld: number | null;
  support: number | null | undefined;
  resistance: number | null | undefined;
  txs: Tx[];
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
  lines.push(`- Be neutral. Do **not** force a bullish or long bias.`);
  lines.push(
    `- If evidence is bearish or unclear, say so (WAIT / SKIP / risk-off). Do not sugar-coat.`
  );
  lines.push(`- Prefer verified recent news/events; say "none verified" if unsure.`);
  lines.push(`- Do **not** invent news.`);
  lines.push(`- Do **NOT** use training-memory headlines (often stale) — only what you can verify now.`);
  lines.push(
    `- Platform constraint: the trader can only **buy or sell spot**. They cannot open a short/margin trade — if the case is bearish, prefer **do not buy / hold cash**, not “short it”.`
  );
  lines.push(`- Prefer pullbacks / staged buys over chasing when a buy is warranted.`);
  lines.push(``);
  lines.push(`## Market snapshot`);
  lines.push(`- Price now: ${price}`);
  if (args.support != null) lines.push(`- App support ref: ~${args.support}`);
  if (args.resistance != null) lines.push(`- App resistance ref: ~${args.resistance}`);

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
      `Given this open bag, when is a sensible time to **trim / sell** vs **hold**, and is **averaging down** justified only on a clear pullback?`
    );
    lines.push(
      `Cover: invalidation, profit-take zones near resistance, and risk if support fails. Stay neutral — if the bag looks wrong, say exit/trim.`
    );
  } else {
    lines.push(``);
    lines.push(`## Position`);
    lines.push(`The trader does **not** hold ${base} right now.`);
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
    if (cheapCoin) {
      lines.push(
        `Is it reasonable to **start a spot buy of about ₱10,000** in ${base} at/near current levels, based on verified research and levels?`
      );
    } else {
      lines.push(
        `Is it better to **buy 1 ${base}** or **more than 1**, and is a buy justified at all right now based on verified research and levels?`
      );
    }
    lines.push(
      `Advise **BUY / WAIT / SKIP**. If the setup is weak or bearish, choose WAIT or SKIP (hold cash) — do not invent a long. If BUY, suggest staging, invalidation, and a rough hold timeframe.`
    );
  }

  lines.push(``);
  lines.push(`## Answer format`);
  lines.push(
    `1. Verdict: BUY / WAIT / SKIP` + (args.holding ? ` / HOLD / TRIM / EXIT` : ``)
  );
  lines.push(`2. Why (max 3 bullets) — neutral; include downside if relevant`);
  lines.push(`3. Levels to watch (entry / invalidation / take-profit) or "none — stay in cash"`);
  lines.push(`4. News: verified only, or "none verified"`);
  lines.push(`5. Timeframe note (when to recheck)`);
  if (!args.holding) {
    lines.push(
      `6. Size note: ` +
        (cheapCoin
          ? `comment on ~₱10,000 starter (approx coins) or smaller`
          : `comment on 1 coin vs more, and total PHP at risk`)
    );
  }
  return lines.join("\n");
}

export default function PositionAndTradesCard({
  symbol,
  currentPrice,
  portfolio,
  transactions,
  support,
  resistance,
}: Props) {
  const [copied, setCopied] = useState(false);

  const holdings = portfolio?.holdings ?? 0;
  const spent = portfolio?.spent ?? 0;
  const holding = holdings > 0 && spent > 0;
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
        holdings,
        spent,
        avg,
        pnlPct,
        daysHeld: portfolio?.daysHeld ?? null,
        support,
        resistance,
        txs: transactions,
      }),
    [
      symbol,
      currentPrice,
      holding,
      holdings,
      spent,
      avg,
      pnlPct,
      portfolio?.daysHeld,
      support,
      resistance,
      transactions,
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
          {copied ? "✅ Copied" : holding ? "📋 Agent: hold / sell?" : "📋 Agent: buy advice?"}
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
