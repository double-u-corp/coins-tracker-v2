import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { isAuthenticatedRequest } from "@/lib/auth";

const ALLOWED = new Set(["bad", "monitor", "nochase", "neutral", ""]);

type FlagMap = Record<string, string>;

/**
 * GET  /api/coin-flags → { flags: { SYMBOL: "bad"|"monitor"|"nochase"|"neutral" } }
 * PUT  /api/coin-flags { symbol, flag } → set or clear (flag "" / null)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === "GET") {
      const coins = await prisma.coin.findMany({
        where: { scanFlag: { not: null } },
        select: { symbol: true, scanFlag: true },
      });
      const flags: FlagMap = {};
      for (const c of coins) {
        if (c.scanFlag) flags[c.symbol.toUpperCase()] = c.scanFlag;
      }
      return res.status(200).json({ flags });
    }

    if (req.method === "PUT" || req.method === "POST") {
      if (!isAuthenticatedRequest(req)) {
        return res.status(401).json({ error: "Login required" });
      }
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const symbol = String(body?.symbol || "").trim().toUpperCase();
      let flag = body?.flag == null ? "" : String(body.flag).trim().toLowerCase();
      if (!symbol) return res.status(400).json({ error: "symbol required" });
      if (!ALLOWED.has(flag)) {
        return res.status(400).json({ error: "flag must be bad|monitor|nochase|neutral|empty" });
      }
      const coin = await prisma.coin.findUnique({ where: { symbol } });
      if (!coin) return res.status(404).json({ error: `${symbol} not found` });

      const scanFlag = flag === "" ? null : flag;
      await prisma.coin.update({
        where: { symbol },
        data: { scanFlag },
      });
      return res.status(200).json({ symbol, flag: scanFlag });
    }

    res.setHeader("Allow", "GET, PUT, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[coin-flags]", err);
    return res.status(500).json({ error: (err as Error).message || "Server error" });
  }
}
