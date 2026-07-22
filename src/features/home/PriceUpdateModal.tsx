import Modal from "@/components/Modal";

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
}: PriceUpdateModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={coin ? `Update price — ${coin.name} (${coin.symbol})` : "Update price"} closeLabel="Cancel">
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
    </Modal>
  );
}
