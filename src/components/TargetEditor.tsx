import { useEffect, useState } from "react";

interface TargetEditorProps {
  value: number | null;
  onSave: (value: number | null) => void;
  placeholder?: string;
}

/** A single editable number field that saves on blur (or Enter), and reverts display if left empty. */
export default function TargetEditor({ value, onSave, placeholder }: TargetEditorProps) {
  const [text, setText] = useState(value !== null ? String(value) : "");

  // Keep the field in sync if the underlying value changes elsewhere (e.g. after a refresh).
  useEffect(() => {
    setText(value !== null ? String(value) : "");
  }, [value]);

  function commit() {
    if (text.trim() === "") {
      onSave(null);
      return;
    }
    const parsed = Number(text);
    if (!Number.isNaN(parsed) && parsed > 0) {
      onSave(parsed);
    } else {
      setText(value !== null ? String(value) : ""); // revert invalid input
    }
  }

  return (
    <input
      type="number"
      inputMode="decimal"
      min="0"
      step="any"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right text-xs shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
    />
  );
}
