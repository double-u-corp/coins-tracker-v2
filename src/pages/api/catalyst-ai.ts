import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";

type ResponseData = {
  response?: string;
  logs?: Record<string, { timestamp: number; response: string; category: string }>;
  error?: string;
};

async function fetchTavilySearch(query: string): Promise<string> {
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) throw new Error("TAVILY_API_KEY is missing.");

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: tavilyApiKey,
      query,
      search_depth: "basic",
      include_answer: true,
      max_results: 5,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tavily Search API Error: ${errorText}`);
  }

  const data = await response.json();
  const directAnswer = data.answer ? `Direct Summary: ${data.answer}\n\n` : "";
  const snippets = data.results
    ?.map((item: any) => `- ${item.title}: ${item.content} (${item.url})`)
    .join("\n") || "";

  return `${directAnswer}Recent Market Data:\n${snippets}`;
}

async function summarizeWithGroq(prompt: string, searchContext: string): Promise<string> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) throw new Error("GROQ_API_KEY is missing.");

  const systemPrompt = `You are an elite real-time crypto intelligence analyst. Synthesize the web search context to answer the user query for the target crypto asset.

FORMATTING REQUIREMENTS:
1. MANDATORY: The VERY FIRST line MUST be an explicit sentiment verdict in this exact format:
   **Sentiment:** 🟢 BULLISH | 🔴 BEARISH | ⚪ NEUTRAL — [Concise 1-sentence explanation]
2. Provide 3-4 distinct, highly actionable bullet points summarizing price drivers, funding rates, protocol updates, or whale movements.
3. Every single fact, announcement, or metric MUST cite its source using inline bracket links like [Source Title](URL).`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `SEARCH CONTEXT:\n${searchContext}\n\nUSER QUERY:\n${prompt}` },
      ],
      temperature: 0.2,
      max_tokens: 1200,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || "Failed to generate AI summary.");
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "No response generated.";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseData>) {
  if (req.method === "GET") {
    try {
      const logs = await prisma.catalystLog.findMany();
      const mappedLogs: Record<string, { timestamp: number; response: string; category: string }> = {};

      logs.forEach((log) => {
        mappedLogs[log.promptId] = {
          timestamp: new Date(log.updatedAt).getTime(),
          response: log.response,
          category: log.category,
        };
      });

      return res.status(200).json({ logs: mappedLogs });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  }

  if (req.method === "POST") {
    const { promptId, prompt, category, forceRefresh } = req.body || {};

    if (!promptId || !prompt || !category) {
      return res.status(400).json({ error: "promptId, prompt, and category are required." });
    }

    try {
      if (!forceRefresh) {
        const existingLog = await prisma.catalystLog.findUnique({ where: { promptId } });
        if (existingLog) {
          return res.status(200).json({ response: existingLog.response });
        }
      }

      const searchContext = await fetchTavilySearch(prompt);
      const summary = await summarizeWithGroq(prompt, searchContext);

      await prisma.catalystLog.upsert({
        where: { promptId },
        update: { response: summary, category, updatedAt: new Date() },
        create: { promptId, category, response: summary },
      });

      return res.status(200).json({ response: summary });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message || "Failed to execute scan." });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ error: "Method not allowed" });
}