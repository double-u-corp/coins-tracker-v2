import { formatPhp } from "@/lib/format";

interface StrategyPlaybookProps {
  symbol: string;
  support: number | null;
}

export default function StrategyPlaybook({ symbol, support }: StrategyPlaybookProps) {
  if (!symbol) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <span>🛡️</span> Calculated Ladder Strategy <span className="text-brand-600">({symbol})</span>
        </h3>
        <p className="text-xs text-gray-500 mt-1">
          Review these rules before deploying any DCA capital.
        </p>
      </div>

      <div className="p-4 space-y-4">
        {/* Step 1 */}
        <div className="flex gap-3">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-800">
            1
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-900">Wait for Technical Support</h4>
            <p className="mt-1 text-xs text-gray-600 leading-relaxed">
              Never catch a falling knife. Wait for {symbol} to stabilize or bounce off the current technical support level 
              {support ? (
                <span className="font-semibold text-gray-900"> (currently near {formatPhp(support)}) </span>
              ) : (
                " "
              )} 
              before making a move.
            </p>
          </div>
        </div>

        {/* Step 2 */}
        <div className="flex gap-3">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-800">
            2
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-900">Use Strict Cash Budgets</h4>
            <p className="mt-1 text-xs text-gray-600 leading-relaxed">
              Use the "By Cash Budget" calculator below. Stick to rigid, pre-planned allocations—like a strict ₱3,000 payday limit—so the market is forced to work within your financial boundaries.
            </p>
          </div>
        </div>

        {/* Step 3 */}
        <div className="flex gap-3">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-800">
            3
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-900">Ladder Your Entries</h4>
            <p className="mt-1 text-xs text-gray-600 leading-relaxed">
              Do not deploy your entire budget at one single price. Split the allocation into smaller limit orders spanning from current support down to deeper downside targets.
            </p>
          </div>
        </div>

        {/* Step 4 */}
        <div className="flex gap-3">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-800">
            4
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-900">Maintain Operational Discipline</h4>
            <p className="mt-1 text-xs text-gray-600 leading-relaxed">
              Keep a positive mindset and completely avoid revenge-trading. Cap your market monitoring to five focused sessions per day to prevent screen fatigue and impulsive buys.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}