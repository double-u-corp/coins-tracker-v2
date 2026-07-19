import type { NextApiRequest, NextApiResponse } from "next";
import { buildLogoutCookie } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse<{ ok: true } | { error: string }>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Set-Cookie", buildLogoutCookie());
  return res.status(200).json({ ok: true });
}
