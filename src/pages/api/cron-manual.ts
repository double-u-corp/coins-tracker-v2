import type { NextApiRequest, NextApiResponse } from "next";
import { runCronJob, type CronResult } from "@/lib/cronLogic";
import { isAuthenticatedRequest } from "@/lib/auth";

type Response = { ok: true; ranAt: string; results: CronResult[] } | { ok: false; error: string };

/**
 * POST /api/cron-manual
 *
 * Runs the exact same logic as the scheduled /api/cron endpoint, but is
 * meant to be called from the Home page's "Run Cron Now" button (only shown
 * when logged in) so you can verify the fetch/compare/persist logic without
 * waiting for the next scheduled time.
 *
 * Requires login. Note this is separate from CRON_SECRET, which protects
 * the scheduled /api/cron endpoint that Vercel Cron calls — a server secret
 * can't be safely embedded in a browser button, so this route uses the same
 * session-cookie auth as the rest of the app instead.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<Response>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ ok: false, error: "Login required" });
  }

  try {
    const results = await runCronJob();
    return res.status(200).json({ ok: true, ranAt: new Date().toISOString(), results });
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
}
