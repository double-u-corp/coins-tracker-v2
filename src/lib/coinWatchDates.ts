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
  /\b(unlock|delisting|delist|event|integration|listing|list|hardfork|hard\s*fork|conference|token\s*unlock|governance|vote|validator|proposal|webinar|upgrade|mainnet|airdrop|staking|tokenomics|roadmap|sunset|launch|claim|vest|cliff|scheduled|historical)\b/i;

function normalizeLabel(raw: string): CoinWatchLabel {
  const s = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (!s || s === "-" || s === "—" || s === "–") return "event";
  if (/delist/.test(s)) return "delisting";
  if (/unlock|token unlock|vest(ed|ing)?|claim window|cliff/.test(s)) return "unlock";
  if (/integrat/.test(s)) return "integration";
  if (/(^|\s)list(ing)?(\s|$)/.test(s) && !/delist/.test(s)) return "listing";
  if (/hard\s*fork|hardfork/.test(s)) return "hardfork";
  if (
    /event|conference|webinar|governance|vote|validator|proposal|upgrade|mainnet|airdrop|staking|tokenomics|roadmap|sunset|launch|activation|merger|legacy/.test(
      s
    )
  )
    return "event";
  // Free-form Google labels e.g. "Claim Window End", "Q4 Roadmap Target"
  if (/claim|window|target|scheduled|historical/.test(s)) return "event";
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


/** Infer ticker from description / line when journal is general (no coin). */
function inferSymbolFromText(text: string, known?: string | null): string | null {
  if (known) return known.replace(/\s+/g, "").toUpperCase();
  const t = text || "";
  let m = t.match(/\b([A-Z]{2,12})PHP\b/);
  if (m) return m[1] + "PHP";
  const bases = [
    "ASTER", "TRUMP", "WEMIX", "VIRTUAL", "HBAR", "AAVE", "LINK", "ONDO", "GRAM",
    "SHIB", "XAUT", "BCH", "BNB", "BTC", "ETH", "SOL", "SUI", "XLM", "XRP", "XDC",
    "ADA", "UNI", "TRX", "SPX", "ENA", "XPL", "RON", "TX", "POL", "BGB", "SKY", "HYPE", "RENDER", "NEAR",
  ];
  const upper = t.toUpperCase();
  for (const b of bases) {
    if (new RegExp(`\\b${b}\\b`).test(upper)) return b + "PHP";
  }
  return null;
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
    const resolved =
      inferSymbolFromText(`${desc} ${sourceLine}`, symbol) ||
      inferSymbolFromText(sourceLine, null) ||
      symbol;
    out.push({
      symbol: resolved,
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
    // Strip list markers: • · - * and optional "Watch date" noise
    let line = raw.trim().replace(/^[•·▪◦\-\*]+\s*/, "").trim();
    if (!line || line.length < 8) continue;
    // skip section headers only
    if (/^watch[_\s-]*dates\s*:?\s*$/i.test(line)) continue;
    if (/^fundamental[_\s-]*profile\s*:?\s*$/i.test(line)) continue;

    // Google / free-form: "2026-11-28 · Claim Window End · Deadline…"
    {
      const bare = line.match(/^(\d{4}-\d{2}-\d{2})\s*[·•|,;]\s*(.+)$/);
      if (bare) {
        const dateStr = parseDateToken(bare[1]);
        if (dateStr) {
          const rest = bare[2].trim();
          const parts = rest.split(/[·•|]/).map((x) => x.trim()).filter(Boolean);
          let labelRaw = parts[0] || "event";
          let desc = parts.length > 1 ? parts.slice(1).join(" · ") : parts[0] || rest;
          if (parts.length === 1 && (parts[0] || "").length > 48) {
            labelRaw = "event";
            desc = parts[0];
          }
          const label = normalizeLabel(labelRaw);
          const description = cleanDesc(
            parts.length > 1 ? `${labelRaw} — ${desc}` : String(desc)
          );
          push(dateStr, label, description || cleanDesc(rest), line, ctx.symbol ?? null);
          continue;
        }
      }
    }

    // **Watch date:** / **Coin watch:** structured (allow markdown * around label/colon)
    let m = line.match(
      /(?:Watch\s*date|Coin\s*watch|Shake\s*date|Event\s*date)\*{0,2}\s*[:：]\*{0,2}\s*(.+)$/i
    );
    if (m) {
      const rest = m[1]
        .replace(/^\*+\s*/, "")
        .replace(/\*+/g, "")
        .trim();
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
