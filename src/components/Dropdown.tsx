interface DropdownOption {
  label: string;
  value: string;
}

interface DropdownProps {
  label?: string;
  value: string;
  options: DropdownOption[];
  placeholder?: string;
  onChange: (value: string) => void;
}

export default function Dropdown({ label, value, options, placeholder = "Select an option", onChange }: DropdownProps) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
      {label && <span>{label}</span>}
      <select
        className="w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:w-64"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
