interface AlertBannerProps {
  message: string;
  variant?: "info" | "success" | "warning" | "error";
  onDismiss?: () => void;
}

const VARIANT_STYLES: Record<NonNullable<AlertBannerProps["variant"]>, string> = {
  info: "bg-brand-50 border-brand-500 text-brand-700",
  success: "bg-green-50 border-green-500 text-green-700",
  warning: "bg-yellow-50 border-yellow-500 text-yellow-700",
  error: "bg-red-50 border-red-500 text-red-700",
};

export default function AlertBanner({ message, variant = "info", onDismiss }: AlertBannerProps) {
  return (
    <div
      role="status"
      className={`mb-4 flex items-center gap-2 rounded-md border-l-4 px-4 py-3 text-sm font-medium ${VARIANT_STYLES[variant]}`}
    >
      <span aria-hidden="true">ℹ️</span>
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded p-0.5 text-current opacity-60 hover:opacity-100"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
