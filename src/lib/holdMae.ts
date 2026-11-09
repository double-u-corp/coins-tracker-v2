/**
 * Client helper for MAE / hold floors.
 * Source of truth is DB (HoldFloor) via /api/hold-floor.
 * Memory cache avoids hammering the API while rendering many cards.
 */
export type HoldMae = {
  symbol: string;
  worstPct: number;
  worstPrice: number;
  avgAtUpdate: number;
  updatedAt: string;
  /** DB id when loaded from server */
  id?: number;
  open?: boolean;
};

type FloorApi = {
  id: number;
  symbol: string;
  avgCost: number;
  worstPrice: number;
  worstPct: number;
  updatedAt: string;
  closedAt: string | null;
};

const mem = new Map<string, HoldMae>();
let hydratePromise: Promise<void> | null = null;

function fromApi(f: FloorApi): HoldMae {
  return {
    symbol: f.symbol.toUpperCase(),
    worstPct: f.worstPct,
    worstPrice: f.worstPrice,
    avgAtUpdate: f.avgCost,
    updatedAt: f.updatedAt,
    id: f.id,
    open: f.closedAt == null,
  };
}

/** Load open floors once per session (or force). */
export async function hydrateHoldMaeFromDb(force = false): Promise<void> {
  if (typeof window === "undefined") return;
  if (!force && hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const res = await fetch("/api/hold-floor?open=1", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { floors?: FloorApi[] };
      for (const f of data.floors || []) {
        mem.set(f.symbol.toUpperCase(), fromApi(f));
      }
    } catch {
      /* offline */
    }
  })();
  return hydratePromise;
}

export function getHoldMae(symbol: string): HoldMae | null {
  return mem.get(symbol.toUpperCase()) || null;
}

/**
 * Persist deepest drawdown vs avg for an open bag.
 * Call when rendering held cards; returns updated MAE (optimistic + server).
 */
export function updateHoldMae(symbol: string, avg: number, price: number): HoldMae | null {
  if (!(avg > 0) || !(price > 0)) return getHoldMae(symbol);
  const key = symbol.toUpperCase();
  const prev = mem.get(key);
  const worstPrice = prev ? Math.min(prev.worstPrice, price) : price;
  const worstPct = (worstPrice - avg) / avg;
  const next: HoldMae = {
    symbol: key,
    worstPct,
    worstPrice,
    avgAtUpdate: avg,
    updatedAt: new Date().toISOString(),
    id: prev?.id,
    open: true,
  };
  mem.set(key, next);

  // Fire-and-forget DB write (cron also refreshes every poll)
  if (typeof window !== "undefined") {
    void fetch("/api/hold-floor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: key, avgCost: avg, price }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { floor?: FloorApi };
        if (data.floor) mem.set(key, fromApi(data.floor));
      })
      .catch(() => {});
  }
  return next;
}

export function clearHoldMae(symbol: string) {
  const key = symbol.toUpperCase();
  mem.delete(key);
  if (typeof window !== "undefined") {
    void fetch("/api/hold-floor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "close", symbol: key }),
    }).catch(() => {});
  }
}

export function levelWasTouched(
  mae: HoldMae | null | undefined,
  levelPct: number
): boolean {
  if (!mae) return false;
  return mae.worstPct <= levelPct + 1e-9;
}

export function formatMaeBadge(mae: HoldMae | null | undefined): string | null {
  if (!mae || mae.worstPct >= -0.005) return null;
  const p = mae.worstPct * 100;
  const s = Math.abs(p - Math.round(p)) < 0.05 ? String(Math.round(p)) : p.toFixed(1);
  return `Floor ${s}%`;
}
