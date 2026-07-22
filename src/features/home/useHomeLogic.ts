import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/features/auth/useAuth";
import type { CoinSummary, NewRecordAlert } from "@/validators/recordSchema";

interface HomeState {
  coins: CoinSummary[];
  lastCronRun: string | null;
  lastCronStatus: string | null;
  loading: boolean;
  error: string | null;
}

export interface ReachedTarget {
  symbol: string;
  name: string;
  type: "high" | "low";
  value: number;
}

interface PriceUpdateCoin {
  symbol: string;
  name: string;
}

// Remembers which cron run's new-record alert the user has already
// dismissed, so the modal doesn't reopen for the same run on every page
// visit — but does reopen for any genuinely new run that sets a record.
const DISMISSED_KEY = "coins-tracker:dismissed-alert-cron-log-id";

export function useHomeLogic() {
  const { authenticated } = useAuth();

  const [state, setState] = useState<HomeState>({
    coins: [],
    lastCronRun: null,
    lastCronStatus: null,
    loading: true,
    error: null,
  });

  const [alertRecords, setAlertRecords] = useState<NewRecordAlert[]>([]);
  const [alertModalOpen, setAlertModalOpen] = useState(false);

  // Session-only dismiss for the target-reached banner: tracks which set of
  // reached targets was last dismissed, so dismissing it doesn't hide a
  // *different* coin newly reaching its target afterward.
  const [dismissedTargetsKey, setDismissedTargetsKey] = useState<string | null>(null);

  // Manual price update — click a coin's symbol in the table to open a
  // modal with a single price input. Only reachable when logged in: the
  // table cell isn't even a button (no onClick) when authenticated is
  // false, so there's nothing to click into this flow from without a
  // session. For coins added via Manage Coins' "Add a coin manually" flow
  // (e.g. TH) that have no live price feed, this is the only way their
  // price ever changes.
  const [priceUpdateCoin, setPriceUpdateCoin] = useState<PriceUpdateCoin | null>(null);
  const [priceUpdateModalOpen, setPriceUpdateModalOpen] = useState(false);
  const [priceUpdateValue, setPriceUpdateValue] = useState("");
  const [priceUpdateSubmitting, setPriceUpdateSubmitting] = useState(false);
  const [priceUpdateError, setPriceUpdateError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/coins");
      if (!res.ok) throw new Error(`Failed to load coins (${res.status})`);
      const data = (await res.json()) as {
        coins: CoinSummary[];
        lastCronRun: string | null;
        lastCronStatus: string | null;
      };
      setState({
        coins: data.coins,
        lastCronRun: data.lastCronRun,
        lastCronStatus: data.lastCronStatus,
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((prev) => ({ ...prev, loading: false, error: (err as Error).message }));
    }
  }, []);

  const checkAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/coins?type=alerts");
      if (!res.ok) return;
      const data = (await res.json()) as { cronLogId: number | null; newRecords: NewRecordAlert[] };
      if (!data.cronLogId || data.newRecords.length === 0) return;

      const dismissedId = typeof window !== "undefined" ? window.localStorage.getItem(DISMISSED_KEY) : null;
      if (dismissedId === String(data.cronLogId)) return;

      setAlertRecords(data.newRecords);
      setAlertModalOpen(true);
    } catch {
      // Non-critical — silently skip the alert check on failure.
    }
  }, []);

  useEffect(() => {
    loadSummary();
    checkAlerts();
  }, [loadSummary, checkAlerts]);

  function closeAlertModal() {
    setAlertModalOpen(false);
    fetch("/api/coins?type=alerts")
      .then((res) => res.json())
      .then((data: { cronLogId: number | null }) => {
        if (data.cronLogId && typeof window !== "undefined") {
          window.localStorage.setItem(DISMISSED_KEY, String(data.cronLogId));
        }
      })
      .catch(() => {
        /* non-critical */
      });
  }

  const reachedTargets: ReachedTarget[] = useMemo(() => {
    const entries: ReachedTarget[] = [];
    for (const coin of state.coins) {
      if (coin.targetHighReached && coin.targetHigh !== null) {
        entries.push({ symbol: coin.symbol, name: coin.name, type: "high", value: coin.targetHigh });
      }
      if (coin.targetLowReached && coin.targetLow !== null) {
        entries.push({ symbol: coin.symbol, name: coin.name, type: "low", value: coin.targetLow });
      }
    }
    return entries;
  }, [state.coins]);

  const reachedTargetsKey = reachedTargets.map((t) => `${t.symbol}-${t.type}`).sort().join(",");
  const showTargetBanner = reachedTargets.length > 0 && reachedTargetsKey !== dismissedTargetsKey;

  function dismissTargetBanner() {
    setDismissedTargetsKey(reachedTargetsKey);
  }

  function openPriceUpdateModal(coin: PriceUpdateCoin) {
    setPriceUpdateCoin(coin);
    setPriceUpdateValue("");
    setPriceUpdateError(null);
    setPriceUpdateModalOpen(true);
  }

  function closePriceUpdateModal() {
    setPriceUpdateModalOpen(false);
    setPriceUpdateCoin(null);
    setPriceUpdateError(null);
  }

  async function submitPriceUpdate() {
    if (!priceUpdateCoin) return;
    setPriceUpdateError(null);

    const price = Number(priceUpdateValue);
    if (!priceUpdateValue || Number.isNaN(price) || price <= 0) {
      setPriceUpdateError("Enter a valid price greater than 0");
      return;
    }

    setPriceUpdateSubmitting(true);
    try {
      const res = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: priceUpdateCoin.symbol, price }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to update price");
      }
      await loadSummary();
      closePriceUpdateModal();
    } catch (err) {
      setPriceUpdateError((err as Error).message);
    } finally {
      setPriceUpdateSubmitting(false);
    }
  }

  return {
    ...state,
    canUpdatePrice: authenticated,
    priceUpdateCoin,
    priceUpdateModalOpen,
    priceUpdateValue,
    setPriceUpdateValue,
    priceUpdateSubmitting,
    priceUpdateError,
    openPriceUpdateModal,
    closePriceUpdateModal,
    submitPriceUpdate,
    alertRecords,
    alertModalOpen,
    closeAlertModal,
    reachedTargets,
    showTargetBanner,
    dismissTargetBanner,
  };
}
