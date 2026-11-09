import prisma from "@/lib/prisma";

export type HoldFloorView = {
  id: number;
  coinId: number;
  symbol: string;
  name: string;
  avgCost: number;
  worstPrice: number;
  worstPct: number;
  reachedAt: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  open: boolean;
};

function toView(
  row: {
    id: number;
    coinId: number;
    avgCost: number;
    worstPrice: number;
    worstPct: number;
    reachedAt: Date;
    createdAt: Date;
    updatedAt: Date;
    closedAt: Date | null;
    coin: { symbol: string; name: string };
  }
): HoldFloorView {
  return {
    id: row.id,
    coinId: row.coinId,
    symbol: row.coin.symbol,
    name: row.coin.name,
    avgCost: row.avgCost,
    worstPrice: row.worstPrice,
    worstPct: row.worstPct,
    reachedAt: row.reachedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    open: row.closedAt == null,
  };
}

/** Touch/open floor for a held bag. Deepens worst if price makes a new low vs avg. */
export async function touchHoldFloor(args: {
  symbol: string;
  avgCost: number;
  price: number;
}): Promise<HoldFloorView | null> {
  const avg = Number(args.avgCost);
  const price = Number(args.price);
  if (!(avg > 0) || !(price > 0)) return null;

  const coin = await prisma.coin.findUnique({
    where: { symbol: args.symbol.toUpperCase() },
    select: { id: true, symbol: true, name: true },
  });
  if (!coin) return null;

  const worstPctNow = (price - avg) / avg;
  const open = await prisma.holdFloor.findFirst({
    where: { coinId: coin.id, closedAt: null },
    include: { coin: { select: { symbol: true, name: true } } },
    orderBy: { id: "desc" },
  });

  if (!open) {
    const created = await prisma.holdFloor.create({
      data: {
        coinId: coin.id,
        avgCost: avg,
        worstPrice: price,
        worstPct: worstPctNow,
        reachedAt: new Date(),
      },
      include: { coin: { select: { symbol: true, name: true } } },
    });
    return toView(created);
  }

  // DCA: refresh avg; recompute pct from stored worst price
  let worstPrice = open.worstPrice;
  let reachedAt = open.reachedAt;
  if (price < worstPrice) {
    worstPrice = price;
    reachedAt = new Date();
  }
  const worstPct = (worstPrice - avg) / avg;

  const updated = await prisma.holdFloor.update({
    where: { id: open.id },
    data: {
      avgCost: avg,
      worstPrice,
      worstPct,
      reachedAt,
    },
    include: { coin: { select: { symbol: true, name: true } } },
  });
  return toView(updated);
}

/** Mark open floor closed when position is flat. */
export async function closeHoldFloor(symbol: string): Promise<void> {
  const coin = await prisma.coin.findUnique({
    where: { symbol: symbol.toUpperCase() },
    select: { id: true },
  });
  if (!coin) return;
  await prisma.holdFloor.updateMany({
    where: { coinId: coin.id, closedAt: null },
    data: { closedAt: new Date() },
  });
}

export async function listHoldFloors(opts?: {
  openOnly?: boolean;
  symbol?: string;
  limit?: number;
}): Promise<HoldFloorView[]> {
  const where: {
    closedAt?: Date | null;
    coin?: { symbol: string };
  } = {};
  if (opts?.openOnly) where.closedAt = null;
  if (opts?.symbol) where.coin = { symbol: opts.symbol.toUpperCase() };

  const rows = await prisma.holdFloor.findMany({
    where,
    include: { coin: { select: { symbol: true, name: true } } },
    orderBy: [{ closedAt: "asc" }, { reachedAt: "desc" }],
    take: opts?.limit ?? 200,
  });
  return rows.map(toView);
}

/**
 * Replay simple holdings from transactions and touch floors with latest Record price.
 * Safe to call from cron after polls.
 */
export async function refreshHoldFloorsFromPortfolio(): Promise<{ updated: number; closed: number }> {
  const txs = await prisma.transaction.findMany({
    where: { coinId: { not: null } },
    select: {
      coinId: true,
      type: true,
      coinAmount: true,
      phpAmount: true,
      transactedAt: true,
      id: true,
      coin: { select: { symbol: true } },
    },
    orderBy: [{ transactedAt: "asc" }, { id: "asc" }],
  });

  type Agg = { holdings: number; spent: number; symbol: string };
  const byCoin = new Map<number, Agg>();
  for (const t of txs) {
    if (t.coinId == null || !t.coin) continue;
    const type = t.type.toLowerCase();
    if (type !== "buy" && type !== "sell") continue;
    let a = byCoin.get(t.coinId);
    if (!a) {
      a = { holdings: 0, spent: 0, symbol: t.coin.symbol };
      byCoin.set(t.coinId, a);
    }
    if (type === "buy") {
      a.holdings += Number(t.coinAmount) || 0;
      a.spent += Number(t.phpAmount) || 0;
    } else {
      const sellCoins = Number(t.coinAmount) || 0;
      const prevH = a.holdings;
      if (prevH > 1e-12 && sellCoins > 0) {
        const ratio = Math.min(1, sellCoins / prevH);
        a.spent = Math.max(0, a.spent * (1 - ratio));
      }
      a.holdings = Math.max(0, a.holdings - sellCoins);
      if (a.holdings < 1e-10) {
        a.holdings = 0;
        a.spent = 0;
      }
    }
  }

  let updated = 0;
  let closed = 0;
  for (const [coinId, a] of byCoin) {
    if (a.holdings <= 1e-10) {
      const res = await prisma.holdFloor.updateMany({
        where: { coinId, closedAt: null },
        data: { closedAt: new Date() },
      });
      closed += res.count;
      continue;
    }
    const avg = a.spent / a.holdings;
    if (!(avg > 0)) continue;
    const last = await prisma.record.findFirst({
      where: { coinId },
      orderBy: { createdAt: "desc" },
      select: { price: true },
    });
    if (!last || !(last.price > 0)) continue;
    await touchHoldFloor({ symbol: a.symbol, avgCost: avg, price: last.price });
    updated += 1;
  }
  return { updated, closed };
}
