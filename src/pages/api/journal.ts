import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { isAuthenticatedRequest } from "@/lib/auth";
import { createJournalEntrySchema, deleteJournalEntrySchema } from "@/validators/journalSchema";
import type { JournalEntryView } from "@/validators/journalSchema";

type ListResponse = { entries: JournalEntryView[] };
type CreateResponse = { entry: JournalEntryView };
type DeleteResponse = { ok: true };
type ErrorResponse = { error: string };

/**
 * GET /api/journal?symbol=X&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Lists journal entries, optionally filtered to a date range and/or a coin.
 * When `symbol` is given, includes that coin's entries AND general entries
 * (coinId null) — general notes are relevant no matter which chart is open.
 */
async function handleList(req: NextApiRequest, res: NextApiResponse<ListResponse | ErrorResponse>) {
  const { symbol, from, to } = req.query;

  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (typeof from === "string" && from) dateFilter.gte = new Date(from);
  if (typeof to === "string" && to) dateFilter.lte = new Date(to);

  let symbolFilter: { OR?: { coinId: number | null }[] } = {};
  if (typeof symbol === "string" && symbol.trim()) {
    const coin = await prisma.coin.findUnique({ where: { symbol: symbol.trim().toUpperCase() } });
    // This coin's entries OR general (coin-agnostic) entries. -1 is a
    // sentinel that matches nothing if the symbol isn't a monitored coin.
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

  const parsed = createJournalEntrySchema.safeParse(req.body);
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

/** DELETE /api/journal — remove a journal entry. Requires login. */
async function handleDelete(req: NextApiRequest, res: NextApiResponse<DeleteResponse | ErrorResponse>) {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: "Login required" });
  }

  const parsed = deleteJournalEntrySchema.safeParse(req.body);
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
  res: NextApiResponse<ListResponse | CreateResponse | DeleteResponse | ErrorResponse>
) {
  try {
    if (req.method === "POST") {
      return await handleCreate(req, res as NextApiResponse<CreateResponse | ErrorResponse>);
    }
    if (req.method === "DELETE") {
      return await handleDelete(req, res as NextApiResponse<DeleteResponse | ErrorResponse>);
    }
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET, POST, DELETE");
      return res.status(405).json({ error: "Method not allowed" });
    }
    return await handleList(req, res as NextApiResponse<ListResponse | ErrorResponse>);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
