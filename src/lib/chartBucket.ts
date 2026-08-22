export type ChartGranularity = "daily" | "weekly" | "monthly" | "yearly";

/**
 * Computes the bucket a timestamp falls into for the price line chart, plus
 * a human-readable label for the x-axis. Pure function, safe to import from
 * both server (the /api/coins?type=chart handler) and client code (aligning
 * journal entries to the same buckets the chart uses) — no DB access here.
 *
 * Daily buckets use the specific UTC calendar day; weekly buckets use the 
 * Monday of that week; monthly/yearly use calendar boundaries.
 */
export function chartBucketKey(date: Date, granularity: ChartGranularity): { period: string; label: string } {
  if (granularity === "daily") {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    const period = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const label = new Date(Date.UTC(year, month, day)).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    return { period, label };
  }

  if (granularity === "yearly") {
    const year = date.getUTCFullYear();
    return { period: String(year), label: String(year) };
  }

  if (granularity === "monthly") {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const period = `${year}-${String(month + 1).padStart(2, "0")}`;
    const label = new Date(Date.UTC(year, month, 1)).toLocaleDateString(undefined, {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    return { period, label };
  }

  // weekly — bucket by the Monday that starts that ISO-ish week.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const isoDay = d.getUTCDay() || 7; // Sunday(0) -> 7, so Monday=1..Sunday=7
  d.setUTCDate(d.getUTCDate() - isoDay + 1);
  const period = d.toISOString().slice(0, 10);
  const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return { period, label };
}