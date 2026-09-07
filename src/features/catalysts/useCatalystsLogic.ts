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

export const AVAILABLE_TOKENS = [
  "SOL",
  "XLM",
  "BCH",
  "AAVE",
  "SUI",
  "HBAR",
  "LINK",
  "HYPE",
  "BNB",
  "TX",        // Corrume + Sol merge
  "ASTER",
  "VIRTUAL",
  "UNI",
  "RON",
  "TRX",
  "ADA",
  "XRP",
  "SHIB",
  "TRUMP",
  "ENA",
  "XPL",
  "XAUT",
  "LTC",
  "GRAM",
  "Ondo",
  "XDC",
  "SPX",
  "POL",
  "BGB",
  "WEMIX",
  "SKY"
];;

// Shared instruction rules for AI prompts
const INSTRUCTION_SUFFIX = 
  " RULES: 1. Prioritize current breaking news (past 24-72h) and upcoming scheduled events over past events. 2. If no current/future news exists, you may mention past events, but explicitly label them with their exact past occurrence date as historical context. 3. MUST include direct article links / source URLs for every news item, announcement, or catalyst reported.";

// Context helper to disambiguate tokens with generic ticker names or rebrands
const formatTokenForPrompt = (token: string) => {
  switch (token.toUpperCase()) {
    case "TX":
      return "TX (txEcosystem / tx protocol, the merged token of Coreum [COREUM] and Sologenic [SOLO])";
    case "POL":
      return "POL (Polygon, formerly MATIC)";
    default:
      return token;
  }
};

const chunkArray = (arr: string[], size: number) => 
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

const tokenBatches = chunkArray(AVAILABLE_TOKENS, 6);

const derivativesPrompts: CatalystPrompt[] = tokenBatches.map((batch, index) => {
  const tokenList = batch.map(formatTokenForPrompt).join(", ");
  return {
    id: `daily-derivatives-${index + 1}`,
    category: "Daily",
    title: `Derivatives Batch ${index + 1} (${batch.join(", ")})`,
    prompt: `What do current perpetual funding rates and open interest levels for ${tokenList} suggest about over-leveraged positioning, and has there been a recent liquidation spike in any of them? ${INSTRUCTION_SUFFIX}`,
  };
});

const onChainPrompts: CatalystPrompt[] = tokenBatches.map((batch, index) => {
  const tokenList = batch.map(formatTokenForPrompt).join(", ");
  return {
    id: `daily-onchain-${index + 1}`,
    category: "Daily",
    title: `On-Chain Batch ${index + 1} (${batch.join(", ")})`,
    prompt: `What are the latest on-chain signals this week for ${tokenList} — large whale transfers, exchange inflows/outflows, or unusual holder activity — that could indicate upcoming volatility? ${INSTRUCTION_SUFFIX}`,
  };
});

const exploitPrompts: CatalystPrompt[] = tokenBatches.map((batch, index) => {
  const tokenList = batch.map(formatTokenForPrompt).join(", ");
  return {
    id: `daily-exploit-${index + 1}`,
    category: "Daily",
    title: `Exploit Risk Batch ${index + 1} (${batch.join(", ")})`,
    prompt: `Have there been any recent exploits, bridge hacks, or security incidents affecting ${tokenList} or the protocols/exchanges they rely on? ${INSTRUCTION_SUFFIX}`,
  };
});

const exchangeListingPrompts: CatalystPrompt[] = tokenBatches.map((batch, index) => {
  const tokenList = batch.map(formatTokenForPrompt).join(", ");
  return {
    id: `weekly-listings-${index + 1}`,
    category: "Weekly",
    title: `Exchange Listings Batch ${index + 1} (${batch.join(", ")})`,
    prompt: `What are the latest official announcements regarding new listings, upcoming delistings, or network support changes on major exchanges (including Binance, Coinbase, OKX, Bybit, and Coins.ph) for ${tokenList}? ${INSTRUCTION_SUFFIX}`,
  };
});

const monthlyUnlockPrompts: CatalystPrompt[] = tokenBatches.map((batch, index) => {
  const tokenList = batch.map(formatTokenForPrompt).join(", ");
  return {
    id: `token-batch-${index + 1}`,
    category: "Monthly",
    title: `Token Unlocks Batch ${index + 1} (${batch.join(", ")})`,
    prompt: `What are the major scheduled token unlocks, mainnet upgrades, or migration dates in the next 60 days for ${tokenList}? ${INSTRUCTION_SUFFIX}`,
  };
});

const STATIC_PROMPTS: CatalystPrompt[] = [
  {
    id: "weekly-coins-ph",
    category: "Weekly",
    title: "Exchange Listings — Coins.ph",
    prompt: `What are the latest official news and announcements from Coins.ph, including coin listings, delistings, or new additions? ${INSTRUCTION_SUFFIX}`,
  },
  {
    id: "weekly-1",
    category: "Weekly",
    title: "Macro & Fed Calendar",
    prompt: `What are the upcoming high-impact US macroeconomic events, FOMC meetings, Fed speaker appearances, and employment reports for the next two weeks that could cause crypto market volatility? ${INSTRUCTION_SUFFIX}`,
  },
  {
    id: "weekly-2",
    category: "Weekly",
    title: "Inflation Prints",
    prompt: `What are the exact CPI and core PCE release dates this month, and what are the consensus estimates versus the prior reading? ${INSTRUCTION_SUFFIX}`,
  },
  {
    id: "weekly-3",
    category: "Weekly",
    title: "Labor Market Reports",
    prompt: `What are the upcoming labor market releases — Initial Jobless Claims, JOLTS job openings, ADP Employment — scheduled this week or month, and how have recent prints trended? ${INSTRUCTION_SUFFIX}`,
  },
  {
    id: "weekly-4",
    category: "Weekly",
    title: "Macro Cross-Asset Backdrop",
    prompt: `How are the US Dollar Index (DXY) and 10-year Treasury yield trending this week, and is broader crypto market risk appetite currently rising or falling? ${INSTRUCTION_SUFFIX}`,
  },
  {
    id: "weekly-5",
    category: "Weekly",
    title: "Geopolitics & Risk-Off Flows",
    prompt: `Are there any active or escalating geopolitical tensions, international security crises, or trade restrictions currently driving risk-off flows in global markets that are affecting crypto? ${INSTRUCTION_SUFFIX}`,
  },
  {
    id: "weekly-6",
    category: "Weekly",
    title: "Energy & Oil Prices",
    prompt: `What are the latest OPEC+ production decisions, crude oil inventory reports, or supply disruptions that could feed into inflation data and shift crypto volatility? ${INSTRUCTION_SUFFIX}`,
  },
  {
    id: "monthly-regulatory",
    category: "Monthly",
    title: "Regulatory Calendar",
    prompt: `Are there any pending SEC or CFTC decisions, congressional votes, or MiCA enforcement actions affecting crypto scheduled this month? ${INSTRUCTION_SUFFIX}`,
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
  const [activeTab, setActiveTab] = useState<"batch" | "coin">("batch");
  const [selectedCoin, setSelectedCoin] = useState<string>("TX");

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

  const runCoinDeepDiveScan = async (
    coin: string,
    actionType: "why_moving" | "catalysts" | "risks"
  ) => {
    const promptId = `coin-deepdive-${coin.toLowerCase()}-${actionType}`;
    const targetCoinName = formatTokenForPrompt(coin);
    let promptText = "";

    if (actionType === "why_moving") {
      promptText = `Why is ${targetCoinName} price moving today? What are the top breaking news items, official announcements, or whale movements in the last 24-48 hours driving this price action? ${INSTRUCTION_SUFFIX}`;
    } else if (actionType === "catalysts") {
      promptText = `What are the upcoming bullish catalysts, scheduled mainnet upgrades, major partnerships, or exchange listings for ${targetCoinName}? ${INSTRUCTION_SUFFIX}`;
    } else {
      promptText = `Are there any active security threats, upcoming token unlocks, regulatory risks, or negative catalysts affecting ${targetCoinName}? ${INSTRUCTION_SUFFIX}`;
    }

    await runAiSearch(promptId, promptText, "Daily", true);
    return promptId;
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
    activeTab,
    setActiveTab,
    selectedCoin,
    setSelectedCoin,
    runCoinDeepDiveScan,
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