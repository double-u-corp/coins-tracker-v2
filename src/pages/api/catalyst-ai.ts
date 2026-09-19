import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";

type ResponseData = {
  response?: string;
  logs?: Record<string, { timestamp: number; response: string; category: string }>;
  error?: string;
};

// "markdown" = human-readable analyst summary (default).
// "json" = structured event list, schema-enforced.
type ResponseFormat = "markdown" | "json";

// Model selection is deliberately different per response format:
// - "markdown" (grounded narrative/analyst summaries): qwen/qwen3.8-27b.
//   This model DEFAULTS to reasoning_effort "none" (per Groq's docs), so it
//   can run in genuinely non-reasoning mode — no hidden chain-of-thought
//   tokens competing with the visible answer for the max_tokens budget
//   (that competition is what caused the earlier finish_reason:"length" /
//   empty-content bug), and less tendency to bridge gaps with inference
//   instead of saying "not found in sources."
//   NOTE: llama-3.3-70b-versatile (previously recommended here) was
//   retired by Groq on 2026-08-16 and is no longer available.
// - "json" (macro calendar events): needs a model Groq supports for STRICT
//   schema-enforced structured outputs (constrained decoding), which is
//   only openai/gpt-oss-20b and openai/gpt-oss-120b. Kept on gpt-oss-120b,
//   with reasoning_effort "low" (its valid range is low/medium/high only —
//   "none" is rejected with a 400 for this model family).
const MODELS: Record<ResponseFormat, string> = {
  markdown: "qwen/qwen3.8-27b",
  json: "openai/gpt-oss-120b",
};

// Max output tokens per format. Deliberately NOT a shared constant:
// - markdown (qwen3.8-27b, reasoning_effort:"none"): no hidden reasoning
//   tokens to budget for, and this account's on_demand tier caps
//   qwen/qwen3.8-27b at 1000 output tokens/minute (OTPM) — asking for more
//   than that gets the request rejected outright, not just truncated.
//   Left with headroom below the cap rather than sitting right at it.
// - json (gpt-oss-120b, reasoning_effort:"low"): still has some hidden
//   reasoning overhead even at "low," so keeps a larger budget.
const MAX_OUTPUT_TOKENS: Record<ResponseFormat, number> = {
  markdown: 800,
  json: 2000,
};

const MACRO_EVENT_SCHEMA = {
  name: "macro_events",
  strict: true,
  schema: {
    type: "object",
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD, official US Eastern Time (ET) calendar date" },
            timeET: { type: "string", description: "HH:mm 24-hour ET release time; empty string if not confidently known" },
            title: { type: "string" },
            type: { type: "string", enum: ["NFP", "CPI", "PCE", "FOMC", "EXPIRY", "OTHER"] },
            severity: { type: "string", enum: ["high", "medium"] },
          },
          // Groq's strict mode requires every property listed here, even
          // ones that are semantically optional — timeET uses "" to mean
          // "unknown" rather than being an omittable key.
          required: ["date", "timeET", "title", "type", "severity"],
          additionalProperties: false,
        },
      },
    },
    required: ["events"],
    additionalProperties: false,
  },
};
// "news" topic and a tight recency window. Deeper/structural lookups (unlock
// schedules, macro calendar dates) benefit more from "advanced" search depth
// than from a narrow day window, since the info they need isn't necessarily
// from the last few days.
type SearchProfile = "breaking" | "weekly" | "trend" | "authoritative";

// Search behavior is keyed by an explicit profile set per-prompt, not
// inferred from the category label. Categories get renamed/merged over
// time (this exact function silently broke when News+Daily became "Live" —
// it kept matching the old names and every Live scan fell through to the
// generic default, losing its news-recency settings with no error thrown).
// An explicit profile can't go stale that way.
function getTavilySearchParams(profile: SearchProfile) {
  switch (profile) {
    case "breaking":
      // Freshest possible: news topic, tight 3-day window.
      return { topic: "news", search_depth: "basic", days: 3 };
    case "weekly":
      return { topic: "news", search_depth: "basic", days: 10 };
    case "trend":
      // Needs current-week recency (DXY/yields/geopolitical mood) but
      // benefits from deeper search than a quick news skim.
      return { topic: "news", search_depth: "advanced", days: 7 };
    case "authoritative":
      // Scheduled/roadmap facts (unlock dates, FOMC calendar) — accuracy
      // matters more than recency; a hard day-window can exclude the one
      // official announcement page that's actually correct.
      return { topic: "general", search_depth: "advanced", days: undefined };
    default:
      return { topic: "general", search_depth: "basic", days: undefined };
  }
}

async function fetchTavilySearch(searchQuery: string, searchProfile: SearchProfile): Promise<string> {
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) throw new Error("TAVILY_API_KEY is missing.");

  const { topic, search_depth, days } = getTavilySearchParams(searchProfile);

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: tavilyApiKey,
      query: searchQuery,
      topic,
      search_depth,
      ...(days ? { days } : {}),
      include_answer: true,
      max_results: 5,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tavily Search API Error: ${errorText}`);
  }

  const data = await response.json();
  const results = data.results || [];
  const directAnswer = data.answer ? `Direct Summary: ${data.answer}\n\n` : "";
  const snippets = results
    .map((item: any) => `- ${item.title}: ${item.content} (${item.url})`)
    .join("\n");

  // Give the model an explicit, honest signal about how much it actually
  // has to work with, instead of leaving it to infer "is this enough" on
  // its own — that inference is exactly where fabrication creeps in.
  const usableResultCount = results.filter((r: any) => (r.content || "").length > 60).length;
  const contextQualityNote =
    usableResultCount === 0
      ? "SEARCH QUALITY NOTE: 0 substantive results were returned for this query. Treat this as effectively NO real data available — do not attempt to answer from general knowledge or plausible assumptions."
      : `SEARCH QUALITY NOTE: ${usableResultCount} substantive result(s) returned out of ${results.length} total. Base your answer strictly on what these actually say.`;

  return `${contextQualityNote}\n\n${directAnswer}Recent Market Data:\n${snippets || "(no results returned)"}`;
}

function getSystemPrompt(responseFormat: ResponseFormat): string {
  if (responseFormat === "json") {
    return `You are a data extraction engine. Read the SEARCH CONTEXT and extract only the requested scheduled events into the "events" array.

GROUNDING (highest priority):
1. Only include events that are explicitly present in the SEARCH CONTEXT. Do not add events, dates, or times from general knowledge or plausible-sounding guesses.
2. If you are not confident about "timeET" for a given event, set it to an empty string "" rather than guessing.
3. If the SEARCH CONTEXT contains no qualifying events at all, return an empty "events" array.
The response format (keys, types) is enforced automatically — focus only on getting the content right.`;
  }

  return `You are a real-time crypto intelligence analyst. Synthesize ONLY the information present in the provided SEARCH CONTEXT to answer the user query. You are extracting and organizing facts that are already in the search context — you are not permitted to add facts, figures, or claims that are not explicitly present in it.

ANTI-FABRICATION RULES (highest priority — override the formatting rules below if they conflict):
1. NEVER invent specific numbers — funding rates, open interest, whale transfer amounts, prices, percentages — that do not literally appear in the SEARCH CONTEXT. A precise-looking number with no basis in the context is a fabrication, not a fact.
2. NEVER invent or imply a source that isn't in the SEARCH CONTEXT. If you don't have a real URL from the context for a claim, don't cite one — and don't state the claim as fact either.
3. If the SEARCH CONTEXT does not contain enough real information to answer part (or all) of the query, SAY SO PLAINLY instead of filling the gap. It is correct and expected to write "No reliable data found on [X] in the current search results" rather than inventing plausible-sounding figures.
4. It is better to give 1 verified bullet point (or zero, with an honest note) than 4 bullet points where some are fabricated.

FORMATTING REQUIREMENTS (subject to the anti-fabrication rules above):
1. The VERY FIRST line MUST be an explicit sentiment verdict in this exact format:
   **Sentiment:** 🟢 BULLISH | 🔴 BEARISH | ⚪ NEUTRAL — [Concise 1-sentence explanation]
   If the search context is too thin to support any sentiment judgment, use ⚪ NEUTRAL and say so explicitly (e.g., "insufficient data to assess").
2. Provide up to 3-4 distinct bullet points summarizing price drivers, funding rates, protocol updates, or whale movements — but ONLY for points actually backed by the search context. Do not pad to reach 3-4 if the context doesn't support that many.
3. Every fact, announcement, or metric MUST cite its source using inline bracket links like [Source Title](URL), where the URL is copied from the SEARCH CONTEXT — never invented.`;
}

async function summarizeWithGroq(
  prompt: string,
  searchContext: string,
  responseFormat: ResponseFormat
): Promise<string> {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) throw new Error("GROQ_API_KEY is missing.");

  const systemPrompt = getSystemPrompt(responseFormat);

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODELS[responseFormat],
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `SEARCH CONTEXT:\n${searchContext}\n\nUSER QUERY:\n${prompt}` },
      ],
      temperature: responseFormat === "json" ? 0 : 0.1,
      max_tokens: MAX_OUTPUT_TOKENS[responseFormat],
      // qwen3.8-27b accepts "none" (fully disables reasoning — this is the
      // model's own default, set explicitly here for clarity). gpt-oss
      // models reject "none" with a 400; they only accept low/medium/high.
      reasoning_effort: responseFormat === "json" ? "low" : "none",
      ...(responseFormat === "json"
        ? {
            response_format: { type: "json_schema", json_schema: MACRO_EVENT_SCHEMA },
          }
        : {}),
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || "Failed to generate AI summary.");
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content || !content.trim()) {
    const finishReason = data.choices?.[0]?.finish_reason;
    const hint =
      finishReason === "length"
        ? "The model likely spent its full token budget on internal reasoning before writing an answer. Try Re-Scan — if this keeps happening, the prompt may need simplifying."
        : "This usually means the search context was too thin or the request was rejected mid-generation.";
    throw new Error(`The AI returned no content (finish_reason: ${finishReason || "unknown"}). ${hint}`);
  }

  return content;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseData>) {
  if (req.method === "GET") {
    try {
      // Exclude ChartScan rows — those belong to the coin scanner feature,
      // which shares this table but is a separate consumer. Without this
      // filter, every Catalysts page load would also fetch and discard
      // every tracked coin's scan history for no reason.
      const logs = await prisma.catalystLog.findMany({ where: { category: { not: "ChartScan" } } });
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
    const { promptId, prompt, searchQuery, category, searchProfile, forceRefresh, responseFormat } = req.body || {};

    if (!promptId || !prompt || !category) {
      return res.status(400).json({ error: "promptId, prompt, and category are required." });
    }

    // Fall back to the full prompt as the search query if the caller didn't
    // send a short one, so older clients don't break — but callers should
    // always send a short, keyword-style searchQuery for best search results.
    const effectiveSearchQuery: string = searchQuery || prompt;
    const format: ResponseFormat = responseFormat === "json" ? "json" : "markdown";
    // Fallback for any caller that doesn't send an explicit searchProfile —
    // maps from category as a best-effort guess, but a client sending a
    // real searchProfile always wins.
    const fallbackProfile: SearchProfile =
      category === "Live" ? "breaking" : category === "Weekly" ? "weekly" : "authoritative";
    const effectiveSearchProfile: SearchProfile = searchProfile || fallbackProfile;

    try {
      if (!forceRefresh) {
        const existingLog = await prisma.catalystLog.findUnique({ where: { promptId } });
        if (existingLog) {
          return res.status(200).json({ response: existingLog.response });
        }
      }

      const searchContext = await fetchTavilySearch(effectiveSearchQuery, effectiveSearchProfile);
      const summary = await summarizeWithGroq(prompt, searchContext, format);

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