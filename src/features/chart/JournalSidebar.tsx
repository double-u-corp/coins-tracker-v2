import { useState } from "react";
import AlertBanner from "@/components/AlertBanner";
import JournalForm from "./JournalForm";
import type { JournalEntryView } from "@/validators/journalSchema";

interface CoinOption {
  symbol: string;
  name: string;
}

interface JournalSidebarProps {
  entries: JournalEntryView[];
  loading: boolean;
  error: string | null;
  coinOptions: CoinOption[];
  defaultSymbol: string;
  authenticated: boolean;
  onAdd: (input: { symbol: string | null; entryDate: string; title: string; notes: string }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function JournalSidebar({
  entries,
  loading,
  error,
  coinOptions,
  defaultSymbol,
  authenticated,
  onAdd,
  onDelete,
}: JournalSidebarProps) {
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(id: number) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await onDelete(id);
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <aside className="flex w-full flex-col gap-4 lg:w-80 lg:shrink-0">
      {authenticated ? (
        <JournalForm coinOptions={coinOptions} defaultSymbol={defaultSymbol} onSubmit={onAdd} />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-xs text-gray-500 shadow-sm">
          Log in to add journal entries.
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Events &amp; notes in range</h3>
        {error && <AlertBanner variant="error" message={`Failed to load journal: ${error}`} />}
        {deleteError && <AlertBanner variant="error" message={deleteError} />}
        {loading ? (
          <p className="text-xs text-gray-500">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-gray-500">No journal entries in this range yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-gray-500">
                      {formatDate(entry.entryDate)}
                      {entry.symbol && <span className="ml-1 text-gray-400">· {entry.symbol}</span>}
                    </div>
                    <div className="text-sm font-semibold text-gray-900">{entry.title}</div>
                  </div>
                  {authenticated && (
                    <button
                      type="button"
                      onClick={() => handleDelete(entry.id)}
                      disabled={deletingId === entry.id}
                      className="shrink-0 rounded p-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                      aria-label="Delete entry"
                    >
                      {deletingId === entry.id ? "…" : "✕"}
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-600">{entry.notes}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
