import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/features/auth/useAuth";
import type { CoinSummary, NewRecordAlert } from "@/validators/recordSchema";

export interface CronRunResult {
  symbol: string;
  price: number;
  high: number;
  low: number;
  isNewHigh: boolean;
  isNewLow: boolean;
}

interface HomeState {
  coins: CoinSummary[];
  lastCronRun: string | null;
  lastCronStatus: string | null;
  loading: boolean;
  error: string | null;
}

interface CronRunState {
  running: boolean;
  error: string | null;
  results: CronRunResult[] | null;
}

export interface ReachedTarget {
  symbol: string;
  name: string;
  type: "high" | "low";
  value: number;
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

  const [cronRun, setCronRun] = useState<CronRunState>({ running: false, error: null, results: null });

  const [alertRecords, setAlertRecords] = useState<NewRecordAlert[]>([]);
  const [alertModalOpen, setAlertModalOpen] = useState(false);

  // Bumped after each successful manual cron run — passed to <NewsSection
  // refreshSignal={newsRefreshTick} /> so it resets to page 1 and reloads,
  // since a cron run is what generates new signals/articles. NewsSection
  // otherwise manages its own fetching/pagination independently.
  const [newsRefreshTick, setNewsRefreshTick] = useState(0);

  // Session-only dismiss for the target-reached banner: tracks which set of
  // reached targets was last dismissed, so dismissing it doesn't hide a
  // *different* coin newly reaching its target afterward.
  const [dismissedTargetsKey, setDismissedTargetsKey] = useState<string | null>(null);

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

  const runCronNow = useCallback(async () => {
    setCronRun({ running: true, error: null, results: null });
    try {
      const res = await fetch("/api/cron-manual", { method: "POST" });
      const data = (await res.json()) as
        | { ok: true; results: CronRunResult[] }
        | { ok: false; error: string };

      if (!("ok" in data) || !data.ok) {
        throw new Error("error" in data ? data.error : "Cron run failed");
      }

      setCronRun({ running: false, error: null, results: data.results });
      await loadSummary(); // refresh the table + banner with the new data
      await checkAlerts(); // this run may have set a new high/low
      setNewsRefreshTick((prev) => prev + 1); // this run may have generated new signals/articles
    } catch (err) {
      setCronRun({ running: false, error: (err as Error).message, results: null });
    }
  }, [loadSummary, checkAlerts]);

  return {
    ...state,
    cronRun,
    runCronNow,
    canRunCron: authenticated,
    alertRecords,
    alertModalOpen,
    closeAlertModal,
    reachedTargets,
    showTargetBanner,
    dismissTargetBanner,
    newsRefreshTick,
  };
}
