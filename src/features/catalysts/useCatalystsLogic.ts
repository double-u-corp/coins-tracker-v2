import { useState, useEffect, useCallback, useMemo } from "react";
import type { JournalEntryView } from "@/validators/journalSchema";

export interface CatalystPrompt {
  id: string;
  category: "Daily" | "Weekly" | "Monthly";
  title: string;
  prompt: string;
}

export interface CachedAiLog {
  timestamp: number;
  response: string;
  category: "Daily" | "Weekly" | "Monthly";
}

const TOKENS = [
  "HYPE", "BNB", "TX (coreum and sologenic)", "ASTER", "VIRTUAL", "UNI", "RON", "TRX", 
  "ADA", "XRP", "SHIB", "TRUMP", "ENA", "XPL", "XAUT", "LTC", 
  "GRAM", "Ondo", "XDC", "SPX", "POL", "BGB", "WEMIX", "SKY"
];

const chunkArray = (arr: string[], size: number) => 
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

const tokenBatches = chunkArray(TOKENS, 6);

const derivativesPrompts: CatalystPrompt[] = tokenBatches.map((batch, index) => ({
  id: `daily-derivatives-${index + 1}`,
  category: "Daily",
  title: `Derivatives Batch ${index + 1} (${batch.join(", ")})`,
  prompt: `What do current perpetual funding rates and open interest levels for ${batch.join(", ")} suggest about over-leveraged positioning, and has there been a recent liquidation spike in any of them?`,
}));

const onChainPrompts: CatalystPrompt[] = tokenBatches.map((batch, index) => ({
  id: `daily-onchain-${index + 1}`,
  category: "Daily",
  title: `On-Chain Batch ${index + 1} (${batch.join(", ")})`,
  prompt: `What are the latest on-chain signals this week for ${batch.join(", ")} — large whale transfers, exchange inflows/outflows, or unusual holder activity — that could indicate upcoming volatility?`,
}));

const exploitPrompts: CatalystPrompt[] = tokenBatches.map((batch, index) => ({
  id: `daily-exploit-${index + 1}`,
  category: "Daily",
  title: `Exploit Risk Batch ${index + 1} (${batch.join(", ")})`,
  prompt: `Have there been any recent exploits, bridge hacks, or security incidents affecting ${batch.join(", ")} or the protocols/exchanges they rely on?`,
}));

const exchangeListingPrompts: CatalystPrompt[] = tokenBatches.map((batch, index) => ({
  id: `weekly-listings-${index + 1}`,
  category: "Weekly",
  title: `Exchange Listings Batch ${index + 1} (${batch.join(", ")})`,
  prompt: `What are the latest official announcements regarding new listings, upcoming delistings, or network support changes on major exchanges (including Binance, Coinbase, OKX, Bybit, and Coins.ph) for ${batch.join(", ")}?`,
}));

const monthlyUnlockPrompts: CatalystPrompt[] = tokenBatches.map((batch, index) => ({
  id: `token-batch-${index + 1}`,
  category: "Monthly",
  title: `Token Unlocks Batch ${index + 1} (${batch.join(", ")})`,
  prompt: `What are the major scheduled token unlocks, mainnet upgrades, or migration dates in the next 60 days for ${batch.join(", ")}?`,
}));

const STATIC_PROMPTS: CatalystPrompt[] = [
  {
    id: "weekly-coins-ph",
    category: "Weekly",
    title: "Exchange Listings — Coins.ph",
    prompt: "What are the latest official news and announcements from Coins.ph, including coin listings, delistings, or new additions?",
  },
  {
    id: "weekly-1",
    category: "Weekly",
    title: "Macro & Fed Calendar",
    prompt: "What are the upcoming high-impact US macroeconomic events, FOMC meetings, Fed speaker appearances, and employment reports for the next two weeks that could cause crypto market volatility?",
  },
  {
    id: "weekly-2",
    category: "Weekly",
    title: "Inflation Prints",
    prompt: "What are the exact CPI and core PCE release dates this month, and what are the consensus estimates versus the prior reading?",
  },
  {
    id: "weekly-3",
    category: "Weekly",
    title: "Labor Market Reports",
    prompt: "What are the upcoming labor market releases — Initial Jobless Claims, JOLTS job openings, ADP Employment — scheduled this week or month, and how have recent prints trended?",
  },
  {
    id: "weekly-4",
    category: "Weekly",
    title: "Macro Cross-Asset Backdrop",
    prompt: "How are the US Dollar Index (DXY) and 10-year Treasury yield trending this week, and is broader crypto market risk appetite currently rising or falling?",
  },
  {
    id: "weekly-5",
    category: "Weekly",
    title: "Geopolitics & Risk-Off Flows",
    prompt: "Are there any active or escalating geopolitical tensions, international security crises, or trade restrictions currently driving risk-off flows in global markets that are affecting crypto?",
  },
  {
    id: "weekly-6",
    category: "Weekly",
    title: "Energy & Oil Prices",
    prompt: "What are the latest OPEC+ production decisions, crude oil inventory reports, or supply disruptions that could feed into inflation data and shift crypto volatility?",
  },
  {
    id: "monthly-regulatory",
    category: "Monthly",
    title: "Regulatory Calendar",
    prompt: "Are there any pending SEC or CFTC decisions, congressional votes, or MiCA enforcement actions affecting crypto scheduled this month?",
  },
];

const ALL_PROMPTS = [
  ...derivativesPrompts,
  ...onChainPrompts,
  ...exploitPrompts,
  ...exchangeListingPrompts,
  ...monthlyUnlockPrompts,
  ...STATIC_PROMPTS,
];

export function useCatalystsLogic() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  const [aiCache, setAiCache] = useState<Record<string, CachedAiLog>>({});
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [aiErrors, setAiErrors] = useState<Record<string, string>>({});
  const [savedStatus, setSavedStatus] = useState<Record<string, boolean>>({});

  const [entries, setEntries] = useState<JournalEntryView[]>([]);
  const [journalLoading, setJournalLoading] = useState(true);
  const [journalError, setJournalError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(true);

  const fetchAiLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/catalyst-ai");
      if (res.ok) {
        const data = await res.json();
        if (data.logs) {
          setAiCache(data.logs);
        }
      }
    } catch (e) {
      console.error("Failed to load DB AI logs", e);
    }
  }, []);

  useEffect(() => {
    fetchAiLogs();
  }, [fetchAiLogs]);

  const generalEntries = useMemo(() => {
    return entries.filter((entry) => !entry.symbol || entry.symbol.trim() === "");
  }, [entries]);

  const checkIsPeriodCurrent = (timestamp: number, category: "Daily" | "Weekly" | "Monthly") => {
    const runDate = new Date(timestamp);
    const now = new Date();

    if (category === "Daily") {
      return runDate.toDateString() === now.toDateString();
    }
    if (category === "Weekly") {
      const diffDays = (now.getTime() - runDate.getTime()) / (1000 * 3600 * 24);
      return diffDays < 7;
    }
    if (category === "Monthly") {
      return runDate.getFullYear() === now.getFullYear() && runDate.getMonth() === now.getMonth();
    }
    return false;
  };

  const getPromptStatus = (id: string, category: "Daily" | "Weekly" | "Monthly") => {
    const log = aiCache[id];
    if (!log) return { status: "unrun", label: "Not Fetched" };

    const isCurrent = checkIsPeriodCurrent(log.timestamp, category);
    const dateStr = new Date(log.timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    if (isCurrent) {
      return { status: "current", label: `Fetched (${category}) • ${dateStr}` };
    } else {
      return { status: "expired", label: `Expired (${dateStr})` };
    }
  };

  const runAiSearch = async (
    promptId: string,
    promptText: string,
    category: "Daily" | "Weekly" | "Monthly",
    force = false
  ) => {
    setAiLoading((prev) => ({ ...prev, [promptId]: true }));
    setAiErrors((prev) => ({ ...prev, [promptId]: "" }));

    try {
      const res = await fetch("/api/catalyst-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptId,
          prompt: promptText,
          category,
          forceRefresh: force,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch live insights.");

      setAiCache((prev) => ({
        ...prev,
        [promptId]: {
          timestamp: Date.now(),
          response: data.response,
          category,
        },
      }));
    } catch (err: any) {
      setAiErrors((prev) => ({ ...prev, [promptId]: err.message || "An error occurred" }));
    } finally {
      setAiLoading((prev) => ({ ...prev, [promptId]: false }));
    }
  };

  const fetchJournalEntries = useCallback(async () => {
    setJournalLoading(true);
    setJournalError(null);
    try {
      const res = await fetch("/api/journal");
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!res.ok) throw new Error("Failed to load journal entries");
      const data = await res.json();
      setEntries(data.entries || data || []);
    } catch (err) {
      setJournalError((err as Error).message);
    } finally {
      setJournalLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJournalEntries();
  }, [fetchJournalEntries]);

  const addJournalEntry = async (input: { symbol: string | null; entryDate: string; title: string; notes: string }) => {
    const res = await fetch("/api/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || "Failed to add journal entry");
    }
    await fetchJournalEntries();
  };

  const saveAiResponseToJournal = async (promptId: string, title: string, text: string) => {
    try {
      await addJournalEntry({
        symbol: null,
        entryDate: new Date().toISOString().split("T")[0],
        title: `AI Catalyst: ${title}`,
        notes: text,
      });
      setSavedStatus((prev) => ({ ...prev, [promptId]: true }));
      setTimeout(() => {
        setSavedStatus((prev) => ({ ...prev, [promptId]: false }));
      }, 3000);
    } catch (err) {
      alert("Failed to save to journal: " + (err as Error).message);
    }
  };

  const updateJournalEntry = async (id: number, input: { title?: string; notes?: string }) => {
  const res = await fetch("/api/journal", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...input }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || errData.message || "Failed to update entry");
  }

  await fetchJournalEntries();
};

const deleteJournalEntry = async (id: number) => {
  const res = await fetch("/api/journal", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || errData.message || "Failed to delete journal entry");
  }

  await fetchJournalEntries();
};
  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredPrompts = ALL_PROMPTS.filter(
    (p) => selectedCategory === "All" || p.category === selectedCategory
  );

  return {
    selectedCategory,
    setSelectedCategory,
    filteredPrompts,
    copiedId,
    handleCopy,
    generalEntries,
    journalLoading,
    journalError,
    authenticated,
    addJournalEntry,
    deleteJournalEntry,
    updateJournalEntry,
    aiCache,
    aiLoading,
    aiErrors,
    savedStatus,
    runAiSearch,
    getPromptStatus,
    saveAiResponseToJournal,
  };
}