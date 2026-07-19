import type { NextApiRequest, NextApiResponse } from "next";
import { buildSessionCookie, createSessionToken, verifyCredentials } from "@/lib/auth";
import { loginSchema } from "@/validators/authSchema";

type Response = { ok: true } | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Response>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid login payload" });
  }

  const { username, password } = parsed.data;

  if (!verifyCredentials(username, password)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const token = createSessionToken(username);
  res.setHeader("Set-Cookie", buildSessionCookie(token));
  return res.status(200).json({ ok: true });
}
