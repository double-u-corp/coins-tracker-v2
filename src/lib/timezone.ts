// Centralized timezone handling. Nothing else in the app should call
// `new Date()` and trust it to mean "Manila time" — the browser's local
// clock could be set to anything. Everything trading-relevant goes through
// these helpers instead, so the app behaves the same regardless of device
// timezone settings.

export const TRADER_TIMEZONE = "Asia/Manila";
// US macro releases (CPI, NFP, FOMC) are always quoted in US Eastern Time,
// which shifts between EST (UTC-5) and EDT (UTC-4) depending on the date.
export const US_MACRO_TIMEZONE = "America/New_York";

/** "Now", explicitly anchored to Manila time regardless of device timezone. */
export function nowInManila(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TRADER_TIMEZONE }));
}

/** Returns "YYYY-MM-DD" for a given instant, as that date reads in `timeZone`. */
export function getDateKeyInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  parts.forEach((p) => (map[p.type] = p.value));
  return `${map.year}-${map.month}-${map.day}`;
}

/** e.g. "9:30 PM MNL" for a given instant. */
export function getTimeLabelInZone(instant: Date, timeZone: string, suffix: string): string {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
  return `${time} ${suffix}`;
}

/**
 * Converts a "YYYY-MM-DD" + "HH:mm" pair that represents a wall-clock time
 * IN `sourceTimeZone` (e.g. a Fed release quoted in ET) into a real UTC
 * instant — correctly accounting for DST on that specific date, so a
 * hardcoded "-5" or "-4" offset is never needed.
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, sourceTimeZone: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const naiveUtcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));

  // Compare how that same instant reads in the source zone vs. true UTC to
  // recover the zone's current offset (handles DST automatically), then
  // correct the guess.
  const asSourceZone = new Date(naiveUtcGuess.toLocaleString("en-US", { timeZone: sourceTimeZone }));
  const asUtc = new Date(naiveUtcGuess.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = asUtc.getTime() - asSourceZone.getTime();

  return new Date(naiveUtcGuess.getTime() + offsetMs);
}

/** Manila date-key + display label for a US ET-quoted event date/time. */
export function usEventToManila(dateStr: string, timeET?: string) {
  if (!timeET) {
    // No time given — best effort: assume the ET calendar date is a close
    // enough placement, but flag it as approximate for display.
    return { manilaDateKey: dateStr, manilaTimeLabel: null as string | null, approximate: true };
  }
  const utcInstant = zonedTimeToUtc(dateStr, timeET, US_MACRO_TIMEZONE);
  return {
    manilaDateKey: getDateKeyInZone(utcInstant, TRADER_TIMEZONE),
    manilaTimeLabel: getTimeLabelInZone(utcInstant, TRADER_TIMEZONE, "MNL"),
    approximate: false,
  };
}