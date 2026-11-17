/** Trading venues — holdings/cash are per venue; 3h price polls stay per coin only. */
export const VENUES = ["coins_ph", "maya", "gcash"] as const;
export type VenueId = (typeof VENUES)[number];

export const VENUE_LABELS: Record<VenueId, string> = {
  coins_ph: "Coins.ph",
  maya: "Maya",
  gcash: "GCash",
};

export function normalizeVenue(v: unknown): VenueId {
  const s = String(v || "coins_ph").toLowerCase().trim();
  if (s === "maya") return "maya";
  if (s === "gcash" || s === "g-cash") return "gcash";
  return "coins_ph";
}

export function venueLabel(v: string | null | undefined): string {
  return VENUE_LABELS[normalizeVenue(v)] || String(v || "Coins.ph");
}

export function portfolioKey(symbol: string, venue: string): string {
  return `${String(symbol).toUpperCase()}::${normalizeVenue(venue)}`;
}

/** Chart buy-dot colors per venue (keep distinct on line chart). */
export const VENUE_COLORS: Record<VenueId, string> = {
  coins_ph: "#7c3aed", // violet
  maya: "#059669", // emerald
  gcash: "#0284c7", // sky
};

export function venueColor(v: string | null | undefined): string {
  return VENUE_COLORS[normalizeVenue(v)] || VENUE_COLORS.coins_ph;
}
