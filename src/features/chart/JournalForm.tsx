import { useState, type FormEvent } from "react";
import AlertBanner from "@/components/AlertBanner";

interface JournalFormProps {
  defaultSymbol: string;
  onSubmit: (input: { symbol: string | null; entryDate: string; title: string; notes: string }) => Promise<void>;
}

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
    const finalTitle = title.trim() || fallbackTitle;

    setSubmitting(true);
    try {
      await onSubmit({
        symbol: defaultSymbol || null,
        entryDate: new Date(entryDate).toISOString(),
        title: finalTitle,
        notes: trimmedNotes,
      });
      setTitle("");
      setNotes("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
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
        <span>Title <span className="text-gray-400 font-normal">(optional)</span></span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`e.g. Bought DIP (Defaults to ${defaultSymbol || "Trade Log"})`}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        <span>Notes <span className="text-red-500">*</span></span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="e.g. 10 @ 7350 ladder entry near key support"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          required
        />
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