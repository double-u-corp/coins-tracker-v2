import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";

type ResponseData = {
  response?: string;
  logs?: Record<string, { timestamp: number; response: string; category: string }>;
  error?: string;
};

function checkIsPeriodCurrent(timestamp: Date, category: string): boolean {
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
}

async function fetchTavilySearch(query: string): Promise<string> {
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) throw new Error("TAVILY_API_KEY is missing in environment variables.");

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
  const directAnswer = data.answer ? `Tavily Direct Summary: ${data.answer}\n\n` : "";
  const snippets =
    data.results
      ?.map((item: any) => `- ${item.title}: ${item.content} (${item.url})`)
      .join("\n") || "";

  return `${directAnswer}Recent News & Market Snippets:\n${snippets}`;
}

async function summarizeWithGroq(prompt: string, searchContext: string): Promise<string> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) throw new Error("GROQ_API_KEY is missing in environment variables.");

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: [
        {
          role: "system",
          content:
            "You are a real-time crypto analyst. Synthesize the provided web search context and answer the user query directly in 3-4 concise bullet points. Highlight funding rates, open interest, liquidations, exchange announcements, or protocol updates if mentioned in the context. Always cite key sources using brackets like 【url】 or 【Source Name】 when relevant.",
        },
        {
          role: "user",
          content: `SEARCH CONTEXT:\n${searchContext}\n\nUSER QUERY:\n${prompt}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || "Failed to generate AI summary with Groq.");
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "No response generated.";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  // GET: Load all existing database logs on initial page load
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

  // POST: Retrieve cached result or trigger live Tavily + Groq scan
  if (req.method === "POST") {
    const { promptId, prompt, category, forceRefresh } = req.body || {};

    if (!promptId || !prompt || !category) {
      return res.status(400).json({ error: "promptId, prompt, and category are required." });
    }

    try {
      if (!forceRefresh) {
        const existingLog = await prisma.catalystLog.findUnique({
          where: { promptId },
        });

        if (existingLog && checkIsPeriodCurrent(existingLog.updatedAt, category)) {
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
      console.error("Catalyst AI Error:", err);
      return res.status(500).json({
        error: (err as Error).message || "Failed to process live AI news request.",
      });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ error: "Method not allowed" });
}