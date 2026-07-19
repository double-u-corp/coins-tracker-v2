import { useState, type FormEvent } from "react";
import Dropdown from "@/components/Dropdown";
import AlertBanner from "@/components/AlertBanner";

interface CoinOption {
  symbol: string;
  name: string;
}

interface JournalFormProps {
  coinOptions: CoinOption[];
  defaultSymbol: string;
  onSubmit: (input: { symbol: string | null; entryDate: string; title: string; notes: string }) => Promise<void>;
}

export default function JournalForm({ coinOptions, defaultSymbol, onSubmit }: JournalFormProps) {
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [coinSymbol, setCoinSymbol] = useState(defaultSymbol);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Enter a title");
      return;
    }
    if (!notes.trim()) {
      setError("Enter some notes");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        symbol: coinSymbol || null,
        entryDate: new Date(entryDate).toISOString(),
        title: title.trim(),
        notes: notes.trim(),
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
      <h3 className="text-sm font-semibold text-gray-900">Log an event</h3>

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

      <Dropdown
        label="Coin (optional — leave blank for a general note)"
        placeholder="General (no specific coin)"
        value={coinSymbol}
        onChange={setCoinSymbol}
        options={coinOptions.map((c) => ({ label: `${c.name} (${c.symbol})`, value: c.symbol }))}
      />

      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        <span>Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Sold half my position"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
        <span>Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="What happened, and why it mattered"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
