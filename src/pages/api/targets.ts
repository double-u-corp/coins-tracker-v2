import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { setTargetSchema } from "@/validators/coinSchema";

type Response =
  | { targetHigh: number | null; targetLow: number | null; reviewUntil: string | null }
  | { error: string };

/**
 * POST /api/targets — set (or clear) target high/low and optional reviewUntil date.
 * Body: { symbol, targetHigh, targetLow, reviewUntil?: "YYYY-MM-DD"|null }.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<Response>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const parsed = setTargetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.errors[0]?.message ?? "Invalid target payload",
    });
  }

  const { symbol, targetHigh, targetLow, reviewUntil } = parsed.data;

  const coin = await prisma.coin.findUnique({ where: { symbol } });
  if (!coin) {
    return res.status(404).json({ error: `${symbol} is not a monitored coin.` });
  }

  const bodyHasReview = Object.prototype.hasOwnProperty.call(req.body || {}, "reviewUntil");
  const reviewDate =
    bodyHasReview && reviewUntil != null
      ? new Date(`${reviewUntil}T12:00:00.000Z`)
      : bodyHasReview
        ? null
        : undefined;

  const updatePayload: {
    targetHigh: number | null;
    targetLow: number | null;
    reviewUntil?: Date | null;
  } = { targetHigh, targetLow };
  if (bodyHasReview) {
    updatePayload.reviewUntil = reviewDate ?? null;
  }

  const target = await prisma.priceTarget.upsert({
    where: { coinId: coin.id },
    update: updatePayload,
    create: {
      coinId: coin.id,
      targetHigh,
      targetLow,
      reviewUntil: bodyHasReview ? reviewDate ?? null : null,
    },
  });

  return res.status(200).json({
    targetHigh: target.targetHigh,
    targetLow: target.targetLow,
    reviewUntil: target.reviewUntil
      ? target.reviewUntil.toISOString().slice(0, 10)
      : null,
  });
}
