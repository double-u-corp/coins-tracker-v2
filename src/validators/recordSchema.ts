import { z } from "zod";

/** Validates a raw price Record entity. */
export const recordSchema = z.object({
  id: z.number().int().positive(),
  coinId: z.number().int().positive(),
  price: z.number().positive("Price must be positive"),
  high: z.number().positive("High must be positive"),
  low: z.number().positive("Low must be positive"),
  createdAt: z.coerce.date(),
});

export type RecordInput = z.infer<typeof recordSchema>;

/** Shape returned by /api/coins for the Home page table. */
export const coinSummarySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  symbol: z.string(),
  currentPrice: z.number().nullable(),
  recordedHigh: z.number().nullable(),
  recordedLow: z.number().nullable(),
  targetHigh: z.number().nullable(),
  targetLow: z.number().nullable(),
  targetHighReached: z.boolean(),
  targetLowReached: z.boolean(),
  // Direction vs. the previous stored Record, i.e. did this run's price go
  // up/down/stay flat since the last time a price was recorded for this
  // coin. Null when there's fewer than two Records yet to compare.
  priceDirection: z.enum(["up", "down", "flat"]).nullable(),
});

export type CoinSummary = z.infer<typeof coinSummarySchema>;

/** A single coin's new-high or new-low event from the most recent cron run. */
export const newRecordAlertSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  type: z.enum(["high", "low"]),
  value: z.number(),
});

export type NewRecordAlert = z.infer<typeof newRecordAlertSchema>;

/** Shape for a single day's aggregated high/low, used by the Calendar page. */
export const dailyRecordSchema = z.object({
  date: z.string(), // "YYYY-MM-DD"
  high: z.number(),
  low: z.number(),
});

export type DailyRecord = z.infer<typeof dailyRecordSchema>;

/**
 * A single bucketed point for the price line chart. Unlike DailyRecord
 * (which uses the Record table's cumulative all-time high/low), a chart
 * point's high/low is the actual price range observed within that bucket
 * (week/month/year) — the peak and trough price during that period, which
 * is what makes a weekly/monthly/yearly chart show real movement instead
 * of a slowly-changing all-time-high staircase.
 */
export const chartPointSchema = z.object({
  period: z.string(), // bucket key, e.g. "2026-W15", "2026-04", "2026"
  label: z.string(), // human-readable label for the x-axis
  high: z.number(),
  low: z.number(),
});

export type ChartPoint = z.infer<typeof chartPointSchema>;
