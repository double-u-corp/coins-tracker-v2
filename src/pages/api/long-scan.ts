import type { NextApiRequest, NextApiResponse } from "next";
import { isAuthenticatedRequest } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { runLongScanSnapshot } from "@/lib/longScanLogic";

/** Vercel serverless: full watchlist scan needs more than default 10s. */
export const config = {
  maxDuration: 60,
};

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

function isCronAuthorized(req: NextApiRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  // Vercel Cron injects this on scheduled invocations
  if (req.headers["x-vercel-cron"] === "1") return true;
  return false;
}

async function runScanHandler(req: NextApiRequest, res: NextApiResponse) {
  if (!isCronAuthorized(req) && !isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await runLongScanSnapshot();
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const message = (err as Error).message || String(err);
    console.error("[long-scan]", message);
    // Always try to leave a visible failure breadcrumb on the log page
    try {
      await prisma.longScanRun.create({
        data: {
          scannedAt: new Date(),
          scanned: 0,
          saved: 0,
          pruned: 0,
          message: `FAILED: ${message}`.slice(0, 500),
        },
      });
    } catch (logErr) {
      console.error("[long-scan] could not write failure run:", logErr);
    }
    return res.status(500).json({ ok: false, error: message });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Cron may use GET (same as price /api/cron) or POST
  if (req.method === "GET" && (req.query.run === "1" || req.query.run === "true")) {
    return runScanHandler(req, res);
  }

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
      const message = (err as Error).message;
      // Table missing → clear signal for deploy
      if (/longScanRun|LongScanRun|does not exist/i.test(message)) {
        return res.status(500).json({
          error:
            "LongScan tables missing — run: npx prisma db push && npx prisma generate",
        });
      }
      return res.status(500).json({ error: message });
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
    return runScanHandler(req, res);
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}
