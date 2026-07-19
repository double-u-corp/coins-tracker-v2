import { useEffect, useMemo, useState } from "react";
import type { CoinSummary, DailyRecord } from "@/validators/recordSchema";

interface CoinOption {
  symbol: string;
  name: string;
}

export function useCalendarLogic() {
  const [coinOptions, setCoinOptions] = useState<CoinOption[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [monthCursor, setMonthCursor] = useState<Date>(() => new Date());
  const [days, setDays] = useState<DailyRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the list of coins once, to populate the dropdown.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/coins")
      .then((res) => res.json())
      .then((data: { coins: CoinSummary[] }) => {
        if (!cancelled) {
          setCoinOptions(data.coins.map((c) => ({ symbol: c.symbol, name: c.name })));
        }
      })
      .catch(() => {
        /* dropdown just stays empty on failure */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const monthParam = useMemo(() => {
    const y = monthCursor.getFullYear();
    const m = String(monthCursor.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }, [monthCursor]);

  // Load daily high/low whenever the selected coin or visible month changes.
  useEffect(() => {
    if (!selectedSymbol) {
      setDays([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/coins?type=calendar&symbol=${selectedSymbol}&month=${monthParam}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load calendar data (${res.status})`);
        return res.json();
      })
      .then((data: { days: DailyRecord[] }) => {
        if (!cancelled) setDays(data.days);
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
  }, [selectedSymbol, monthParam]);

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
    loading,
    error,
  };
}
