import { z } from "zod";

/**
 * Validates the payload for POST /api/transactions.
 *
 * - `type`: "buy" or "sell".
 * - Live trade: `symbol`, `type`, and `coinAmount` (buy: how much coin to
 *   acquire — wait, buys are entered as a PHP amount instead, see below).
 * - Manual/historical entry: also supply `price` (what you actually
 *   paid/received per unit) and optionally `transactedAt`.
 *
 * Buys are entered as a PHP amount to spend (coinAmount is derived).
 * Sells are entered as a coin amount to sell (phpAmount received is derived).
 */
export const createTransactionSchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .min(1, "Coin is required")
      .transform((val) => val.toUpperCase()),
    type: z.enum(["buy", "sell"]),
    phpAmount: z.coerce
      .number({ invalid_type_error: "Enter a valid PHP amount" })
      .positive("PHP amount must be greater than 0")
      .max(100_000_000, "That amount looks too large")
      .optional(),
    coinAmount: z.coerce
      .number({ invalid_type_error: "Enter a valid coin amount" })
      .positive("Coin amount must be greater than 0")
      .optional(),
    price: z.coerce
      .number({ invalid_type_error: "Enter a valid price" })
      .positive("Price must be greater than 0")
      .optional(),
    transactedAt: z
      .string()
      .refine((val) => !Number.isNaN(Date.parse(val)), "Enter a valid date")
      .refine((val) => Date.parse(val) <= Date.now(), "Date can't be in the future")
      .optional(),
  })
  .refine((data) => (data.type === "buy" ? data.phpAmount !== undefined : true), {
    message: "PHP amount is required for a buy",
    path: ["phpAmount"],
  })
  .refine((data) => (data.type === "sell" ? data.coinAmount !== undefined : true), {
    message: "Coin amount is required for a sell",
    path: ["coinAmount"],
  });

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

/** Validates the payload for DELETE /api/transactions (removing a mistaken entry). */
export const deleteTransactionSchema = z.object({
  id: z.coerce.number().int().positive("A valid transaction id is required"),
});

/**
 * Validates the payload for PATCH /api/transactions — correcting the coin
 * amount and/or price of an existing entry (e.g. the exact numbers weren't
 * available at the time). phpAmount is recomputed from these, so it isn't
 * editable directly.
 */
export const updateTransactionSchema = z.object({
  id: z.coerce.number().int().positive("A valid transaction id is required"),
  coinAmount: z.coerce.number({ invalid_type_error: "Enter a valid coin amount" }).positive("Coin amount must be greater than 0"),
  price: z.coerce.number({ invalid_type_error: "Enter a valid price" }).positive("Price must be greater than 0"),
});

export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

/** Shape of a single transaction row returned to the client. */
export const transactionSchema = z.object({
  id: z.number().int().positive(),
  symbol: z.string(),
  name: z.string(),
  type: z.enum(["buy", "sell"]),
  phpAmount: z.number(),
  price: z.number(),
  coinAmount: z.number(),
  isManual: z.boolean(),
  transactedAt: z.string(),
});

export type TransactionView = z.infer<typeof transactionSchema>;

/** Per-coin portfolio rollup: what's been spent/received vs. what's left and what it's worth now. */
export const portfolioEntrySchema = z.object({
  symbol: z.string(),
  name: z.string(),
  totalCoinAmount: z.number(), // net held = bought - sold
  totalBought: z.number(),
  totalSold: z.number(),
  totalPhpSpent: z.number(), // gross PHP spent on buys
  totalPhpReceived: z.number(), // gross PHP received from sells
  averageBuyPrice: z.number(),
  currentPrice: z.number().nullable(),
  currentValue: z.number().nullable(), // net holdings valued at current price
  unrealizedGainLoss: z.number().nullable(),
  unrealizedGainLossPercent: z.number().nullable(),
  realizedGainLoss: z.number(), // profit/loss already locked in from sells, using average buy cost
});

export type PortfolioEntry = z.infer<typeof portfolioEntrySchema>;
