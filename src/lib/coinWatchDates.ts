/**
 * Parse coin-specific shake dates from journal markdown (Spot, LONG-scan, general).
 * Labels: unlock | delisting | event | integration | listing | hardfork | other
 * No dedupe — every matched line is kept (user can delete journal rows).
 */

export type CoinWatchLabel =
  | "unlock"
  | "delisting"
  | "event"
  | "integration"
  | "listing"
  | "hardfork"
  | "other";

export type CoinWatchEvent = {
  symbol: string | null;
  coinId: number | null;
  date: string; // YYYY-MM-DD
  label: CoinWatchLabel;
  description: string;
  journalEntryId: number;
  journalTitle: string;
  sourceLine: string;
};

const LABEL_RE =
  /\b(unlock|delisting|delist|event|integration|listing|list|hardfork|hard\s*fork|conference|token\s*unlock|governance|vote|validator|proposal)\b/i;

function normalizeLabel(raw: string): CoinWatchLabel {
  const s = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (/delist/.test(s)) return "delisting";
  if (/unlock|token unlock/.test(s)) return "unlock";
  if (/integrat/.test(s)) return "integration";
  if (/list/.test(s) && !/delist/.test(s)) return "listing";
  if (/hard\s*fork|hardfork/.test(s)) return "hardfork";
  if (/event|conference/.test(s)) return "event";
  return "other";
}

function isoDate(y: number, m: number, d: number): string | null {
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseDateToken(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
  if (m) return isoDate(+m[3], +m[1], +m[2]);
  return null;
}

/**
 * Preferred formats (agent journal):
 * - **Watch date:** 2026-12-08 · unlock · Jenner hardfork on BNB Chain
 * - **Coin watch:** BNBPHP | 2026-12-08 | unlock | short description
 * - Watch date: 2026-11-15 · delisting · …
 * Fallback: any line with a date + unlock/delisting/event/integration nearby.
 */
export function extractCoinWatchEventsFromNotes(
  notes: string,
  ctx: {
    journalEntryId: number;
    journalTitle?: string | null;
    symbol?: string | null;
    coinId?: number | null;
  }
): CoinWatchEvent[] {
  if (!notes?.trim()) return [];
  const out: CoinWatchEvent[] = [];
  const lines = notes.split(/\r?\n/);

  const push = (
    date: string,
    label: CoinWatchLabel,
    description: string,
    sourceLine: string,
    symbol: string | null = ctx.symbol ?? null
  ) => {
    out.push({
      symbol,
      coinId: ctx.coinId ?? null,
      date,
      label,
      description: description.replace(/\*+/g, "").trim().slice(0, 240) || label,
      journalEntryId: ctx.journalEntryId,
      journalTitle: (ctx.journalTitle || "").slice(0, 120),
      sourceLine: sourceLine.slice(0, 280),
    });
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.length < 8) continue;

    // **Watch date:** / **Coin watch:** structured
    let m = line.match(
      /(?:Watch\s*date|Coin\s*watch|Shake\s*date|Event\s*date)\s*[:：]\s*(.+)$/i
    );
    if (m) {
      const rest = m[1].replace(/^\*+\s*/, "").trim();
      // SYMBOL | DATE | LABEL | desc
      let parts = rest.split("|").map((p) => p.trim());
      if (parts.length >= 3) {
        let sym: string | null = null;
        let dateStr: string | null = null;
        let labelRaw = "";
        let desc = "";
        if (parseDateToken(parts[0])) {
          dateStr = parseDateToken(parts[0]);
          labelRaw = parts[1];
          desc = parts.slice(2).join(" · ");
        } else if (parseDateToken(parts[1])) {
          sym = parts[0].replace(/\s+/g, "").toUpperCase();
          dateStr = parseDateToken(parts[1]);
          labelRaw = parts[2] || "event";
          desc = parts.slice(3).join(" · ");
        }
        if (dateStr) {
          push(dateStr, normalizeLabel(labelRaw || "event"), desc, line, sym || ctx.symbol || null);
          continue;
        }
      }
      // DATE · label · desc
      parts = rest.split(/[·•|]/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 1) {
        const dateStr = parseDateToken(parts[0]);
        if (dateStr) {
          const labelRaw = parts[1] || "event";
          const desc = parts.slice(2).join(" · ") || parts[1] || "";
          push(
            dateStr,
            normalizeLabel(LABEL_RE.test(labelRaw) ? labelRaw : "event"),
            LABEL_RE.test(labelRaw) ? desc : parts.slice(1).join(" · "),
            line
          );
          continue;
        }
      }
    }

    // **Unlock:** 2026-12-08 — desc
    m = line.match(
      /\*{0,2}\s*(Unlock|Delisting|Listing|Integration|Hardfork|Event)\s*\*{0,2}\s*[:：]\s*(.+)$/i
    );
    if (m) {
      const label = normalizeLabel(m[1]);
      const rest = m[2].trim();
      const dm = rest.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/);
      if (dm) {
        const dateStr = parseDateToken(dm[1]);
        if (dateStr) {
          const desc = rest.replace(dm[1], "").replace(/^[\s·\-|—–]+/, "").trim();
          push(dateStr, label, desc, line);
          continue;
        }
      }
    }

    // Fallback: line has ISO date and a known keyword
    if (LABEL_RE.test(line)) {
      const dm = line.match(/(\d{4}-\d{2}-\d{2})/);
      if (dm) {
        const dateStr = dm[1];
        const lm = line.match(LABEL_RE);
        const label = normalizeLabel(lm?.[1] || "event");
        const desc = line
          .replace(dm[1], "")
          .replace(LABEL_RE, "")
          .replace(/^[\s\-*:·|•]+/, "")
          .trim();
        push(dateStr, label, desc || line.slice(0, 120), line);
      }
    }
  }

  return out;
}

export function extractAllCoinWatchEvents(
  entries: Array<{
    id: number;
    title?: string | null;
    notes?: string | null;
    symbol?: string | null;
    coinId?: number | null;
  }>
): CoinWatchEvent[] {
  const all: CoinWatchEvent[] = [];
  for (const e of entries) {
    all.push(
      ...extractCoinWatchEventsFromNotes(e.notes || "", {
        journalEntryId: e.id,
        journalTitle: e.title,
        symbol: e.symbol ?? null,
        coinId: e.coinId ?? null,
      })
    );
  }
  // Sort: today first, then date asc
  const manilaToday = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  all.sort((a, b) => {
    const aT = a.date === manilaToday ? 0 : a.date < manilaToday ? 2 : 1;
    const bT = b.date === manilaToday ? 0 : b.date < manilaToday ? 2 : 1;
    if (aT !== bT) return aT - bT;
    return a.date.localeCompare(b.date) || a.label.localeCompare(b.label);
  });
  return all;
}
