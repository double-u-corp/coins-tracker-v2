import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { setTargetSchema } from "@/validators/coinSchema";

type Response =
  | {
      targetHigh: number | null;
      targetLow: number | null;
      onMonitor: boolean;
      reviewUntil: string | null;
    }
  | { error: string };

/**
 * POST /api/targets — set target high/low and onMonitor (Home Target & review).
 * Body: { symbol, targetHigh, targetLow, onMonitor?: boolean }.
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

  const { symbol, targetHigh, targetLow, onMonitor } = parsed.data;

  const coin = await prisma.coin.findUnique({ where: { symbol } });
  if (!coin) {
    return res.status(404).json({ error: `${symbol} is not a monitored coin.` });
  }

  const bodyHasMonitor = Object.prototype.hasOwnProperty.call(req.body || {}, "onMonitor");
  const monitorVal = bodyHasMonitor ? Boolean(onMonitor) : undefined;

  const updatePayload: {
    targetHigh: number | null;
    targetLow: number | null;
    onMonitor?: boolean;
  } = { targetHigh, targetLow };
  if (monitorVal !== undefined) {
    updatePayload.onMonitor = monitorVal;
  }

  const target = await prisma.priceTarget.upsert({
    where: { coinId: coin.id },
    update: updatePayload,
    create: {
      coinId: coin.id,
      targetHigh,
      targetLow,
      onMonitor: monitorVal ?? false,
    },
  });

  return res.status(200).json({
    targetHigh: target.targetHigh,
    targetLow: target.targetLow,
    onMonitor: Boolean(target.onMonitor),
    reviewUntil: target.reviewUntil
      ? target.reviewUntil.toISOString().slice(0, 10)
      : null,
  });
}
