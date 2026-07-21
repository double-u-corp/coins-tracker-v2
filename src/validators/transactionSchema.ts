import { z } from "zod";

/**
 * Validates the payload for POST /api/transactions.
 *
 * `type`: "buy" or "sell". Every entry always supplies BOTH `phpAmount`
 * (the peso amount spent on a buy, or received from a sell) AND
 * `coinAmount` (how many coins were bought/sold) — no per-unit price
 * input. `price` is derived server-side as phpAmount / coinAmount, purely
 * for display/reference; it's never something the user types directly,
 * since the exact execution price isn't always known precisely and
 * differs from what a live ticker would show at lookup time.
 */
export const createTransactionSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Coin is required")
    .transform((val) => val.toUpperCase()),
  type: z.enum(["buy", "sell"]),
  phpAmount: z.coerce
    .number({ invalid_type_error: "Enter a valid PHP amount" })
    .positive("PHP amount must be greater than 0")
    .max(100_000_000, "That amount looks too large"),
  coinAmount: z.coerce
    .number({ invalid_type_error: "Enter a valid coin amount" })
    .positive("Coin amount must be greater than 0"),
  transactedAt: z
    .string()
    .refine((val) => !Number.isNaN(Date.parse(val)), "Enter a valid date")
    .refine((val) => Date.parse(val) <= Date.now(), "Date can't be in the future")
    .optional(),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

/** Validates the payload for DELETE /api/transactions (removing a mistaken entry). */
export const deleteTransactionSchema = z.object({
  id: z.coerce.number().int().positive("A valid transaction id is required"),
});

/**
 * Validates the payload for PATCH /api/transactions — correcting the coin
 * amount and/or PHP amount of an existing entry. `price` is recomputed
 * from these (phpAmount / coinAmount), not editable directly — same
 * reasoning as createTransactionSchema above.
 */
export const updateTransactionSchema = z.object({
  id: z.coerce.number().int().positive("A valid transaction id is required"),
  coinAmount: z.coerce.number({ invalid_type_error: "Enter a valid coin amount" }).positive("Coin amount must be greater than 0"),
  phpAmount: z.coerce.number({ invalid_type_error: "Enter a valid PHP amount" }).positive("PHP amount must be greater than 0"),
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

/**
 * Per-coin portfolio rollup — deliberately just 4 numbers:
 * holdings (net coins held), spent (net PHP still invested — buys minus
 * sell proceeds), current value (currentPrice × holdings), and gain/loss
 * (current value − spent). No average-cost/realized-vs-unrealized split;
 * this is an intentional simplification over an earlier, more detailed
 * version of this schema.
 */
export const portfolioEntrySchema = z.object({
  symbol: z.string(),
  name: z.string(),
  holdings: z.number(), // net coins held = totalBought - totalSold
  spent: z.number(), // net PHP invested = totalPhpSpent (buys) - totalPhpReceived (sells)
  currentPrice: z.number().nullable(),
  currentValue: z.number().nullable(), // currentPrice * holdings
  gainLoss: z.number().nullable(), // currentValue - spent
});

export type PortfolioEntry = z.infer<typeof portfolioEntrySchema>;
