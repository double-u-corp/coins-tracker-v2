import { useEffect, useState } from "react";
import type { CoinSummary } from "@/validators/recordSchema";

export interface AvailableCoin {
  symbol: string;
  price: number;
  suggestedName: string;
  alreadyMonitored: boolean;
}

export function useManageCoinsLogic() {
  const [monitored, setMonitored] = useState<CoinSummary[]>([]);
  const [monitoredLoading, setMonitoredLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AvailableCoin[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingSymbol, setPendingSymbol] = useState<string | null>(null);

  async function loadMonitored() {
    setMonitoredLoading(true);
    try {
      const res = await fetch("/api/coins");
      const data = (await res.json()) as { coins: CoinSummary[] };
      setMonitored(data.coins);
    } finally {
      setMonitoredLoading(false);
    }
  }

  useEffect(() => {
    loadMonitored();
  }, []);

  // Debounce the search-as-you-type call to Coins.ph.
  useEffect(() => {
    const handle = setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const res = await fetch(`/api/available-coins?q=${encodeURIComponent(query.trim())}`);
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const data = (await res.json()) as { coins: AvailableCoin[] };
        setSearchResults(data.coins);
      } catch (err) {
        setSearchError((err as Error).message);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(handle);
  }, [query]);

  async function addCoin(symbol: string, name: string) {
    setActionError(null);
    setPendingSymbol(symbol);
    try {
      const res = await fetch("/api/coins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, name }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `Failed to add ${symbol}`);
      }
      await loadMonitored();
      setSearchResults((prev) =>
        prev.map((c) => (c.symbol === symbol ? { ...c, alreadyMonitored: true } : c))
      );
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPendingSymbol(null);
    }
  }

  /**
   * Sets a starting price for a coin without any live fetch (POST
   * /api/records). Intended for right after adding a coin manually, since
   * those are often exactly the coins the live ticker API can't reach.
   * Non-fatal on failure — surfaces as an error banner but doesn't affect
   * whether the coin itself was added.
   */
  async function setStartingPrice(symbol: string, price: number) {
    setActionError(null);
    try {
      const res = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, price }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `Failed to set starting price for ${symbol}`);
      }
      await loadMonitored();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  async function removeCoin(symbol: string) {
    setActionError(null);
    setPendingSymbol(symbol);
    try {
      const res = await fetch("/api/coins", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `Failed to remove ${symbol}`);
      }
      await loadMonitored();
      setSearchResults((prev) =>
        prev.map((c) => (c.symbol === symbol ? { ...c, alreadyMonitored: false } : c))
      );
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPendingSymbol(null);
    }
  }

  async function updateTarget(symbol: string, targetHigh: number | null, targetLow: number | null) {
    setActionError(null);
    try {
      const res = await fetch("/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, targetHigh, targetLow }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `Failed to update target for ${symbol}`);
      }
      await loadMonitored();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  return {
    monitored,
    monitoredLoading,
    query,
    setQuery,
    searchResults,
    searchLoading,
    searchError,
    actionError,
    pendingSymbol,
    addCoin,
    setStartingPrice,
    removeCoin,
    updateTarget,
  };
}
