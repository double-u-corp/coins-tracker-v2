import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { CoinSummary } from "@/validators/recordSchema";
import type { PortfolioEntry, TransactionView } from "@/validators/transactionSchema";

interface CoinOption {
  symbol: string;
  name: string;
}

export type TradeType = "buy" | "sell" | "deposit" | "withdraw";

/**
 * Closed cycle history (never overwritten).
 * - "full_exit": sold to zero
 * - "recovered_reentry": sells already covered buys (house-money bag), then a new buy started the next cycle
 */
export interface ClosedTradeCycle {
  cycleIndex: number;
  startAt: string;
  endAt: string;
  daysHeld: number;
  realizedPnl: number;
  totalBoughtPhp: number;
  totalSoldPhp: number;
  avgBuyPrice: number | null;
  avgSellPrice: number | null;
  coinsBought: number;
  coinsSold: number;
  closeReason: "full_exit" | "recovered_reentry";
  /** Coins still held when cycle closed via recovered + new buy (house money snapshot). */
  freeCoinsCarried: number;
}

/** Per-coin analytics for “am I profitable?” and “what’s taking long?” */
export interface CoinAnalytics {
  symbol: string;
  name: string;
  holdings: number;
  /** Average cost of remaining units (PHP per coin) — current open lot only. */
  avgCost: number | null;
  /** Lifetime PHP spent on buys (all cycles). */
  totalBoughtPhp: number;
  /** Lifetime PHP received from sells (all cycles). */
  totalSoldPhp: number;
  /** Locked-in P&L from sells (average-cost method) — sum of all cycles. */
  realizedPnl: number;
  /** Open P&L: holdings * (currentPrice - avgCost). */
  unrealizedPnl: number | null;
  /** realized + unrealized (unrealized treated as 0 if unknown). */
  totalPnl: number | null;
  currentPrice: number | null;
  currentValue: number | null;
  /** Unrealized % vs avg cost. */
  unrealizedPct: number | null;
  /** First buy ever (lifetime). */
  firstBuyAt: string | null;
  lastBuyAt: string | null;
  lastSellAt: string | null;
  /**
   * Days held for the *current open* position only (since this cycle's first buy).
   * After a full exit + re-buy, this resets — closed cycles keep their own daysHeld.
   */
  daysSinceFirstBuy: number | null;
  /** Days current open lot has been below avg cost (approx). */
  daysUnderwater: number | null;
  isUnderwater: boolean;
  isInProfitOpen: boolean;
  winningSells: number;
  losingSells: number;
  avgDaysToSell: number | null;
  status: "in_profit" | "underwater" | "flat" | "flat_closed" | "no_position";
  /** Completed rounds — only when holdings hit 0. Trims do not create cycles. */
  closedCycles: ClosedTradeCycle[];
  /** Open cycle start (null if flat). */
  openCycleStartAt: string | null;
  /**
   * Open cycle only: sell proceeds so far >= buy cost this cycle.
   * Remaining coins are "house money" mentally — still one cycle until full exit.
   */
  openCycleCostRecovered: boolean;
  /** Realized P&L booked from trims inside the current open cycle. */
  openCycleRealizedPnl: number;
  /** PHP bought / sold so far in the open cycle. */
  openCycleBoughtPhp: number;
  openCycleSoldPhp: number;
}

/**
 * Walk buys/sells in time order with average-cost basis.
 * Realized P&L is booked on each sell; remaining lot carries avg cost.
 */
export function buildCoinAnalytics(
  serverPortfolio: PortfolioEntry[],
  txList: TransactionView[]
): CoinAnalytics[] {
  type LotState = {
    name: string;
    units: number;
    costPhp: number;
    realizedPnl: number;
    totalBoughtPhp: number;
    totalSoldPhp: number;
    firstBuyAt: string | null; // lifetime first buy
    lastBuyAt: string | null;
    lastSellAt: string | null;
    winningSells: number;
    losingSells: number;
    sellHoldDaysSum: number;
    sellCount: number;
    // --- current open cycle (resets when units → 0) ---
    cycleIndex: number;
    cycleStartAt: string | null;
    cycleBoughtPhp: number;
    cycleSoldPhp: number;
    cycleCoinsBought: number;
    cycleCoinsSold: number;
    cycleRealizedPnl: number;
    closedCycles: ClosedTradeCycle[];
  };

  const bySymbol = new Map<string, LotState>();

  const ensure = (symbol: string, name: string): LotState => {
    let s = bySymbol.get(symbol);
    if (!s) {
      s = {
        name,
        units: 0,
        costPhp: 0,
        realizedPnl: 0,
        totalBoughtPhp: 0,
        totalSoldPhp: 0,
        firstBuyAt: null,
        lastBuyAt: null,
        lastSellAt: null,
        winningSells: 0,
        losingSells: 0,
        sellHoldDaysSum: 0,
        sellCount: 0,
        cycleIndex: 0,
        cycleStartAt: null,
        cycleBoughtPhp: 0,
        cycleSoldPhp: 0,
        cycleCoinsBought: 0,
        cycleCoinsSold: 0,
        cycleRealizedPnl: 0,
        closedCycles: [],
      };
      bySymbol.set(symbol, s);
    }
    return s;
  };

  const sorted = [...txList]
    .filter((t) => t.symbol && t.symbol !== "PHP")
    .sort((a, b) => new Date(a.transactedAt).getTime() - new Date(b.transactedAt).getTime());

  for (const t of sorted) {
    const tType = String(t.type).toLowerCase();
    if (tType !== "buy" && tType !== "sell") continue;

    const symbol = t.symbol;
    const state = ensure(symbol, t.name || symbol);
    const coins = Number(t.coinAmount) || 0;
    const php = Number(t.phpAmount) || 0;
    const txTime = new Date(t.transactedAt).getTime();

    if (tType === "buy" && coins > 0) {
      const recoveredWhileHolding =
        state.units > 0 &&
        state.cycleBoughtPhp > 0 &&
        state.cycleSoldPhp >= state.cycleBoughtPhp;

      // (1) Flat → new cycle
      // (2) Still holding but cost already recovered → freeze prior cycle (free bag snapshot), then new cycle for fresh capital
      if (state.units <= 0 || recoveredWhileHolding) {
        if (recoveredWhileHolding && state.cycleStartAt) {
          const daysHeld = Math.max(
            0,
            Math.round((txTime - new Date(state.cycleStartAt).getTime()) / (1000 * 60 * 60 * 24))
          );
          state.closedCycles.push({
            cycleIndex: state.cycleIndex,
            startAt: state.cycleStartAt,
            endAt: t.transactedAt,
            daysHeld,
            realizedPnl: state.cycleSoldPhp - state.cycleBoughtPhp,
            totalBoughtPhp: state.cycleBoughtPhp,
            totalSoldPhp: state.cycleSoldPhp,
            avgBuyPrice:
              state.cycleCoinsBought > 0 ? state.cycleBoughtPhp / state.cycleCoinsBought : null,
            avgSellPrice:
              state.cycleCoinsSold > 0 ? state.cycleSoldPhp / state.cycleCoinsSold : null,
            coinsBought: state.cycleCoinsBought,
            coinsSold: state.cycleCoinsSold,
            closeReason: "recovered_reentry",
            freeCoinsCarried: state.units, // bag before this buy
          });
          // House-money bag: cost already returned via sells — remaining units carry 0 cost into next cycle
          state.costPhp = 0;
        }

        state.cycleIndex += 1;
        state.cycleStartAt = t.transactedAt;
        state.cycleBoughtPhp = 0;
        state.cycleSoldPhp = 0;
        state.cycleCoinsBought = 0;
        state.cycleCoinsSold = 0;
        state.cycleRealizedPnl = 0;
        if (state.units <= 0) {
          state.costPhp = 0;
        }
      }

      state.units += coins;
      state.costPhp += php;
      state.totalBoughtPhp += php;
      state.cycleBoughtPhp += php;
      state.cycleCoinsBought += coins;
      if (!state.firstBuyAt) state.firstBuyAt = t.transactedAt;
      state.lastBuyAt = t.transactedAt;
    } else if (tType === "sell" && coins > 0) {
      const avgCost = state.units > 0 ? state.costPhp / state.units : 0;
      const sellUnits = Math.min(coins, state.units > 0 ? state.units : coins);
      const costRemoved = avgCost * sellUnits;
      const proceeds = php;
      const realized = proceeds - costRemoved;
      state.realizedPnl += realized;
      state.cycleRealizedPnl += realized;
      state.totalSoldPhp += php;
      state.cycleSoldPhp += php;
      state.cycleCoinsSold += sellUnits;
      state.units = Math.max(0, state.units - sellUnits);
      state.costPhp = Math.max(0, state.costPhp - costRemoved);
      if (state.units < 1e-12) {
        state.units = 0;
        state.costPhp = 0;
      }
      state.lastSellAt = t.transactedAt;
      if (realized > 0) state.winningSells += 1;
      else state.losingSells += 1;

      // Hold days relative to *this cycle's* start (not lifetime first buy)
      const cycleStart = state.cycleStartAt || state.firstBuyAt;
      if (cycleStart) {
        const days = Math.max(
          0,
          Math.round((txTime - new Date(cycleStart).getTime()) / (1000 * 60 * 60 * 24))
        );
        state.sellHoldDaysSum += days;
        state.sellCount += 1;
      }

      // Full exit → freeze this cycle into history (re-entry later starts a new cycle)
      if (state.units <= 0 && state.cycleStartAt) {
        const daysHeld = Math.max(
          0,
          Math.round((txTime - new Date(state.cycleStartAt).getTime()) / (1000 * 60 * 60 * 24))
        );
        state.closedCycles.push({
          cycleIndex: state.cycleIndex,
          startAt: state.cycleStartAt,
          endAt: t.transactedAt,
          daysHeld,
          realizedPnl: state.cycleSoldPhp - state.cycleBoughtPhp,
          totalBoughtPhp: state.cycleBoughtPhp,
          totalSoldPhp: state.cycleSoldPhp,
          avgBuyPrice:
            state.cycleCoinsBought > 0 ? state.cycleBoughtPhp / state.cycleCoinsBought : null,
          avgSellPrice:
            state.cycleCoinsSold > 0 ? state.cycleSoldPhp / state.cycleCoinsSold : null,
          coinsBought: state.cycleCoinsBought,
          coinsSold: state.cycleCoinsSold,
          closeReason: "full_exit",
          freeCoinsCarried: 0,
        });

        state.cycleStartAt = null;
        state.cycleBoughtPhp = 0;
        state.cycleSoldPhp = 0;
        state.cycleCoinsBought = 0;
        state.cycleCoinsSold = 0;
        state.cycleRealizedPnl = 0;
      }
    }
  }

  // Merge with server portfolio for live price / display holdings when tx trail is thin
  const portfolioBySymbol = new Map(serverPortfolio.map((p) => [p.symbol, p]));
  const symbols = new Set<string>([...bySymbol.keys(), ...portfolioBySymbol.keys()]);

  const now = Date.now();
  const rows: CoinAnalytics[] = [];

  for (const symbol of symbols) {
    const state = bySymbol.get(symbol);
    const entry = portfolioBySymbol.get(symbol);
    const name = state?.name || entry?.name || symbol;

    const holdingsFromTx = state?.units ?? 0;
    const holdingsFromServer = entry?.holdings != null ? Number(entry.holdings) : 0;
    // Prefer server holdings when present (source of truth for on-hand)
    const holdings = holdingsFromServer > 0 || !state ? holdingsFromServer : holdingsFromTx;

    const costPhp = state?.costPhp ?? 0;
    const avgCost =
      holdingsFromTx > 0 && costPhp > 0
        ? costPhp / holdingsFromTx
        : holdings > 0 && entry?.spent != null && Number(entry.spent) > 0
          ? Number(entry.spent) / holdings
          : null;

    const currentValue =
      entry?.currentValue != null && !Number.isNaN(Number(entry.currentValue))
        ? Number(entry.currentValue)
        : null;
    const currentPrice =
      holdings > 0 && currentValue != null
        ? currentValue / holdings
        : entry && "currentPrice" in entry && (entry as any).currentPrice != null
          ? Number((entry as any).currentPrice)
          : null;

    const realizedPnl = state?.realizedPnl ?? 0;
    let unrealizedPnl: number | null = null;
    let unrealizedPct: number | null = null;
    if (holdings > 0 && avgCost != null && currentPrice != null) {
      unrealizedPnl = holdings * (currentPrice - avgCost);
      unrealizedPct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : null;
    } else if (holdings > 0 && currentValue != null && avgCost != null) {
      unrealizedPnl = currentValue - avgCost * holdings;
      unrealizedPct = avgCost > 0 ? (unrealizedPnl / (avgCost * holdings)) * 100 : null;
    }

    const totalPnl =
      unrealizedPnl != null ? realizedPnl + unrealizedPnl : state ? realizedPnl : null;

    const firstBuyAt = state?.firstBuyAt ?? null;
    // Current open cycle only — does not include closed history
    const openCycleStartAt = state?.cycleStartAt && (state.units > 0 || holdings > 0) ? state.cycleStartAt : null;
    const positionStart = openCycleStartAt || (holdings > 0 ? firstBuyAt : null);
    const daysSinceFirstBuy = positionStart
      ? Math.max(0, Math.round((now - new Date(positionStart).getTime()) / (1000 * 60 * 60 * 24)))
      : null;

    const isUnderwater =
      holdings > 0 && unrealizedPnl != null ? unrealizedPnl < 0 : false;
    const isInProfitOpen =
      holdings > 0 && unrealizedPnl != null ? unrealizedPnl > 0 : false;

    // Underwater clock for *current* open lot only
    const daysUnderwater =
      isUnderwater && daysSinceFirstBuy != null ? daysSinceFirstBuy : isUnderwater ? null : 0;

    let status: CoinAnalytics["status"] = "no_position";
    if (holdings > 0) {
      if (unrealizedPnl == null) status = "flat";
      else if (unrealizedPnl > 0) status = "in_profit";
      else if (unrealizedPnl < 0) status = "underwater";
      else status = "flat";
    } else if ((state?.totalBoughtPhp ?? 0) > 0) {
      status = realizedPnl > 0 ? "in_profit" : realizedPnl < 0 ? "underwater" : "flat_closed";
    }

    const avgDaysToSell =
      state && state.sellCount > 0 ? Math.round(state.sellHoldDaysSum / state.sellCount) : null;

    rows.push({
      symbol,
      name,
      holdings,
      avgCost,
      totalBoughtPhp: state?.totalBoughtPhp ?? 0,
      totalSoldPhp: state?.totalSoldPhp ?? 0,
      realizedPnl,
      unrealizedPnl,
      totalPnl,
      currentPrice,
      currentValue,
      unrealizedPct,
      firstBuyAt,
      lastBuyAt: state?.lastBuyAt ?? null,
      lastSellAt: state?.lastSellAt ?? null,
      daysSinceFirstBuy,
      daysUnderwater,
      isUnderwater,
      isInProfitOpen,
      winningSells: state?.winningSells ?? 0,
      losingSells: state?.losingSells ?? 0,
      avgDaysToSell,
      status,
      closedCycles: state?.closedCycles ? [...state.closedCycles] : [],
      openCycleStartAt: openCycleStartAt,
      openCycleCostRecovered:
        holdings > 0 &&
        (state?.cycleBoughtPhp ?? 0) > 0 &&
        (state?.cycleSoldPhp ?? 0) >= (state?.cycleBoughtPhp ?? 0),
      openCycleRealizedPnl: state?.cycleRealizedPnl ?? 0,
      openCycleBoughtPhp: state?.cycleBoughtPhp ?? 0,
      openCycleSoldPhp: state?.cycleSoldPhp ?? 0,
    });
  }

  // Longest underwater / slowest first for UI defaults
  rows.sort((a, b) => {
    const au = a.daysUnderwater ?? -1;
    const bu = b.daysUnderwater ?? -1;
    if (au !== bu) return bu - au;
    const ah = a.daysSinceFirstBuy ?? -1;
    const bh = b.daysSinceFirstBuy ?? -1;
    return bh - ah;
  });

  return rows;
}

/** Legacy net-spent floor for overview cards (compatible with existing TradeView). */
const processPortfolio = (
  serverPortfolio: PortfolioEntry[],
  txList: TransactionView[]
): PortfolioEntry[] => {
  const coinMap = new Map<string, { totalBoughtPhp: number; totalSoldPhp: number }>();

  for (const t of txList) {
    if (!t.symbol || t.symbol === "PHP") continue;
    const tType = String(t.type).toLowerCase();
    if (!coinMap.has(t.symbol)) {
      coinMap.set(t.symbol, { totalBoughtPhp: 0, totalSoldPhp: 0 });
    }
    const stats = coinMap.get(t.symbol)!;
    if (tType === "buy") stats.totalBoughtPhp += Number(t.phpAmount) || 0;
    else if (tType === "sell") stats.totalSoldPhp += Number(t.phpAmount) || 0;
  }

  return serverPortfolio.map((entry) => {
    const stats = coinMap.get(entry.symbol);
    const totalBought = stats ? stats.totalBoughtPhp : 0;
    const totalSold = stats ? stats.totalSoldPhp : 0;
    const netSpent = Math.max(0, totalBought - totalSold);
    const currentValue = entry.currentValue !== null ? Number(entry.currentValue) : null;
    const gainLoss = currentValue !== null ? currentValue - netSpent : null;
    return { ...entry, spent: netSpent, gainLoss };
  });
};

export function useTradeLogic() {
  const [coinOptions, setCoinOptions] = useState<CoinOption[]>([]);
  const [transactions, setTransactions] = useState<TransactionView[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [type, setType] = useState<TradeType>("buy");
  const [symbol, setSymbol] = useState("");
  const [phpAmount, setPhpAmount] = useState("");
  const [coinAmount, setCoinAmount] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastTransaction, setLastTransaction] = useState<TransactionView | null>(null);

  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCoinAmount, setEditCoinAmount] = useState("");
  const [editPhpAmount, setEditPhpAmount] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [coinsRes, txRes] = await Promise.all([fetch("/api/coins"), fetch("/api/transactions")]);
      if (!coinsRes.ok) throw new Error(`Failed to load coins (${coinsRes.status})`);
      if (!txRes.ok) throw new Error(`Failed to load transactions (${txRes.status})`);

      const coinsData = (await coinsRes.json()) as { coins: CoinSummary[] };
      const txData = (await txRes.json()) as {
        transactions: TransactionView[];
        portfolio: PortfolioEntry[];
      };

      const options = coinsData.coins.map((c) => ({ symbol: c.symbol, name: c.name }));
      setCoinOptions(options);
      setSymbol((prev) => prev || options[0]?.symbol || "");
      setTransactions(txData.transactions);

      const adjustedPortfolio = processPortfolio(txData.portfolio, txData.transactions);
      setPortfolio(adjustedPortfolio);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const coinAnalytics = useMemo(
    () => buildCoinAnalytics(portfolio, transactions),
    [portfolio, transactions]
  );

  const analyticsSummary = useMemo(() => {
    let realized = 0;
    let unrealized = 0;
    let hasUnrealized = false;
    let win = 0;
    let loss = 0;
    let longest: CoinAnalytics | null = null;

    for (const c of coinAnalytics) {
      realized += c.realizedPnl;
      if (c.unrealizedPnl != null) {
        unrealized += c.unrealizedPnl;
        hasUnrealized = true;
      }
      win += c.winningSells;
      loss += c.losingSells;
      if (c.isUnderwater) {
        if (
          !longest ||
          (c.daysUnderwater ?? 0) > (longest.daysUnderwater ?? 0)
        ) {
          longest = c;
        }
      }
    }

    const closed = win + loss;
    return {
      totalRealizedPnl: realized,
      totalUnrealizedPnl: hasUnrealized ? unrealized : null,
      totalPnl: hasUnrealized ? realized + unrealized : realized,
      sellWinRate: closed > 0 ? win / closed : null,
      winningSells: win,
      losingSells: loss,
      longestUnderwater: longest,
      underwaterCount: coinAnalytics.filter((c) => c.isUnderwater).length,
    };
  }, [coinAnalytics]);

  async function submitTransaction(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const isCashFlow = type === "deposit" || type === "withdraw";

    if (!isCashFlow && !symbol) {
      setSubmitError("Select a coin first");
      return;
    }
    const amount = Number(phpAmount);
    if (!phpAmount || Number.isNaN(amount) || amount <= 0) {
      setSubmitError("Enter a valid PHP amount greater than 0");
      return;
    }

    const coins = Number(coinAmount);
    if (!isCashFlow && (!coinAmount || Number.isNaN(coins) || coins <= 0)) {
      setSubmitError("Enter a valid number of coins greater than 0");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: isCashFlow ? null : symbol,
          type,
          phpAmount: amount,
          coinAmount: isCashFlow ? 0 : coins,
          customPrice: customPrice ? Number(customPrice) : undefined,
          transactedAt: new Date(date).toISOString(),
        }),
      });
      const data = (await res.json()) as { transaction?: TransactionView; error?: string };
      if (!res.ok || !data.transaction) {
        throw new Error(data.error ?? "Failed to record transaction");
      }
      setLastTransaction(data.transaction);
      setPhpAmount("");
      setCoinAmount("");
      setCustomPrice("");
      await load();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteTransaction(id: number) {
    setDeletingId(id);
    try {
      const res = await fetch("/api/transactions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to delete transaction");
      }
      await load();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  function startEdit(tx: TransactionView) {
    setEditingId(tx.id);
    setEditCoinAmount(String(tx.coinAmount));
    setEditPhpAmount(String(tx.phpAmount));
    setEditPrice(String(tx.price));
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit() {
    if (editingId === null) return;

    const coinAmountNum = Number(editCoinAmount);
    const phpAmountNum = Number(editPhpAmount);
    const priceNum = Number(editPrice);

    if (Number.isNaN(phpAmountNum) || phpAmountNum <= 0) {
      setEditError("Enter a valid PHP amount greater than 0");
      return;
    }

    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch("/api/transactions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          coinAmount: coinAmountNum,
          phpAmount: phpAmountNum,
          price: !Number.isNaN(priceNum) && priceNum > 0 ? priceNum : undefined,
        }),
      });
      const data = (await res.json()) as { transaction?: TransactionView; error?: string };
      if (!res.ok || !data.transaction) {
        throw new Error(data.error ?? "Failed to update transaction");
      }
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setEditSaving(false);
    }
  }

  return {
    coinOptions,
    transactions,
    portfolio,
    coinAnalytics,
    analyticsSummary,
    loading,
    loadError,
    type,
    setType,
    symbol,
    setSymbol,
    phpAmount,
    setPhpAmount,
    coinAmount,
    setCoinAmount,
    customPrice,
    setCustomPrice,
    date,
    setDate,
    submitting,
    submitError,
    lastTransaction,
    submitTransaction,
    deleteTransaction,
    deletingId,
    editingId,
    editCoinAmount,
    setEditCoinAmount,
    editPhpAmount,
    setEditPhpAmount,
    editPrice,
    setEditPrice,
    editError,
    editSaving,
    startEdit,
    cancelEdit,
    saveEdit,
  };
}
