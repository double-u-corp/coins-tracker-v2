import type { NextApiRequest, NextApiResponse } from "next";
import {
  touchHoldFloor,
  closeHoldFloor,
  listHoldFloors,
  refreshHoldFloorsFromPortfolio,
} from "@/lib/holdFloorDb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === "GET") {
      const openOnly = req.query.open === "1" || req.query.open === "true";
      const symbol =
        typeof req.query.symbol === "string" && req.query.symbol.trim()
          ? req.query.symbol.trim()
          : undefined;
      const floors = await listHoldFloors({ openOnly, symbol });
      return res.status(200).json({ floors });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      if (body.action === "refresh") {
        const result = await refreshHoldFloorsFromPortfolio();
        return res.status(200).json(result);
      }
      if (body.action === "close" && body.symbol) {
        await closeHoldFloor(String(body.symbol));
        return res.status(200).json({ ok: true });
      }
      const symbol = String(body.symbol || "").toUpperCase();
      const avgCost = Number(body.avgCost);
      const price = Number(body.price);
      if (!symbol || !(avgCost > 0) || !(price > 0)) {
        return res.status(400).json({ error: "symbol, avgCost, price required" });
      }
      const floor = await touchHoldFloor({ symbol, avgCost, price });
      return res.status(200).json({ floor });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[hold-floor]", err);
    return res.status(500).json({ error: (err as Error).message || "hold-floor failed" });
  }
}
