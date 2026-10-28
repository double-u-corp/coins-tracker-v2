import { useState } from "react";
import AlertBanner from "@/components/AlertBanner";
import JournalForm from "./JournalForm";
import type { JournalEntryView } from "@/validators/journalSchema";
import FormattedAiResponse from "@/components/FormattedAiResponse";
import dynamic from "next/dynamic";

const ManageCoinsView = dynamic(() => import("@/features/manage/ManageCoinsView"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-gray-500">Loading Manage…</p>,
});
const LongScanView = dynamic(() => import("@/features/longScan/LongScanView"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-gray-500">Loading LONG scan…</p>,
});


interface JournalSidebarProps {
  entries: JournalEntryView[];
  loading: boolean;
  error: string | null;
  defaultSymbol: string;
  authenticated: boolean;
  onAdd: (input: { symbol: string | null; entryDate: string; title: string; notes: string }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onUpdate?: (id: number, input: { title?: string; notes?: string }) => Promise<void>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function JournalSidebar({
  entries,
  loading,
  error,
  defaultSymbol,
  authenticated,
  onAdd,
  onDelete,
  onUpdate,
}: JournalSidebarProps) {
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Inline Editing State
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState<string>("");
  const [editNotes, setEditNotes] = useState<string>("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [longScanOpen, setLongScanOpen] = useState(false);

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

  function startEditing(entry: JournalEntryView) {
    setEditingId(entry.id);
    setEditTitle(entry.title);
    setEditNotes(entry.notes);
    setUpdateError(null);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditTitle("");
    setEditNotes("");
    setUpdateError(null);
  }

  async function handleSaveUpdate(id: number) {
    if (!onUpdate) return;
    setSavingId(id);
    setUpdateError(null);
    try {
      await onUpdate(id, { title: editTitle, notes: editNotes });
      setEditingId(null);
    } catch (err) {
      setUpdateError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <aside className="grid w-full grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Column 1: The Form (Takes up 4 columns on desktop) */}
      <div className="lg:col-span-4">
        {authenticated ? (
          <JournalForm defaultSymbol={defaultSymbol} onSubmit={onAdd} />
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-xs text-gray-500 shadow-sm">
            Log in to add journal entries.
          </div>
        )}
      </div>

      {/* Column 2: The List of Entries (Takes up 8 columns on desktop) */}
      <div className="lg:col-span-8">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Events &amp; notes in range</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-900 hover:bg-emerald-100"
            >
              <span aria-hidden>⚙️</span>
              Manage
            </button>
            <button
              type="button"
              onClick={() => setLongScanOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-900 hover:bg-indigo-100"
            >
              <span aria-hidden>📡</span>
              LONG scan
            </button>
          </div>
        </div>
        {error && <AlertBanner variant="error" message={`Failed to load journal: ${error}`} />}
        {deleteError && <AlertBanner variant="error" message={deleteError} />}
        {updateError && <AlertBanner variant="error" message={updateError} />}
        {loading ? (
          <p className="text-xs text-gray-500">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-gray-500">No journal entries in this range yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => {
              const isEditing = editingId === entry.id;

              return (
                <li key={entry.id} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                  {isEditing ? (
                    <div className="flex flex-col gap-2.5">
                      <div className="text-xs font-medium text-gray-500">
                        {formatDate(entry.entryDate)}
                        {entry.symbol && <span className="ml-1 text-gray-400">· {entry.symbol}</span>}
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">Title</label>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full rounded-md border border-gray-300 p-1.5 text-xs font-semibold text-gray-900 focus:border-purple-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-0.5">Notes</label>
                        <textarea
                          rows={6}
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          className="w-full rounded-md border border-gray-300 p-2 text-xs font-mono text-gray-800 focus:border-purple-500 focus:outline-none"
                        />
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-1 border-t border-gray-100">
                        <button
                          type="button"
                          onClick={cancelEditing}
                          className="rounded px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 transition"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveUpdate(entry.id)}
                          disabled={savingId === entry.id}
                          className="rounded bg-purple-600 px-3 py-1 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition"
                        >
                          {savingId === entry.id ? "Saving…" : "Save Changes"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-medium text-gray-500">
                            {formatDate(entry.entryDate)}
                            {entry.symbol && <span className="ml-1 text-gray-400">· {entry.symbol}</span>}
                          </div>
                          <div className="text-sm font-semibold text-gray-900">{entry.title?.trim() ?? ""}</div>
                        </div>
                        {authenticated && (
                          <div className="flex items-center gap-1 shrink-0">
                            {onUpdate && (
                              <button
                                type="button"
                                onClick={() => startEditing(entry)}
                                className="rounded p-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-purple-600 transition"
                                aria-label="Edit entry"
                                title="Edit entry"
                              >
                                ✏️
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDelete(entry.id)}
                              disabled={deletingId === entry.id}
                              className="rounded p-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 transition"
                              aria-label="Delete entry"
                              title="Delete entry"
                            >
                              {deletingId === entry.id ? "…" : "✕"}
                            </button>
                          </div>
                        )}
                      </div>
                      <FormattedAiResponse text={entry.notes} />
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {manageOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Manage coins"
          onClick={() => setManageOpen(false)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-t-2xl sm:rounded-xl border border-gray-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 shrink-0">
              <h2 className="text-base font-bold text-gray-900">⚙️ Manage coins</h2>
              <button
                type="button"
                onClick={() => setManageOpen(false)}
                className="rounded-md border border-gray-200 px-2.5 py-1 text-sm font-bold text-gray-600 hover:bg-gray-50"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto px-3 py-3 sm:px-4">
              <ManageCoinsView />
            </div>
          </div>
        </div>
      )}

      {longScanOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="LONG scan"
          onClick={() => setLongScanOpen(false)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-t-2xl sm:rounded-xl border border-gray-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 shrink-0">
              <h2 className="text-base font-bold text-gray-900">📡 LONG scan</h2>
              <button
                type="button"
                onClick={() => setLongScanOpen(false)}
                className="rounded-md border border-gray-200 px-2.5 py-1 text-sm font-bold text-gray-600 hover:bg-gray-50"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto px-1 py-2 sm:px-2">
              <LongScanView />
            </div>
          </div>
        </div>
      )}

    </aside>
  );
}