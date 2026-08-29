import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { CoinSummary, DailyRecord } from "@/validators/recordSchema";

export interface CoinOption {
  symbol: string;
  name: string;
  currentPrice?: number | null; // Added currentPrice
}

export type MultiCoinRecords = Record<string, DailyRecord[]>;

export function useCalendarLogic() {
  const router = useRouter();

  const [coinOptions, setCoinOptions] = useState<CoinOption[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [hasAppliedInitialSymbol, setHasAppliedInitialSymbol] = useState(false);
  const [monthCursor, setMonthCursor] = useState<Date>(() => new Date());
  
  const [allCoinsData, setAllCoinsData] = useState<MultiCoinRecords>({});
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the list of coins once
  useEffect(() => {
    let cancelled = false;
    fetch("/api/coins")
      .then((res) => res.json())
      .then((data: { coins: CoinSummary[] }) => {
        if (!cancelled && Array.isArray(data.coins)) {
          // Map the currentPrice so it is available in the UI
          setCoinOptions(data.coins.map((c) => ({ 
            symbol: c.symbol, 
            name: c.name,
            currentPrice: c.currentPrice 
          })));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Initial symbol handling from router query
  useEffect(() => {
    if (hasAppliedInitialSymbol) return;
    if (!router.isReady) return;
    if (coinOptions.length === 0) return;

    const queriedSymbol = typeof router.query.symbol === "string" ? router.query.symbol.toUpperCase() : "";
    if (queriedSymbol) {
      const matched = coinOptions.find((c) => c.symbol === queriedSymbol);
      if (matched) {
        setSelectedSymbol(matched.symbol);
      }
    }
    setHasAppliedInitialSymbol(true);
  }, [router.isReady, router.query.symbol, coinOptions, hasAppliedInitialSymbol]);

  const monthParam = useMemo(() => {
    const y = monthCursor.getFullYear();
    const m = String(monthCursor.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }, [monthCursor]);

  // Always fetch all coins for the selected month to ensure accurate ranking calculations
  useEffect(() => {
    if (coinOptions.length === 0) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all(
      coinOptions.map((coin) =>
        fetch(`/api/coins?type=calendar&symbol=${coin.symbol}&month=${monthParam}`)
          .then((res) => (res.ok ? res.json() : { days: [] }))
          .then((data: { days: DailyRecord[] }) => ({ symbol: coin.symbol, days: data.days || [] }))
          .catch(() => ({ symbol: coin.symbol, days: [] }))
      )
    )
      .then((results) => {
        if (!cancelled) {
          const map: MultiCoinRecords = {};
          results.forEach((r) => {
            map[r.symbol] = r.days;
          });
          setAllCoinsData(map);
        }
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [monthParam, coinOptions]);

  // Derive single coin daily records directly from allCoinsData
  const days = useMemo(() => {
    return selectedSymbol ? allCoinsData[selectedSymbol] || [] : [];
  }, [selectedSymbol, allCoinsData]);

  function goToPreviousMonth() {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }

  function goToNextMonth() {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }

  return {
    coinOptions,
    selectedSymbol,
    setSelectedSymbol,
    monthCursor,
    goToPreviousMonth,
    goToNextMonth,
    days,
    allCoinsData,
    loading,
    error,
  };
}