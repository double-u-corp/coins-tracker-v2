import { z } from "zod";

/** Validates a raw coin entity (as returned by Prisma / the API). */
export const coinSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1, "Coin name is required"),
  symbol: z
    .string()
    .min(1, "Symbol is required")
    .regex(/^[A-Z0-9]+$/, "Symbol must be uppercase alphanumeric (e.g. BTCUSDT)"),
});

export type CoinInput = z.infer<typeof coinSchema>;

/** Validates the payload for POST /api/coins (adding a new coin to monitor). */
export const addCoinSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Symbol is required")
    .regex(/^[A-Z0-9]+$/i, "Symbol must be alphanumeric (e.g. BTCUSDT)")
    .transform((val) => val.toUpperCase()),
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(50, "Name is too long"),
});

export type AddCoinInput = z.infer<typeof addCoinSchema>;

/** Validates the payload for DELETE /api/coins (removing a monitored coin). */
export const removeCoinSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Symbol is required")
    .transform((val) => val.toUpperCase()),
});

/** Validates the payload for POST /api/targets (set a coin's target high/low). */
export const setTargetSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Symbol is required")
    .transform((val) => val.toUpperCase()),
  targetHigh: z.coerce.number().positive("Target high must be greater than 0").nullable(),
  targetLow: z.coerce.number().positive("Target low must be greater than 0").nullable(),
});

export type SetTargetInput = z.infer<typeof setTargetSchema>;

/** Validates the coin symbol supplied via query params (e.g. calendar/chart filters). */
export const coinSymbolQuerySchema = z
  .string()
  .trim()
  .regex(/^[A-Z0-9]*$/i, "Invalid coin symbol")
  .transform((val) => val.toUpperCase());

/** Validates a "YYYY-MM" month query param used by the calendar page. */
export const monthQuerySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be in YYYY-MM format");

/** Validates the `years` query param for the chart page — 1 to 5, matching the retention window. */
export const chartYearsQuerySchema = z.coerce.number().int().min(1).max(5);

/** Validates the `granularity` query param for the chart page. */
export const chartGranularitySchema = z.enum(["weekly", "monthly", "yearly"]);
export type ChartGranularity = z.infer<typeof chartGranularitySchema>;
