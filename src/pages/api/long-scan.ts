import type { NextApiRequest, NextApiResponse } from "next";
import { isAuthenticatedRequest } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { runLongScanSnapshot } from "@/lib/longScanLogic";

type LadderLevel = { price: number; basis: string; allocationPct: number };

export type LongScanHitDto = {
  id: number;
  symbol: string;
  name: string;
  scannedAt: string;
  bias: string;
  score: number;
  maxScore: number;
  confidence: number;
  currentPrice: number;
  support: number | null;
  resistance: number | null;
  isExtended: boolean;
  ladder: LadderLevel[];
  invalidation: number | null;
  invalidationNote: string | null;
  target: number | null;
  targetNote: string | null;
  macroTrend: string | null;
  signalsNote: string | null;
};

function mapHit(h: {
  id: number;
  symbol: string;
  name: string;
  scannedAt: Date;
  bias: string;
  score: number;
  maxScore: number;
  confidence: number;
  currentPrice: number;
  support: number | null;
  resistance: number | null;
  isExtended: boolean;
  ladderJson: string;
  invalidation: number | null;
  invalidationNote: string | null;
  target: number | null;
  targetNote: string | null;
  macroTrend: string | null;
  signalsNote: string | null;
}): LongScanHitDto {
  let ladder: LadderLevel[] = [];
  try {
    ladder = JSON.parse(h.ladderJson);
  } catch {
    ladder = [];
  }
  return {
    id: h.id,
    symbol: h.symbol,
    name: h.name,
    scannedAt: h.scannedAt.toISOString(),
    bias: h.bias,
    score: h.score,
    maxScore: h.maxScore,
    confidence: h.confidence,
    currentPrice: h.currentPrice,
    support: h.support,
    resistance: h.resistance,
    isExtended: h.isExtended,
    ladder,
    invalidation: h.invalidation,
    invalidationNote: h.invalidationNote,
    target: h.target,
    targetNote: h.targetNote,
    macroTrend: h.macroTrend,
    signalsNote: h.signalsNote,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
      const [rows, runs] = await Promise.all([
        prisma.longScanHit.findMany({
          orderBy: [{ scannedAt: "desc" }, { symbol: "asc" }],
          take: limit,
        }),
        prisma.longScanRun.findMany({
          orderBy: { scannedAt: "desc" },
          take: 60,
        }),
      ]);
      return res.status(200).json({
        hits: rows.map(mapHit),
        runs: runs.map((r) => ({
          id: r.id,
          scannedAt: r.scannedAt.toISOString(),
          scanned: r.scanned,
          saved: r.saved,
          pruned: r.pruned,
          message: r.message,
        })),
      });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  }

  if (req.method === "DELETE") {
    try {
      const id = Number(req.query.id);
      const runId = Number(req.query.runId);
      if (Number.isFinite(runId) && runId > 0) {
        const run = await prisma.longScanRun.findUnique({ where: { id: runId } });
        if (!run) return res.status(404).json({ error: "Run not found" });
        await prisma.longScanHit.deleteMany({ where: { scannedAt: run.scannedAt } });
        await prisma.longScanRun.delete({ where: { id: runId } });
        return res.status(200).json({ ok: true });
      }
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: "id or runId required" });
      }
      await prisma.longScanHit.delete({ where: { id } });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  }

  if (req.method === "POST") {
    // Cron secret OR logged-in user (manual run from the page)
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.authorization;
    const isVercelCron = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
    const hasUser = isAuthenticatedRequest(req);

    if (!isVercelCron && !hasUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const result = await runLongScanSnapshot();
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}
