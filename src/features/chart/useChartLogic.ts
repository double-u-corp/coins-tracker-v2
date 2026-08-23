import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "@/features/auth/useAuth";
import { chartBucketKey, type ChartGranularity } from "@/lib/chartBucket";
import type { CoinSummary, ChartPoint } from "@/validators/recordSchema";
import type { JournalEntryView } from "@/validators/journalSchema";

export interface Transaction {
  id: number;
  symbol: string;
  name: string;
  type: "buy" | "sell";
  phpAmount: number;
  price: number;
  coinAmount: number;
  isManual: boolean;
  transactedAt: string;
}

export interface PortfolioItem {
  symbol: string;
  name: string;
  holdings: number;
  spent: number;
  sold: number;
  currentPrice: number;
  currentValue: number;
  gainLoss: number;
}

export function useChartLogic() {
  const router = useRouter();
  const { authenticated } = useAuth();

  const [coinOptions, setCoinOptions] = useState<{ symbol: string; name: string }[]>([]);
  const [allCoins, setAllCoins] = useState<CoinSummary[]>([]);
  const [symbol, setSymbol] = useState("");
  const [hasAppliedInitialSymbol, setHasAppliedInitialSymbol] = useState(false);
  const [years, setYears] = useState(1);
  const [granularity, setGranularity] = useState<ChartGranularity>("daily");

  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  const [entries, setEntries] = useState<JournalEntryView[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/coins")
      .then((res) => res.json())
      .then((data: { coins: CoinSummary[] }) => {
        if (!cancelled) {
          setAllCoins(data.coins);
          setCoinOptions(data.coins.map((c) => ({ symbol: c.symbol, name: c.name })));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (hasAppliedInitialSymbol) return;
    if (!router.isReady) return;
    if (coinOptions.length === 0) return;

    const queriedSymbol = typeof router.query.symbol === "string" ? router.query.symbol.toUpperCase() : "";
    const matched = coinOptions.find((c) => c.symbol === queriedSymbol);
    
    setSymbol(matched?.symbol ?? ""); 
    setHasAppliedInitialSymbol(true);
  }, [router.isReady, router.query.symbol, coinOptions, hasAppliedInitialSymbol]);

  const rangeStart = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    return d;
  }, [years]);

  const loadChart = useCallback(() => {
    if (!symbol) return;
    setChartLoading(true);
    setChartError(null);
    fetch(`/api/coins?type=chart&symbol=${symbol}&years=${years}&granularity=${granularity}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load chart data (${res.status})`);
        return res.json();
      })
      .then((data: { points: ChartPoint[] }) => setPoints(data.points))
      .catch((err) => setChartError((err as Error).message))
      .finally(() => setChartLoading(false));
  }, [symbol, years, granularity]);

  const loadJournal = useCallback(() => {
    if (!symbol) return;
    setJournalLoading(true);
    setJournalError(null);
    const from = rangeStart.toISOString().slice(0, 10);
    fetch(`/api/journal?symbol=${symbol}&from=${from}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load journal (${res.status})`);
        return res.json();
      })
      .then((data: { entries: JournalEntryView[] }) => setEntries(data.entries))
      .catch((err) => setJournalError((err as Error).message))
      .finally(() => setJournalLoading(false));
  }, [symbol, rangeStart]);

  const loadTransactions = useCallback(() => {
    setTxLoading(true);
    fetch("/api/transactions")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load transactions (${res.status})`);
        return res.json();
      })
      .then((data) => {
        setTransactions(data.transactions || []);
        setPortfolio(data.portfolio || []);
      })
      .catch((err) => console.error(err))
      .finally(() => setTxLoading(false));
  }, []);

  useEffect(() => { loadChart(); }, [loadChart]);
  useEffect(() => { loadJournal(); }, [loadJournal]);
  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  const journalLabelsInView = useMemo(() => {
    const labels = new Set<string>();
    for (const entry of entries) {
      const { label } = chartBucketKey(new Date(entry.entryDate), granularity);
      if (points.some((p) => p.label === label)) labels.add(label);
    }
    return labels;
  }, [entries, granularity, points]);

  async function addJournalEntry(input: { symbol: string | null; entryDate: string; title: string; notes: string }) {
    const res = await fetch("/api/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error("Failed to save journal entry");
    loadJournal();
  }

  async function deleteJournalEntry(id: number) {
    const res = await fetch("/api/journal", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error("Failed to delete journal entry");
    loadJournal();
  }

  return {
    coinOptions, allCoins, symbol, setSymbol, years, setYears, granularity, setGranularity,
    points, chartLoading, chartError, entries, journalLoading, journalError,
    journalLabelsInView, addJournalEntry, deleteJournalEntry, authenticated,
    transactions, portfolio, txLoading
  };
}