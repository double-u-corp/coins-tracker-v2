import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { fetchAllPrices, deriveNameFromSymbol } from "@/lib/coinsApi";
import { isAuthenticatedRequest } from "@/lib/auth";

interface AvailableCoin {
  symbol: string;
  price: number;
  suggestedName: string;
  alreadyMonitored: boolean;
}

type Response = { coins: AvailableCoin[] } | { error: string };

const MAX_RESULTS = 50;

/**
 * GET /api/available-coins?q=btc
 *
 * Proxies the Coins.ph ticker endpoint (with no `symbol` param it returns
 * every tradeable symbol) so the Manage Coins page can let you search the
 * full exchange list and pick what to start tracking, instead of guessing
 * valid symbols. Requires login, same as the rest of Manage Coins.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<Response>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: "Login required" });
  }

  const query = String(req.query.q ?? "")
    .trim()
    .toUpperCase();

  try {
    const [allPrices, monitored] = await Promise.all([
      fetchAllPrices(),
      prisma.coin.findMany({ select: { symbol: true } }),
    ]);

    const monitoredSymbols = new Set(monitored.map((c) => c.symbol));

    // Coins.ph's "all tickers" response can include the same symbol more
    // than once; dedupe by symbol (keeping the first occurrence) so every
    // result is unique — both for correctness and so the list has stable
    // React keys on the client.
    const seen = new Set<string>();
    const filtered = allPrices
      .filter((entry) => (query ? entry.symbol.toUpperCase().includes(query) : true))
      .filter((entry) => {
        if (seen.has(entry.symbol)) return false;
        seen.add(entry.symbol);
        return true;
      })
      .slice(0, MAX_RESULTS)
      .map((entry) => ({
        symbol: entry.symbol,
        price: parseFloat(entry.price),
        suggestedName: deriveNameFromSymbol(entry.symbol),
        alreadyMonitored: monitoredSymbols.has(entry.symbol.toUpperCase()),
      }));

    return res.status(200).json({ coins: filtered });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
