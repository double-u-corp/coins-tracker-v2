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

/** Validates the `years` query param for the chart page. Accepts fractional
 * values — the 1M/3M/6M range buttons send fractional years (0.08/0.25/0.50),
 * so "years" here is a UI-level unit, not a literal whole-calendar-year
 * count. The previous `.int().min(1)` rejected every sub-1 value outright,
 * which is exactly why 1M/3M/6M 400'd while 1Y/3Y (whole numbers) passed.
 * The downstream cutoff calculation in coins.ts is plain millisecond
 * arithmetic (`years * 365 * 24h`), so it already handles fractional years
 * correctly — this was purely a validation-layer bug, not a date-math one. */
export const chartYearsQuerySchema = z.coerce.number().min(0.01).max(5);

/** Validates the `hours` query param for the intraday chart (granularity=3h)
 * — capped at 30 days' worth of hours, which is already generous for
 * swing/entry-ladder purposes and far below the 3-year Record retention
 * window, so there's no risk of this ever requesting pruned data. */
export const chartHoursQuerySchema = z.coerce.number().int().min(1).max(24 * 30);

/** Validates the `granularity` query param for the chart page. */
export const chartGranularitySchema = z.enum(["daily", "weekly", "monthly", "yearly"]);
export type ChartGranularity = z.infer<typeof chartGranularitySchema>;