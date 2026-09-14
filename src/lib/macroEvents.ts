import { usEventToManila } from "./timezone";

export interface MacroEvent {
  date: string; // "YYYY-MM-DD" — official US Eastern Time (ET) calendar date
  timeET?: string; // "HH:mm" 24h, release time in ET, if known
  title: string;
  type: "NFP" | "CPI" | "PCE" | "FOMC" | "EXPIRY" | "OTHER";
  severity: "high" | "medium";
  // Derived, not requested from the AI.
  manilaDateKey?: string;
  manilaTimeLabel?: string | null;
  approximateTime?: boolean;
}

export function extractJsonArray(text: string): MacroEvent[] {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "");
  cleaned = cleaned.replace(/\s*```$/, "");

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fallback repair path for any non-schema-enforced response that got
    // truncated (shouldn't normally happen once strict json_schema is in
    // use, but kept as a safety net).
    const firstBracket = cleaned.indexOf("[");
    const firstBrace = cleaned.indexOf("{");
    const start = [firstBracket, firstBrace].filter((i) => i !== -1).sort((a, b) => a - b)[0];
    if (start === undefined) throw new Error("No valid calendar data returned.");
    const truncated = cleaned.substring(start);
    const lastBrace = truncated.lastIndexOf("}");
    if (lastBrace === -1) throw new Error("AI response was cut off. Click Re-Scan to retry.");
    const repaired = truncated.substring(0, lastBrace + 1) + (truncated.trim().startsWith("[") ? "]" : "");
    try {
      parsed = JSON.parse(repaired);
    } catch {
      throw new Error("AI response was cut off. Click Re-Scan to retry.");
    }
  }

  // Strict schema mode returns { events: [...] }; tolerate a bare array too.
  const events: MacroEvent[] = Array.isArray(parsed) ? parsed : parsed?.events || [];

  // Schema mode uses "" to mean "unknown time" (strict mode can't have
  // truly optional keys) — normalize that to undefined for the rest of the
  // app, which already treats a missing timeET as "unknown."
  return events.map((evt) => ({
    ...evt,
    timeET: evt.timeET && evt.timeET.trim() ? evt.timeET : undefined,
  }));
}

/** Attaches Manila-local placement/time-label to each event so a Manila-based
 * trader sees the day/time an event actually lands for them, not the raw US
 * ET date it was reported against. */
export function attachManilaFields(events: MacroEvent[]): MacroEvent[] {
  return events.map((evt) => {
    const { manilaDateKey, manilaTimeLabel, approximate } = usEventToManila(evt.date, evt.timeET);
    return { ...evt, manilaDateKey, manilaTimeLabel, approximateTime: approximate };
  });
}

/** Sorts events chronologically by their real Manila-local instant, falling
 * back to the raw ET date when no time was given. */
export function sortEventsChronologically(events: MacroEvent[]): MacroEvent[] {
  return [...events].sort((a, b) => {
    const aKey = `${a.manilaDateKey || a.date}T${a.timeET || "00:00"}`;
    const bKey = `${b.manilaDateKey || b.date}T${b.timeET || "00:00"}`;
    return aKey.localeCompare(bKey);
  });
}