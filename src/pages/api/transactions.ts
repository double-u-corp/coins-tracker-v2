import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { fetchPrice, toPhpSymbol } from "@/lib/coinsApi";
import { isAuthenticatedRequest } from "@/lib/auth";
import {
  createTransactionSchema,
  deleteTransactionSchema,
  updateTransactionSchema,
} from "@/validators/transactionSchema";
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
    symbol: t.coin?.symbol ?? "PHP",
    name: t.coin?.name ?? "Cash Flow",
    type: t.type as "buy" | "sell" | "deposit" | "withdraw",
    phpAmount: t.phpAmount,
    price: t.price,
    coinAmount: t.coinAmount,
    isManual: t.isManual,
    transactedAt: t.transactedAt.toISOString(),
  }));

  // Roll transactions up per coin (excluding cash deposits/withdrawals)
  const byCoin = new Map<
    string,
    { coinId: number; symbol: string; name: string; holdings: number; spent: number; sold: number }
  >();

  for (const t of transactions) {
    if (!t.coin) continue; // Skip pure cash deposits/withdrawals

    const existing = byCoin.get(t.coin.symbol) ?? {
      coinId: t.coin.id,
      symbol: t.coin.symbol,
      name: t.coin.name,
      holdings: 0,
      spent: 0,
      sold: 0,
    };

    if (t.type === "buy") {
      existing.holdings += t.coinAmount;
      existing.spent += t.phpAmount;
    } else if (t.type === "sell") {
      existing.holdings -= t.coinAmount;
      existing.spent -= t.phpAmount;
      existing.sold += t.phpAmount;
    }
    byCoin.set(t.coin.symbol, existing);
  }

  const portfolio: PortfolioEntry[] = await Promise.all(
    Array.from(byCoin.values()).map(async (entry) => {
      let currentPrice: number | null = null;
      try {
        currentPrice = await fetchPrice(toPhpSymbol(entry.symbol));
      } catch {
        currentPrice = null;
      }

      if (currentPrice === null) {
        const latestRecord = await prisma.record.findFirst({
          where: { coinId: entry.coinId },
          orderBy: { createdAt: "desc" },
          select: { price: true },
        });
        currentPrice = latestRecord?.price ?? null;
      }

      const currentValue = currentPrice !== null ? currentPrice * entry.holdings : null;
      const gainLoss = currentValue !== null ? currentValue - entry.spent : null;

      return {
        symbol: entry.symbol,
        name: entry.name,
        holdings: entry.holdings,
        spent: entry.spent,
        sold: entry.sold,
        currentPrice,
        currentValue,
        gainLoss,
      };
    })
  );

  res.status(200).json({ transactions: transactionViews, portfolio });
}

/**
 * POST /api/transactions — handles buy, sell, deposit, and withdraw.
 */
async function handleCreate(req: NextApiRequest, res: NextApiResponse<CreateResponse | ErrorResponse>) {
  const parsed = createTransactionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid transaction payload" });
  }

  const { symbol, type, phpAmount, coinAmount, transactedAt: manualDate } = parsed.data;

  // 1. Calculate live available PHP cash balance
  const allTxs = await prisma.transaction.findMany({ select: { type: true, phpAmount: true } });
  let cashBalance = 0;
  for (const tx of allTxs) {
    if (tx.type === "deposit" || tx.type === "sell") cashBalance += tx.phpAmount;
    if (tx.type === "withdraw" || tx.type === "buy") cashBalance -= tx.phpAmount;
  }

  // 2. Validate sufficient cash balance for buys or withdrawals
  if ((type === "buy" || type === "withdraw") && phpAmount > cashBalance) {
    return res.status(400).json({
      error: `Insufficient cash balance. Available: ₱${cashBalance.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}. Tried to ${type}: ₱${phpAmount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}.`,
    });
  }

  const isCashFlow = type === "deposit" || type === "withdraw";

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

    if (type === "sell") {
      const existing = await prisma.transaction.findMany({
        where: { coinId: coin.id },
        select: { type: true, coinAmount: true },
      });
      const currentlyHeld = existing.reduce(
        (sum, t) => sum + (t.type === "buy" ? t.coinAmount : t.type === "sell" ? -t.coinAmount : 0),
        0
      );
      if (finalCoinAmount > currentlyHeld) {
        return res.status(400).json({
          error: `You only hold ${currentlyHeld.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${symbol}, can't sell ${finalCoinAmount}.`,
        });
      }
    }

    price = phpAmount / (finalCoinAmount || 1);
  }

  const createPayload = {
    type,
    phpAmount,
    price: isCashFlow ? 0 : price,
    coinAmount: isCashFlow ? 0 : finalCoinAmount,
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
      type: transaction.type as "buy" | "sell" | "deposit" | "withdraw",
      phpAmount: transaction.phpAmount,
      price: transaction.price,
      coinAmount: transaction.coinAmount,
      isManual: transaction.isManual,
      transactedAt: transaction.transactedAt.toISOString(),
    },
  });
}

/**
 * PATCH /api/transactions — correct existing transaction.
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

  if (existing.type === "sell" && existing.coinId) {
    const others = await prisma.transaction.findMany({
      where: { coinId: existing.coinId, id: { not: id } },
      select: { type: true, coinAmount: true },
    });
    const heldExcludingThis = others.reduce(
      (sum, t) => sum + (t.type === "buy" ? t.coinAmount : t.type === "sell" ? -t.coinAmount : 0),
      0
    );
    const updatedCoinAmount = coinAmount ?? existing.coinAmount;
    if (updatedCoinAmount > heldExcludingThis) {
      return res.status(400).json({
        error: `That would sell more than you hold: ${heldExcludingThis.toLocaleString(undefined, {
          maximumFractionDigits: 8,
        })} ${existing.coin?.symbol ?? ""} available.`,
      });
    }
  }

  const updatedPhp = phpAmount ?? existing.phpAmount;
  const updatedCoins = coinAmount ?? existing.coinAmount;
  const isCashFlow = existing.type === "deposit" || existing.type === "withdraw";
  const price = isCashFlow ? 0 : updatedCoins > 0 ? updatedPhp / updatedCoins : existing.price;

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
      type: updated.type as "buy" | "sell" | "deposit" | "withdraw",
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