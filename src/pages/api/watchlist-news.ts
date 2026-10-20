import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";

const PROMPT_ID = "watchlist-market-signals";
const CATEGORY = "WatchlistNews";

type CacheBody = {
  markdown: string;
  updatedAt: number | null;
  tickers: string[];
};

type ErrorBody = { error: string };

function baseTicker(symbol: string): string {
  const s = symbol.toUpperCase();
  return s.endsWith("PHP") && s.length > 3 ? s.slice(0, -3) : s;
}

async function fetchTavily(query: string): Promise<string> {
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) throw new Error("TAVILY_API_KEY is missing.");

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: tavilyApiKey,
      query,
      topic: "news",
      search_depth: "basic",
      days: 3,
      include_answer: true,
      max_results: 8,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tavily error: ${errorText}`);
  }

  const data = await response.json();
  const results = data.results || [];
  const directAnswer = data.answer ? `Direct Summary: ${data.answer}\n\n` : "";
  const snippets = results
    .map(
      (item: { title?: string; content?: string; url?: string }) =>
        `- ${item.title}: ${item.content} (${item.url})`
    )
    .join("\n");

  return `${directAnswer}Results:\n${snippets || "(no results)"}`;
}

async function summarizeWithGroq(tickers: string[], searchContext: string): Promise<string> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    // Fallback: structured markdown from Tavily only
    return (
      `**Sentiment:** ⚪ NEUTRAL — Tavily raw results (Groq not configured)\n\n` +
      `Watchlist: ${tickers.join(", ")}\n\n${searchContext}`
    );
  }

  const prompt =
    `You are summarizing NEWS for a Manila spot trader's WATCHLIST only.\n` +
    `Tickers monitored: ${tickers.join(", ")}.\n` +
    `Rules: NEUTRAL stance — do not force bullish. Only use SEARCH CONTEXT. No invented numbers or dates.\n` +
    `Ignore pure price-spam. Prefer catalysts, listings, hacks, regulation, protocol news that name these assets or BTC/ETH market-wide drivers.\n` +
    `Format:\n` +
    `1) First line: **Sentiment:** 🟢 BULLISH | 🔴 BEARISH | ⚪ NEUTRAL — one sentence\n` +
    `2) Up to 6 bullets: **TICKER** — fact [Source](url) from context only\n` +
    `3) If a ticker has nothing in context, skip it (do not invent).\n` +
    `4) End with "Sources:" and unique URLs from context.`;

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
            "Extract and organize facts from SEARCH CONTEXT only. Never fabricate. Prefer fewer verified bullets over padded speculation.",
        },
        {
          role: "user",
          content: `SEARCH CONTEXT:\n${searchContext}\n\nUSER QUERY:\n${prompt}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 1200,
      // Same family as catalyst-ai markdown summaries
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
      const coins = await prisma.coin.findMany({ select: { symbol: true }, orderBy: { symbol: "asc" } });
      const tickers = coins.map((c) => baseTicker(c.symbol));
      return res.status(200).json({
        markdown: log?.response || "",
        updatedAt: log ? new Date(log.updatedAt).getTime() : null,
        tickers,
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
    const coins = await prisma.coin.findMany({
      select: { symbol: true, name: true },
      orderBy: { symbol: "asc" },
    });
    if (coins.length === 0) {
      return res.status(400).json({ error: "No monitored coins" });
    }

    const tickers = [...new Set(coins.map((c) => baseTicker(c.symbol)))];
    // Two focused queries — avoids one giant noisy search
    const majors = tickers.filter((t) =>
      ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "LINK", "AVAX", "SUI", "DOT"].includes(t)
    );
    const alts = tickers.filter((t) => !majors.includes(t)).slice(0, 18);

    const q1 =
      majors.length > 0
        ? `crypto news last 3 days ${majors.join(" ")} bitcoin ethereum`
        : `crypto market news last 3 days bitcoin ethereum`;
    const q2 =
      alts.length > 0
        ? `crypto news last 3 days ${alts.join(" ")} token listing unlock hack`
        : `crypto altcoin news last 3 days`;

    const [ctx1, ctx2] = await Promise.all([fetchTavily(q1), fetchTavily(q2)]);
    const searchContext = `--- Query A ---\n${ctx1}\n\n--- Query B ---\n${ctx2}`;
    const markdown = await summarizeWithGroq(tickers, searchContext);

    await prisma.catalystLog.upsert({
      where: { promptId: PROMPT_ID },
      create: {
        promptId: PROMPT_ID,
        category: CATEGORY,
        response: markdown,
      },
      update: {
        category: CATEGORY,
        response: markdown,
      },
    });

    return res.status(200).json({
      markdown,
      updatedAt: Date.now(),
      tickers,
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
