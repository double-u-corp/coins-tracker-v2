/**
 * Research / monitoring priority for PHP spot (Coins.ph / Maya).
 * NOT buy signals — use when a technical setup already exists (support, RSI, ladder).
 * Pause (trackingEnabled=false) still overrides display in scans.
 */

export type CoinTier = "S" | "A" | "B" | "C";

export type TierMeta = {
  tier: CoinTier;
  label: string;
  short: string;
  /** Lower = higher priority in lists */
  rank: number;
  badgeClass: string;
};

const TIER_META: Record<CoinTier, Omit<TierMeta, "tier">> = {
  S: {
    label: "S · Core",
    short: "Majors / gold proxy — always track; market direction anchors",
    rank: 0,
    badgeClass: "bg-amber-100 text-amber-950 border-amber-300",
  },
  A: {
    label: "A · Priority",
    short: "Solid PHP alts — first in line for entry research when setup appears",
    rank: 1,
    badgeClass: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  B: {
    label: "B · Conditional",
    short: "OK if held or clear setup — pause polling if no bag / no thesis",
    rank: 2,
    badgeClass: "bg-sky-100 text-sky-900 border-sky-300",
  },
  C: {
    label: "C · Low / pause",
    short: "Delist risk, Convert-only noise, or weak PHP priority — do not prioritize buys",
    rank: 3,
    badgeClass: "bg-slate-200 text-slate-700 border-slate-400",
  },
};

/** Base ticker or full PHP symbol → tier (defaults to B if unknown). */
const BY_BASE: Record<string, CoinTier> = {
  // S — direction anchors + majors
  BTC: "S",
  ETH: "S",
  XAUT: "S",
  BNB: "S",
  SOL: "S",

  // A — priority alts (PHP-relevant, liquid enough for spot research)
  XRP: "A",
  ADA: "A",
  LINK: "A",
  AAVE: "A",
  BCH: "A",
  LTC: "A",
  TRX: "A",
  SUI: "A",
  HBAR: "A",
  XLM: "A",
  UNI: "A",
  POL: "A",
  ONDO: "A",
  NEAR: "A",
  RENDER: "A",
  DOT: "A",
  INJ: "A",
  HYPE: "A", // user priority — strong product; still confirm PHP venue depth

  // B — conditional (pause if no bag)
  SHIB: "B",
  GRAM: "B",
  BGB: "B",
  WEMIX: "B",
  XDC: "B",
  SKY: "B",
  VIRTUAL: "B",
  RON: "B",
  ENA: "B",
  XPL: "B",
  ASTER: "B",
  TX: "B",

  // C — delist / avoid new buys as priority
  SPX: "C",
  TRUMP: "C",
};

export function baseTickerFromSymbol(symbol: string): string {
  const s = String(symbol || "").toUpperCase().trim();
  if (s.endsWith("PHP")) return s.slice(0, -3);
  return s;
}

export function getCoinTier(symbolOrBase: string): CoinTier {
  const base = baseTickerFromSymbol(symbolOrBase);
  return BY_BASE[base] ?? "B";
}

export function getTierMeta(tier: CoinTier): TierMeta {
  return { tier, ...TIER_META[tier] };
}

export function getCoinTierMeta(symbolOrBase: string): TierMeta {
  return getTierMeta(getCoinTier(symbolOrBase));
}

/** Sort helper: S → A → B → C, then name. */
export function compareByTier(
  aSym: string,
  bSym: string,
  aName?: string,
  bName?: string
): number {
  const ra = getCoinTierMeta(aSym).rank;
  const rb = getCoinTierMeta(bSym).rank;
  if (ra !== rb) return ra - rb;
  return String(aName || aSym).localeCompare(String(bName || bSym));
}
