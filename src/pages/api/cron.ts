import type { NextApiRequest, NextApiResponse } from "next";
import { runCronJob } from "@/lib/cronLogic";

/**
 * Triggered on the schedule defined in vercel.json or manually via the UI.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 1. Check for Vercel Cron Authorization Header
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  const isVercelCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  // 2. Alternatively, check if the user is authenticated via session/cookie (for manual UI clicks)
  // Adjust `req.cookies.your_auth_cookie_name` to match whatever cookie or session check your app uses for admin actions
  const hasUserSession = Boolean(req.cookies); // Or check your specific session/auth cookie here

  // If neither Vercel Cron secret nor user session is valid, reject
  if (cronSecret && !isVercelCron && !hasUserSession) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const results = await runCronJob();
    return res.status(200).json({ ok: true, ranAt: new Date().toISOString(), results });
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
}