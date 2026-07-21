import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { CoinSummary } from "@/validators/recordSchema";
import type { PortfolioEntry, TransactionView } from "@/validators/transactionSchema";

interface CoinOption {
  symbol: string;
  name: string;
}

export type TradeType = "buy" | "sell";

export function useTradeLogic() {
  const [coinOptions, setCoinOptions] = useState<CoinOption[]>([]);
  const [transactions, setTransactions] = useState<TransactionView[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [type, setType] = useState<TradeType>("buy");
  const [symbol, setSymbol] = useState("");
  const [phpAmount, setPhpAmount] = useState(""); // amount spent (buy) or received (sell)
  const [coinAmount, setCoinAmount] = useState(""); // quantity bought or sold
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastTransaction, setLastTransaction] = useState<TransactionView | null>(null);

  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCoinAmount, setEditCoinAmount] = useState("");
  const [editPhpAmount, setEditPhpAmount] = useState("");
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

      const options = coinsData.coins.map((c) => ({ symbol: c.symbol, name: c.name }));
      setCoinOptions(options);
      setSymbol((prev) => prev || options[0]?.symbol || ""); // default to first monitored coin
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
    const amount = Number(phpAmount);
    if (!phpAmount || Number.isNaN(amount) || amount <= 0) {
      setSubmitError("Enter a valid PHP amount greater than 0");
      return;
    }
    const coins = Number(coinAmount);
    if (!coinAmount || Number.isNaN(coins) || coins <= 0) {
      setSubmitError("Enter a valid number of coins greater than 0");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          type,
          phpAmount: amount,
          coinAmount: coins,
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
    if (!editCoinAmount || Number.isNaN(coinAmountNum) || coinAmountNum <= 0) {
      setEditError("Enter a valid coin amount greater than 0");
      return;
    }
    if (!editPhpAmount || Number.isNaN(phpAmountNum) || phpAmountNum <= 0) {
      setEditError("Enter a valid PHP amount greater than 0");
      return;
    }

    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch("/api/transactions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, coinAmount: coinAmountNum, phpAmount: phpAmountNum }),
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
    symbol,
    setSymbol,
    phpAmount,
    setPhpAmount,
    coinAmount,
    setCoinAmount,
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
    editError,
    editSaving,
    startEdit,
    cancelEdit,
    saveEdit,
  };
}
