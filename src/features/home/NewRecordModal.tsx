import Link from "next/link";
import Modal from "@/components/Modal";
import { formatPhp } from "@/lib/format";
import type { NewRecordAlert } from "@/validators/recordSchema";

interface NewRecordModalProps {
  open: boolean;
  records: NewRecordAlert[];
  onClose: () => void;
}

export default function NewRecordModal({ open, records, onClose }: NewRecordModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="📈 New price record" closeLabel="Got it, close">
      <ul className="flex flex-col gap-2">
        {records.map((record, idx) => (
          <li
            key={`${record.symbol}-${record.type}-${idx}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
          >
            <div className="min-w-0 flex-1">
              <span className="font-medium text-gray-900">
                {record.name}{" "}
                <span className="text-gray-400">({record.symbol})</span>
              </span>
              <span
                className={`ml-2 font-semibold ${
                  record.type === "high" ? "text-green-700" : "text-red-700"
                }`}
              >
                New {record.type === "high" ? "high" : "low"}: {formatPhp(record.value)}
              </span>
            </div>
            <Link
              href={`/chart?symbol=${encodeURIComponent(record.symbol)}`}
              className="shrink-0 rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-700"
              onClick={onClose}
            >
              Spot →
            </Link>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
