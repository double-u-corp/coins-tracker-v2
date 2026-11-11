import type { NextApiRequest, NextApiResponse } from "next";
import { isAuthenticatedRequest } from "@/lib/auth";
import {
  listCoinWatchEvents,
  deleteCoinWatchById,
  deleteCoinWatchByDate,
  deleteCoinWatchByDateSymbol,
  ingestJournalForCoinWatch,
} from "@/lib/coinWatchStore";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === "GET") {
      const events = await listCoinWatchEvents();
      return res.status(200).json({ events });
    }

    if (req.method === "POST") {
      // Manual re-ingest from journal body (optional)
      if (!isAuthenticatedRequest(req)) {
        return res.status(401).json({ error: "Login required" });
      }
      const { journalEntryId, notes, title, symbol, coinId } = req.body || {};
      if (!journalEntryId || notes == null) {
        return res.status(400).json({ error: "journalEntryId and notes required" });
      }
      const added = await ingestJournalForCoinWatch({
        journalEntryId: Number(journalEntryId),
        notes: String(notes),
        title: title ?? null,
        symbol: symbol ?? null,
        coinId: coinId != null ? Number(coinId) : null,
      });
      return res.status(200).json({ ok: true, added });
    }

    if (req.method === "DELETE") {
      if (!isAuthenticatedRequest(req)) {
        return res.status(401).json({ error: "Login required" });
      }
      const id = typeof req.query.id === "string" ? req.query.id : req.body?.id;
      const date = typeof req.query.date === "string" ? req.query.date : req.body?.date;
      const symbol =
        typeof req.query.symbol === "string" ? req.query.symbol : req.body?.symbol;
      const label =
        typeof req.query.label === "string" ? req.query.label : req.body?.label;

      if (id) {
        const ok = await deleteCoinWatchById(String(id));
        return res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: "Not found" });
      }
      if (date && symbol) {
        const n = await deleteCoinWatchByDateSymbol(String(date), String(symbol), label);
        return res.status(200).json({ ok: true, removed: n });
      }
      if (date) {
        const n = await deleteCoinWatchByDate(String(date));
        return res.status(200).json({ ok: true, removed: n });
      }
      return res.status(400).json({ error: "Provide id, or date, or date+symbol" });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
