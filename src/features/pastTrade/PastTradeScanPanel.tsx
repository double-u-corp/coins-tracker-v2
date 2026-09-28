import { useMemo, useState } from "react";
import type { CoinSummary } from "@/validators/recordSchema";
import { BIAS_BADGE_CLASSES } from "../../features/chart/Technicals";
import { formatPhp } from "@/lib/format";
import {
  usePastTradeScanner,
  classifyFastTradeResult,
  formatFastTradeScanForJournal,
  type FastTradeScanResult,
  type FastTradeBucket,
} from "./usePastTradeScanner";

interface PastTradeScanPanelProps {
  allCoins: CoinSummary[];
  onSelectSymbol: (symbol: string) => void;
}

const BUCKET_META: Record<
  Exclude<FastTradeBucket, null>,
  { title: string; badgeClass: string }
> = {
  "long-ready": { title: "🟢 LONG — near support / ready", badgeClass: "border-emerald-200 bg-emerald-50" },
  "short-ready": { title: "🔴 SHORT — near resistance / ready", badgeClass: "border-rose-200 bg-rose-50" },
  "long-extended": { title: "⏳ LONG — extended, wait for pullback", badgeClass: "border-gray-200 bg-gray-50" },
  "short-extended": { title: "⏳ SHORT — extended, wait for bounce", badgeClass: "border-gray-200 bg-gray-50" },
};

const BUCKET_ORDER: Exclude<FastTradeBucket, null>[] = [
  "long-ready",
  "short-ready",
  "long-extended",
  "short-extended",
];

function ResultRow({ r, onSelectSymbol }: { r: FastTradeScanResult; onSelectSymbol: (s: string) => void }) {
  const c = r.confluence;
  if (!c) return null;
  const density = r.seriesDensity;
  return (
    <button
      type="button"
      onClick={() => onSelectSymbol(r.symbol)}
      className="w-full flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-white px-3 py-2 text-left text-xs hover:border-brand-300 hover:bg-brand-50/40 transition"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold border ${BIAS_BADGE_CLASSES[c.bias]}`}>
          {c.bias}
        </span>
        <span className="font-semibold text-gray-900 truncate">{r.symbol}</span>
        {density && !density.isFastEnough && (
          <span title="Printing slowly — thin data" className="shrink-0 text-amber-500">
            ⚠️
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0 text-gray-500">
        <span className="font-mono">{formatPhp(c.currentPrice)}</span>
        <span>
          {c.score >= 0 ? "+" : ""}
          {c.score}/±{c.maxPossibleScore}
        </span>
      </div>
    </button>
  );
}

export default function PastTradeScanPanel({ allCoins, onSelectSymbol }: PastTradeScanPanelProps) {
  const { scanResults, isScanning, scanProgress, scanError, hasScanned, runScan } = usePastTradeScanner(allCoins);
  const [copied, setCopied] = useState(false);

  const buckets = useMemo(() => {
    const grouped: Record<Exclude<FastTradeBucket, null>, FastTradeScanResult[]> = {
      "long-ready": [],
      "short-ready": [],
      "long-extended": [],
      "short-extended": [],
    };
    for (const r of scanResults) {
      const bucket = classifyFastTradeResult(r);
      if (bucket) grouped[bucket].push(r);
    }
    return grouped;
  }, [scanResults]);

  const totalHits =
    buckets["long-ready"].length +
    buckets["short-ready"].length +
    buckets["long-extended"].length +
    buckets["short-extended"].length;

  const handleCopy = () => {
    navigator.clipboard.writeText(formatFastTradeScanForJournal(scanResults));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Fast-Trade Scan — all coins</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Scans every tracked coin on intraday data, both LONG and SHORT (leverage) entries.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasScanned && totalHits > 0 && (
            <button
              type="button"
              onClick={handleCopy}
              className="text-[11px] font-semibold text-white bg-gray-700 hover:bg-gray-800 rounded px-2.5 py-1.5 transition"
            >
              {copied ? "✅ Copied!" : "📋 Copy report"}
            </button>
          )}
          <button
            type="button"
            onClick={runScan}
            disabled={isScanning || allCoins.length === 0}
            className="text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded px-3 py-1.5 transition"
          >
            {isScanning
              ? `Scanning… ${scanProgress.completed}/${scanProgress.total}`
              : hasScanned
              ? "Re-scan"
              : "Scan All Coins"}
          </button>
        </div>
      </div>

      {scanError && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2">{scanError}</p>
      )}

      {hasScanned && !isScanning && (
        <>
          {totalHits === 0 ? (
            <p className="text-xs text-gray-500">
              No LONG or SHORT entries ready right now — everything scanned is NEUTRAL, already
              extended, or still accumulating history.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {BUCKET_ORDER.filter((b) => buckets[b].length > 0).map((bucket) => (
                <div key={bucket} className={`rounded-md border p-3 space-y-1.5 ${BUCKET_META[bucket].badgeClass}`}>
                  <div className="text-xs font-bold text-gray-800">
                    {BUCKET_META[bucket].title} ({buckets[bucket].length})
                  </div>
                  <div className="space-y-1.5">
                    {buckets[bucket].map((r) => (
                      <ResultRow key={r.symbol} r={r} onSelectSymbol={onSelectSymbol} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
