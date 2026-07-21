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

  // Roll transactions up per coin: holdings = net coins (buys - sells),
  // spent = net PHP still invested (buy cost - sell proceeds). Then fetch
  // each coin's *current* PHP price (live, not the last cron snapshot —
  // which may be USDT-quoted) to compute today's value and gain/loss.
  const byCoin = new Map<string, { symbol: string; name: string; holdings: number; spent: number }>();
  for (const t of transactions) {
    const existing = byCoin.get(t.coin.symbol) ?? {
      symbol: t.coin.symbol,
      name: t.coin.name,
      holdings: 0,
      spent: 0,
    };
    if (t.type === "buy") {
      existing.holdings += t.coinAmount;
      existing.spent += t.phpAmount;
    } else {
      existing.holdings -= t.coinAmount;
      existing.spent -= t.phpAmount;
    }
    byCoin.set(t.coin.symbol, existing);
  }

  const portfolio: PortfolioEntry[] = await Promise.all(
    Array.from(byCoin.values()).map(async (entry) => {
      let currentPrice: number | null = null;
      try {
        currentPrice = await fetchPrice(toPhpSymbol(entry.symbol));
      } catch {
        currentPrice = null; // live lookup failed; still show what was spent
      }

      const currentValue = currentPrice !== null ? currentPrice * entry.holdings : null;
      const gainLoss = currentValue !== null ? currentValue - entry.spent : null;

      return {
        symbol: entry.symbol,
        name: entry.name,
        holdings: entry.holdings,
        spent: entry.spent,
        currentPrice,
        currentValue,
        gainLoss,
      };
    })
  );

  res.status(200).json({ transactions: transactionViews, portfolio });
}

/**
 * POST /api/transactions — buy or sell.
 * Always takes both `phpAmount` (spent on a buy, received from a sell) and
 * `coinAmount` (quantity) directly from the user — no live price lookup,
 * no per-unit price input. `price` is stored purely as a derived
 * phpAmount/coinAmount reference value.
 */
async function handleCreate(req: NextApiRequest, res: NextApiResponse<CreateResponse | ErrorResponse>) {
  const parsed = createTransactionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid transaction payload" });
  }

  const { symbol, type, phpAmount, coinAmount, transactedAt: manualDate } = parsed.data;

  const coin = await prisma.coin.findUnique({ where: { symbol } });
  if (!coin) {
    return res.status(404).json({ error: `${symbol} is not a monitored coin. Add it from Manage Coins first.` });
  }

  if (type === "sell") {
    // Can't sell more than currently held. This checks *current* net
    // holdings regardless of the transaction's date — logging a historical
    // sell out of chronological order isn't validated against the balance
    // at that point in time, only against the total as it stands today.
    const existing = await prisma.transaction.findMany({ where: { coinId: coin.id }, select: { type: true, coinAmount: true } });
    const currentlyHeld = existing.reduce((sum, t) => sum + (t.type === "buy" ? t.coinAmount : -t.coinAmount), 0);
    if (coinAmount > currentlyHeld) {
      return res.status(400).json({
        error: `You only hold ${currentlyHeld.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${symbol}, can't sell ${coinAmount}.`,
      });
    }
  }

  const price = phpAmount / coinAmount;

  const transaction = await prisma.transaction.create({
    data: {
      coinId: coin.id,
      type,
      phpAmount,
      price,
      coinAmount,
      isManual: true,
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
 * PATCH /api/transactions — correct the coin amount and/or PHP amount of
 * an existing entry. `price` is always recomputed as phpAmount / coinAmount
 * — never edited directly, since the exact per-unit execution price isn't
 * reliably known (that's the whole reason this field isn't user-facing).
 * For a sell, re-validates that the corrected amount still doesn't exceed
 * holdings (excluding this transaction's own original amount).
 */
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

  const price = phpAmount / coinAmount;

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
