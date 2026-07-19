import type { ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  closeLabel?: string;
}

/**
 * A modal that only closes when the user clicks the close button —
 * deliberately no backdrop-click or Escape-key dismissal, for alerts that
 * shouldn't be missed by an accidental click.
 */
export default function Modal({ open, onClose, title, children, closeLabel = "Close" }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">{title}</h2>
        <div className="mb-6">{children}</div>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
        >
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
