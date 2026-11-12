/**
 * Parse coin-specific shake dates from journal markdown (Spot, LONG-scan, general).
 * Labels: unlock | delisting | event | integration | listing | hardfork | other
 * No dedupe — every matched line is kept (user can delete rows in Coin watch dates).
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
  /\b(unlock|delisting|delist|event|integration|listing|list|hardfork|hard\s*fork|conference|token\s*unlock|governance|vote|validator|proposal|webinar|upgrade|mainnet|airdrop)\b/i;

function normalizeLabel(raw: string): CoinWatchLabel {
  const s = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (!s || s === "-" || s === "—" || s === "–") return "event";
  if (/delist/.test(s)) return "delisting";
  if (/unlock|token unlock/.test(s)) return "unlock";
  if (/integrat/.test(s)) return "integration";
  if (/list/.test(s) && !/delist/.test(s)) return "listing";
  if (/hard\s*fork|hardfork/.test(s)) return "hardfork";
  if (/event|conference|webinar|governance|vote|validator|proposal|upgrade|mainnet|airdrop/.test(s))
    return "event";
  return "other";
}

function cleanDesc(s: string): string {
  return s
    .replace(/\*+/g, "")
    .replace(/^[\s·•|—–\-]+/, "")
    .replace(/[\s·•|—–\-]+$/, "")
    .trim()
    .slice(0, 240);
}

/** Split "event — detail" or "unlock - detail" into label + desc. */
function splitLabelDesc(chunk: string): { labelRaw: string; descRest: string } {
  const t = chunk.trim();
  const m = t.match(
    /^(unlock|delisting|delist|event|integration|listing|hardfork|hard\s*fork|other|conference|webinar|governance)\s*[—–\-:]\s*(.+)$/i
  );
  if (m) return { labelRaw: m[1], descRest: m[2].trim() };
  // "event · rest" already handled by outer split; lone dash
  if (/^[—–\-]+$/.test(t)) return { labelRaw: "event", descRest: "" };
  return { labelRaw: t, descRest: "" };
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
 * - **Watch date:** 2026-11-19 · event · XLM Q3 webinar · Stellar update
 * - Also accepts em dash: Watch date: 2026-11-19 · event — XLM Q3 webinar
 * - **Coin watch:** BNBPHP | 2026-12-08 | unlock | short description
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
    const desc = cleanDesc(description) || label;
    out.push({
      symbol,
      coinId: ctx.coinId ?? null,
      date,
      label: label || "event",
      description: desc,
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
          const { labelRaw: lr, descRest } = splitLabelDesc(labelRaw);
          push(
            dateStr,
            normalizeLabel(lr || "event"),
            cleanDesc([descRest, desc].filter(Boolean).join(" · ")),
            line,
            sym || ctx.symbol || null
          );
          continue;
        }
      }
      // DATE · label · desc  (also · or —)
      parts = rest.split(/[·•|]/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 1) {
        const dateStr = parseDateToken(parts[0]);
        if (dateStr) {
          if (parts.length === 1) {
            push(dateStr, "event", "Watch date", line);
            continue;
          }
          const { labelRaw, descRest } = splitLabelDesc(parts[1]);
          const known = LABEL_RE.test(labelRaw);
          const label = normalizeLabel(known ? labelRaw : "event");
          const desc = known
            ? [descRest, ...parts.slice(2)].filter(Boolean).join(" · ")
            : [parts[1], ...parts.slice(2)].filter(Boolean).join(" · ");
          push(dateStr, label, cleanDesc(desc), line);
          continue;
        }
      }
    }

    // **Unlock:** 2026-12-08 — desc
    m = line.match(
      /\*{0,2}\s*(Unlock|Delisting|Listing|Integration|Hardfork|Event|Webinar|Governance)\*{0,2}\s*[:：]?\s*(\d{4}-\d{2}-\d{2})\s*[—–\-:·]?\s*(.*)$/i
    );
    if (m) {
      const dateStr = parseDateToken(m[2]);
      if (dateStr) {
        push(dateStr, normalizeLabel(m[1]), cleanDesc(m[3] || line), line);
        continue;
      }
    }

    // Loose: line contains YYYY-MM-DD + keyword
    const dm = line.match(/(\d{4}-\d{2}-\d{2})/);
    if (dm && LABEL_RE.test(line)) {
      const dateStr = parseDateToken(dm[1]);
      if (dateStr) {
        const lm = line.match(LABEL_RE);
        const label = normalizeLabel(lm?.[1] || "event");
        const desc = cleanDesc(
          line
            .replace(dm[1], "")
            .replace(/(?:Watch\s*date|Coin\s*watch)\s*[:：]?/i, "")
            .replace(LABEL_RE, "")
        );
        push(dateStr, label, desc || line.slice(0, 120), line);
      }
    }
  }

  return out;
}

export function extractAllCoinWatchEvents(
  entries: {
    id: number;
    notes?: string | null;
    title?: string | null;
    symbol?: string | null;
    coinId?: number | null;
  }[]
): CoinWatchEvent[] {
  const all: CoinWatchEvent[] = [];
  for (const e of entries) {
    all.push(
      ...extractCoinWatchEventsFromNotes(e.notes || "", {
        journalEntryId: e.id,
        journalTitle: e.title,
        symbol: e.symbol,
        coinId: e.coinId ?? null,
      })
    );
  }
  all.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  return all;
}
