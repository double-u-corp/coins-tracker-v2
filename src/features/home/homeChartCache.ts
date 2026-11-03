/**
 * Client cache for Home line-chart series between 3h polls.
 * Data only changes when cron writes a new price print (~:05 Manila slots).
 * Refreshing the page inside the same window reuses localStorage instead of
 * hitting /api/coins for every chart.
 */

const PREFIX = "coinsTracker:homeChart:v1:";

/** Manila cron hours (matches Home / Timing). */
const SLOT_HOURS = [2, 5, 8, 11, 14, 17, 20, 23] as const;

function manilaNowParts(): { h: number; m: number; dayKey: string } {
  const m = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return {
    h: m.getUTCHours(),
    m: m.getUTCMinutes(),
    dayKey: m.toISOString().slice(0, 10),
  };
}

/** Next poll slot boundary in Manila (hour). After that, cache is stale. */
export function nextManilaPollSlot(): { hour: number; dayKey: string; label: string } {
  const { h, m, dayKey } = manilaNowParts();
  const mins = h * 60 + m;
  for (const slot of SLOT_HOURS) {
    const slotMins = slot * 60 + 5;
    if (mins < slotMins) {
      return { hour: slot, dayKey, label: `${String(slot).padStart(2, "0")}:05` };
    }
  }
  // Past 23:05 → next is tomorrow 02:05
  const tomorrow = new Date(Date.now() + 8 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000);
  return {
    hour: 2,
    dayKey: tomorrow.toISOString().slice(0, 10),
    label: "02:05",
  };
}

/** Cache valid until this key changes (next Manila poll day+hour). */
export function currentPollWindowKey(): string {
  const next = nextManilaPollSlot();
  return `${next.dayKey}@${next.hour}`;
}

type CacheEnvelope<T> = {
  windowKey: string;
  savedAt: number;
  data: T;
};

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readChartCache<T>(key: string): T | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(PREFIX + key);
    if (!raw) return null;
    const env = JSON.parse(raw) as CacheEnvelope<T>;
    if (!env || env.windowKey !== currentPollWindowKey()) return null;
    return env.data ?? null;
  } catch {
    return null;
  }
}

export function writeChartCache<T>(key: string, data: T): void {
  const s = storage();
  if (!s) return;
  try {
    const env: CacheEnvelope<T> = {
      windowKey: currentPollWindowKey(),
      savedAt: Date.now(),
      data,
    };
    s.setItem(PREFIX + key, JSON.stringify(env));
  } catch {
    /* quota / private mode */
  }
}

/** Drop all home chart cache entries (optional force refresh). */
export function clearHomeChartCache(): void {
  const s = storage();
  if (!s) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => s.removeItem(k));
  } catch {
    /* ignore */
  }
}
