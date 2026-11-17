import type { NextApiRequest, NextApiResponse } from "next";
import { isAuthenticatedRequest } from "@/lib/auth";
import {
  loadHomeMonitorSnapshot,
  runHomeMonitorScan,
} from "@/lib/homeMonitorScan";

/**
 * GET  — last saved Home monitor snapshot (near support / fast pump / RSI). No heavy compute.
 * POST — run one bulk scan, save snapshot, return it. Manual only.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    try {
      const snap = await loadHomeMonitorSnapshot();
      return res.status(200).json({ snapshot: snap });
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message });
    }
  }

  if (req.method === "POST") {
    if (!isAuthenticatedRequest(req)) {
      return res.status(401).json({ error: "Login required" });
    }
    try {
      const snapshot = await runHomeMonitorScan();
      return res.status(200).json({ snapshot, ok: true });
    } catch (e) {
      console.error("[home-monitor-scan]", e);
      return res.status(500).json({ error: (e as Error).message });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
