/**
 * Shared neutral coin event-research prompt (Home on-hold, Spot, LONG-scan).
 * No buy/add/sell ranking — strict Watch date lines for Coin watch dates scraper.
 */

export type CoinNewsCoin = { symbol: string; name?: string | null };

export type CoinNewsMode = "holding" | "not_holding" | "board";

function baseName(c: CoinNewsCoin): string {
  return (c.name || c.symbol.replace(/PHP$/i, "") || c.symbol).trim();
}

/** Exact labels the Coin watch dates parser accepts. */
const WATCH_LABELS = "unlock | delisting | event | integration | listing | hardfork";

/**
 * @param mode holding → present + next 30d only
 *             not_holding / board → past 30d + present + next 30d
 */
export function buildCoinNewsResearchPrompt(args: {
  coins: CoinNewsCoin[];
  mode: CoinNewsMode;
  /** Shown in journal block, e.g. "Home · On hold", "Spot · Agent", "LONG-scan" */
  promptLabel: string;
  /** Optional one-line context (price etc.) — no S/R ladder advice */
  extraContext?: string[];
}): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const lines: string[] = [];
  const holding = args.mode === "holding";
  const bases = args.coins
    .map((c) => baseName(c))
    .filter(Boolean)
    .join(", ");

  lines.push(`You are a neutral crypto research assistant (Philippines PHP spot context).`);
  lines.push(`Analysis date (Manila): **${today}**.`);
  lines.push(``);
  lines.push(`## Task`);
  if (holding) {
    lines.push(
      `Research **current / ongoing** catalysts and **next ~30 calendar days only** for the coin(s) below.`
    );
    lines.push(
      `The trader **already holds** — do **not** ask whether to buy more, add, average down, sell, or size in.`
    );
  } else {
    lines.push(
      `Research **verified** catalysts for the coin(s) below across **past ~30 days**, **present / ~72h**, and **next ~30 calendar days**.`
    );
    lines.push(
      `Do **not** recommend buy, sell, hold, add, average down, rank for ₱10k, or size in.`
    );
  }
  lines.push(
    `Do **not** invent position size, cost basis, P&L, or holdings. Treat this as **activity / event research only**.`
  );
  lines.push(``);
  lines.push(`## Coins (search by project name / base ticker — not the PHP pair spelling)`);
  for (const c of args.coins) {
    const sym = String(c.symbol || "").toUpperCase();
    if (!sym) continue;
    lines.push(`- **${baseName(c)}** (local pair ${sym})`);
  }
  if (args.extraContext?.length) {
    lines.push(``);
    lines.push(`## App snapshot (context only — not entry advice)`);
    for (const x of args.extraContext) lines.push(`- ${x}`);
  }
  lines.push(``);
  lines.push(`## Research windows`);
  if (holding) {
    lines.push(`1. **Present / last ~72h** — verified news, listings, exploits, outages, official posts.`);
    lines.push(
      `2. **Next ~30 days** — dated unlocks, upgrades, governance votes, listings/delistings, conferences (confirmed dates only).`
    );
    lines.push(
      `3. **Do not** dig historical pumps or past-30d narratives unless needed to name a **forward** dated item.`
    );
  } else {
    lines.push(`1. **Past ~30 days** — verified news that may explain the path into today.`);
    lines.push(`2. **Present / last ~72h** — verified news, listings, exploits, outages, official posts.`);
    lines.push(
      `3. **Next ~30 days** — dated unlocks, upgrades, governance votes, listings/delistings, conferences (confirmed dates only).`
    );
  }
  lines.push(
    `4. **Security (last ~90d)** — exploit / hack / bridge / chain halt if still relevant; else **searched, none found**.`
  );
  lines.push(``);
  lines.push(`## Rules`);
  lines.push(`- Neutral. No buy / add / sell / rank / price-target verdict.`);
  lines.push(`- Verified sources only; no training-memory headlines; no invented dates.`);
  lines.push(`- Per category with nothing found after search → **none verified**.`);
  lines.push(`- Prefer project name / base ticker in searches (e.g. XLM not XLMPHP).`);
  lines.push(``);
  lines.push(`## Output (strict — machine-parsed)`);
  if (holding) {
    lines.push(`1. Short bullets only: Coin | Now / 72h | Next 30d | Security (no tables required).`);
  } else {
    lines.push(
      `1. Short bullets only: Coin | Past 30d | Now / 72h | Next 30d | Security (no tables required).`
    );
  }
  lines.push(``);
  lines.push(`2. **Watch date lines — CRITICAL (Coin watch dates scraper).**`);
  lines.push(`   Every dated catalyst MUST be its own bullet in **exactly** this shape (copy the pattern):`);
  lines.push(``);
  lines.push(`   - **Watch date:** YYYY-MM-DD · <label> · <BASE> <short detail>`);
  lines.push(``);
  lines.push(`   **Hard rules:**`);
  lines.push(`   - Starts with: \`- **Watch date:**\` (markdown bullet + bold label + colon).`);
  lines.push(`   - Date = \`YYYY-MM-DD\` only (no time, no weekday).`);
  lines.push(`   - Separators = middle dot \`·\` (not commas, not pipes, not "on", not parentheses for the structure).`);
  lines.push(`   - \`<label>\` = **one** of: ${WATCH_LABELS}`);
  lines.push(
    `   - \`<BASE>\` = project ticker **without** PHP (e.g. BCH, ADA, XLM, TX, ASTER) as the **first word** of the detail.`
  );
  lines.push(`   - One catalyst per line. Repeat the full \`- **Watch date:** …\` line for each date.`);
  lines.push(`   - Do **not** put Watch dates only inside a table or a paragraph.`);
  lines.push(`   - Do **not** write "Watch date" without the bold + colon pattern above.`);
  lines.push(`   - If a coin has **no** dated item → omit Watch date lines for that coin (do not invent).`);
  lines.push(``);
  lines.push(`   **Valid examples:**`);
  lines.push(`   - **Watch date:** 2026-11-15 · event · BCH Faster Blocks lock-in target`);
  lines.push(`   - **Watch date:** 2026-11-24 · hardfork · XLM Bell Protocol 30 mainnet upgrade vote`);
  lines.push(`   - **Watch date:** 2026-11-29 · unlock · ASTER 2.25M ecosystem/community unlock`);
  lines.push(`   - **Watch date:** 2026-12-07 · event · ADA Intersect Annual Members Meeting`);
  lines.push(``);
  lines.push(`   **Invalid (will not save):**`);
  lines.push(`   - Watch date 2026-11-15: BCH event…`);
  lines.push(`   - 2026-11-15 | event | BCH…`);
  lines.push(`   - **Date:** 2026-11-15 — event for BCH…`);
  lines.push(``);
  lines.push(`3. End with **only** this fenced markdown block (trader pastes it to journal).`);
  lines.push(`   Inside the fence, include **Agent**, **Prompt**, **Coins covered**, every **Watch date** line again, then **Notes**.`);
  lines.push(``);
  lines.push("```markdown");
  lines.push(`## Coin research · ${today} (Manila)`);
  lines.push(`- **Agent:** Spot Trading Desk AI (name your model)`);
  lines.push(`- **Prompt:** ${args.promptLabel}`);
  lines.push(`- **Coins covered:** ${bases || "…"}`);
  lines.push(`- **Watch date:** 2026-11-15 · event · BCH example detail`);
  lines.push(`- **Watch date:** 2026-11-24 · hardfork · XLM example detail`);
  lines.push(`- **Notes:** short neutral bullets only; no buy/sell advice`);
  lines.push("```");
  lines.push(``);
  lines.push(
    `Failure mode: free-form dates without the exact \`- **Watch date:** YYYY-MM-DD · label · BASE detail\` lines will **not** appear in Coin watch dates.`
  );
  return lines.join("\n");
}

/** Compact version for Google ?q= URL limits. */
export function buildCoinNewsResearchPromptCompact(args: {
  coins: CoinNewsCoin[];
  mode: CoinNewsMode;
  promptLabel: string;
}): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const holding = args.mode === "holding";
  const names = args.coins
    .map((c) => baseName(c))
    .filter(Boolean)
    .slice(0, 12)
    .join(", ");
  const windows = holding
    ? "CURRENT + next ~30d only (already holding; no deep past)"
    : "past ~30d + present/~72h + next ~30d";
  const parts = [
    `Neutral PHP spot research (${args.promptLabel}). Coins: ${names || "n/a"}. Manila ${today}.`,
    `Windows: ${windows}. No buy/add/sell/rank advice. Verified only; no invented dates.`,
    `CRITICAL machine format — every dated catalyst MUST be exactly:`,
    `- **Watch date:** YYYY-MM-DD · unlock|delisting|event|integration|listing|hardfork · BASE short detail`,
    `Examples: - **Watch date:** 2026-11-15 · event · BCH Faster Blocks lock-in | - **Watch date:** 2026-11-24 · hardfork · XLM Protocol 30 vote`,
    `BASE = ticker without PHP as first word of detail. One line per date. Not tables. Omit line if none verified.`,
    `End with markdown journal: Agent, Prompt, Coins covered, all Watch date lines, Notes.`,
  ];
  return parts.join(" ");
}
