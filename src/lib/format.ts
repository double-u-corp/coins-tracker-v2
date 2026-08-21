/**
 * Formats a value as PHP currency. Uses up to 8 decimal places for sub-₱1
 * values — many altcoins trade at a small fraction of a peso (e.g. SHIB at
 * ₱0.0000025), and the data itself is captured/stored at full precision
 * (parseFloat + Postgres double precision both handle this fine); it was
 * only ever the display capping at 2 decimals that made a cheap coin's
 * price collapse to a useless "₱0.00". Values ≥ ₱1 still use the normal 2
 * decimals, so a BTC-range price doesn't print a wall of trailing zeros.
 * Returns "—" for null.
 */
export function formatPhp(value: number | null): string {
  if (value === null) return "—";
  const maximumFractionDigits = Math.abs(value) < 1 ? 8 : 2;
  return value.toLocaleString(undefined, { style: "currency", currency: "PHP", maximumFractionDigits });
}

/** Formats a coin quantity (not currency) with enough precision for fractional holdings. */
export function formatCoinAmount(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}
