import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { CoinSummary } from "@/validators/recordSchema";
import type { PortfolioEntry, TransactionView } from "@/validators/transactionSchema";

interface CoinOption {
  symbol: string;
  name: string;
}

export type TradeType = "buy" | "sell";
export type TradeMode = "live" | "manual";

export function useTradeLogic() {
  const [coinOptions, setCoinOptions] = useState<CoinOption[]>([]);
  const [transactions, setTransactions] = useState<TransactionView[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [type, setType] = useState<TradeType>("buy");
  const [mode, setMode] = useState<TradeMode>("live");
  const [symbol, setSymbol] = useState("");
  const [phpAmount, setPhpAmount] = useState(""); // used when type === "buy"
  const [coinAmount, setCoinAmount] = useState(""); // used when type === "sell"
  const [manualPrice, setManualPrice] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastTransaction, setLastTransaction] = useState<TransactionView | null>(null);

  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCoinAmount, setEditCoinAmount] = useState("");
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
      const txData = (await txRes.json()) as { transactions: TransactionView[]; portfolio: PortfolioEntry[] };

      setCoinOptions(coinsData.coins.map((c) => ({ symbol: c.symbol, name: c.name })));
      setTransactions(txData.transactions);
      setPortfolio(txData.portfolio);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submitTransaction(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (!symbol) {
      setSubmitError("Select a coin first");
      return;
    }

    const payload: Record<string, unknown> = { symbol, type };

    if (type === "buy") {
      const amount = Number(phpAmount);
      if (!phpAmount || Number.isNaN(amount) || amount <= 0) {
        setSubmitError("Enter a valid PHP amount greater than 0");
        return;
      }
      payload.phpAmount = amount;
    } else {
      const amount = Number(coinAmount);
      if (!coinAmount || Number.isNaN(amount) || amount <= 0) {
        setSubmitError("Enter a valid coin amount greater than 0");
        return;
      }
      payload.coinAmount = amount;
    }

    if (mode === "manual") {
      const priceNum = Number(manualPrice);
      if (!manualPrice || Number.isNaN(priceNum) || priceNum <= 0) {
        setSubmitError(`Enter the price you ${type === "buy" ? "paid" : "sold at"} per unit`);
        return;
      }
      payload.price = priceNum;
      if (manualDate) {
        payload.transactedAt = new Date(manualDate).toISOString();
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { transaction?: TransactionView; error?: string };
      if (!res.ok || !data.transaction) {
        throw new Error(data.error ?? "Failed to record transaction");
      }
      setLastTransaction(data.transaction);
      setPhpAmount("");
      setCoinAmount("");
      setManualPrice("");
      setManualDate("");
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
    const priceNum = Number(editPrice);
    if (!editCoinAmount || Number.isNaN(coinAmountNum) || coinAmountNum <= 0) {
      setEditError("Enter a valid coin amount greater than 0");
      return;
    }
    if (!editPrice || Number.isNaN(priceNum) || priceNum <= 0) {
      setEditError("Enter a valid price greater than 0");
      return;
    }

    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch("/api/transactions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, coinAmount: coinAmountNum, price: priceNum }),
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
    loading,
    loadError,
    type,
    setType,
    mode,
    setMode,
    symbol,
    setSymbol,
    phpAmount,
    setPhpAmount,
    coinAmount,
    setCoinAmount,
    manualPrice,
    setManualPrice,
    manualDate,
    setManualDate,
    submitting,
    submitError,
    lastTransaction,
    submitTransaction,
    deleteTransaction,
    deletingId,
    editingId,
    editCoinAmount,
    setEditCoinAmount,
    editPrice,
    setEditPrice,
    editError,
    editSaving,
    startEdit,
    cancelEdit,
    saveEdit,
  };
}
