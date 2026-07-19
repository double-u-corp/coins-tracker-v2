import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { setTargetSchema } from "@/validators/coinSchema";

type Response = { targetHigh: number | null; targetLow: number | null } | { error: string };

/**
 * POST /api/targets — set (or clear) a coin's target high/low.
 * Body: { symbol, targetHigh: number|null, targetLow: number|null }.
 *
 * Not gated behind login: target levels are a personal reminder, not a
 * money-moving action, so they're editable directly from the Home page.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<Response>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const parsed = setTargetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid target payload" });
  }

  const { symbol, targetHigh, targetLow } = parsed.data;

  const coin = await prisma.coin.findUnique({ where: { symbol } });
  if (!coin) {
    return res.status(404).json({ error: `${symbol} is not a monitored coin.` });
  }

  const target = await prisma.priceTarget.upsert({
    where: { coinId: coin.id },
    update: { targetHigh, targetLow },
    create: { coinId: coin.id, targetHigh, targetLow },
  });

  return res.status(200).json({ targetHigh: target.targetHigh, targetLow: target.targetLow });
}
