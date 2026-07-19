import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/features/auth/useAuth";
import { chartBucketKey } from "@/lib/chartBucket";
import type { CoinSummary, ChartPoint } from "@/validators/recordSchema";
import type { JournalEntryView } from "@/validators/journalSchema";

interface CoinOption {
  symbol: string;
  name: string;
}

export type Granularity = "weekly" | "monthly" | "yearly";

export function useChartLogic() {
  const { authenticated } = useAuth();

  const [coinOptions, setCoinOptions] = useState<CoinOption[]>([]);
  const [symbol, setSymbol] = useState("");
  const [years, setYears] = useState(1);
  const [granularity, setGranularity] = useState<Granularity>("weekly");

  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  const [entries, setEntries] = useState<JournalEntryView[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);

  // Load the coin list once, for the dropdown.
  useEffect(() => {
    fetch("/api/coins")
      .then((res) => res.json())
      .then((data: { coins: CoinSummary[] }) => {
        setCoinOptions(data.coins.map((c) => ({ symbol: c.symbol, name: c.name })));
        // Default to the first monitored coin so the chart isn't empty on load.
        setSymbol((prev) => prev || data.coins[0]?.symbol || "");
      })
      .catch(() => {
        /* dropdown just stays empty on failure */
      });
  }, []);

  const rangeStart = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    return d;
  }, [years]);

  const loadChart = useCallback(() => {
    if (!symbol) {
      setPoints([]);
      return;
    }
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
    if (!symbol) {
      setEntries([]);
      return;
    }
    setJournalLoading(true);
    setJournalError(null);
    const from = rangeStart.toISOString().slice(0, 10);
    fetch(`/api/journal?symbol=${symbol}&from=${from}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load journal entries (${res.status})`);
        return res.json();
      })
      .then((data: { entries: JournalEntryView[] }) => setEntries(data.entries))
      .catch((err) => setJournalError((err as Error).message))
      .finally(() => setJournalLoading(false));
  }, [symbol, rangeStart]);

  useEffect(() => {
    loadChart();
  }, [loadChart]);

  useEffect(() => {
    loadJournal();
  }, [loadJournal]);

  // Aligns each journal entry to the same bucket the chart uses, so
  // markers on the chart land on an x-axis label that actually exists in
  // the data — this is the "connects to the graph" link between the two.
  const journalLabelsInView = useMemo(() => {
    const labels = new Set<string>();
    for (const entry of entries) {
      const { label } = chartBucketKey(new Date(entry.entryDate), granularity);
      if (points.some((p) => p.label === label)) {
        labels.add(label);
      }
    }
    return labels;
  }, [entries, granularity, points]);

  async function addJournalEntry(input: { symbol: string | null; entryDate: string; title: string; notes: string }) {
    const res = await fetch("/api/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = (await res.json()) as { entry?: JournalEntryView; error?: string };
    if (!res.ok || !data.entry) {
      throw new Error(data.error ?? "Failed to save journal entry");
    }
    loadJournal();
  }

  async function deleteJournalEntry(id: number) {
    const res = await fetch("/api/journal", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? "Failed to delete journal entry");
    }
    loadJournal();
  }

  return {
    coinOptions,
    symbol,
    setSymbol,
    years,
    setYears,
    granularity,
    setGranularity,
    points,
    chartLoading,
    chartError,
    entries,
    journalLoading,
    journalError,
    journalLabelsInView,
    addJournalEntry,
    deleteJournalEntry,
    authenticated,
  };
}
