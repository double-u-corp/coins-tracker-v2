import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { fetchPrice, toPhpSymbol } from "@/lib/coinsApi";
import { isAuthenticatedRequest } from "@/lib/auth";
import {
  createTransactionSchema,
  deleteTransactionSchema,
  updateTransactionSchema,
} from "@/validators/transactionSchema";
import type { PortfolioEntry, TransactionView } from "@/validators/transactionSchema";
import { normalizeVenue, portfolioKey } from "@/lib/venues";

type ListResponse = { 
  transactions: TransactionView[]; 
  portfolio: PortfolioEntry[];
  cashOnHand: number;
  /** Cash per venue (deposits + sells − buys − withdraws) */
  cashByVenue: Record<string, number>;
  totalDeposited: number;
  totalWithdrawn: number;
};
type CreateResponse = { transaction: TransactionView };
type UpdateResponse = { transaction: TransactionView };
type DeleteResponse = { ok: true };
type ErrorResponse = { error: string };

// Helper to prevent slow external price APIs from stalling the backend response
async function fetchPriceWithTimeout(symbol: string, timeoutMs = 2000): Promise<number | null> {
  try {
    const pricePromise = fetchPrice(toPhpSymbol(symbol));
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs)
    );
    return await Promise.race([pricePromise, timeoutPromise]);
  } catch {
    return null;
  }
}

async function handleList(res: NextApiResponse<ListResponse | ErrorResponse>) {
  // Fetch only strictly required fields
  const transactions = await prisma.transaction.findMany({
    select: {
      id: true,
      type: true,
      phpAmount: true,
      price: true,
      coinAmount: true,
      isManual: true,
      transactedAt: true,
      coinId: true,
      venue: true,
      coin: {
        select: { id: true, symbol: true, name: true },
      },
    },
    orderBy: { transactedAt: "desc" },
  });

  let totalDeposited = 0;
  let totalWithdrawn = 0;

  const cashByVenue: Record<string, number> = {
    coins_ph: 0,
    maya: 0,
    gcash: 0,
  };
  const cashOnHand = transactions.reduce((acc, t) => {
    const type = t.type.toLowerCase();
    const amt = Number(t.phpAmount) || 0;
    const v = normalizeVenue((t as { venue?: string }).venue);

    if (type === "deposit") {
      totalDeposited += amt;
      cashByVenue[v] = (cashByVenue[v] || 0) + amt;
      return acc + amt;
    }
    if (type === "sell") {
      cashByVenue[v] = (cashByVenue[v] || 0) + amt;
      return acc + amt;
    }
    if (type === "withdraw") {
      totalWithdrawn += amt;
      cashByVenue[v] = (cashByVenue[v] || 0) - amt;
      return acc - amt;
    }
    if (type === "buy") {
      cashByVenue[v] = (cashByVenue[v] || 0) - amt;
      return acc - amt;
    }
    return acc;
  }, 0);

  const transactionViews: TransactionView[] = transactions.map((t) => ({
    id: t.id,
    symbol: t.coin?.symbol ?? "PHP",
    name: t.coin?.name ?? "Cash Flow",
    type: t.type.toLowerCase() as "buy" | "sell" | "deposit" | "withdraw",
    phpAmount: Number(t.phpAmount),
    price: Number(t.price),
    coinAmount: Number(t.coinAmount),
    isManual: t.isManual,
    transactedAt: t.transactedAt.toISOString(),
    venue: normalizeVenue((t as { venue?: string }).venue),
  }));

  const byCoin = new Map<
    string,
    {
      coinId: number;
      symbol: string;
      name: string;
      venue: string;
      holdings: number;
      spent: number;
      sold: number;
      boughtUnits: number;
    }
  >();

  for (const t of transactions) {
    if (!t.coin) continue;
    const venue = normalizeVenue((t as { venue?: string }).venue);
    const key = portfolioKey(t.coin.symbol, venue);

    const existing = byCoin.get(key) ?? {
      coinId: t.coin.id,
      symbol: t.coin.symbol,
      name: t.coin.name,
      venue,
      holdings: 0,
      spent: 0,
      sold: 0,
      boughtUnits: 0,
    };

    const type = t.type.toLowerCase();
    const coinAmt = Number(t.coinAmount) || 0;
    const phpAmt = Number(t.phpAmount) || 0;

    if (type === "buy") {
      existing.holdings += coinAmt;
      existing.spent += phpAmt;
      existing.boughtUnits += coinAmt;
    } else if (type === "sell") {
      existing.holdings -= coinAmt;
      existing.sold += phpAmt;
    }
    // Dust / float noise: treat near-zero bags as fully realized
    if (Math.abs(existing.holdings) < 1e-8) existing.holdings = 0;
    if (existing.holdings < 0) existing.holdings = 0;
    // Residual after near-full exit: <0.15% of cumulative buy units → closed
    if (
      existing.boughtUnits > 0 &&
      existing.holdings > 0 &&
      existing.holdings / existing.boughtUnits < 0.0015 &&
      existing.sold >= existing.spent * 0.97
    ) {
      existing.holdings = 0;
    }
    byCoin.set(key, existing);
  }

  // Only open bags — drop flat rows so Home/Trade don't show "closed" coins as held
  const entries = Array.from(byCoin.values()).filter((e) => e.holdings > 1e-8);
  const coinIds = entries.map((e) => e.coinId);

  // Batch query latest fallback prices from DB in a single call
  const fallbackRecords = coinIds.length > 0
    ? await prisma.record.findMany({
        where: { coinId: { in: coinIds } },
        orderBy: { createdAt: "desc" },
        select: { coinId: true, price: true },
      })
    : [];

  const latestPriceMap = new Map<number, number>();
  for (const rec of fallbackRecords) {
    if (!latestPriceMap.has(rec.coinId)) {
      latestPriceMap.set(rec.coinId, Number(rec.price));
    }
  }

  // Fetch external live prices in parallel
  const livePrices = await Promise.all(
    entries.map((entry) => fetchPriceWithTimeout(entry.symbol))
  );

  const portfolio: PortfolioEntry[] = entries.map((entry, index) => {
    let currentPrice = livePrices[index];

    if (currentPrice === null) {
      currentPrice = latestPriceMap.get(entry.coinId) ?? null;
    }

    const currentValue = currentPrice !== null ? currentPrice * entry.holdings : null;
    const netSpent = entry.spent - entry.sold;
    const gainLoss = currentValue !== null ? currentValue - netSpent : null;

    return {
      symbol: entry.symbol,
      name: entry.name,
      venue: entry.venue || "coins_ph",
      holdings: entry.holdings,
      bought: entry.spent,
      spent: netSpent,
      sold: entry.sold,
      currentPrice,
      currentValue,
      gainLoss,
    } as PortfolioEntry;
  });

  res.status(200).json({ 
    transactions: transactionViews, 
    portfolio, 
    cashOnHand,
    cashByVenue,
    totalDeposited,
    totalWithdrawn,
  });
}

async function handleCreate(req: NextApiRequest, res: NextApiResponse<CreateResponse | ErrorResponse>) {
  const parsed = createTransactionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid transaction payload" });
  }

  const { symbol, type, phpAmount, coinAmount, transactedAt: manualDate, venue: venueRaw } = parsed.data;
  const typeLower = type.toLowerCase();
  const venue = normalizeVenue(venueRaw);

  const allTxs = await prisma.transaction.findMany({
    select: { type: true, phpAmount: true, venue: true },
  });
  let cashBalance = 0;
  let venueCash = 0;
  for (const tx of allTxs) {
    const tType = tx.type.toLowerCase();
    const amt = Number(tx.phpAmount) || 0;
    const v = normalizeVenue((tx as { venue?: string }).venue);
    if (tType === "deposit" || tType === "sell") {
      cashBalance += amt;
      if (v === venue) venueCash += amt;
    }
    if (tType === "withdraw" || tType === "buy") {
      cashBalance -= amt;
      if (v === venue) venueCash -= amt;
    }
  }

  // Soft check per venue — warn via message but allow if total cash ok? Prefer strict per venue.
  if ((typeLower === "buy" || typeLower === "withdraw") && phpAmount > venueCash + 1e-6) {
    return res.status(400).json({
      error: `Insufficient ${venue} cash. Available on this venue: ₱${venueCash.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}. Tried to ${typeLower}: ₱${phpAmount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}. Deposit on ${venue} first (or use another venue).`,
    });
  }

  const isCashFlow = typeLower === "deposit" || typeLower === "withdraw";

  let coinId: number | null = null;
  let finalCoinAmount = coinAmount ?? 0;
  let price = 0;

  if (!isCashFlow) {
    if (!symbol) {
      return res.status(400).json({ error: "Symbol is required for coin trades." });
    }

    const coin = await prisma.coin.findUnique({ where: { symbol } });
    if (!coin) {
      return res.status(404).json({ error: `${symbol} is not a monitored coin. Add it from Manage Coins first.` });
    }
    coinId = coin.id;

    if (typeLower === "sell") {
      const existing = await prisma.transaction.findMany({
        where: { coinId: coin.id, venue },
        select: { type: true, coinAmount: true, venue: true },
      });
      const currentlyHeld = existing.reduce(
        (sum, t) =>
          sum +
          (t.type.toLowerCase() === "buy"
            ? Number(t.coinAmount)
            : t.type.toLowerCase() === "sell"
              ? -Number(t.coinAmount)
              : 0),
        0
      );
      const EPS = 1e-8;
      if (finalCoinAmount > currentlyHeld + EPS) {
        return res.status(400).json({
          error: `You only hold ${currentlyHeld.toLocaleString(undefined, {
            maximumFractionDigits: 8,
          })} ${symbol} on ${venue}, can't sell ${finalCoinAmount}.`,
        });
      }
      if (finalCoinAmount >= currentlyHeld - EPS) {
        finalCoinAmount = Math.max(0, currentlyHeld);
      }
    }

    price = phpAmount / (finalCoinAmount || 1);
  }

  const createPayload = {
    type: typeLower,
    phpAmount,
    price: isCashFlow ? 0 : price,
    coinAmount: isCashFlow ? 0 : finalCoinAmount,
    venue,
    isManual: true,
    ...(coinId !== null ? { coinId } : {}),
    ...(manualDate ? { transactedAt: new Date(manualDate) } : {}),
  };

  const transaction = await prisma.transaction.create({
    data: createPayload as any,
    include: { coin: true },
  });

  return res.status(201).json({
    transaction: {
      id: transaction.id,
      symbol: transaction.coin?.symbol ?? "PHP",
      name: transaction.coin?.name ?? "Cash Flow",
      type: transaction.type.toLowerCase() as "buy" | "sell" | "deposit" | "withdraw",
      phpAmount: Number(transaction.phpAmount),
      price: Number(transaction.price),
      coinAmount: Number(transaction.coinAmount),
      isManual: transaction.isManual,
      transactedAt: transaction.transactedAt.toISOString(),
      venue: normalizeVenue((transaction as { venue?: string }).venue),
    },
  });
}

async function handleUpdate(req: NextApiRequest, res: NextApiResponse<UpdateResponse | ErrorResponse>) {
  const parsed = updateTransactionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid correction payload" });
  }

  const { id, coinAmount, phpAmount } = parsed.data;

  const existing = await prisma.transaction.findUnique({ where: { id }, include: { coin: true } });
  if (!existing) {
    return res.status(404).json({ error: "Transaction not found" });
  }

  const existingType = existing.type.toLowerCase();

  if (existingType === "sell" && existing.coinId) {
    const others = await prisma.transaction.findMany({
      where: { coinId: existing.coinId, id: { not: id } },
      select: { type: true, coinAmount: true },
    });
    const heldExcludingThis = others.reduce(
      (sum, t) => sum + (t.type.toLowerCase() === "buy" ? Number(t.coinAmount) : t.type.toLowerCase() === "sell" ? -Number(t.coinAmount) : 0),
      0
    );
    const updatedCoinAmount = coinAmount ?? Number(existing.coinAmount);
    if (updatedCoinAmount > heldExcludingThis) {
      return res.status(400).json({
        error: `That would sell more than you hold: ${heldExcludingThis.toLocaleString(undefined, {
          maximumFractionDigits: 8,
        })} ${existing.coin?.symbol ?? ""} available.`,
      });
    }
  }

  const updatedPhp = phpAmount ?? Number(existing.phpAmount);
  const updatedCoins = coinAmount ?? Number(existing.coinAmount);
  const isCashFlow = existingType === "deposit" || existingType === "withdraw";
  const price = isCashFlow ? 0 : updatedCoins > 0 ? updatedPhp / updatedCoins : Number(existing.price);

  const updated = await prisma.transaction.update({
    where: { id },
    data: {
      coinAmount: isCashFlow ? 0 : updatedCoins,
      price,
      phpAmount: updatedPhp,
      isManual: true,
    },
    include: { coin: true },
  });

  return res.status(200).json({
    transaction: {
      id: updated.id,
      symbol: updated.coin?.symbol ?? "PHP",
      name: updated.coin?.name ?? "Cash Flow",
      type: updated.type.toLowerCase() as "buy" | "sell" | "deposit" | "withdraw",
      phpAmount: Number(updated.phpAmount),
      price: Number(updated.price),
      coinAmount: Number(updated.coinAmount),
      isManual: updated.isManual,
      transactedAt: updated.transactedAt.toISOString(),
      venue: normalizeVenue((updated as { venue?: string }).venue),
    },
  });
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse<DeleteResponse | ErrorResponse>) {
  const parsed = deleteTransactionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid payload" });
  }

  const existing = await prisma.transaction.findUnique({ where: { id: parsed.data.id } });
  if (!existing) {
    return res.status(404).json({ error: "Transaction not found" });
  }

  await prisma.transaction.delete({ where: { id: parsed.data.id } });
  return res.status(200).json({ ok: true });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ListResponse | CreateResponse | UpdateResponse | DeleteResponse | ErrorResponse>
) {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: "Login required" });
  }

  try {
    if (req.method === "POST") return await handleCreate(req, res as NextApiResponse<CreateResponse | ErrorResponse>);
    if (req.method === "PATCH") return await handleUpdate(req, res as NextApiResponse<UpdateResponse | ErrorResponse>);
    if (req.method === "DELETE") return await handleDelete(req, res as NextApiResponse<DeleteResponse | ErrorResponse>);
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET, POST, PATCH, DELETE");
      return res.status(405).json({ error: "Method not allowed" });
    }
    return await handleList(res as NextApiResponse<ListResponse | ErrorResponse>);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}