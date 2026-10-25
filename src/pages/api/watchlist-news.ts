import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { createHash } from "crypto";

const PROMPT_ID = "watchlist-market-signals";
const CATEGORY = "WatchlistNews";
const PER_OUTLET = 3;
/** Keep rows this many days; older can still be deleted manually sooner. */
const RETAIN_DAYS = 1; // keep outlet rows ~1 day only

export const CORE_OUTLETS = [
  { id: "theblock", host: "theblock.co", label: "The Block" },
  { id: "decrypt", host: "decrypt.co", label: "Decrypt" },
  // Replaced CoinDesk + Blockworks (unreachable on user network)
  { id: "bitcoinmagazine", host: "bitcoinmagazine.com", label: "Bitcoin Magazine" },
  { id: "dlnews", host: "dlnews.com", label: "DL News" },
] as const;

export type OutletNewsRow = {
  id: string;
  url: string;
  title: string;
  domain: string;
  label: string;
  /** When we first saved this URL */
  scannedAt: string;
  /** Best-effort article date YYYY-MM-DD (from URL or scan day) */
  newsDate: string;
};

type Store = {
  version: 2;
  items: OutletNewsRow[];
  lastScrapedAt?: string;
};

type OkBody = {
  items: OutletNewsRow[];
  lastScrapedAt: number | null;
  outlets: { id: string; host: string; label: string }[];
  added?: number;
  message?: string;
};

type ErrorBody = { error: string };

function urlId(url: string): string {
  return createHash("sha1").update(url.split("?")[0]).digest("hex").slice(0, 16);
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Pull YYYY-MM-DD from common news URL paths. */
function newsDateFromUrl(url: string, fallback: string): string {
  const m = url.match(/\/(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\/|$)/);
  if (m) {
    const y = m[1];
    const mo = m[2].padStart(2, "0");
    const d = m[3].padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  return fallback;
}

function manilaYmd(d = new Date()): string {
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isTodayOrYesterday(newsDate: string, todayManila: string): boolean {
  const t = new Date(`${todayManila}T12:00:00.000Z`).getTime();
  const n = new Date(`${newsDate}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(n)) return true; // keep if unknown → treat as scan day
  const diffDays = Math.round((t - n) / 86_400_000);
  return diffDays >= 0 && diffDays <= 1;
}

function parseStore(raw: string | null | undefined): Store {
  if (!raw) return { version: 2, items: [] };
  // New structured store
  if (raw.startsWith("<!--meta:")) {
    try {
      const end = raw.indexOf("-->");
      const meta = JSON.parse(raw.slice(9, end));
      if (meta.version === 2 && Array.isArray(meta.items)) {
        return {
          version: 2,
          items: meta.items,
          lastScrapedAt: meta.lastScrapedAt,
        };
      }
    } catch {
      /* fall through */
    }
  }
  // Legacy markdown blob — start clean table
  try {
    const j = JSON.parse(raw);
    if (j.version === 2 && Array.isArray(j.items)) return j as Store;
  } catch {
    /* ignore */
  }
  return { version: 2, items: [] };
}

function serializeStore(store: Store): string {
  return `<!--meta:${JSON.stringify(store)}-->\n`;
}

function pruneOld(items: OutletNewsRow[]): OutletNewsRow[] {
  const cutoff = Date.now() - RETAIN_DAYS * 86_400_000;
  return items.filter((it) => {
    const t = Date.parse(it.scannedAt);
    return !Number.isFinite(t) || t >= cutoff;
  });
}

async function fetchOutlet(
  outlet: (typeof CORE_OUTLETS)[number]
): Promise<Omit<OutletNewsRow, "id" | "scannedAt" | "newsDate">[]> {
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) throw new Error("TAVILY_API_KEY is missing.");

  // Fixed ~2 day window: today + yesterday only (Tavily days=2)
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: tavilyApiKey,
      query: `crypto OR bitcoin OR ethereum OR regulation OR ETF OR exchange news`,
      topic: "news",
      search_depth: "basic",
      days: 2,
      include_answer: false,
      max_results: PER_OUTLET,
      include_domains: [outlet.host],
    }),
  });

  if (!response.ok) {
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
      url: r.url!.split("#")[0],
      title: (r.title || "").trim(),
      domain: hostFromUrl(r.url!) || outlet.host,
      label: outlet.label,
    }));
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OkBody | ErrorBody>
) {
  const outlets = CORE_OUTLETS.map(({ id, host, label }) => ({ id, host, label }));

  if (req.method === "GET") {
    try {
      const log = await prisma.catalystLog.findUnique({ where: { promptId: PROMPT_ID } });
      const store = parseStore(log?.response);
      const items = pruneOld(store.items).sort(
        (a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt) || b.newsDate.localeCompare(a.newsDate)
      );
      return res.status(200).json({
        items,
        lastScrapedAt: store.lastScrapedAt ? Date.parse(store.lastScrapedAt) : null,
        outlets,
      });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  }

  // Delete one row by id or url
  if (req.method === "DELETE") {
    try {
      const id = typeof req.query.id === "string" ? req.query.id : null;
      const url = typeof req.query.url === "string" ? req.query.url : null;
      if (!id && !url) {
        return res.status(400).json({ error: "id or url required" });
      }

      const log = await prisma.catalystLog.findUnique({ where: { promptId: PROMPT_ID } });
      const store = parseStore(log?.response);
      const before = store.items.length;
      store.items = store.items.filter((it) => {
        if (id && it.id === id) return false;
        if (url && it.url.split("?")[0] === url.split("?")[0]) return false;
        return true;
      });

      if (store.items.length === before) {
        return res.status(404).json({ error: "Row not found" });
      }

      await prisma.catalystLog.upsert({
        where: { promptId: PROMPT_ID },
        create: {
          promptId: PROMPT_ID,
          category: CATEGORY,
          response: serializeStore(store),
        },
        update: { category: CATEGORY, response: serializeStore(store) },
      });

      return res.status(200).json({
        items: store.items.sort(
          (a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt)
        ),
        lastScrapedAt: store.lastScrapedAt ? Date.parse(store.lastScrapedAt) : null,
        outlets,
        message: "Deleted",
      });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Scan: today/yesterday only, skip URLs already stored
  try {
    if (!process.env.TAVILY_API_KEY) {
      return res.status(500).json({ error: "TAVILY_API_KEY is missing." });
    }

    const log = await prisma.catalystLog.findUnique({ where: { promptId: PROMPT_ID } });
    const store = parseStore(log?.response);
    store.items = pruneOld(store.items);

    const existingUrls = new Set(
      store.items.map((it) => it.url.split("?")[0].toLowerCase())
    );

    const today = manilaYmd();
    const scannedAt = new Date().toISOString();
    const batches = await Promise.all(
      CORE_OUTLETS.map((o) => fetchOutlet(o).catch(() => []))
    );

    let added = 0;
    for (const batch of batches) {
      for (const raw of batch) {
        const canonical = raw.url.split("?")[0];
        const key = canonical.toLowerCase();
        if (existingUrls.has(key)) continue;

        const newsDate = newsDateFromUrl(canonical, today);
        // Only keep articles dated today or yesterday (Manila calendar)
        if (!isTodayOrYesterday(newsDate, today)) continue;

        const row: OutletNewsRow = {
          id: urlId(canonical),
          url: canonical,
          title: raw.title,
          domain: raw.domain,
          label: raw.label,
          scannedAt,
          newsDate,
        };
        store.items.push(row);
        existingUrls.add(key);
        added += 1;
      }
    }

    store.lastScrapedAt = scannedAt;
    store.version = 2;

    await prisma.catalystLog.upsert({
      where: { promptId: PROMPT_ID },
      create: {
        promptId: PROMPT_ID,
        category: CATEGORY,
        response: serializeStore(store),
      },
      update: { category: CATEGORY, response: serializeStore(store) },
    });

    const items = store.items.sort(
      (a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt) || b.newsDate.localeCompare(a.newsDate)
    );

    return res.status(200).json({
      items,
      lastScrapedAt: Date.parse(scannedAt),
      outlets,
      added,
      message:
        added > 0
          ? `Added ${added} new link(s). Duplicates skipped. Window: today & yesterday.`
          : "No new links (all URLs already saved or outside today/yesterday).",
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
