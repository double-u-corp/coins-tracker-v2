import { z } from "zod";

/** Shape of a news/signal item returned to the client. */
export const newsItemViewSchema = z.object({
  id: z.number().int().positive(),
  symbol: z.string(),
  name: z.string(),
  headline: z.string(),
  summary: z.string(),
  sentiment: z.enum(["bullish", "bearish", "neutral"]),
  source: z.string(),
  url: z.string().nullable(),
  cronLogId: z.number().int().positive().nullable(),
  publishedAt: z.string(),
});

export type NewsItemView = z.infer<typeof newsItemViewSchema>;
