import { useState, useEffect, useCallback, useMemo } from "react";
import type { JournalEntryView } from "@/validators/journalSchema";
import { nowInManila, getDateKeyInZone, TRADER_TIMEZONE } from "../../lib/timezone";

export interface CatalystPrompt {
  id: string;
  category: "Live" | "Weekly" | "Monthly" | "Macro";
  title: string;
  prompt: string;
  // Short, keyword-style query sent to the search API. Kept separate from
  // `prompt` (which carries the full instructions for the LLM) because
  // search engines return better results from a few keywords than from a
  // paragraph of formatting rules.
  searchQuery: string;
  // "coin" = result depends on the currently selected coin.
  // "global" = same result regardless of which coin is selected (market-wide
  // or exchange-wide). Surfaced in the UI so switching coins doesn't
  // silently look like it did nothing for these.
  scope: "coin" | "global";
  // Explicit search recency/depth profile — see catalyst-ai.ts. Set per
  // prompt (not inferred from category) so a future category rename can't
  // silently break freshness settings again.
  searchProfile: "breaking" | "weekly" | "trend" | "authoritative";
  // "markdown" = human-readable analyst summary (default).
  // "json" = structured event list, rendered as a sorted list, not prose.
  responseFormat?: "markdown" | "json";
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
    case "Live":
      return " RULES: 1. Cover breaking news, whale activity, and official announcements from the past 24-72 hours, PLUS current 24h derivatives data (funding rates, open interest, liquidations) and on-chain net flows. 2. Provide a clear overall sentiment (Bullish/Bearish/Neutral) and explain the direct cause behind recent price action. 3. Include direct source links where available.";

    case "Weekly":
      return " RULES: 1. Focus on events and updates within a 7-day lookback or lookahead window. 2. Check BOTH major exchanges (Binance, Coinbase, OKX, Bybit) AND mid-tier/regional exchanges (KuCoin, Gate.io, MEXC, Bitget, HTX, LBank, Upbit, Bithumb, Coins.ph, PDAX) — many of these assets list on mid-tier or regional platforms before or instead of a Tier-1 listing, so do not limit the search to only the largest names. 3. Also flag any major DEX listing spike (Uniswap, PancakeSwap) if it signals new liquidity. 4. Note which specific exchange(s) each listing/pair applies to.";

    case "Monthly":
      return " RULES: 1. Focus on a 30-60 day horizon for scheduled token unlocks (% of circulating supply), major roadmap milestones, mainnet upgrades, or TGEs. 2. Highlight potential supply pressure.";

    case "Macro":
      return " RULES: 1. Cover the full macro picture in one pass: (a) upcoming FOMC/CPI/PCE/NFP calendar dates this month with exact ET release times where known, (b) current DXY and 10-year Treasury yield trend, (c) any active geopolitical or global financial risk affecting risk-on assets. 2. NEVER use Unicode citation brackets like 【...】. 3. Format ALL citations as standard Markdown links: [Source Name](https://url.com).";
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
    title: "Coins.ph Platform Updates",
    prompt: `What are the latest official announcements from Coins.ph specifically — new token listings, delistings, fee changes, or maintenance/platform updates? RULES: 1. Focus only on official Coins.ph announcements within a 7-day lookback or lookahead window. 2. Do not include general market-wide exchange news unrelated to Coins.ph itself.`,
    searchQuery: "Coins.ph official announcement listing update",
    scope: "global",
    searchProfile: "weekly",
  },
  {
    id: "macro-calendar-events",
    category: "Macro",
    title: "Upcoming Macro Event Dates (FOMC, CPI, PCE, NFP)",
    prompt: `List the top 6-8 scheduled US macroeconomic events for this month and next month: NFP, CPI, Core PCE, FOMC meetings, and major options expiries. For each, give the official US Eastern Time (ET) release date, and the release time in ET if you're confident of it. Only include events you can find explicitly in the search results — do not guess dates from general knowledge.`,
    searchQuery: "US economic calendar CPI PCE NFP FOMC dates this month",
    scope: "global",
    searchProfile: "authoritative",
    responseFormat: "json",
  },
  {
    id: "macro-briefing",
    category: "Macro",
    title: "Macro Briefing (DXY, Yields, Geopolitics)",
    prompt: `Give a macro briefing for crypto markets covering: (1) how the US Dollar Index (DXY) and 10-year Treasury yield are trending this week and what that implies for crypto risk appetite, (2) any major geopolitical or global financial market risk currently affecting risk-on assets. Do not list specific FOMC/CPI/NFP calendar dates — that is covered separately.${getCategoryRules("Macro")}`,
    searchQuery: "DXY treasury yield geopolitical risk crypto this week",
    scope: "global",
    searchProfile: "trend",
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
        id: `coin-${key}-live`,
        category: "Live",
        title: `${selectedCoin} — Live Pulse (News, Derivatives, On-Chain)`,
        prompt: `Give a full live snapshot of ${formattedToken}: why it's moving, top breaking news/announcements/whale moves in the past 24-72h, current perpetual funding rates and open interest, and any notable exchange net inflow/outflow or on-chain accumulation.${getCategoryRules("Live")}`,
        searchQuery: `${selectedCoin} crypto news funding rate whale flows today`,
        scope: "coin",
        searchProfile: "breaking",
      },
      {
        id: `coin-${key}-weekly-listings`,
        category: "Weekly",
        title: `${selectedCoin} — Exchange Listings & Pairs (All Tiers)`,
        prompt: `What are the latest official announcements regarding new exchange listings, delistings, or perpetual/spot trading pairs for ${formattedToken}? Check both major exchanges (Binance, Coinbase, OKX, Bybit) and mid-tier/regional exchanges (KuCoin, Gate.io, MEXC, Bitget, HTX, Upbit, Bithumb, Coins.ph, PDAX) — do not assume it only lists on the largest platforms.${getCategoryRules("Weekly")}`,
        searchQuery: `${selectedCoin} new listing exchange KuCoin Gate MEXC Bitget Bybit`,
        scope: "coin",
        searchProfile: "weekly",
      },
      {
        id: `coin-${key}-monthly-unlocks`,
        category: "Monthly",
        title: `${selectedCoin} — Token Unlocks & Roadmap`,
        prompt: `What are the major scheduled token unlocks, mainnet upgrades, or governance milestones in the next 30-60 days for ${formattedToken}?${getCategoryRules("Monthly")}`,
        searchQuery: `${selectedCoin} token unlock schedule mainnet upgrade`,
        scope: "coin",
        searchProfile: "authoritative",
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
    const now = nowInManila();

    if (category === "Live") {
      return getDateKeyInZone(runDate, TRADER_TIMEZONE) === getDateKeyInZone(now, TRADER_TIMEZONE);
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

  const runAiSearch = async (item: CatalystPrompt, force = false) => {
    const { id: promptId, prompt: promptText, category, searchQuery, searchProfile, responseFormat } = item;

    setAiLoading((prev) => ({ ...prev, [promptId]: true }));
    setAiErrors((prev) => ({ ...prev, [promptId]: "" }));

    try {
      const res = await fetch("/api/catalyst-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptId,
          prompt: promptText,
          searchQuery,
          searchProfile,
          category,
          forceRefresh: force,
          responseFormat: responseFormat || "markdown",
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