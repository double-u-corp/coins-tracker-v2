import { useState } from "react";

export interface CatalystPrompt {
  id: string;
  category: "Daily" | "Weekly" | "Monthly";
  title: string;
  prompt: string;
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

// Daily Ticker Batches
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

// Weekly Exchange Listings & Delistings Batches
const exchangeListingPrompts: CatalystPrompt[] = tokenBatches.map((batch, index) => ({
  id: `weekly-listings-${index + 1}`,
  category: "Weekly",
  title: `Exchange Listings Batch ${index + 1} (${batch.join(", ")})`,
  prompt: `What are the latest official announcements regarding new listings, upcoming delistings, or network support changes on major exchanges (including Binance, Coinbase, OKX, Bybit, and Coins.ph) for ${batch.join(", ")}?`,
}));

// Monthly Unlocks Batches
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
  };
}