/** Formats a value as PHP currency, e.g. 1234.5 -> "₱1,234.50". Returns "—" for null. */
export function formatPhp(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString(undefined, { style: "currency", currency: "PHP", maximumFractionDigits: 2 });
}

/** Formats a coin quantity (not currency) with enough precision for fractional holdings. */
export function formatCoinAmount(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}
