import Modal from "@/components/Modal";
import { formatPhp } from "@/lib/format";
import type { ManualRecordEntry } from "./useHomeLogic";

interface PriceUpdateCoin {
  symbol: string;
  name: string;
}

interface PriceUpdateModalProps {
  open: boolean;
  coin: PriceUpdateCoin | null;
  value: string;
  onValueChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  recentRecords: ManualRecordEntry[];
  recentLoading: boolean;
  recentError: string | null;
  editingId: number | null;
  editValue: string;
  onEditValueChange: (value: string) => void;
  editSaving: boolean;
  editError: string | null;
  onStartEdit: (record: ManualRecordEntry) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function PriceUpdateModal({
  open,
  coin,
  value,
  onValueChange,
  onSave,
  saving,
  error,
  onClose,
  recentRecords,
  recentLoading,
  recentError,
  editingId,
  editValue,
  onEditValueChange,
  editSaving,
  editError,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
}: PriceUpdateModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={coin ? `Update price — ${coin.name} (${coin.symbol})` : "Update price"} closeLabel="Close">
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        <span>New price (PHP)</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          autoFocus
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave();
          }}
          placeholder="e.g. 3500000"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </label>

      {error && <p className="mt-2 text-xs font-medium text-red-700">{error}</p>}

      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="mt-3 w-full rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>

      <div className="mt-5 border-t border-gray-200 pt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Recent manual entries — found a wrong one? Fix it here
        </h3>

        {recentError && <p className="mb-2 text-xs font-medium text-red-700">{recentError}</p>}
        {recentLoading ? (
          <p className="text-xs text-gray-500">Loading…</p>
        ) : recentRecords.length === 0 ? (
          <p className="text-xs text-gray-500">No manual entries yet for this coin.</p>
        ) : (
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {recentRecords.map((record) => (
              <li key={record.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50">
                {editingId === record.id ? (
                  <div className="flex w-full flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        autoFocus
                        value={editValue}
                        onChange={(e) => onEditValueChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") onSaveEdit();
                        }}
                        className="w-28 rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                      <button
                        type="button"
                        onClick={onSaveEdit}
                        disabled={editSaving}
                        className="rounded-md bg-brand-600 px-2 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                      >
                        {editSaving ? "…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={onCancelEdit}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                    {editError && <p className="text-xs font-medium text-red-700">{editError}</p>}
                  </div>
                ) : (
                  <>
                    <div>
                      <div className="font-medium text-gray-900">{formatPhp(record.price)}</div>
                      <div className="text-xs text-gray-400">{formatDateTime(record.createdAt)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onStartEdit(record)}
                      className="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                    >
                      Edit
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
