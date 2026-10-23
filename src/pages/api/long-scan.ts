import type { NextApiRequest, NextApiResponse } from "next";
import { isAuthenticatedRequest } from "@/lib/auth";
import {
  runLongScanSnapshot,
  listLongScanRuns,
  deleteLongScanRun,
  deleteLongScanHit,
} from "@/lib/longScanLogic";

/** Full watchlist scan can exceed default serverless limit. */
export const config = {
  maxDuration: 60,
};

function isCronAuthorized(req: NextApiRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  if (req.headers["x-vercel-cron"] === "1") return true;
  return false;
}

async function runScanHandler(req: NextApiRequest, res: NextApiResponse) {
  if (!isCronAuthorized(req) && !isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await runLongScanSnapshot();
    return res.status(200).json(result);
  } catch (err) {
    const message = (err as Error).message || String(err);
    console.error("[long-scan]", message);
    return res.status(500).json({ ok: false, error: message });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Price cron style: GET + Bearer CRON_SECRET runs the job.
  // (Postman POST works; many schedulers only fire GET and looked "successful"
  // while only listing runs — nothing new was saved.)
  if (req.method === "GET" && isCronAuthorized(req)) {
    return runScanHandler(req, res);
  }

  if (req.method === "GET" && (req.query.run === "1" || req.query.run === "true")) {
    return runScanHandler(req, res);
  }

  if (req.method === "GET") {
    try {
      const runs = await listLongScanRuns();
      return res.status(200).json({ runs });
    } catch (err) {
      return res.status(500).json({ error: (err as Error).message });
    }
  }

  if (req.method === "DELETE") {
    try {
      const runId = typeof req.query.runId === "string" ? req.query.runId : null;
      const symbol = typeof req.query.symbol === "string" ? req.query.symbol : null;
      if (!runId) {
        return res.status(400).json({ error: "runId required" });
      }
      if (symbol) {
        const ok = await deleteLongScanHit(runId, symbol);
        if (!ok) return res.status(404).json({ error: "Hit not found" });
        return res.status(200).json({ ok: true });
      }
      const ok = await deleteLongScanRun(runId);
      if (!ok) return res.status(404).json({ error: "Run not found" });
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
