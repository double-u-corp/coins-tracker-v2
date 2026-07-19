import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { isAuthenticatedRequest } from "@/lib/auth";
import { z } from "zod";

const manualPriceSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Symbol is required")
    .transform((val) => val.toUpperCase()),
  price: z.coerce.number({ invalid_type_error: "Enter a valid price" }).positive("Price must be greater than 0"),
});

type Response = { price: number; high: number; low: number } | { error: string };

/**
 * POST /api/records — manually set a price point for a coin, with no live
 * fetch involved. Mainly used right after adding a coin manually in Manage
 * Coins (see Gotcha in CLAUDE.md) — a coin added by typing its symbol
 * directly is often exactly one the live ticker API can't reach, so trying
 * to fetch it would just fail. This lets you give it a starting price
 * instead. Compares against the last recorded high/low the same way the
 * cron job does. Not linked to a CronLog (cronLogId stays null), so it
 * doesn't trigger the new-record alert modal — that's reserved for actual
 * cron runs.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<Response>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: "Login required" });
  }

  const parsed = manualPriceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid payload" });
  }

  const { symbol, price } = parsed.data;

  const coin = await prisma.coin.findUnique({ where: { symbol } });
  if (!coin) {
    return res.status(404).json({ error: `${symbol} is not a monitored coin.` });
  }

  const lastRecord = await prisma.record.findFirst({ where: { coinId: coin.id }, orderBy: { createdAt: "desc" } });
  const previousHigh = lastRecord?.high ?? price;
  const previousLow = lastRecord?.low ?? price;
  const high = Math.max(previousHigh, price);
  const low = Math.min(previousLow, price);

  await prisma.record.create({
    data: { coinId: coin.id, price, high, low, isNewHigh: false, isNewLow: false, cronLogId: null },
  });

  return res.status(200).json({ price, high, low });
}
