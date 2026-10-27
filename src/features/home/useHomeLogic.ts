import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/features/auth/useAuth";
import type { CoinSummary, NewRecordAlert } from "@/validators/recordSchema";
import type { JournalEntryView } from "@/validators/journalSchema";

interface HomeState {
  coins: CoinSummary[];
  lastCronRun: string | null;
  lastCronStatus: string | null;
  loading: boolean;
  error: string | null;
}

export interface TargetAlertCoin {
  cardKey: string;
  symbol: string;
  name: string;
  targetType: "high" | "low";
  alertType: "reached" | "nearing";
  targetPrice: number;
  currentPrice: number;
  distance: number;
  status: string;
}

/** Coins with an agent "review by / valid until" date set on Manage. */
export interface ReviewScheduleCoin {
  symbol: string;
  name: string;
  reviewUntil: string; // YYYY-MM-DD
  currentPrice: number | null;
  /** negative = overdue days, 0 = today, positive = days left */
  daysUntil: number;
  urgency: "overdue" | "today" | "soon" | "later";
}

/** One Home card per coin: high + low + review date combined. */
export interface MonitorCoinCard {
  symbol: string;
  name: string;
  currentPrice: number | null;
  high: TargetAlertCoin | null;
  low: TargetAlertCoin | null;
  review: ReviewScheduleCoin | null;
}

interface PriceUpdateCoin {
  symbol: string;
  name: string;
}

export interface ManualRecordEntry {
  id: number;
  price: number;
  createdAt: string;
}

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

  const [selectedCoins, setSelectedCoins] = useState<string[]>([]);
  const [alertRecords, setAlertRecords] = useState<NewRecordAlert[]>([]);
  const [alertModalOpen, setAlertModalOpen] = useState(false);

  const [priceUpdateCoin, setPriceUpdateCoin] = useState<PriceUpdateCoin | null>(null);
  const [priceUpdateModalOpen, setPriceUpdateModalOpen] = useState(false);
  const [priceUpdateValue, setPriceUpdateValue] = useState("");
  const [priceUpdateSubmitting, setPriceUpdateSubmitting] = useState(false);
  const [priceUpdateError, setPriceUpdateError] = useState<string | null>(null);

  const [recentManualRecords, setRecentManualRecords] = useState<ManualRecordEntry[]>([]);
  const [recentManualLoading, setRecentManualLoading] = useState(false);
  const [recentManualError, setRecentManualError] = useState<string | null>(null);

  const [editingRecordId, setEditingRecordId] = useState<number | null>(null);
  const [editRecordValue, setEditRecordValue] = useState("");
  const [editRecordSaving, setEditRecordSaving] = useState(false);
  const [editRecordError, setEditRecordError] = useState<string | null>(null);

  const [portfolio, setPortfolio] = useState<any[]>([]);
  const [cronTriggering, setCronTriggering] = useState(false);

  const [journalEntries, setJournalEntries] = useState<JournalEntryView[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);


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
      // Non-critical
    }
  }, []);

  async function triggerCronManually() {
    setCronTriggering(true);

    try {
      const res = await fetch("/api/cron-manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = (await res.json()) as
        | { ok: true; ranAt: string; results: any[] }
        | { ok: false; error: string };

      if (!res.ok || !data.ok) {
        if (res.status === 401) {
          throw new Error("You must be logged in to trigger a manual run.");
        }
        throw new Error(!data.ok ? data.error : `Request failed with status ${res.status}`);
      }

      await loadSummary();
    } catch (err: any) {
      alert(err.message || "Failed to trigger manual update.");
    } finally {
      setCronTriggering(false);
    }
  }

  useEffect(() => {
    loadSummary();
    checkAlerts();
  }, [loadSummary, checkAlerts]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/transactions")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load transactions");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setPortfolio(data.portfolio || []);
      })
      .catch((err) => console.error(err));

    return () => {
      cancelled = true;
    };
  }, []);

  function closeAlertModal() {
    setAlertModalOpen(false);
    fetch("/api/coins?type=alerts")
      .then((res) => res.json())
      .then((data: { cronLogId: number | null }) => {
        if (data.cronLogId && typeof window !== "undefined") {
          window.localStorage.setItem(DISMISSED_KEY, String(data.cronLogId));
        }
      })
      .catch(() => {});
  }

  const filteredCoins = useMemo(() => {
    return state.coins.filter((coin) => selectedCoins.includes(coin.symbol));
  }, [state.coins, selectedCoins]);

  // Combined Target Alerts: Priority given to Reached, followed by Nearing (<5% distance)
  const targetAlerts = useMemo<TargetAlertCoin[]>(() => {
    if (!state.coins || state.coins.length === 0) return [];

    const alerts: TargetAlertCoin[] = [];

    for (const coin of state.coins) {
      if (coin.currentPrice === null || coin.currentPrice === undefined) continue;

      const current = Number(coin.currentPrice);
      const targetHigh = coin.targetHigh != null ? Number(coin.targetHigh) : null;
      const targetLow = coin.targetLow != null ? Number(coin.targetLow) : null;

      // Check Target High
      if (targetHigh !== null && !isNaN(targetHigh)) {
        const isReached = coin.targetHighReached || current >= targetHigh;
        const distPct = ((targetHigh - current) / targetHigh) * 100;

        if (isReached) {
          alerts.push({
            cardKey: `${coin.symbol}-high-reached`,
            symbol: coin.symbol,
            name: coin.name,
            targetType: "high",
            alertType: "reached",
            targetPrice: targetHigh,
            currentPrice: current,
            distance: 0,
            status: "Target High Reached!",
          });
        } else if (distPct <= 5) {
          alerts.push({
            cardKey: `${coin.symbol}-high-nearing`,
            symbol: coin.symbol,
            name: coin.name,
            targetType: "high",
            alertType: "nearing",
            targetPrice: targetHigh,
            currentPrice: current,
            distance: Math.max(0, distPct),
            status: `Within ${distPct.toFixed(1)}% of High`,
          });
        }
      }

      // Check Target Low
      if (targetLow !== null && !isNaN(targetLow)) {
        const isReached = coin.targetLowReached || current <= targetLow;
        const distPct = ((current - targetLow) / targetLow) * 100;

        if (isReached) {
          alerts.push({
            cardKey: `${coin.symbol}-low-reached`,
            symbol: coin.symbol,
            name: coin.name,
            targetType: "low",
            alertType: "reached",
            targetPrice: targetLow,
            currentPrice: current,
            distance: 0,
            status: "Target Low Reached!",
          });
        } else if (distPct <= 5) {
          alerts.push({
            cardKey: `${coin.symbol}-low-nearing`,
            symbol: coin.symbol,
            name: coin.name,
            targetType: "low",
            alertType: "nearing",
            targetPrice: targetLow,
            currentPrice: current,
            distance: Math.max(0, distPct),
            status: `Within ${distPct.toFixed(1)}% of Low`,
          });
        }
      }
    }

    return alerts.sort((a, b) => {
      if (a.alertType === "reached" && b.alertType !== "reached") return -1;
      if (a.alertType !== "reached" && b.alertType === "reached") return 1;
      return a.distance - b.distance;
    });
  }, [state.coins]);

  const reviewSchedule = useMemo<ReviewScheduleCoin[]>(() => {
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

    const rows: ReviewScheduleCoin[] = [];
    for (const coin of state.coins) {
      const raw = coin.reviewUntil;
      if (!raw) continue;
      const reviewUntil = String(raw).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewUntil)) continue;
      const [y, m, d] = reviewUntil.split("-").map(Number);
      const reviewUtc = Date.UTC(y, m - 1, d);
      const daysUntil = Math.round((reviewUtc - todayUtc) / 86_400_000);
      let urgency: ReviewScheduleCoin["urgency"] = "later";
      if (daysUntil < 0) urgency = "overdue";
      else if (daysUntil === 0) urgency = "today";
      else if (daysUntil <= 3) urgency = "soon";
      rows.push({
        symbol: coin.symbol,
        name: coin.name,
        reviewUntil,
        currentPrice: coin.currentPrice,
        daysUntil,
        urgency,
      });
    }
    return rows.sort((a, b) => a.daysUntil - b.daysUntil || a.symbol.localeCompare(b.symbol));
  }, [state.coins]);

  const monitorCards = useMemo<MonitorCoinCard[]>(() => {
    const bySym = new Map<string, MonitorCoinCard>();
    const coinBySym = new Map(state.coins.map((c) => [c.symbol, c]));

    const ensure = (symbol: string, name: string, currentPrice: number | null) => {
      let row = bySym.get(symbol);
      if (!row) {
        row = { symbol, name, currentPrice, high: null, low: null, review: null };
        bySym.set(symbol, row);
      } else if (currentPrice != null && row.currentPrice == null) {
        row.currentPrice = currentPrice;
      }
      return row;
    };

    /** Attach target levels even when outside the 5% band (for review-date cards). */
    const fillTargetsFromCoin = (row: MonitorCoinCard) => {
      const coin = coinBySym.get(row.symbol);
      if (!coin) return;
      const current = coin.currentPrice != null ? Number(coin.currentPrice) : null;

      if (!row.high && coin.targetHigh != null && !isNaN(Number(coin.targetHigh))) {
        const th = Number(coin.targetHigh);
        const isReached = current != null && (coin.targetHighReached || current >= th);
        const distPct =
          current != null && th > 0 ? Math.max(0, ((th - current) / th) * 100) : 0;
        row.high = {
          cardKey: `${row.symbol}-high-watch`,
          symbol: row.symbol,
          name: row.name,
          targetType: "high",
          alertType: isReached ? "reached" : "nearing",
          targetPrice: th,
          currentPrice: current ?? 0,
          distance: distPct,
          status: isReached
            ? "Target High Reached!"
            : distPct <= 5
              ? `Within ${distPct.toFixed(1)}% of High`
              : `High target · ${distPct.toFixed(1)}% away`,
        };
      }

      if (!row.low && coin.targetLow != null && !isNaN(Number(coin.targetLow))) {
        const tl = Number(coin.targetLow);
        const isReached = current != null && (coin.targetLowReached || current <= tl);
        const distPct =
          current != null && tl > 0 ? Math.max(0, ((current - tl) / tl) * 100) : 0;
        row.low = {
          cardKey: `${row.symbol}-low-watch`,
          symbol: row.symbol,
          name: row.name,
          targetType: "low",
          alertType: isReached ? "reached" : "nearing",
          targetPrice: tl,
          currentPrice: current ?? 0,
          distance: distPct,
          status: isReached
            ? "Target Low Reached!"
            : distPct <= 5
              ? `Within ${distPct.toFixed(1)}% of Low`
              : `Low target · ${distPct.toFixed(1)}% away`,
        };
      }
    };

    for (const a of targetAlerts) {
      const row = ensure(a.symbol, a.name, a.currentPrice);
      if (a.targetType === "high") row.high = a;
      else row.low = a;
    }
    for (const r of reviewSchedule) {
      const row = ensure(r.symbol, r.name, r.currentPrice);
      row.review = r;
      // Always show high/low levels on review cards, even if far from 5% band
      fillTargetsFromCoin(row);
    }

    const rank = (c: MonitorCoinCard) => {
      let s = 0;
      if (c.high?.alertType === "reached" || c.low?.alertType === "reached") s -= 100;
      if (c.review?.urgency === "overdue") s -= 50;
      if (c.review?.urgency === "today") s -= 40;
      if (c.high || c.low) s -= 10;
      if (c.review) s -= 5;
      return s;
    };

    return [...bySym.values()].sort(
      (a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol)
    );
  }, [targetAlerts, reviewSchedule, state.coins]);

  const loadRecentManualRecords = useCallback(async (symbol: string) => {
    setRecentManualLoading(true);
    setRecentManualError(null);
    try {
      const res = await fetch(`/api/records?symbol=${symbol}&limit=10`);
      if (!res.ok) throw new Error(`Failed to load recent entries (${res.status})`);
      const data = (await res.json()) as { records: ManualRecordEntry[] };
      setRecentManualRecords(data.records);
    } catch (err) {
      setRecentManualError((err as Error).message);
    } finally {
      setRecentManualLoading(false);
    }
  }, []);

  function openPriceUpdateModal(coin: PriceUpdateCoin) {
    setPriceUpdateCoin(coin);
    setPriceUpdateValue("");
    setPriceUpdateError(null);
    setEditingRecordId(null);
    setEditRecordError(null);
    setPriceUpdateModalOpen(true);
    loadRecentManualRecords(coin.symbol);
  }

  function closePriceUpdateModal() {
    setPriceUpdateModalOpen(false);
    setPriceUpdateCoin(null);
    setPriceUpdateError(null);
    setRecentManualRecords([]);
    setEditingRecordId(null);
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
      setPriceUpdateValue("");
      await Promise.all([loadSummary(), loadRecentManualRecords(priceUpdateCoin.symbol)]);
    } catch (err) {
      setPriceUpdateError((err as Error).message);
    } finally {
      setPriceUpdateSubmitting(false);
    }
  }

  function startEditRecord(record: ManualRecordEntry) {
    setEditingRecordId(record.id);
    setEditRecordValue(String(record.price));
    setEditRecordError(null);
  }

  function cancelEditRecord() {
    setEditingRecordId(null);
    setEditRecordError(null);
  }

  async function saveEditRecord() {
    if (editingRecordId === null || !priceUpdateCoin) return;

    const price = Number(editRecordValue);
    if (!editRecordValue || Number.isNaN(price) || price <= 0) {
      setEditRecordError("Enter a valid price greater than 0");
      return;
    }

    setEditRecordSaving(true);
    setEditRecordError(null);
    try {
      const res = await fetch("/api/records", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingRecordId, price }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to update entry");
      }
      setEditingRecordId(null);
      await Promise.all([loadSummary(), loadRecentManualRecords(priceUpdateCoin.symbol)]);
    } catch (err) {
      setEditRecordError((err as Error).message);
    } finally {
      setEditRecordSaving(false);
    }
  }

  const loadJournal = useCallback(async () => {
    setJournalLoading(true);
    setJournalError(null);
    try {
      const from = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      // empty symbol → general notes only (server/client filter)
      const res = await fetch(`/api/journal?symbol=&from=${from}`);
      if (!res.ok) throw new Error(`Failed to load journal (${res.status})`);
      const data = (await res.json()) as { entries: JournalEntryView[] };
      const general = (data.entries || []).filter((e) => !e.symbol);
      setJournalEntries(general);
    } catch (err) {
      setJournalError((err as Error).message);
      setJournalEntries([]);
    } finally {
      setJournalLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJournal();
  }, [loadJournal]);

  async function addJournalEntry(input: {
    symbol: string | null;
    entryDate: string;
    title: string;
    notes: string;
  }) {
    const res = await fetch("/api/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, symbol: input.symbol || null }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(
        (errData as { error?: string; message?: string }).error ||
          (errData as { message?: string }).message ||
          "Failed to save journal entry"
      );
    }
    await loadJournal();
  }

  async function updateJournalEntry(id: number, input: { title?: string; notes?: string }) {
    const res = await fetch("/api/journal", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...input }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(
        (errData as { error?: string; message?: string }).error ||
          (errData as { message?: string }).message ||
          "Failed to update entry"
      );
    }
    await loadJournal();
  }

  async function deleteJournalEntry(id: number) {
    const res = await fetch("/api/journal", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error("Failed to delete journal entry");
    await loadJournal();
  }

  return {
    ...state,
    allCoins: state.coins,
    coins: filteredCoins,
    targetAlerts,
    reviewSchedule,
    monitorCards,
    selectedCoins,
    setSelectedCoins,
    portfolio,
    canUpdatePrice: authenticated,
    authenticated,
    journalEntries,
    journalLoading,
    journalError,
    addJournalEntry,
    updateJournalEntry,
    deleteJournalEntry,
    priceUpdateCoin,
    priceUpdateModalOpen,
    priceUpdateValue,
    setPriceUpdateValue,
    priceUpdateSubmitting,
    priceUpdateError,
    openPriceUpdateModal,
    closePriceUpdateModal,
    submitPriceUpdate,
    recentManualRecords,
    recentManualLoading,
    recentManualError,
    editingRecordId,
    editRecordValue,
    setEditRecordValue,
    editRecordSaving,
    editRecordError,
    startEditRecord,
    cancelEditRecord,
    saveEditRecord,
    alertRecords,
    alertModalOpen,
    closeAlertModal,
    cronTriggering,
    triggerCronManually,
  };
}