import { useState, useEffect, useCallback, useMemo } from "react";
import type { JournalEntryView } from "@/validators/journalSchema";
import type { CoinSummary } from "@/validators/recordSchema";
import { nowInManila, getDateKeyInZone, TRADER_TIMEZONE } from "../../lib/timezone";

export interface CatalystPrompt {
  id: string;
  category: "Live" | "Weekly" | "Monthly" | "Macro";
  title: string;
  prompt: string;
  searchQuery: string;
  scope: "coin" | "global";
  searchProfile: "breaking" | "weekly" | "trend" | "authoritative";
  responseFormat?: "markdown" | "json";
  tier?: "standard" | "deepDive";
}

export interface CachedAiLog {
  timestamp: number;
  response: string;
  category: string;
}


const getCategoryRules = (category: CatalystPrompt["category"]) => {
  switch (category) {
    case "Live":
      return (
        " RULES: 1. Cover the past 24-72 hours AND any confirmed events scheduled in the next 24-72 hours that could move price. " +
        "2. Include current 24h derivatives (funding, open interest, liquidations) and notable on-chain net flows where found. " +
        "3. Overall sentiment: Bullish / Bearish / Neutral. " +
        "4. List BOTH (A) Key Bullish Drivers and (B) Key Bearish/Downside Risks. " +
        "5. Include source links when available. 6. Do not invent scheduled dates — only list events explicitly found."
      );
    case "Weekly":
      return (
        " RULES: 1. Cover a 7-day lookback AND a 7-day lookahead. " +
        "2. Check major and mid-tier/regional exchanges (incl. Coins.ph, PDAX). " +
        "3. Equal weight to delistings/restrictions vs new listings. " +
        "4. Separate RECENT (past 7d) vs UPCOMING (next 7d) when both exist."
      );
    case "Monthly":
      return (
        " RULES: 1. 30-60 day horizon: unlocks (% supply if known), mainnet upgrades, TGEs, governance. " +
        "2. Highlight supply pressure. 3. CONFIRM vs RUMOR. 4. If none found, say so."
      );
    case "Macro":
      return (
        " RULES: 1. Stay within this prompt topic only. " +
        "2. Prefer forward-looking risk for crypto (1-4 weeks). " +
        "3. Do not invent calendar dates."
      );
    default:
      return "";
  }
};

/**
 * Coins.ph / local pairs are stored as e.g. VIRTUALPHP, SUIPHP.
 * Tavily and news use the global ticker (VIRTUAL, SUI) — never "*PHP".
 */
export function baseAssetSymbol(symbol: string): string {
  const s = (symbol || "").trim().toUpperCase();
  if (s.endsWith("PHP") && s.length > 3) return s.slice(0, -3);
  return s;
}

const formatTokenForPrompt = (token: string) => {
  const base = baseAssetSymbol(token);
  switch (base) {
    case "TX":
      return "TX (txEcosystem / tx protocol, merged token of Coreum and Sologenic)";
    case "POL":
      return "POL (Polygon, formerly MATIC)";
    case "VIRTUAL":
      return "VIRTUAL (Virtuals Protocol, AI agent token on Base — not the English word virtual)";
    case "SPX":
      return "SPX (SPX6900 meme coin — not the S&P 500 index)";
    case "HYPE":
      return "HYPE (Hyperliquid token)";
    case "RON":
      return "RON (Ronin / Axie Infinity token)";
    case "GRAM":
      return "GRAM (Telegram/TON related token, not the unit of mass)";
    case "UNI":
      return "UNI (Uniswap token)";
    case "LINK":
      return "LINK (Chainlink)";
    case "ENA":
      return "ENA (Ethena)";
    case "XAUT":
      return "XAUT (Tether Gold)";
    case "ONDO":
      return "ONDO (Ondo Finance RWA)";
    case "SKY":
      return "SKY (Sky protocol / MakerDAO related)";
    default:
      return `${base} (crypto token)`;
  }
};

const SEARCH_DISAMBIGUATORS: Record<string, string> = {
  TX: "txEcosystem Coreum Sologenic crypto",
  SPX: "SPX6900 meme coin crypto",
  TRUMP: "TRUMP token Solana meme coin crypto",
  UNI: "Uniswap UNI token crypto",
  GRAM: "Telegram GRAM TON crypto token",
  SOL: "Solana SOL blockchain crypto",
  HYPE: "Hyperliquid HYPE token crypto",
  VIRTUAL: "Virtuals Protocol VIRTUAL AI agent token Base crypto",
  RON: "Ronin Axie Infinity RON crypto token",
  POL: "Polygon POL MATIC crypto token",
  SKY: "Sky protocol MakerDAO SKY crypto token",
  LINK: "Chainlink LINK crypto token",
  ONDO: "Ondo Finance ONDO RWA crypto token",
  XAUT: "Tether Gold XAUT crypto token",
  ENA: "Ethena ENA synthetic dollar crypto token",
  SUI: "Sui SUI blockchain crypto",
  AAVE: "Aave AAVE DeFi crypto",
  BCH: "Bitcoin Cash BCH crypto",
  XLM: "Stellar XLM crypto",
  HBAR: "Hedera HBAR crypto",
  ASTER: "ASTER crypto token",
  XPL: "XPL crypto token",
  BGB: "Bitget BGB token crypto",
  WEMIX: "WEMIX crypto token",
};

function buildCoinSearchQuery(pairOrTicker: string, suffix: string): string {
  const base = baseAssetSymbol(pairOrTicker);
  const disambiguator = SEARCH_DISAMBIGUATORS[base];
  // Never send VIRTUALPHP / SUIPHP to Tavily — only the base asset + disambiguators.
  const subject = disambiguator ? `${base} ${disambiguator}` : `${base} crypto token`;
  return `${subject} ${suffix}`;
}

export function buildPortablePrompt(basePrompt: string): string {
  const today = getDateKeyInZone(nowInManila(), TRADER_TIMEZONE);
  return (
    `Please search the web for the most current, real information before answering — ` +
    `do not rely on your training data alone, and do not guess or fabricate specific numbers, dates, or sources if you can't find them. ` +
    `Today's date is ${today} (Asia/Manila trader calendar).\n\n${basePrompt}`
  );
}

const STATIC_GLOBAL_PROMPTS: CatalystPrompt[] = [
  {
    id: "macro-calendar-events",
    category: "Macro",
    title: "Upcoming Macro Event Dates (FOMC, CPI, PCE, NFP)",
    prompt: `List the top 6-8 scheduled US macro events for this month and next month that crypto traders watch: NFP, CPI, Core PCE, FOMC, major options expiries if found. For each: date, ET time if known, why it can move crypto. Only dates found in search results.${getCategoryRules("Macro")}`,
    searchQuery: "US economic calendar CPI PCE NFP FOMC dates this month next month",
    scope: "global",
    searchProfile: "authoritative",
    responseFormat: "json",
  },
  {
    id: "macro-briefing",
    category: "Macro",
    title: "Macro Briefing (DXY, Yields, Risk Appetite)",
    prompt: `Macro briefing for crypto risk appetite: (1) DXY and 10y yield this week and implication for BTC/alts, (2) geopolitical or financial stress that could force risk-off in the next 1-2 weeks. No FOMC/CPI calendar dates. No SEC/legal.${getCategoryRules("Macro")}`,
    searchQuery: "DXY treasury yield risk off crypto this week",
    scope: "global",
    searchProfile: "trend",
  },
  {
    id: "macro-regulation-sec",
    category: "Macro",
    title: "Regulatory & Policy Watch (SEC, CFTC, Legislation)",
    prompt: `Regulatory/legal/policy crypto developments in the last 7 days that could affect liquidity in coming weeks. Flag known decision dates. No DXY/yields.${getCategoryRules("Macro")}`,
    searchQuery: "crypto regulation SEC CFTC lawsuit bill stablecoin rule this week",
    scope: "global",
    searchProfile: "trend",
  },
  {
    id: "global-crypto-stress",
    category: "Live",
    title: "Crypto Market Stress (Liquidations, Risk-Off, BTC Dominance)",
    prompt: `Is broader crypto under stress (past 72h + next few days)? Liquidation cascades, BTC dominance shifts, confirmed stablecoin issues, exchange outages, risk-off from alts. Overall: Risk-on / Mixed / Risk-off. Implication for altcoin LONG entries this week. No invented $ figures.`,
    searchQuery: "crypto liquidations BTC dominance risk off exchange outage stablecoin",
    scope: "global",
    searchProfile: "breaking",
  },
  {
    id: "global-hacks-exploit-risks",
    category: "Live",
    title: "DeFi Hacks & Exploit Risk (Market-Wide)",
    prompt: `Recent exploits, bridge hacks, emergency pauses in past 72h — official or security-firm confirmed only. Protocol, $ impact if known, contagion notes if stated.`,
    searchQuery: "crypto exploit hack flash loan bridge drain compromise",
    scope: "global",
    searchProfile: "breaking",
  },
  {
    id: "global-altcoin-season-flow",
    category: "Weekly",
    title: "Altcoin Flow & Sector Rotation (Weekly)",
    prompt: `Past 7d and next 7d: flows favoring BTC, ETH, or alt sectors (L2, AI, RWA, meme, DeFi)? Facts vs opinion. One-line implication for selective mid-cap LONG entries. No invented flow numbers.`,
    searchQuery: "crypto altcoin season BTC ETH sector rotation ETF flows this week",
    scope: "global",
    searchProfile: "weekly",
  },
  {
    id: "weekly-coins-ph",
    category: "Weekly",
    title: "Coins.ph Platform Updates (PH Spot)",
    prompt: `Official Coins.ph announcements (listings, delistings, fees, maintenance) in 7-day lookback or lookahead. Flag PHP spot pair impact.`,
    searchQuery: "Coins.ph official announcement listing delisting update",
    scope: "global",
    searchProfile: "weekly",
  },
];

export function useCatalystsLogic() {
  const [selectedCoin, setSelectedCoin] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  /** coin = this asset; global = market-wide only (no coin picker). */
  const [selectedScope, setSelectedScope] = useState<"coin" | "global">("coin");
  const [allCoins, setAllCoins] = useState<CoinSummary[]>([]);
  const [coinsLoading, setCoinsLoading] = useState(true);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [aiCache, setAiCache] = useState<Record<string, CachedAiLog>>({});
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [aiErrors, setAiErrors] = useState<Record<string, string>>({});
  const [savedStatus, setSavedStatus] = useState<Record<string, boolean>>({});

  const [entries, setEntries] = useState<JournalEntryView[]>([]);
  const [journalLoading, setJournalLoading] = useState(true);
  const [journalError, setJournalError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(true);

  const coinSpecificPrompts = useMemo<CatalystPrompt[]>(() => {
    if (!selectedCoin) return [];
    const base = baseAssetSymbol(selectedCoin);
    const formattedToken = formatTokenForPrompt(selectedCoin);
    const key = selectedCoin.toLowerCase();
    const pairNote =
      base !== selectedCoin.toUpperCase()
        ? ` Local spot pair is ${selectedCoin.toUpperCase()} (PHP); research the underlying asset ${base}, not the string "${selectedCoin}".`
        : "";

    return [
      {
        id: `coin-${key}-live`,
        category: "Live",
        title: `${base} — Live Pulse (News, Derivatives, On-Chain)`,
        prompt: `Live snapshot of ${formattedToken} for a spot LONG-only trader: why it's moving, news/whales past 24-72h, confirmed events next 24-72h, funding/OI, net flows.${pairNote}${getCategoryRules("Live")}`,
        searchQuery: buildCoinSearchQuery(selectedCoin, "news funding rate whale flows upcoming event today"),
        scope: "coin",
        searchProfile: "breaking",
      },
      {
        id: `coin-${key}-upcoming-catalysts`,
        category: "Live",
        title: `${base} — Upcoming Catalysts (Next 7 Days)`,
        prompt: `Confirmed or officially scheduled catalysts for ${formattedToken} in the next 7 days: listings, unlocks, mainnet events, governance votes, partnership go-lives, exchange maintenance. Format: date · event · source. Mark CONFIRM vs RUMOR. If none: say "No confirmed catalysts in the next 7 days". One line each: better for pullback buy vs chase.`,
        searchQuery: buildCoinSearchQuery(selectedCoin, "upcoming listing unlock mainnet event schedule next week"),
        scope: "coin",
        searchProfile: "breaking",
      },
      {
        id: `coin-${key}-weekly-listings`,
        category: "Weekly",
        title: `${base} — Exchange Listings & Pairs (All Tiers)`,
        prompt: `Official listing/delisting/margin/restriction news for ${formattedToken}. RECENT (past 7d) and UPCOMING (next 7d). Major + mid-tier/regional exchanges incl. Coins.ph, PDAX.${getCategoryRules("Weekly")}`,
        searchQuery: buildCoinSearchQuery(selectedCoin, "new listing delisting margin removal restriction exchange"),
        scope: "coin",
        searchProfile: "weekly",
      },
      {
        id: `coin-${key}-monthly-unlocks`,
        category: "Monthly",
        title: `${base} — Token Unlocks & Roadmap`,
        prompt: `Scheduled unlocks, mainnet upgrades, governance milestones for ${formattedToken} in next 30-60 days.${getCategoryRules("Monthly")}`,
        searchQuery: buildCoinSearchQuery(selectedCoin, "token unlock schedule mainnet upgrade calendar"),
        scope: "coin",
        searchProfile: "authoritative",
      },
      {
        id: `coin-${key}-developer-github`,
        category: "Weekly",
        title: `${base} — Developer & Protocol Activity`,
        prompt: `Technical upgrades, releases, forks, or proposals for ${formattedToken} past 7-10 days, plus anything scheduled soon. Official sources only.`,
        searchQuery: buildCoinSearchQuery(selectedCoin, "github mainnet testnet upgrade hard fork protocol update"),
        scope: "coin",
        searchProfile: "weekly",
      },
      {
        id: `coin-${key}-ecosystem-grants`,
        category: "Monthly",
        title: `${base} — Ecosystem, Grants & Partnerships`,
        prompt: `Partnerships, raises, grants, integrations for ${formattedToken} last 30-60 days; any go-live dates still ahead. Official only.`,
        searchQuery: buildCoinSearchQuery(selectedCoin, "ecosystem grant fund venture capital strategic partnership"),
        scope: "coin",
        searchProfile: "authoritative",
      },
      {
        id: `coin-${key}-institutional-adoption`,
        category: "Monthly",
        title: `${base} — Institutional Adoption`,
        prompt: `ETF filings, treasury buys, custody, fund allocations for ${formattedToken} last 30-60 days + upcoming decision dates. Official/financial news only.`,
        searchQuery: buildCoinSearchQuery(selectedCoin, "ETF filing institutional treasury custody adoption"),
        scope: "coin",
        searchProfile: "authoritative",
      },
      {
        id: `coin-${key}-governance-proposals`,
        category: "Weekly",
        title: `${base} — Governance & Protocol Votes`,
        prompt: `Governance/DAO votes for ${formattedToken} past 7-14 days and open votes with end dates. Official forum/Snapshot only.`,
        searchQuery: buildCoinSearchQuery(selectedCoin, "governance proposal DAO vote Snapshot"),
        scope: "coin",
        searchProfile: "weekly",
      },
      {
        id: `coin-${key}-social-sentiment`,
        category: "Live",
        title: `${base} — Social & Community Sentiment`,
        prompt: `Social/community sentiment for ${formattedToken} past 24-72h from articles/aggregators only. Never invent metrics. If unknown, say so.`,
        searchQuery: buildCoinSearchQuery(selectedCoin, "community sentiment social media reaction"),
        scope: "coin",
        searchProfile: "breaking",
        tier: "deepDive",
      },
      {
        id: `coin-${key}-competitive-positioning`,
        category: "Monthly",
        title: `${base} — Competitive Positioning`,
        prompt: `Peer comparison for ${formattedToken} from sources only. Name cited competitors. If none, say so.`,
        searchQuery: buildCoinSearchQuery(selectedCoin, "competitor comparison market share TVL analysis"),
        scope: "coin",
        searchProfile: "trend",
        tier: "deepDive",
      },
    ];
  }, [selectedCoin]);

  const [deepDiveCoins, setDeepDiveCoins] = useState<Record<string, boolean>>({});
  const isDeepDiveOn = !!deepDiveCoins[selectedCoin];
  const toggleDeepDive = (coin: string) => {
    setDeepDiveCoins((prev) => ({ ...prev, [coin]: !prev[coin] }));
  };

  const allPrompts = useMemo(() => {
    const visible = coinSpecificPrompts.filter((p) => p.tier !== "deepDive" || isDeepDiveOn);
    return [...visible, ...STATIC_GLOBAL_PROMPTS];
  }, [coinSpecificPrompts, isDeepDiveOn]);

  const filteredPrompts = useMemo(() => {
    let list = allPrompts;
    if (selectedCategory !== "All") list = list.filter((p) => p.category === selectedCategory);
    if (selectedScope === "coin") list = list.filter((p) => p.scope === "coin");
    else if (selectedScope === "global") list = list.filter((p) => p.scope === "global");
    return list;
  }, [allPrompts, selectedCategory, selectedScope]);

  const coinPrompts = useMemo(() => filteredPrompts.filter((p) => p.scope === "coin"), [filteredPrompts]);
  const globalPrompts = useMemo(() => filteredPrompts.filter((p) => p.scope === "global"), [filteredPrompts]);

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
          } else setAiCache(data.logs);
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

  const fetchCoins = useCallback(async () => {
    setCoinsLoading(true);
    try {
      const res = await fetch("/api/coins");
      if (!res.ok) throw new Error(`Failed to load coins (${res.status})`);
      const data = (await res.json()) as { coins: CoinSummary[] };
      const coins = data.coins ?? [];
      setAllCoins(coins);
      setSelectedCoin((prev) => {
        if (prev && coins.some((c) => c.symbol === prev)) return prev;
        return coins[0]?.symbol ?? "";
      });
    } catch (e) {
      console.error("Failed to load coins", e);
    } finally {
      setCoinsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAiLogs();
    fetchJournalEntries();
    fetchCoins();
  }, [fetchAiLogs, fetchJournalEntries, fetchCoins]);

  const generalEntries = useMemo(
    () => entries.filter((entry) => !entry.symbol || entry.symbol.trim() === ""),
    [entries]
  );

  const checkIsPeriodCurrent = (timestamp: number, category: string) => {
    const runDate = new Date(timestamp);
    const now = nowInManila();
    if (category === "Live") {
      return getDateKeyInZone(runDate, TRADER_TIMEZONE) === getDateKeyInZone(now, TRADER_TIMEZONE);
    }
    if (category === "Weekly" || category === "Macro") {
      return (now.getTime() - runDate.getTime()) / (1000 * 3600 * 24) < 7;
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
    return isCurrent
      ? { status: "current", label: `Fetched • ${dateStr}` }
      : { status: "expired", label: `Expired (${dateStr})` };
  };

  /** User button always forceRefresh so Tavily+Groq run (API skips search when force is false and a log exists). */
  const runAiSearch = async (item: CatalystPrompt, _force = true) => {
    const { id: promptId, prompt: promptText, category, searchQuery, searchProfile, responseFormat } = item;
    if (!promptText?.trim()) {
      setAiErrors((prev) => ({ ...prev, [promptId]: "Missing prompt text." }));
      return;
    }
    if (!searchQuery?.trim()) {
      setAiErrors((prev) => ({
        ...prev,
        [promptId]: "Missing searchQuery — Tavily needs a short keyword query.",
      }));
      return;
    }
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
          searchProfile: searchProfile || "breaking",
          category,
          forceRefresh: true,
          responseFormat: responseFormat || "markdown",
        }),
      });
      const data = await res.json().catch(() => ({} as { response?: string; error?: string }));
      if (!res.ok) {
        throw new Error(
          data.error ||
            `Scan failed (${res.status}). Check TAVILY_API_KEY / GROQ_API_KEY and server logs.`
        );
      }
      if (!data.response || !String(data.response).trim()) {
        throw new Error(
          "API returned an empty response. Often: Tavily empty results, Groq token limit, or missing API keys."
        );
      }
      setAiCache((prev) => ({
        ...prev,
        [promptId]: { timestamp: Date.now(), response: data.response, category },
      }));
    } catch (err: any) {
      setAiErrors((prev) => ({ ...prev, [promptId]: err.message || "An error occurred" }));
    } finally {
      setAiLoading((prev) => ({ ...prev, [promptId]: false }));
    }
  };

  const addJournalEntry = async (input: {
    symbol: string | null;
    entryDate: string;
    title: string;
    notes: string;
  }) => {
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
      setTimeout(() => setSavedStatus((prev) => ({ ...prev, [promptId]: false })), 3000);
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

  const coinOptions = useMemo(
    () =>
      allCoins.map((c) => ({
        value: c.symbol,
        label: c.name ? `${c.name} (${c.symbol})` : c.symbol,
      })),
    [allCoins]
  );

  return {
    selectedCoin,
    setSelectedCoin,
    selectedCategory,
    setSelectedCategory,
    selectedScope,
    setSelectedScope,
    allCoins,
    coinOptions,
    coinsLoading,
    filteredPrompts,
    coinPrompts,
    globalPrompts,
    allPrompts,
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
    isDeepDiveOn,
    toggleDeepDive,
  };
}
