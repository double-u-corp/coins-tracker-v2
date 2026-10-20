import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";

const PROMPT_ID = "watchlist-market-signals";
const CATEGORY = "WatchlistNews";
const MAX_RESULTS = 10;
const MAX_TICKERS = 8;

type SearchChannel = "web" | "social";

type CacheBody = {
  markdown: string;
  updatedAt: number | null;
  /** All monitored base tickers (for multi-select UI). */
  tickers: string[];
  /** Last search selection. */
  lastSymbols?: string[];
  lastChannel?: SearchChannel;
};

type ErrorBody = { error: string };

function baseTicker(symbol: string): string {
  const s = (symbol || "").trim().toUpperCase();
  if (s.endsWith("PHP") && s.length > 3) return s.slice(0, -3);
  return s;
}

/** Same disambiguation spirit as Catalysts — crypto meaning, not presidents/indexes. */
function formatTokenForSearch(token: string): string {
  const base = baseTicker(token);
  switch (base) {
    case "TX":
      return "TX (txEcosystem / Coreum Sologenic crypto token)";
    case "POL":
      return "POL (Polygon formerly MATIC crypto)";
    case "VIRTUAL":
      return "VIRTUAL (Virtuals Protocol AI agent token on Base crypto — not the English word virtual)";
    case "SPX":
      return "SPX (SPX6900 meme coin crypto — not the S&P 500 index)";
    case "TRUMP":
      return "TRUMP (official Trump meme coin on Solana crypto token — not political news about the president alone)";
    case "HYPE":
      return "HYPE (Hyperliquid token crypto)";
    case "RON":
      return "RON (Ronin Axie Infinity token crypto)";
    case "GRAM":
      return "GRAM (Telegram TON related crypto token — not unit of mass)";
    case "UNI":
      return "UNI (Uniswap token crypto)";
    case "LINK":
      return "LINK (Chainlink crypto)";
    case "ENA":
      return "ENA (Ethena crypto)";
    case "XAUT":
      return "XAUT (Tether Gold crypto)";
    case "ONDO":
      return "ONDO (Ondo Finance RWA crypto)";
    case "SKY":
      return "SKY (Sky protocol MakerDAO related crypto)";
    case "SOL":
      return "SOL (Solana blockchain crypto)";
    case "SUI":
      return "SUI (Sui blockchain crypto)";
    case "AAVE":
      return "AAVE (Aave DeFi crypto)";
    case "BCH":
      return "BCH (Bitcoin Cash crypto)";
    case "XLM":
      return "XLM (Stellar crypto)";
    case "ADA":
      return "ADA (Cardano crypto)";
    case "XRP":
      return "XRP (Ripple crypto)";
    case "BNB":
      return "BNB (BNB Chain crypto)";
    case "BTC":
      return "BTC (Bitcoin crypto)";
    case "ETH":
      return "ETH (Ethereum crypto)";
    default:
      return `${base} (crypto token)`;
  }
}

const SEARCH_DISAMBIGUATORS: Record<string, string> = {
  TX: "txEcosystem Coreum Sologenic crypto",
  SPX: "SPX6900 meme coin crypto",
  TRUMP: "TRUMP token Solana meme coin crypto -president -election",
  UNI: "Uniswap UNI token crypto",
  GRAM: "Telegram GRAM TON crypto token",
  SOL: "Solana SOL blockchain crypto",
  HYPE: "Hyperliquid HYPE token crypto",
  VIRTUAL: "Virtuals Protocol VIRTUAL AI agent Base crypto",
  RON: "Ronin Axie RON crypto",
  POL: "Polygon POL MATIC crypto",
  SKY: "Sky protocol MakerDAO SKY crypto",
  LINK: "Chainlink LINK crypto",
  ONDO: "Ondo Finance ONDO RWA crypto",
  XAUT: "Tether Gold XAUT crypto",
  ENA: "Ethena ENA crypto",
  SUI: "Sui SUI blockchain crypto",
  AAVE: "Aave AAVE DeFi crypto",
  BCH: "Bitcoin Cash BCH crypto",
};

function buildSearchQuery(tickers: string[], channel: SearchChannel): string {
  const parts = tickers.map((t) => {
    const base = baseTicker(t);
    const dis = SEARCH_DISAMBIGUATORS[base] || `${base} crypto token`;
    return dis;
  });
  const core = parts.join(" OR ");
  if (channel === "social") {
    // Tavily still hits the open web; we bias query toward social/discussion sources
    return `(${core}) (site:x.com OR site:twitter.com OR site:linkedin.com OR site:reddit.com) crypto news discussion last week`;
  }
  // Pure web / news-style (Google-like via Tavily)
  return `(${core}) crypto news last 7 days -presale -giveaway`;
}

async function fetchTavily(query: string, channel: SearchChannel): Promise<string> {
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) throw new Error("TAVILY_API_KEY is missing.");

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: tavilyApiKey,
      query,
      topic: channel === "social" ? "general" : "news",
      search_depth: "basic",
      days: channel === "social" ? 7 : 5,
      include_answer: true,
      max_results: MAX_RESULTS,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tavily error: ${errorText}`);
  }

  const data = await response.json();
  const results = (data.results || []).slice(0, MAX_RESULTS);
  const directAnswer = data.answer ? `Direct Summary: ${data.answer}\n\n` : "";
  const snippets = results
    .map(
      (item: { title?: string; content?: string; url?: string }, i: number) =>
        `${i + 1}. ${item.title}: ${item.content} (${item.url})`
    )
    .join("\n");

  return `${directAnswer}Results (max ${MAX_RESULTS}):\n${snippets || "(no results)"}`;
}

async function summarizeWithGroq(
  tickers: string[],
  channel: SearchChannel,
  searchContext: string
): Promise<string> {
  const labels = tickers.map(formatTokenForSearch).join("; ");
  const channelNote =
    channel === "social"
      ? "Prefer posts/discussion from X/Twitter, LinkedIn, Reddit when present in context."
      : "Prefer mainstream web/news articles (not social chatter) when present in context.";

  const prompt =
    `Summarize NEWS for these crypto assets only: ${labels}.\n` +
    `Channel focus: ${channel === "social" ? "social media" : "web/news"}. ${channelNote}\n` +
    `Rules: NEUTRAL — do not force bullish. Only SEARCH CONTEXT. No invented numbers/dates.\n` +
    `TRUMP = meme coin token, not political campaign coverage unless the token is named.\n` +
    `SPX = SPX6900 coin, not S&P 500. VIRTUAL = Virtuals Protocol token.\n` +
    `Format:\n` +
    `1) First line: **Sentiment:** 🟢 BULLISH | 🔴 BEARISH | ⚪ NEUTRAL — one sentence\n` +
    `2) At most ${MAX_RESULTS} bullets total: **TICKER** — fact [Source](url)\n` +
    `3) Skip tickers with nothing in context.\n` +
    `4) End with Sources: unique URLs\n` +
    `5) Plain markdown only — no code fences.`;

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    return (
      `**Sentiment:** ⚪ NEUTRAL — Tavily raw results (Groq not configured)\n\n` +
      `Selected: ${tickers.join(", ")} · channel: ${channel}\n\n${searchContext}`
    );
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL_MARKDOWN || "qwen/qwen3.8-27b",
      messages: [
        {
          role: "system",
          content:
            "Extract facts from SEARCH CONTEXT only. Never fabricate. Cap bullets at 10. Neutral stance.",
        },
        {
          role: "user",
          content: `SEARCH CONTEXT:\n${searchContext}\n\nUSER QUERY:\n${prompt}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 1200,
      reasoning_effort: "none",
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      (errorData as { error?: { message?: string } }).error?.message ||
        "Failed to summarize watchlist news"
    );
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error("Empty AI summary for watchlist news");
  return content.trim();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CacheBody | ErrorBody>
) {
  if (req.method === "GET") {
    try {
      const log = await prisma.catalystLog.findUnique({ where: { promptId: PROMPT_ID } });
      const coins = await prisma.coin.findMany({
        select: { symbol: true },
        orderBy: { symbol: "asc" },
      });
      const tickers = coins.map((c) => baseTicker(c.symbol));
      let lastSymbols: string[] | undefined;
      let lastChannel: SearchChannel | undefined;
      // Optional meta stored as JSON prefix comment — parse if present
      if (log?.response?.startsWith("<!--meta:")) {
        try {
          const end = log.response.indexOf("-->");
          const meta = JSON.parse(log.response.slice(9, end));
          lastSymbols = meta.symbols;
          lastChannel = meta.channel;
        } catch {
          /* ignore */
        }
      }
      const markdown = log?.response?.replace(/^<!--meta:.*?-->\n?/s, "") || "";
      return res.status(200).json({
        markdown,
        updatedAt: log ? new Date(log.updatedAt).getTime() : null,
        tickers,
        lastSymbols,
        lastChannel,
      });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = (req.body || {}) as {
      symbols?: string[];
      channel?: SearchChannel;
    };
    const channel: SearchChannel = body.channel === "social" ? "social" : "web";

    const coins = await prisma.coin.findMany({
      select: { symbol: true, name: true },
      orderBy: { symbol: "asc" },
    });
    if (coins.length === 0) {
      return res.status(400).json({ error: "No monitored coins" });
    }

    const allTickers = [...new Set(coins.map((c) => baseTicker(c.symbol)))];
    let selected = (body.symbols || [])
      .map(baseTicker)
      .filter((t) => allTickers.includes(t));
    if (selected.length === 0) {
      // Default: a few liquid names if user selected none
      selected = allTickers.filter((t) =>
        ["BTC", "ETH", "SOL", "ONDO", "TX"].includes(t)
      );
      if (selected.length === 0) selected = allTickers.slice(0, 5);
    }
    selected = selected.slice(0, MAX_TICKERS);

    const query = buildSearchQuery(selected, channel);
    const searchContext = await fetchTavily(query, channel);
    let markdown = await summarizeWithGroq(selected, channel, searchContext);
    const meta = `<!--meta:${JSON.stringify({ symbols: selected, channel })}-->\n`;
    const stored = meta + markdown;

    await prisma.catalystLog.upsert({
      where: { promptId: PROMPT_ID },
      create: { promptId: PROMPT_ID, category: CATEGORY, response: stored },
      update: { category: CATEGORY, response: stored },
    });

    return res.status(200).json({
      markdown,
      updatedAt: Date.now(),
      tickers: allTickers,
      lastSymbols: selected,
      lastChannel: channel,
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
