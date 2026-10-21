import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";

const PROMPT_ID = "watchlist-market-signals";
const CATEGORY = "WatchlistNews";
const MAX_RESULTS = 12;
/** Per-outlet cap so one site (e.g. Decrypt) cannot fill the whole list. */
const PER_OUTLET = 2;

/** Core high-signal outlets. */
export const CORE_OUTLETS = [
  { id: "coindesk", host: "coindesk.com", label: "CoinDesk" },
  { id: "theblock", host: "theblock.co", label: "The Block" },
  { id: "cointelegraph", host: "cointelegraph.com", label: "Cointelegraph" },
  { id: "decrypt", host: "decrypt.co", label: "Decrypt" },
  { id: "blockworks", host: "blockworks.co", label: "Blockworks" },
  // CryptoSlate: not scraped — UI links to https://cryptoslate.com/top-news/
] as const;

type RangeKey = "since_last" | "1" | "3" | "7";

type Meta = {
  range?: RangeKey;
  scrapedAt?: string;
  windowStart?: string;
  outletHosts?: string[];
  seenUrls?: string[];
  outletHitCounts?: Record<string, number>;
};

type CacheBody = {
  markdown: string;
  updatedAt: number | null;
  lastScrapedAt: number | null;
  range: RangeKey;
  outlets: { id: string; host: string; label: string }[];
  alreadyScrapedToday: boolean;
  skipped?: boolean;
  message?: string;
  outletHitCounts?: Record<string, number>;
};

type ErrorBody = { error: string };

type TavilyHit = {
  title: string;
  content: string;
  url: string;
  host: string;
  label: string;
};

function manilaDayKey(d = new Date()): string {
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function parseMeta(raw: string | undefined | null): { meta: Meta; body: string } {
  if (!raw) return { meta: {}, body: "" };
  if (raw.startsWith("<!--meta:")) {
    try {
      const end = raw.indexOf("-->");
      const meta = JSON.parse(raw.slice(9, end)) as Meta;
      const body = raw.slice(end + 3).replace(/^\n/, "");
      return { meta, body };
    } catch {
      return { meta: {}, body: raw };
    }
  }
  return { meta: {}, body: raw };
}

function rangeToDays(range: RangeKey, lastScrapedAt: number | null): number {
  if (range === "1") return 1;
  if (range === "3") return 3;
  if (range === "7") return 7;
  if (lastScrapedAt) {
    const hours = (Date.now() - lastScrapedAt) / 3_600_000;
    const days = Math.ceil(hours / 24);
    return Math.min(7, Math.max(1, days));
  }
  return 2;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * One Tavily call restricted to a single outlet via include_domains.
 * Avoids the old single OR site: query that often returned only Decrypt.
 */
async function fetchOutlet(
  outlet: (typeof CORE_OUTLETS)[number],
  days: number
): Promise<TavilyHit[]> {
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) throw new Error("TAVILY_API_KEY is missing.");

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: tavilyApiKey,
      query: `crypto OR bitcoin OR ethereum OR regulation OR ETF OR exchange news`,
      topic: "news",
      search_depth: "basic",
      days,
      include_answer: false,
      max_results: PER_OUTLET,
      include_domains: [outlet.host],
    }),
  });

  if (!response.ok) {
    // Soft-fail one outlet so others still return
    console.error(`Tavily ${outlet.host}:`, await response.text());
    return [];
  }

  const data = await response.json();
  const results = (data.results || []) as {
    title?: string;
    content?: string;
    url?: string;
  }[];

  return results
    .filter((r) => r.url && r.title)
    .slice(0, PER_OUTLET)
    .map((r) => ({
      title: r.title || "",
      content: r.content || "",
      url: r.url!,
      host: hostFromUrl(r.url!) || outlet.host,
      label: outlet.label,
    }));
}

/** Parallel per-outlet fetch, then merge (max ~12). */
async function fetchAllOutlets(days: number): Promise<{
  context: string;
  urls: string[];
  hitCounts: Record<string, number>;
}> {
  const batches = await Promise.all(
    CORE_OUTLETS.map((o) => fetchOutlet(o, days).catch(() => [] as TavilyHit[]))
  );

  const hits: TavilyHit[] = [];
  const seen = new Set<string>();
  const hitCounts: Record<string, number> = {};

  for (const batch of batches) {
    for (const h of batch) {
      const key = h.url.split("?")[0];
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(h);
      hitCounts[h.label] = (hitCounts[h.label] || 0) + 1;
    }
  }

  const limited = hits.slice(0, MAX_RESULTS);
  const snippets = limited
    .map(
      (h, i) =>
        `${i + 1}. [${h.label}] ${h.title}: ${h.content} (${h.url})`
    )
    .join("\n");

  const coverage = CORE_OUTLETS.map(
    (o) => `${o.label}: ${hitCounts[o.label] || 0}`
  ).join(", ");

  return {
    context:
      `Outlet coverage this pull: ${coverage}\n\n` +
      `Results (max ${MAX_RESULTS}, ~${PER_OUTLET}/outlet):\n${snippets || "(no results)"}`,
    urls: limited.map((h) => h.url),
    hitCounts,
  };
}

async function summarizeWithGroq(
  searchContext: string,
  days: number,
  previousUrls: string[],
  hitCounts: Record<string, number>
): Promise<string> {
  const outletList = CORE_OUTLETS.map((o) => o.label).join(", ");
  const coverage = CORE_OUTLETS.map(
    (o) => `${o.label}=${hitCounts[o.label] || 0}`
  ).join(", ");
  const dedupeHint =
    previousUrls.length > 0
      ? `Prefer NEW items not in: ${previousUrls.slice(0, 12).join(" ")}.`
      : "Prefer the most recent actionable items.";

  const prompt =
    `Summarize crypto NEWS. Context is pre-fetched from: ${outletList}.\n` +
    `Hits this pull: ${coverage}. Window ~${days} day(s).\n` +
    `Rules: NEUTRAL. Only SEARCH CONTEXT. No invented numbers/dates.\n` +
    `Try to mention MORE THAN ONE outlet when multiple are in context — do not collapse everything to a single site.\n` +
    `Focus: regulation, ETFs, institutional, exchanges, hacks, major protocol. Filter pure hype/presale.\n` +
    `${dedupeHint}\n` +
    `Format:\n` +
    `1) **Sentiment:** 🟢 BULLISH | 🔴 BEARISH | ⚪ NEUTRAL — one sentence\n` +
    `2) Up to ${MAX_RESULTS} bullets: **OutletName** — fact [Source](url)\n` +
    `3) Sources: unique URLs\n` +
    `4) Plain markdown — no code fences.`;

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    return (
      `**Sentiment:** ⚪ NEUTRAL — Tavily raw (Groq not configured)\n\n` +
      `Coverage: ${coverage}\n\n${searchContext}`
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
            "Extract facts from SEARCH CONTEXT only. Never fabricate. Cap at 12 bullets. Neutral. Cover multiple outlets when present.",
        },
        {
          role: "user",
          content: `SEARCH CONTEXT:\n${searchContext}\n\nUSER QUERY:\n${prompt}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 1400,
      reasoning_effort: "none",
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      (errorData as { error?: { message?: string } }).error?.message ||
        "Failed to summarize outlet news"
    );
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error("Empty AI summary");
  return content.trim();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CacheBody | ErrorBody>
) {
  const outlets = CORE_OUTLETS.map(({ id, host, label }) => ({ id, host, label }));

  if (req.method === "GET") {
    try {
      const log = await prisma.catalystLog.findUnique({ where: { promptId: PROMPT_ID } });
      const { meta, body } = parseMeta(log?.response);
      const lastScrapedAt = meta.scrapedAt
        ? Date.parse(meta.scrapedAt)
        : log
          ? new Date(log.updatedAt).getTime()
          : null;
      const alreadyScrapedToday =
        lastScrapedAt != null && manilaDayKey(new Date(lastScrapedAt)) === manilaDayKey();

      return res.status(200).json({
        markdown: body,
        updatedAt: log ? new Date(log.updatedAt).getTime() : null,
        lastScrapedAt: Number.isFinite(lastScrapedAt) ? lastScrapedAt : null,
        range: meta.range || "since_last",
        outlets,
        alreadyScrapedToday,
        outletHitCounts: meta.outletHitCounts,
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
    const body = (req.body || {}) as { range?: RangeKey; force?: boolean };
    const range: RangeKey =
      body.range === "1" || body.range === "3" || body.range === "7" || body.range === "since_last"
        ? body.range
        : "since_last";
    const force = Boolean(body.force);

    const log = await prisma.catalystLog.findUnique({ where: { promptId: PROMPT_ID } });
    const { meta, body: cachedBody } = parseMeta(log?.response);
    const lastScrapedAt = meta.scrapedAt
      ? Date.parse(meta.scrapedAt)
      : log
        ? new Date(log.updatedAt).getTime()
        : null;
    const alreadyScrapedToday =
      lastScrapedAt != null && manilaDayKey(new Date(lastScrapedAt)) === manilaDayKey();

    if (!force && alreadyScrapedToday && cachedBody) {
      return res.status(200).json({
        markdown: cachedBody,
        updatedAt: log ? new Date(log.updatedAt).getTime() : null,
        lastScrapedAt: lastScrapedAt,
        range: meta.range || range,
        outlets,
        alreadyScrapedToday: true,
        skipped: true,
        message:
          "Already scraped today (Manila). Showing cache. Use Force scan for a fresh pull across all outlets.",
        outletHitCounts: meta.outletHitCounts,
      });
    }

    const days = rangeToDays(range, lastScrapedAt);
    const { context, urls, hitCounts } = await fetchAllOutlets(days);
    const markdown = await summarizeWithGroq(context, days, meta.seenUrls || [], hitCounts);

    const coverageMsg = CORE_OUTLETS.map(
      (o) => `${o.label}:${hitCounts[o.label] || 0}`
    ).join(" · ");

    const newMeta: Meta = {
      range,
      scrapedAt: new Date().toISOString(),
      windowStart: new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10),
      outletHosts: CORE_OUTLETS.map((o) => o.host),
      seenUrls: [...new Set([...(meta.seenUrls || []).slice(-30), ...urls])].slice(-50),
      outletHitCounts: hitCounts,
    };
    const stored = `<!--meta:${JSON.stringify(newMeta)}-->\n${markdown}`;

    await prisma.catalystLog.upsert({
      where: { promptId: PROMPT_ID },
      create: { promptId: PROMPT_ID, category: CATEGORY, response: stored },
      update: { category: CATEGORY, response: stored },
    });

    return res.status(200).json({
      markdown,
      updatedAt: Date.now(),
      lastScrapedAt: Date.now(),
      range,
      outlets,
      alreadyScrapedToday: true,
      skipped: false,
      message: `Pulled ~${days}d · ${urls.length} links · ${coverageMsg}`,
      outletHitCounts: hitCounts,
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
