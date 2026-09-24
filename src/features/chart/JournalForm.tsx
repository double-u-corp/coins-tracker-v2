import { useState, type FormEvent } from "react";
import AlertBanner from "@/components/AlertBanner";

interface JournalFormProps {
  defaultSymbol: string;
  onSubmit: (input: {
    symbol: string | null;
    entryDate: string;
    title: string;
    notes: string;
  }) => Promise<void>;
}

/** Soft warn only — server may still reject if notes column is VARCHAR-short. */
const NOTES_SOFT_LIMIT = 8000;

export default function JournalForm({ defaultSymbol, onSubmit }: JournalFormProps) {
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedNotes = notes.trim();
    if (!trimmedNotes) {
      setError("Please enter some notes");
      return;
    }

    const fallbackTitle = defaultSymbol ? `${defaultSymbol} Log` : "Trade Log";
    // Keep title short — long agent prompts belong in notes, not title
    const finalTitle = (title.trim() || fallbackTitle).slice(0, 200);

    setSubmitting(true);
    try {
      await onSubmit({
        symbol: defaultSymbol || null,
        entryDate: new Date(entryDate + "T12:00:00").toISOString(),
        title: finalTitle,
        notes: trimmedNotes,
      });
      setTitle("");
      setNotes("");
    } catch (err) {
      const msg = (err as Error).message || "Failed to save";
      // Common when DB notes is VARCHAR(255/1000) or API zod max is tight
      if (/too long|length|varchar|255|1000|1400|2000|payload|entity too large|413/i.test(msg)) {
        setError(
          `${msg} — Agent review text is long. Put the full paste in Notes (not Title). If this keeps failing, the journal API/DB notes field needs to allow longer text (TEXT), not a short VARCHAR.`
        );
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const notesLen = notes.length;
  const notesWarn = notesLen > NOTES_SOFT_LIMIT;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-gray-100 pb-2">
        <h3 className="text-sm font-semibold text-gray-900">Log an event</h3>
        <span className="rounded bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
          {defaultSymbol || "General"}
        </span>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        <span>Date</span>
        <input
          type="date"
          value={entryDate}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setEntryDate(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        <span>
          Title <span className="text-gray-400 font-normal">(optional, keep short)</span>
        </span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder={`e.g. Agent review (defaults to ${defaultSymbol || "Trade Log"})`}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        <span className="flex items-center justify-between gap-2">
          <span>
            Notes <span className="text-red-500">*</span>
          </span>
          <span className={`tabular-nums font-normal ${notesWarn ? "text-amber-600" : "text-gray-400"}`}>
            {notesLen.toLocaleString()} chars
          </span>
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={8}
          placeholder="Paste agent review or notes here (long text OK)"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono text-xs leading-relaxed"
          required
        />
        {notesWarn && (
          <span className="text-[11px] text-amber-700">
            Very long paste — if save fails, your API/DB may still limit notes length.
          </span>
        )}
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Add entry"}
      </button>
    </form>
  );
}
