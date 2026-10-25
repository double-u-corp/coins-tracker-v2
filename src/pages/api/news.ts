import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import type { NewsItemView } from "@/validators/newsSchema";

type Response = { items: NewsItemView[]; nextCursor: number | null } | { error: string };

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;

/**
 * GET /api/news?symbol=X&limit=15&cursor=<id>
 *
 * Lists auto-generated bullish/bearish signals + any real articles fetched
 * from free RSS feeds (see lib/newsApi.ts), grouped by which cron run
 * produced/last-touched them (`cronLogId`), most recent run first —
 * NOT strictly by `publishedAt`, since a real article's publish date can
 * be older than when this app actually fetched it, and a re-surfaced
 * article's `id` doesn't change on update. `cronLogId` is what the client
 * uses to draw a divider between runs.
 *
 * Cursor-paginated: pass the last item's `id` from the previous page as
 * `cursor` to get the next page. `nextCursor` in the response is null when
 * there are no more results.
 */
type DeleteResponse = { ok: true } | { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Response | DeleteResponse>
) {
  if (req.method === "DELETE") {
    const fromQuery = typeof req.query.id === "string" ? Number(req.query.id) : NaN;
    const fromBody =
      req.body && typeof req.body === "object" && req.body.id != null
        ? Number(req.body.id)
        : NaN;
    const id = Number.isFinite(fromQuery) && fromQuery > 0 ? fromQuery : fromBody;
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id required" });
    }
    try {
      await prisma.newsItem.delete({ where: { id: Math.trunc(id) } });
      return res.status(200).json({ ok: true });
    } catch (err) {
      // Already gone is fine (idempotent)
      const msg = (err as Error).message || "";
      if (/Record to delete does not exist|P2025/i.test(msg)) {
        return res.status(200).json({ ok: true });
      }
      console.error("[news DELETE]", err);
      return res.status(500).json({ error: msg || "Delete failed" });
    }
  }

  if (req.method === "POST" && req.body?.action === "delete") {
    const id = Number(req.body?.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id required" });
    }
    try {
      await prisma.newsItem.delete({ where: { id: Math.trunc(id) } });
      return res.status(200).json({ ok: true });
    } catch (err) {
      const msg = (err as Error).message || "";
      if (/Record to delete does not exist|P2025/i.test(msg)) {
        return res.status(200).json({ ok: true });
      }
      return res.status(500).json({ error: msg });
    }
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, DELETE, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { symbol, limit: limitRaw, cursor: cursorRaw } = req.query;

  let limit = DEFAULT_LIMIT;
  if (typeof limitRaw === "string") {
    const parsed = Number(limitRaw);
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  let cursorId: number | null = null;
  if (typeof cursorRaw === "string") {
    const parsed = Number(cursorRaw);
    if (!Number.isNaN(parsed) && parsed > 0) {
      cursorId = parsed;
    }
  }

  let coinFilter: { coinId?: number } = {};
  if (typeof symbol === "string" && symbol.trim()) {
    const coin = await prisma.coin.findUnique({ where: { symbol: symbol.trim().toUpperCase() } });
    coinFilter = { coinId: coin?.id ?? -1 };
  }

  try {
    const items = await prisma.newsItem.findMany({
      where: coinFilter,
      include: { coin: true },
      orderBy: [{ cronLogId: "desc" }, { id: "desc" }],
      take: limit,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    const views: NewsItemView[] = items.map((item) => ({
      id: item.id,
      symbol: item.coin.symbol,
      name: item.coin.name,
      headline: item.headline,
      summary: item.summary,
      sentiment: item.sentiment as "bullish" | "bearish" | "neutral",
      source: item.source,
      url: item.url,
      cronLogId: item.cronLogId,
      publishedAt: item.publishedAt.toISOString(),
    }));

    const nextCursor = items.length === limit ? items[items.length - 1].id : null;

    return res.status(200).json({ items: views, nextCursor });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
