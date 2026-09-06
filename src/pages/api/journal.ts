import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isAuthenticatedRequest } from "@/lib/auth";
import { createJournalEntrySchema, deleteJournalEntrySchema } from "@/validators/journalSchema";
import type { JournalEntryView } from "@/validators/journalSchema";

type ListResponse = { entries: JournalEntryView[] };
type CreateResponse = { entry: JournalEntryView };
type UpdateResponse = { entry: JournalEntryView };
type DeleteResponse = { ok: true };
type ErrorResponse = { error: string };

const updateJournalEntrySchema = z.object({
  id: z.coerce.number({ invalid_type_error: "ID must be a number" }),
  title: z.string().min(1, "Title cannot be empty").optional(),
  notes: z.string().min(1, "Notes cannot be empty").optional(),
});

/**
 * GET /api/journal?symbol=X&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Lists journal entries, optionally filtered to a date range and/or a coin.
 */
async function handleList(req: NextApiRequest, res: NextApiResponse<ListResponse | ErrorResponse>) {
  const { symbol, from, to } = req.query;

  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (typeof from === "string" && from) dateFilter.gte = new Date(from);
  if (typeof to === "string" && to) dateFilter.lte = new Date(to);

  let symbolFilter: { OR?: { coinId: number | null }[] } = {};
  if (typeof symbol === "string" && symbol.trim()) {
    const coin = await prisma.coin.findUnique({ where: { symbol: symbol.trim().toUpperCase() } });
    symbolFilter = { OR: [{ coinId: coin?.id ?? -1 }, { coinId: null }] };
  }

  const entries = await prisma.journalEntry.findMany({
    where: {
      ...(Object.keys(dateFilter).length > 0 ? { entryDate: dateFilter } : {}),
      ...symbolFilter,
    },
    include: { coin: true },
    orderBy: { entryDate: "desc" },
  });

  const views: JournalEntryView[] = entries.map((e) => ({
    id: e.id,
    symbol: e.coin?.symbol ?? null,
    name: e.coin?.name ?? null,
    entryDate: e.entryDate.toISOString(),
    title: e.title,
    notes: e.notes,
    createdAt: e.createdAt.toISOString(),
  }));

  return res.status(200).json({ entries: views });
}

/** POST /api/journal — create a journal entry. Requires login. */
async function handleCreate(req: NextApiRequest, res: NextApiResponse<CreateResponse | ErrorResponse>) {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: "Login required" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const parsed = createJournalEntrySchema.safeParse(body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid journal entry" });
  }

  const { symbol, entryDate, title, notes } = parsed.data;

  let coinId: number | null = null;
  if (symbol) {
    const coin = await prisma.coin.findUnique({ where: { symbol } });
    if (!coin) {
      return res.status(404).json({ error: `${symbol} is not a monitored coin.` });
    }
    coinId = coin.id;
  }

  const entry = await prisma.journalEntry.create({
    data: { coinId, entryDate: new Date(entryDate), title, notes },
    include: { coin: true },
  });

  return res.status(201).json({
    entry: {
      id: entry.id,
      symbol: entry.coin?.symbol ?? null,
      name: entry.coin?.name ?? null,
      entryDate: entry.entryDate.toISOString(),
      title: entry.title,
      notes: entry.notes,
      createdAt: entry.createdAt.toISOString(),
    },
  });
}

/** PUT /api/journal — edit a journal entry. Requires login. */
async function handleUpdate(req: NextApiRequest, res: NextApiResponse<UpdateResponse | ErrorResponse>) {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: "Login required" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const parsed = updateJournalEntrySchema.safeParse(body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid update payload" });
  }

  const { id, title, notes } = parsed.data;

  const existing = await prisma.journalEntry.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: "Journal entry not found" });
  }

  const updated = await prisma.journalEntry.update({
    where: { id },
    data: {
      ...(title !== undefined && { title }),
      ...(notes !== undefined && { notes }),
    },
    include: { coin: true },
  });

  return res.status(200).json({
    entry: {
      id: updated.id,
      symbol: updated.coin?.symbol ?? null,
      name: updated.coin?.name ?? null,
      entryDate: updated.entryDate.toISOString(),
      title: updated.title,
      notes: updated.notes,
      createdAt: updated.createdAt.toISOString(),
    },
  });
}

/** DELETE /api/journal — remove a journal entry. Requires login. */
async function handleDelete(req: NextApiRequest, res: NextApiResponse<DeleteResponse | ErrorResponse>) {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: "Login required" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const parsed = deleteJournalEntrySchema.safeParse(body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid payload" });
  }

  const existing = await prisma.journalEntry.findUnique({ where: { id: parsed.data.id } });
  if (!existing) {
    return res.status(404).json({ error: "Journal entry not found" });
  }

  await prisma.journalEntry.delete({ where: { id: parsed.data.id } });
  return res.status(200).json({ ok: true });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ListResponse | CreateResponse | UpdateResponse | DeleteResponse | ErrorResponse>
) {
  try {
    if (req.method === "POST") {
      return await handleCreate(req, res as NextApiResponse<CreateResponse | ErrorResponse>);
    }
    if (req.method === "PUT") {
      return await handleUpdate(req, res as NextApiResponse<UpdateResponse | ErrorResponse>);
    }
    if (req.method === "DELETE") {
      return await handleDelete(req, res as NextApiResponse<DeleteResponse | ErrorResponse>);
    }
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET, POST, PUT, DELETE");
      return res.status(405).json({ error: "Method not allowed" });
    }
    return await handleList(req, res as NextApiResponse<ListResponse | ErrorResponse>);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}