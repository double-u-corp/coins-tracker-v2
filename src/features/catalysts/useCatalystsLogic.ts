import { useState, useEffect, useCallback, useMemo } from "react";
import type { JournalEntryView } from "@/validators/journalSchema";

export interface CatalystPrompt {
  id: string;
  category: "News" | "Daily" | "Weekly" | "Monthly" | "Macro";
  title: string;
  prompt: string;
}

export interface CachedAiLog {
  timestamp: number;
  response: string;
  category: string;
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
  "TX",
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
  "SKY",
];

// Helper to inject tailored, category-specific execution rules
const getCategoryRules = (category: CatalystPrompt["category"]) => {
  switch (category) {
    case "News":
      return " RULES: 1. Focus strictly on breaking developments, whale activity, or official announcements from the past 24-72 hours. 2. Explain the direct cause behind recent price action. 3. Include direct source links where available.";

    case "Daily":
      return " RULES: 1. Focus on live 24h market data: perpetual funding rates, open interest shifts, liquidations, and on-chain net flows. 2. Provide a clear 24h sentiment assessment (Bullish/Bearish/Neutral leverage).";

    case "Weekly":
      return " RULES: 1. Focus on events and updates within a 7-day lookback or lookahead window. 2. Highlight exchange listings (Binance, Coins.ph, OKX), new pairs, or weekly structural changes.";

    case "Monthly":
      return " RULES: 1. Focus on a 30-60 day horizon for scheduled token unlocks (% of circulating supply), major roadmap milestones, mainnet upgrades, or TGEs. 2. Highlight potential supply pressure.";

    case "Macro":
return " RULES: 1. List upcoming scheduled US economic calendar dates for this month. 2. NEVER use Unicode citation brackets like 【...】. 3. Format ALL citations as standard Markdown links: [Source Name](https://url.com).";
    default:
      return "";
  }
};

const formatTokenForPrompt = (token: string) => {
  switch (token.toUpperCase()) {
    case "TX":
      return "TX (txEcosystem / tx protocol, merged token of Coreum and Sologenic)";
    case "POL":
      return "POL (Polygon, formerly MATIC)";
    default:
      return token;
  }
};

const STATIC_MACRO_PROMPTS: CatalystPrompt[] = [
  {
    id: "weekly-coins-ph",
    category: "Weekly",
    title: "Coins.ph Listings & Official Updates",
    prompt: `What are the latest official announcements, new token listings, or updates from Coins.ph?${getCategoryRules("Weekly")}`,
  },
  {
    id: "macro-fed-calendar",
    category: "Macro",
    title: "Macro & Fed Calendar",
    prompt: `What are the upcoming high-impact US macroeconomic events, FOMC meetings, Fed speeches, and economic reports scheduled for this month?${getCategoryRules("Macro")}`,
  },
  {
    id: "macro-inflation",
    category: "Macro",
    title: "Inflation Reports (CPI & PCE)",
    prompt: `When are the next US CPI and core PCE inflation reports scheduled, and what are the market expectations and consensus readings?${getCategoryRules("Macro")}`,
  },
  {
    id: "macro-dxy-yields",
    category: "Macro",
    title: "US Dollar Index (DXY) & 10Y Yields",
    prompt: `How are the US Dollar Index (DXY) and 10-year US Treasury yield trending this week, and how is it impacting crypto market risk appetite?${getCategoryRules("Macro")}`,
  },
  {
    id: "macro-geopolitics",
    category: "Macro",
    title: "Geopolitics & Global Risk",
    prompt: `Are there any major global financial market risks, banking developments, or geopolitical events currently impacting crypto and risk-on assets?${getCategoryRules("Macro")}`,
  },
];

export function useCatalystsLogic() {
  const [selectedCoin, setSelectedCoin] = useState<string>("TX");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [aiCache, setAiCache] = useState<Record<string, CachedAiLog>>({});
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [aiErrors, setAiErrors] = useState<Record<string, string>>({});
  const [savedStatus, setSavedStatus] = useState<Record<string, boolean>>({});

  const [entries, setEntries] = useState<JournalEntryView[]>([]);
  const [journalLoading, setJournalLoading] = useState(true);
  const [journalError, setJournalError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(true);

  // Dynamic coin-specific prompts with category-tailored instructions
  const coinSpecificPrompts = useMemo<CatalystPrompt[]>(() => {
    const formattedToken = formatTokenForPrompt(selectedCoin);
    const key = selectedCoin.toLowerCase();

    return [
      {
        id: `coin-${key}-news-moving`,
        category: "News",
        title: `${selectedCoin} — Breaking News & Price Drivers`,
        prompt: `Why is ${formattedToken} moving today? What are the top breaking news items, announcements, or whale moves driving this asset?${getCategoryRules("News")}`,
      },
      {
        id: `coin-${key}-daily-derivatives`,
        category: "Daily",
        title: `${selectedCoin} — Derivatives & Leverage`,
        prompt: `What do perpetual funding rates, open interest, and liquidation levels suggest about leverage and market positioning for ${formattedToken}?${getCategoryRules("Daily")}`,
      },
      {
        id: `coin-${key}-daily-onchain`,
        category: "Daily",
        title: `${selectedCoin} — On-Chain Signals & Whale Flows`,
        prompt: `What are the latest on-chain signals for ${formattedToken} — large exchange net inflows/outflows or wallet accumulation patterns?${getCategoryRules("Daily")}`,
      },
      {
        id: `coin-${key}-weekly-listings`,
        category: "Weekly",
        title: `${selectedCoin} — Exchange Listings & Pairs`,
        prompt: `What are the latest official announcements regarding new exchange listings or perpetual trading pairs (Binance, Coinbase, OKX, Coins.ph) for ${formattedToken}?${getCategoryRules("Weekly")}`,
      },
      {
        id: `coin-${key}-monthly-unlocks`,
        category: "Monthly",
        title: `${selectedCoin} — Token Unlocks & Roadmap`,
        prompt: `What are the major scheduled token unlocks, mainnet upgrades, or governance milestones in the next 30-60 days for ${formattedToken}?${getCategoryRules("Monthly")}`,
      },
    ];
  }, [selectedCoin]);

  const allPrompts = useMemo(() => {
    return [...coinSpecificPrompts, ...STATIC_MACRO_PROMPTS];
  }, [coinSpecificPrompts]);

  const filteredPrompts = useMemo(() => {
    if (selectedCategory === "All") return allPrompts;
    return allPrompts.filter((p) => p.category === selectedCategory);
  }, [allPrompts, selectedCategory]);

  // Robust log fetcher ensuring cache state persists across page refreshes
  const fetchAiLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/catalyst-ai");
      if (res.ok) {
        const data = await res.json();
        if (data.logs) {
          if (Array.isArray(data.logs)) {
            const logMap: Record<string, CachedAiLog> = {};
            data.logs.forEach((log: any) => {
              const key = log.promptId || log.id;
              if (key) {
                logMap[key] = {
                  timestamp: new Date(log.createdAt || log.timestamp || Date.now()).getTime(),
                  response: log.response || log.content || "",
                  category: log.category || "General",
                };
              }
            });
            setAiCache(logMap);
          } else {
            setAiCache(data.logs);
          }
        }
      }
    } catch (e) {
      console.error("Failed to load DB AI logs", e);
    }
  }, []);

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
    fetchAiLogs();
    fetchJournalEntries();
  }, [fetchAiLogs, fetchJournalEntries]);

  const generalEntries = useMemo(() => {
    return entries.filter((entry) => !entry.symbol || entry.symbol.trim() === "");
  }, [entries]);

  const checkIsPeriodCurrent = (timestamp: number, category: string) => {
    const runDate = new Date(timestamp);
    const now = new Date();

    if (category === "News" || category === "Daily") {
      return runDate.toDateString() === now.toDateString();
    }
    if (category === "Weekly" || category === "Macro") {
      const diffDays = (now.getTime() - runDate.getTime()) / (1000 * 3600 * 24);
      return diffDays < 7;
    }
    if (category === "Monthly") {
      return runDate.getFullYear() === now.getFullYear() && runDate.getMonth() === now.getMonth();
    }
    return false;
  };

  const getPromptStatus = (id: string, category: string) => {
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
      return { status: "current", label: `Fetched • ${dateStr}` };
    } else {
      return { status: "expired", label: `Expired (${dateStr})` };
    }
  };

  const runAiSearch = async (
    promptId: string,
    promptText: string,
    category: string,
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
        symbol: selectedCoin,
        entryDate: new Date().toISOString().split("T")[0],
        title: `AI Catalyst [${selectedCoin}]: ${title}`,
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
      headers: { "Content-Type": "application/json" },
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

  return {
    selectedCoin,
    setSelectedCoin,
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