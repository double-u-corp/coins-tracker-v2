import { z } from "zod";

/**
 * Validates the payload for POST /api/transactions.
 *
 * `type`: "buy", "sell", "deposit", or "withdraw".
 * For cash transactions ("deposit", "withdraw"), `symbol` and `coinAmount` are optional.
 * For coin trades ("buy", "sell"), both `symbol` and `coinAmount` are enforced.
 */
export const createTransactionSchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .transform((val) => val.toUpperCase())
      .optional()
      .nullable(),
    type: z.enum(["buy", "sell", "deposit", "withdraw"]),
    phpAmount: z.coerce
      .number({ invalid_type_error: "Enter a valid PHP amount" })
      .positive("PHP amount must be greater than 0")
      .max(100_000_000, "That amount looks too large"),
    coinAmount: z.coerce
      .number({ invalid_type_error: "Enter a valid coin amount" })
      .optional()
      .nullable(),
    transactedAt: z
      .string()
      .refine((val) => !Number.isNaN(Date.parse(val)), "Enter a valid date")
      .refine((val) => Date.parse(val) <= Date.now(), "Date can't be in the future")
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "buy" || data.type === "sell") {
      if (!data.symbol || data.symbol.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Coin is required for trades",
          path: ["symbol"],
        });
      }
      if (data.coinAmount === undefined || data.coinAmount === null || data.coinAmount <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Coin amount must be greater than 0",
          path: ["coinAmount"],
        });
      }
    }
  });

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

/** Validates the payload for DELETE /api/transactions (removing a mistaken entry). */
export const deleteTransactionSchema = z.object({
  id: z.coerce.number().int().positive("A valid transaction id is required"),
});

/**
 * Validates the payload for PATCH /api/transactions — correcting the coin
 * amount and/or PHP amount of an existing entry.
 */
export const updateTransactionSchema = z.object({
  id: z.coerce.number().int().positive("A valid transaction id is required"),
  coinAmount: z.coerce
    .number({ invalid_type_error: "Enter a valid coin amount" })
    .nonnegative("Coin amount must be non-negative")
    .optional(),
  phpAmount: z.coerce
    .number({ invalid_type_error: "Enter a valid PHP amount" })
    .positive("PHP amount must be greater than 0")
    .optional(),
});

export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

/** Shape of a single transaction row returned to the client. */
export const transactionSchema = z.object({
  id: z.number().int().positive(),
  symbol: z.string(),
  name: z.string(),
  type: z.enum(["buy", "sell", "deposit", "withdraw"]),
  phpAmount: z.number(),
  price: z.number(),
  coinAmount: z.number(),
  isManual: z.boolean(),
  transactedAt: z.string(),
});

export type TransactionView = z.infer<typeof transactionSchema>;

/**
 * Per-coin portfolio rollup — 5 numbers:
 * holdings (net coins held), spent (net PHP still invested — buys minus
 * sell proceeds), sold (gross PHP received from sells — informational,
 * already netted into `spent`, not a separate term in the gain/loss math),
 * current value (currentPrice × holdings), and gain/loss (current value −
 * spent).
 */
export const portfolioEntrySchema = z.object({
  symbol: z.string(),
  name: z.string(),
  holdings: z.number(), // net coins held = totalBought - totalSold
  spent: z.number(), // net PHP invested = totalPhpSpent (buys) - totalPhpReceived (sells)
  sold: z.number(), // gross PHP received from sells (totalPhpReceived)
  currentPrice: z.number().nullable(),
  currentValue: z.number().nullable(), // currentPrice * holdings
  gainLoss: z.number().nullable(), // currentValue - spent
});

export type PortfolioEntry = z.infer<typeof portfolioEntrySchema>;