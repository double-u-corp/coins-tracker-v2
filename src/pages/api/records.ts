import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { isAuthenticatedRequest } from "@/lib/auth";
import { z } from "zod";

const manualPriceSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Symbol is required")
    .transform((val) => val.toUpperCase()),
  price: z.coerce.number({ invalid_type_error: "Enter a valid price" }).positive("Price must be greater than 0"),
});

const updateRecordSchema = z.object({
  id: z.coerce.number().int().positive("A valid record id is required"),
  price: z.coerce.number({ invalid_type_error: "Enter a valid price" }).positive("Price must be greater than 0"),
});

interface ManualRecordView {
  id: number;
  price: number;
  createdAt: string;
}

type ListResponse = { records: ManualRecordView[] };
type CreateResponse = { price: number; high: number; low: number };
type UpdateResponse = { record: ManualRecordView };
type ErrorResponse = { error: string };

/**
 * Recomputes the running high/low chain for a coin starting from (and
 * including) `fromRecordId`, walking forward through every later record in
 * creation order. Needed after editing a past record's price: each
 * record's high/low was originally computed as max/min against whatever
 * came before it, so correcting an old price can change what every
 * subsequent record's high/low *should* have been — without this, "Recorded
 * High/Low" on Home (and Calendar's daily aggregates, which read the same
 * cumulative fields) could stay wrong even after fixing the price itself.
 * Does NOT touch isNewHigh/isNewLow flags (those only drive the one-time
 * new-record alert modal for actual cron runs, not worth retroactively
 * rewriting) or any record's `price`/`createdAt` — only `high`/`low`.
 */
async function recalculateHighLowFrom(coinId: number, fromRecordId: number) {
  const [priorRecord, recordsFromPoint] = await Promise.all([
    prisma.record.findFirst({
      where: { coinId, id: { lt: fromRecordId } },
      orderBy: { id: "desc" },
      select: { high: true, low: true },
    }),
    prisma.record.findMany({
      where: { coinId, id: { gte: fromRecordId } },
      orderBy: { id: "asc" },
      select: { id: true, price: true },
    }),
  ]);

  if (recordsFromPoint.length === 0) return;

  let runningHigh = priorRecord?.high ?? recordsFromPoint[0].price;
  let runningLow = priorRecord?.low ?? recordsFromPoint[0].price;

  for (const record of recordsFromPoint) {
    runningHigh = Math.max(runningHigh, record.price);
    runningLow = Math.min(runningLow, record.price);
    await prisma.record.update({
      where: { id: record.id },
      data: { high: runningHigh, low: runningLow },
    });
  }
}

/** GET /api/records?symbol=X&limit=10 — lists recent MANUAL price entries for a coin (cronLogId null), for correcting a wrong one. */
async function handleList(req: NextApiRequest, res: NextApiResponse<ListResponse | ErrorResponse>) {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: "Login required" });
  }

  const { symbol, limit: limitRaw } = req.query;
  if (typeof symbol !== "string" || !symbol.trim()) {
    return res.status(400).json({ error: "A `symbol` query param is required" });
  }

  let limit = 10;
  if (typeof limitRaw === "string") {
    const parsed = Number(limitRaw);
    if (!Number.isNaN(parsed) && parsed > 0) limit = Math.min(parsed, 50);
  }

  const coin = await prisma.coin.findUnique({ where: { symbol: symbol.trim().toUpperCase() } });
  if (!coin) {
    return res.status(200).json({ records: [] });
  }

  const records = await prisma.record.findMany({
    where: { coinId: coin.id, cronLogId: null },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, price: true, createdAt: true },
  });

  return res.status(200).json({
    records: records.map((r) => ({ id: r.id, price: r.price, createdAt: r.createdAt.toISOString() })),
  });
}

/**
 * POST /api/records — manually set a price point for a coin, with no live
 * fetch involved. Mainly used right after adding a coin manually in Manage
 * Coins (see Gotcha in CLAUDE.md) — a coin added by typing its symbol
 * directly is often exactly one the live ticker API can't reach, so trying
 * to fetch it would just fail. This lets you give it a starting price
 * instead. Compares against the last recorded high/low the same way the
 * cron job does. Not linked to a CronLog (cronLogId stays null), so it
 * doesn't trigger the new-record alert modal — that's reserved for actual
 * cron runs.
 */
async function handleCreate(req: NextApiRequest, res: NextApiResponse<CreateResponse | ErrorResponse>) {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: "Login required" });
  }

  const parsed = manualPriceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid payload" });
  }

  const { symbol, price } = parsed.data;

  const coin = await prisma.coin.findUnique({ where: { symbol } });
  if (!coin) {
    return res.status(404).json({ error: `${symbol} is not a monitored coin.` });
  }

  const lastRecord = await prisma.record.findFirst({ where: { coinId: coin.id }, orderBy: { createdAt: "desc" } });
  const previousHigh = lastRecord?.high ?? price;
  const previousLow = lastRecord?.low ?? price;
  const high = Math.max(previousHigh, price);
  const low = Math.min(previousLow, price);

  await prisma.record.create({
    data: { coinId: coin.id, price, high, low, isNewHigh: false, isNewLow: false, cronLogId: null },
  });

  return res.status(200).json({ price, high, low });
}

/**
 * PATCH /api/records — correct a wrong manual price entry (e.g. "I typed
 * yesterday's price wrong"). Only allowed for manual entries (cronLogId
 * null) — a cron-fetched price came from the live API, not something typed
 * in, so it's not something this endpoint corrects. After updating the
 * price, recalculates the high/low chain forward from this record (see
 * recalculateHighLowFrom) so Recorded High/Low stays accurate.
 */
async function handleUpdate(req: NextApiRequest, res: NextApiResponse<UpdateResponse | ErrorResponse>) {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: "Login required" });
  }

  const parsed = updateRecordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid payload" });
  }

  const { id, price } = parsed.data;

  const existing = await prisma.record.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: "Entry not found" });
  }
  if (existing.cronLogId !== null) {
    return res.status(400).json({ error: "Only manually-entered prices can be corrected this way." });
  }

  const updated = await prisma.record.update({ where: { id }, data: { price } });
  await recalculateHighLowFrom(existing.coinId, id);

  return res.status(200).json({
    record: { id: updated.id, price: updated.price, createdAt: updated.createdAt.toISOString() },
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ListResponse | CreateResponse | UpdateResponse | ErrorResponse>
) {
  if (req.method === "GET") {
    return handleList(req, res as NextApiResponse<ListResponse | ErrorResponse>);
  }
  if (req.method === "POST") {
    return handleCreate(req, res as NextApiResponse<CreateResponse | ErrorResponse>);
  }
  if (req.method === "PATCH") {
    return handleUpdate(req, res as NextApiResponse<UpdateResponse | ErrorResponse>);
  }
  res.setHeader("Allow", "GET, POST, PATCH");
  return res.status(405).json({ error: "Method not allowed" });
}
