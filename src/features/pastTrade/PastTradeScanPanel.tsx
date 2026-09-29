import { useMemo, useState } from "react";
import type { CoinSummary } from "@/validators/recordSchema";
import { BIAS_BADGE_CLASSES } from "../../features/chart/Technicals";
import { formatPhp } from "@/lib/format";
import {
  usePastTradeScanner,
  classifyStructureResult,
  formatStructureScanForJournal,
  formatSmaCrossScanForJournal,
  type StructureScanResult,
  type SmaCrossScanResult,
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

function statusBadge(status: SmaCrossScanResult["status"]): { text: string; cls: string } {
  if (status === "approaching")
    return { text: "APPROACHING", cls: "border-sky-200 bg-sky-50 text-sky-900" };
  if (status === "at_cross")
    return { text: "AT CROSS", cls: "border-teal-300 bg-teal-100 text-teal-900" };
  return { text: "JUST ABOVE", cls: "border-emerald-200 bg-emerald-50 text-emerald-900" };
}

function CrossRow({
  r,
  onSelectSymbol,
}: {
  r: SmaCrossScanResult;
  onSelectSymbol: (s: string) => void;
}) {
  const badge = statusBadge(r.status);
  return (
    <button
      type="button"
      onClick={() => onSelectSymbol(r.symbol)}
      className="w-full flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-white px-3 py-2 text-left text-xs hover:border-teal-300 hover:bg-teal-50/40 transition"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold border ${badge.cls}`}>
          {badge.text}
        </span>
        <span className="font-semibold text-gray-900 truncate">{r.symbol}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0 text-gray-500">
        <span className="font-mono">{formatPhp(r.currentPrice)}</span>
        <span className="text-teal-700 font-semibold">
          {r.distPct >= 0 ? "+" : ""}
          {r.distPct.toFixed(1)}% vs 20SMA
        </span>
      </div>
    </button>
  );
}

export default function PastTradeScanPanel({ allCoins, onSelectSymbol }: PastTradeScanPanelProps) {
  const {
    scanResults,
    isScanning,
    scanProgress,
    scanError,
    hasScanned,
    runScan,
    crossResults,
    isCrossScanning,
    crossProgress,
    crossError,
    hasCrossScanned,
    runSmaCrossScan,
  } = usePastTradeScanner(allCoins);
  const [copied, setCopied] = useState(false);
  const [crossCopied, setCrossCopied] = useState(false);

  const near = useMemo(
    () => scanResults.filter((r) => classifyStructureResult(r) === "near-ladder"),
    [scanResults]
  );
  const extended = useMemo(
    () => scanResults.filter((r) => classifyStructureResult(r) === "extended-wait"),
    [scanResults]
  );

  const busy = isScanning || isCrossScanning;

  const copyJournal = () => {
    void navigator.clipboard.writeText(formatStructureScanForJournal(scanResults)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const copyCrossJournal = () => {
    void navigator.clipboard.writeText(formatSmaCrossScanForJournal(crossResults)).then(() => {
      setCrossCopied(true);
      setTimeout(() => setCrossCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-4">
      {/* Structure scan — unchanged purpose */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-gray-900">3h Structure Scan</h2>
            <p className="text-[11px] text-gray-500">
              Near floor / ladder on denser prints.{" "}
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
              disabled={busy || allCoins.length === 0}
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

      {/* New: 20 SMA cross scan */}
      <div className="rounded-lg border border-teal-100 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-gray-900">20 SMA Near-Cross Scan</h2>
            <p className="text-[11px] text-gray-500">
              Price <span className="font-semibold">near 20 SMA and rising</span> (possible crossover
              now) — not old crosses. Confirm on Spot; do not chase if already extended.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasCrossScanned && (
              <button
                type="button"
                onClick={copyCrossJournal}
                className="rounded-md border border-gray-300 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
              >
                {crossCopied ? "✅ Copied" : "📋 Copy"}
              </button>
            )}
            <button
              type="button"
              onClick={runSmaCrossScan}
              disabled={busy || allCoins.length === 0}
              className="rounded-md bg-teal-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {isCrossScanning
                ? `Scanning ${crossProgress.completed}/${crossProgress.total}…`
                : "📈 Scan near 20 SMA"}
            </button>
          </div>
        </div>

        {crossError && <p className="text-xs text-rose-600">{crossError}</p>}

        {hasCrossScanned && crossResults.length === 0 && (
          <p className="text-xs text-gray-500 py-2">
            No coins hugging 20 SMA with upside pressure right now.
          </p>
        )}

        {crossResults.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold text-teal-800">
              Near 20 SMA ({crossResults.length}) — approaching / at cross / just above
            </div>
            {crossResults.map((r) => (
              <CrossRow key={r.symbol} r={r} onSelectSymbol={onSelectSymbol} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
