import { useMemo, useState } from "react";
import type { CoinSummary } from "@/validators/recordSchema";
import { BIAS_BADGE_CLASSES } from "../../features/chart/Technicals";
import { formatPhp } from "@/lib/format";
import {
  usePastTradeScanner,
  classifyStructureResult,
  formatStructureScanForJournal,
  type StructureScanResult,
} from "./usePastTradeScanner";

interface PastTradeScanPanelProps {
  allCoins: CoinSummary[];
  onSelectSymbol: (symbol: string) => void;
}

function ResultRow({
  r,
  onSelectSymbol,
}: {
  r: StructureScanResult;
  onSelectSymbol: (s: string) => void;
}) {
  const c = r.confluence;
  if (!c) return null;
  return (
    <button
      type="button"
      onClick={() => onSelectSymbol(r.symbol)}
      className="w-full flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-white px-3 py-2 text-left text-xs hover:border-purple-300 hover:bg-purple-50/40 transition"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold border ${BIAS_BADGE_CLASSES[c.bias]}`}>
          {c.bias}
        </span>
        <span className="font-semibold text-gray-900 truncate">{r.symbol}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0 text-gray-500">
        <span className="font-mono">{formatPhp(c.currentPrice)}</span>
        <span>
          {c.score >= 0 ? "+" : ""}
          {c.score}
        </span>
      </div>
    </button>
  );
}

export default function PastTradeScanPanel({ allCoins, onSelectSymbol }: PastTradeScanPanelProps) {
  const { scanResults, isScanning, scanProgress, scanError, hasScanned, runScan } =
    usePastTradeScanner(allCoins);
  const [copied, setCopied] = useState(false);

  const near = useMemo(
    () => scanResults.filter((r) => classifyStructureResult(r) === "near-ladder"),
    [scanResults]
  );
  const extended = useMemo(
    () => scanResults.filter((r) => classifyStructureResult(r) === "extended-wait"),
    [scanResults]
  );

  const copyJournal = () => {
    void navigator.clipboard.writeText(formatStructureScanForJournal(scanResults)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-gray-900">3h Structure Scan</h2>
          <p className="text-[11px] text-gray-500">
            Near floor / ladder on denser prints (confirm on Spot).{" "}
            <span className="font-semibold">Confirm bias on Spot</span> before buying.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasScanned && (
            <button
              type="button"
              onClick={copyJournal}
              className="rounded-md border border-gray-300 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
            >
              {copied ? "✅ Copied" : "📋 Copy"}
            </button>
          )}
          <button
            type="button"
            onClick={runScan}
            disabled={isScanning || allCoins.length === 0}
            className="rounded-md bg-purple-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {isScanning
              ? `Scanning ${scanProgress.completed}/${scanProgress.total}…`
              : "🔍 Scan structure"}
          </button>
        </div>
      </div>

      {scanError && <p className="text-xs text-rose-600">{scanError}</p>}

      {hasScanned && near.length === 0 && extended.length === 0 && (
        <p className="text-xs text-gray-500 py-2">
          No near-ladder LONG structure right now. Use Spot Watchlist for the main bias scan.
        </p>
      )}

      {near.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold text-emerald-800">Near floor — check Spot then stage</div>
          {near.map((r) => (
            <ResultRow key={r.symbol} r={r} onSelectSymbol={onSelectSymbol} />
          ))}
        </div>
      )}
      {extended.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold text-amber-800">Extended — wait for pullback</div>
          {extended.map((r) => (
            <ResultRow key={r.symbol} r={r} onSelectSymbol={onSelectSymbol} />
          ))}
        </div>
      )}
    </div>
  );
}
