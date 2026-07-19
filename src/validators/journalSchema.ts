import { z } from "zod";

/** Validates the payload for POST /api/journal. */
export const createJournalEntrySchema = z.object({
  symbol: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((val) => (val ? val.toUpperCase() : null)), // omitted/empty/null = a general, coin-agnostic entry
  entryDate: z
    .string()
    .refine((val) => !Number.isNaN(Date.parse(val)), "Enter a valid date"),
  title: z.string().trim().min(1, "Title is required").max(120, "Title is too long"),
  notes: z.string().trim().min(1, "Notes are required").max(2000, "Notes are too long"),
});

export type CreateJournalEntryInput = z.infer<typeof createJournalEntrySchema>;

/** Validates the payload for DELETE /api/journal. */
export const deleteJournalEntrySchema = z.object({
  id: z.coerce.number().int().positive("A valid entry id is required"),
});

/** Shape of a journal entry returned to the client. */
export const journalEntryViewSchema = z.object({
  id: z.number().int().positive(),
  symbol: z.string().nullable(),
  name: z.string().nullable(),
  entryDate: z.string(),
  title: z.string(),
  notes: z.string(),
  createdAt: z.string(),
});

export type JournalEntryView = z.infer<typeof journalEntryViewSchema>;
