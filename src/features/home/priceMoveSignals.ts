/** Auto price-move signals (not real articles) — hide from Market Signals, use % on chips. */
export function isPriceMoveSignalHeadline(headline: string): boolean {
  const h = headline || "";
  if (/\bdown\s+[\d.]+%/i.test(h)) return true;
  if (/\bup\s+[\d.]+%/i.test(h)) return true;
  if (/hits a new recorded (high|low)/i.test(h)) return true;
  if (/new recorded (high|low)/i.test(h)) return true;
  if (/recorded (high|low)/i.test(h) && /\(\w+PHP\)/i.test(h)) return true;
  return false;
}

/** Parse "XLM (XLMPHP) down 2.2%" → { XLMPHP: -2.2, XLM: -2.2 } */
export function parsePriceMovePercents(headlines: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const reDown = /([A-Za-z0-9]+)\s*\(([A-Za-z0-9]+)\)\s+down\s+([\d.]+)%/i;
  const reUp = /([A-Za-z0-9]+)\s*\(([A-Za-z0-9]+)\)\s+up\s+([\d.]+)%/i;
  // Prefer latest: iterate in order, later overwrites if we reverse — use first occurrence (news is newest first)
  for (const headline of headlines) {
    let m = headline.match(reDown);
    if (m) {
      const pct = -Math.abs(parseFloat(m[3]));
      if (!Number.isFinite(pct)) continue;
      if (map[m[2].toUpperCase()] === undefined) map[m[2].toUpperCase()] = pct;
      if (map[m[1].toUpperCase()] === undefined) map[m[1].toUpperCase()] = pct;
      continue;
    }
    m = headline.match(reUp);
    if (m) {
      const pct = Math.abs(parseFloat(m[3]));
      if (!Number.isFinite(pct)) continue;
      if (map[m[2].toUpperCase()] === undefined) map[m[2].toUpperCase()] = pct;
      if (map[m[1].toUpperCase()] === undefined) map[m[1].toUpperCase()] = pct;
    }
  }
  return map;
}
