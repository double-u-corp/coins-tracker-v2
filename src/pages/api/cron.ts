import type { NextApiRequest, NextApiResponse } from "next";
import { runCronJob } from "@/lib/cronLogic";

/**
 * Triggered on the schedule defined in vercel.json:
 * 7:00, 10:00, 14:00, 19:00, 22:00, 2:00 (server/UTC time).
 *
 * Vercel Cron sends a GET request with an
 * `Authorization: Bearer <CRON_SECRET>` header in production. We verify it
 * here so the endpoint can't be triggered by anyone who finds the URL.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    const results = await runCronJob();
    return res.status(200).json({ ok: true, ranAt: new Date().toISOString(), results });
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
}
