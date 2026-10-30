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

/** Review date parsed from a coin journal note (agent “review by / valid until”). */
export interface JournalReviewDate {
  date: string; // YYYY-MM-DD
  source: "journal";
  entryId: number;
  title: string | null;
  daysUntil: number;
  urgency: "overdue" | "today" | "soon" | "later";
}

/** One Home card per coin: high + low + review date(s) combined. */
export interface MonitorCoinCard {
  symbol: string;
  name: string;
  currentPrice: number | null;
  high: TargetAlertCoin | null;
  low: TargetAlertCoin | null;
  /** Manage-page reviewUntil (single). */
  review: ReviewScheduleCoin | null;
  /** Dates from this coin’s journal notes (may be multiple). */
  journalReviews: JournalReviewDate[];
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

/** Pull YYYY-MM-DD review-by / valid-until / recheck-by from agent journal markdown. */
export function extractReviewDatesFromNotes(notes: string): string[] {
  if (!notes) return [];
  const found = new Set<string>();
  const patterns = [
    /review(?:\s*again)?\s*by\s*[:\-–—]?\s*\*?\*?\s*(\d{4}-\d{2}-\d{2})/gi,
    /valid\s*until\s*[:\-–—]?\s*\*?\*?\s*(\d{4}-\d{2}-\d{2})/gi,
    /recheck\s*by\s*[:\-–—]?\s*\*?\*?\s*(\d{4}-\d{2}-\d{2})/gi,
    /timeframe[^\n]{0,48}?(\d{4}-\d{2}-\d{2})/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(notes)) !== null) {
      found.add(m[1]);
    }
  }
  return [...found].sort();
}

function urgencyFromDays(daysUntil: number): JournalReviewDate["urgency"] {
  if (daysUntil < 0) return "overdue";
  if (daysUntil === 0) return "today";
  if (daysUntil <= 3) return "soon";
  return "later";
}

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
  /** Open-position hold days by symbol (current cycle). */
  const [daysHeldBySymbol, setDaysHeldBySymbol] = useState<Record<string, number>>({});
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
        if (cancelled) return;
        setPortfolio(data.portfolio || []);
        const txs = (data.transactions || []) as {
          symbol?: string;
          type?: string;
          coinAmount?: number;
          transactedAt?: string;
        }[];
        // Sort oldest → newest
        const sorted = [...txs].sort(
          (a, b) =>
            new Date(a.transactedAt || 0).getTime() - new Date(b.transactedAt || 0).getTime()
        );
        const units: Record<string, number> = {};
        const cycleStart: Record<string, string | null> = {};
        for (const tx of sorted) {
          const sym = (tx.symbol || "").toUpperCase();
          if (!sym) continue;
          const type = (tx.type || "").toLowerCase();
          const amt = Number(tx.coinAmount) || 0;
          if (!units[sym]) units[sym] = 0;
          if (type === "buy") {
            if (units[sym] <= 0) cycleStart[sym] = tx.transactedAt || null;
            units[sym] += amt;
          } else if (type === "sell") {
            units[sym] = Math.max(0, units[sym] - amt);
            if (units[sym] <= 1e-12) {
              units[sym] = 0;
              cycleStart[sym] = null;
            }
          }
        }
        const now = Date.now();
        const days: Record<string, number> = {};
        for (const [sym, start] of Object.entries(cycleStart)) {
          if (!start || (units[sym] || 0) <= 0) continue;
          const ms = now - new Date(start).getTime();
          days[sym] = Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
        }
        setDaysHeldBySymbol(days);
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

  /** Coins flagged onMonitor on Manage (Home Target & review). */
  const monitoredSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const coin of state.coins) {
      const on =
        (coin as { onMonitor?: boolean }).onMonitor === true ||
        // legacy: had a reviewUntil date before onMonitor existed
        (!!coin.reviewUntil && (coin as { onMonitor?: boolean }).onMonitor !== false);
      if (on) set.add(coin.symbol);
    }
    return set;
  }, [state.coins]);

  // Manage no longer stores a review date; keep empty list for type compat
  const reviewSchedule = useMemo<ReviewScheduleCoin[]>(() => [], []);

  const monitorCards = useMemo<MonitorCoinCard[]>(() => {
    const bySym = new Map<string, MonitorCoinCard>();
    const coinBySym = new Map(state.coins.map((c) => [c.symbol, c]));

    const ensure = (symbol: string, name: string, currentPrice: number | null) => {
      let row = bySym.get(symbol);
      if (!row) {
        row = { symbol, name, currentPrice, high: null, low: null, review: null, journalReviews: [] };
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
    // Ensure every onMonitor coin has a card (even without target proximity)
    for (const coin of state.coins) {
      if (!monitoredSymbols.has(coin.symbol)) continue;
      const row = ensure(coin.symbol, coin.name, coin.currentPrice);
      fillTargetsFromCoin(row);
    }

    for (const r of reviewSchedule) {
      if (!monitoredSymbols.has(r.symbol)) continue;
      const row = ensure(r.symbol, r.name, r.currentPrice);
      row.review = r;
      fillTargetsFromCoin(row);
    }

    // Journal-derived review dates (per coin; multiple notes → multiple dates)
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    for (const e of journalEntries) {
      if (!e.symbol) continue;
      if (!monitoredSymbols.has(e.symbol)) continue;
      const dates = extractReviewDatesFromNotes(e.notes || "");
      if (!dates.length) continue;
      const coin = coinBySym.get(e.symbol);
      const row = ensure(
        e.symbol,
        coin?.name || e.name || e.symbol,
        coin?.currentPrice ?? null
      );
      for (const date of dates) {
        if (row.journalReviews.some((j) => j.date === date && j.entryId === e.id)) continue;
        // Skip if same date already on Manage reviewUntil (avoid duplicate chip)
        if (row.review?.reviewUntil === date) continue;
        if (row.journalReviews.some((j) => j.date === date)) continue;
        const [y, m, d] = date.split("-").map(Number);
        const reviewUtc = Date.UTC(y, m - 1, d);
        const daysUntil = Math.round((reviewUtc - todayUtc) / 86_400_000);
        row.journalReviews.push({
          date,
          source: "journal",
          entryId: e.id,
          title: e.title || null,
          daysUntil,
          urgency: urgencyFromDays(daysUntil),
        });
        fillTargetsFromCoin(row);
      }
      row.journalReviews.sort((a, b) => a.daysUntil - b.daysUntil || a.date.localeCompare(b.date));
    }

    const rank = (c: MonitorCoinCard) => {
      let s = 0;
      if (c.high?.alertType === "reached" || c.low?.alertType === "reached") s -= 100;
      const urgencies = [
        c.review?.urgency,
        ...c.journalReviews.map((j) => j.urgency),
      ].filter(Boolean);
      if (urgencies.includes("overdue")) s -= 50;
      if (urgencies.includes("today")) s -= 40;
      if (c.high || c.low) s -= 10;
      if (c.review || c.journalReviews.length) s -= 5;
      return s;
    };

    // Only coins with Manage "Home monitor: Yes"
    const rows = [...bySym.values()].filter((c) => monitoredSymbols.has(c.symbol));
    return rows.sort(
      (a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol)
    );
  }, [targetAlerts, reviewSchedule, state.coins, journalEntries, monitoredSymbols]);

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
      // All entries (coin + general) so Target monitor can parse review-by dates
      const res = await fetch(`/api/journal?from=${from}`);
      if (!res.ok) throw new Error(`Failed to load journal (${res.status})`);
      const data = (await res.json()) as { entries: JournalEntryView[] };
      setJournalEntries(data.entries || []);
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
    daysHeldBySymbol,
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