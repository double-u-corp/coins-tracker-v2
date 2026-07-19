import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { fetchPrice, toPhpSymbol } from "@/lib/coinsApi";
import { isAuthenticatedRequest } from "@/lib/auth";
import { createTransactionSchema, deleteTransactionSchema, updateTransactionSchema } from "@/validators/transactionSchema";
import type { PortfolioEntry, TransactionView } from "@/validators/transactionSchema";

type ListResponse = { transactions: TransactionView[]; portfolio: PortfolioEntry[] };
type CreateResponse = { transaction: TransactionView };
type UpdateResponse = { transaction: TransactionView };
type DeleteResponse = { ok: true };
type ErrorResponse = { error: string };

async function handleList(res: NextApiResponse<ListResponse | ErrorResponse>) {
  const transactions = await prisma.transaction.findMany({
    include: { coin: true },
    orderBy: { transactedAt: "desc" },
  });

  const transactionViews: TransactionView[] = transactions.map((t) => ({
    id: t.id,
    symbol: t.coin.symbol,
    name: t.coin.name,
    type: t.type as "buy" | "sell",
    phpAmount: t.phpAmount,
    price: t.price,
    coinAmount: t.coinAmount,
    isManual: t.isManual,
    transactedAt: t.transactedAt.toISOString(),
  }));

  // Roll transactions up per coin, then fetch each coin's *current* PHP
  // price (live, not the last cron snapshot — which may be USDT-quoted) to
  // show today's value and gain/loss alongside what was actually spent.
  const byCoin = new Map<
    string,
    { symbol: string; name: string; totalBought: number; totalSold: number; totalPhpSpent: number; totalPhpReceived: number }
  >();
  for (const t of transactions) {
    const existing = byCoin.get(t.coin.symbol) ?? {
      symbol: t.coin.symbol,
      name: t.coin.name,
      totalBought: 0,
      totalSold: 0,
      totalPhpSpent: 0,
      totalPhpReceived: 0,
    };
    if (t.type === "buy") {
      existing.totalBought += t.coinAmount;
      existing.totalPhpSpent += t.phpAmount;
    } else {
      existing.totalSold += t.coinAmount;
      existing.totalPhpReceived += t.phpAmount;
    }
    byCoin.set(t.coin.symbol, existing);
  }

  const portfolio: PortfolioEntry[] = await Promise.all(
    Array.from(byCoin.values()).map(async (entry) => {
      const totalCoinAmount = entry.totalBought - entry.totalSold;
      const averageBuyPrice = entry.totalBought > 0 ? entry.totalPhpSpent / entry.totalBought : 0;
      const costBasisRemaining = averageBuyPrice * totalCoinAmount;
      const realizedGainLoss = entry.totalPhpReceived - averageBuyPrice * entry.totalSold;

      let currentPrice: number | null = null;
      try {
        currentPrice = await fetchPrice(toPhpSymbol(entry.symbol));
      } catch {
        currentPrice = null; // live lookup failed; still show what was spent
      }

      const currentValue = currentPrice !== null ? currentPrice * totalCoinAmount : null;
      const unrealizedGainLoss = currentValue !== null ? currentValue - costBasisRemaining : null;
      const unrealizedGainLossPercent =
        unrealizedGainLoss !== null && costBasisRemaining > 0 ? (unrealizedGainLoss / costBasisRemaining) * 100 : null;

      return {
        symbol: entry.symbol,
        name: entry.name,
        totalCoinAmount,
        totalBought: entry.totalBought,
        totalSold: entry.totalSold,
        totalPhpSpent: entry.totalPhpSpent,
        totalPhpReceived: entry.totalPhpReceived,
        averageBuyPrice,
        currentPrice,
        currentValue,
        unrealizedGainLoss,
        unrealizedGainLossPercent,
        realizedGainLoss,
      };
    })
  );

  res.status(200).json({ transactions: transactionViews, portfolio });
}

/**
 * POST /api/transactions — buy or sell, live or logged historically.
 * Buys are entered as a PHP amount (coinAmount is derived). Sells are
 * entered as a coin amount (phpAmount received is derived). If `price` is
 * supplied, it's used directly (manual/historical entry, flagged isManual)
 * and no live lookup happens.
 */
async function handleCreate(req: NextApiRequest, res: NextApiResponse<CreateResponse | ErrorResponse>) {
  const parsed = createTransactionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid transaction payload" });
  }

  const { symbol, type, phpAmount: inputPhpAmount, coinAmount: inputCoinAmount, price: manualPrice, transactedAt: manualDate } =
    parsed.data;

  const coin = await prisma.coin.findUnique({ where: { symbol } });
  if (!coin) {
    return res.status(404).json({ error: `${symbol} is not a monitored coin. Add it from Manage Coins first.` });
  }

  const isManual = manualPrice !== undefined;
  let price = manualPrice;

  if (!isManual) {
    try {
      price = await fetchPrice(toPhpSymbol(symbol));
    } catch (err) {
      return res.status(502).json({
        error: `Couldn't fetch a live PHP price for ${symbol} (tried ${toPhpSymbol(symbol)}): ${(err as Error).message}`,
      });
    }
  }
  const resolvedPrice = price as number;

  let phpAmount: number;
  let coinAmount: number;

  if (type === "buy") {
    phpAmount = inputPhpAmount as number;
    coinAmount = phpAmount / resolvedPrice;
  } else {
    coinAmount = inputCoinAmount as number;
    phpAmount = coinAmount * resolvedPrice;

    // Can't sell more than currently held. This checks *current* net
    // holdings regardless of the transaction's date — logging a historical
    // sell out of chronological order isn't validated against the balance
    // at that point in time, only against the total as it stands today.
    const existing = await prisma.transaction.findMany({ where: { coinId: coin.id }, select: { type: true, coinAmount: true } });
    const currentlyHeld = existing.reduce(
      (sum, t) => sum + (t.type === "buy" ? t.coinAmount : -t.coinAmount),
      0
    );
    if (coinAmount > currentlyHeld) {
      return res.status(400).json({
        error: `You only hold ${currentlyHeld.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${symbol}, can't sell ${coinAmount}.`,
      });
    }
  }

  const transaction = await prisma.transaction.create({
    data: {
      coinId: coin.id,
      type,
      phpAmount,
      price: resolvedPrice,
      coinAmount,
      isManual,
      ...(manualDate ? { transactedAt: new Date(manualDate) } : {}),
    },
  });

  return res.status(201).json({
    transaction: {
      id: transaction.id,
      symbol: coin.symbol,
      name: coin.name,
      type: transaction.type as "buy" | "sell",
      phpAmount: transaction.phpAmount,
      price: transaction.price,
      coinAmount: transaction.coinAmount,
      isManual: transaction.isManual,
      transactedAt: transaction.transactedAt.toISOString(),
    },
  });
}

/**
 * PATCH /api/transactions — correct the coin amount and/or price of an
 * existing entry (e.g. the exact numbers weren't available when you first
 * logged it). phpAmount is recomputed as coinAmount * price. Marks the
 * entry isManual, since it's now a user-corrected value rather than
 * whatever was fetched live. For a sell, re-validates that the corrected
 * amount still doesn't exceed holdings (excluding this transaction's own
 * original amount from the current total).
 */
async function handleUpdate(req: NextApiRequest, res: NextApiResponse<UpdateResponse | ErrorResponse>) {
  const parsed = updateTransactionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid correction payload" });
  }

  const { id, coinAmount, price } = parsed.data;

  const existing = await prisma.transaction.findUnique({ where: { id }, include: { coin: true } });
  if (!existing) {
    return res.status(404).json({ error: "Transaction not found" });
  }

  if (existing.type === "sell") {
    const others = await prisma.transaction.findMany({
      where: { coinId: existing.coinId, id: { not: id } },
      select: { type: true, coinAmount: true },
    });
    const heldExcludingThis = others.reduce((sum, t) => sum + (t.type === "buy" ? t.coinAmount : -t.coinAmount), 0);
    if (coinAmount > heldExcludingThis) {
      return res.status(400).json({
        error: `That would sell more than you hold: ${heldExcludingThis.toLocaleString(undefined, {
          maximumFractionDigits: 8,
        })} ${existing.coin.symbol} available.`,
      });
    }
  }

  const phpAmount = coinAmount * price;

  const updated = await prisma.transaction.update({
    where: { id },
    data: { coinAmount, price, phpAmount, isManual: true },
    include: { coin: true },
  });

  return res.status(200).json({
    transaction: {
      id: updated.id,
      symbol: updated.coin.symbol,
      name: updated.coin.name,
      type: updated.type as "buy" | "sell",
      phpAmount: updated.phpAmount,
      price: updated.price,
      coinAmount: updated.coinAmount,
      isManual: updated.isManual,
      transactedAt: updated.transactedAt.toISOString(),
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
    if (req.method === "POST") {
      return await handleCreate(req, res as NextApiResponse<CreateResponse | ErrorResponse>);
    }
    if (req.method === "PATCH") {
      return await handleUpdate(req, res as NextApiResponse<UpdateResponse | ErrorResponse>);
    }
    if (req.method === "DELETE") {
      return await handleDelete(req, res as NextApiResponse<DeleteResponse | ErrorResponse>);
    }
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET, POST, PATCH, DELETE");
      return res.status(405).json({ error: "Method not allowed" });
    }
    return await handleList(res as NextApiResponse<ListResponse | ErrorResponse>);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
