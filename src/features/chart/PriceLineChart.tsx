import { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import type { ChartPoint } from "@/validators/recordSchema";
import { formatPhp } from "@/lib/format";
import { calculateSMASeries, calculateRSISeries, getSupportResistance } from "./Technicals";

export interface PriceLineChartProps {
  points?: ChartPoint[];
  journalLabels?: Set<string>;
  showHigh?: boolean;
  showLow?: boolean;
  showKeyLevels?: boolean;
  showBreakEven?: boolean;
  breakEvenPrice?: number | null;
  support?: number | null;
  resistance?: number | null;
}

export default function PriceLineChart({
  points = [],
  journalLabels,
  showHigh = true,
  showLow = true,
  showKeyLevels = false,
  showBreakEven = false,
  breakEvenPrice,
  support: externalSupport,
  resistance: externalResistance,
}: PriceLineChartProps) {
  const [showSma20, setShowSma20] = useState<boolean>(true);
  const [showSma50, setShowSma50] = useState<boolean>(true);
  const [showSma200, setShowSma200] = useState<boolean>(true);
  const [showRsi, setShowRsi] = useState<boolean>(false);

  // All hooks must run unconditionally on every render — the "no data yet"
  // placeholder is rendered conditionally further down instead, not via an
  // early return before these. (An early return before useMemo here used to
  // violate React's Hooks rules: the hook count would differ between an
  // empty-points render and a populated one.)
  const { chartData, fallbackLevels, liveEquilibrium } = useMemo(() => {
    if (points.length === 0) {
      return {
        chartData: [] as Array<ChartPoint & Record<string, unknown>>,
        fallbackLevels: { support: 0, resistance: 0 },
        liveEquilibrium: 0,
      };
    }

    const levels = getSupportResistance(points, 30);
    const equilibrium = Number((levels.support + levels.resistance) / 2);

    const sma20Series = calculateSMASeries(points, 20);
    const sma50Series = calculateSMASeries(points, 50);
    const sma200Series = calculateSMASeries(points, 200);
    const rsiSeries = calculateRSISeries(points, 14);

    const data = points.map((p, index) => {
      const rawKeyLevel = "keyLevel" in p ? (p as any).keyLevel : undefined;
      return {
        ...p,
        sma20: sma20Series[index] ?? undefined,
        sma50: sma50Series[index] ?? undefined,
        sma200: sma200Series[index] ?? undefined,
        rsi: rsiSeries[index] !== null ? Number(rsiSeries[index]?.toFixed(2)) : undefined,
        // Only preserve a REAL per-point keyLevel if the data actually has
        // one. Do NOT backfill every historical point with today's static
        // equilibrium snapshot — nothing downstream reads keyLevel except
        // the LAST point (see currentKeyLevel below), so backfilling every
        // row here was pure dead weight, and mixing "real per-point data"
        // with "synthetic today's-value" under one field name is a latent
        // bug risk if a future line chart ever plots keyLevel as a series.
        keyLevel: rawKeyLevel !== undefined && rawKeyLevel !== null ? Number(rawKeyLevel) : undefined,
      };
    });

    return { chartData: data, fallbackLevels: levels, liveEquilibrium: equilibrium };
  }, [points]);

  const support = externalSupport ?? fallbackLevels.support;
  const resistance = externalResistance ?? fallbackLevels.resistance;
  // The live reference line uses the last point's real keyLevel if the data
  // provides one, otherwise falls back to the computed equilibrium — this
  // fallback is applied ONCE, here, not smeared across every historical point.
  const currentKeyLevel: number | undefined =
    (chartData[chartData.length - 1]?.keyLevel as number | undefined) ?? liveEquilibrium;

  if (!points || points.length === 0) {
    return (
      <div className="w-full h-72 sm:h-96 flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/50">
        <svg className="w-8 h-8 text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
        </svg>
        <span className="text-sm font-medium text-gray-400">Waiting for chart data...</span>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-3">
      
      <div className="flex w-full overflow-x-auto pb-1 -mx-1 px-1 gap-2 scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        <style dangerouslySetInnerHTML={{__html: `::-webkit-scrollbar { display: none; }`}} />
        <IndicatorPill active={showSma20} onClick={() => setShowSma20(!showSma20)} color="amber" label="20 SMA" />
        <IndicatorPill active={showSma50} onClick={() => setShowSma50(!showSma50)} color="blue" label="50 SMA" />
        <IndicatorPill active={showSma200} onClick={() => setShowSma200(!showSma200)} color="purple" label="200 SMA" />
        <IndicatorPill active={showRsi} onClick={() => setShowRsi(!showRsi)} color="indigo" label="RSI" />
      </div>

      <div className="h-64 sm:h-96 w-full -ml-2 sm:ml-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} >
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            
            <XAxis 
              dataKey="label" 
              stroke="#9ca3af" 
              fontSize={10} 
              tickLine={false} 
              axisLine={false}
              minTickGap={20}
            />
            
<YAxis
              orientation="right"
              stroke="#9ca3af"
              fontSize={10}
              width={45}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val) => {
                if (window.innerWidth < 640 && val >= 1000) {
                  return `${(val / 1000).toFixed(0)}k`;
                }
                return formatPhp(val);
              }}
              domain={["auto", "auto"]}
            />
            
            <Tooltip
              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              formatter={(value: any, name: string) => [
                value !== undefined ? (name === "RSI" ? value : formatPhp(Number(value))) : "N/A",
                name.toUpperCase(),
              ]}
              labelStyle={{ color: "#6b7280", fontSize: '12px', marginBottom: '4px' }}
            />

            {showHigh && <Line type="monotone" dataKey="high" stroke="#22c55e" strokeWidth={1.5} dot={false} name="High" />}
            {showLow && <Line type="monotone" dataKey="low" stroke="#ef4444" strokeWidth={1.5} dot={false} name="Low" />}
            {showSma20 && <Line type="monotone" dataKey="sma20" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="20 SMA" />}
            {showSma50 && <Line type="monotone" dataKey="sma50" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="50 SMA" />}
            {showSma200 && <Line type="monotone" dataKey="sma200" stroke="#a855f7" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="200 SMA" />}

            {showKeyLevels && currentKeyLevel !== undefined && (
              <ReferenceLine 
                y={currentKeyLevel} 
                stroke="#8b5cf6" 
                strokeWidth={1} 
                strokeOpacity={0.7}
                strokeDasharray="4 4" 
                label={{ 
                  value: `Key Level: ${formatPhp(currentKeyLevel)}`, 
                  fill: "#8b5cf6", 
                  fontSize: 10, 
                  position: "insideTopLeft" 
                }} 
              />
            )}

            {showBreakEven && breakEvenPrice != null && (
              <ReferenceLine 
                y={breakEvenPrice} 
                stroke="#3b82f6" 
                strokeDasharray="3 3" 
                label={{ 
                  value: `Break Even: ${formatPhp(breakEvenPrice)}`, 
                  fill: "#3b82f6", 
                  fontSize: 10, 
                  position: "insideTopLeft" 
                }} 
              />
            )}
            
            {resistance && (
              <ReferenceLine 
                y={resistance} 
                stroke="#ef4444" 
                strokeWidth={1} 
                strokeOpacity={0.5} 
                strokeDasharray="4 4" 
                label={{ 
                  value: `Resistance: ${formatPhp(resistance)}`, 
                  fill: "#ef4444", 
                  fontSize: 10, 
                  position: "insideBottomLeft" 
                }} 
              />
            )}
            
            {support && (
              <ReferenceLine 
                y={support} 
                stroke="#10b981" 
                strokeWidth={1} 
                strokeOpacity={0.5} 
                strokeDasharray="4 4" 
                label={{ 
                  value: `Support: ${formatPhp(support)}`, 
                  fill: "#10b981", 
                  fontSize: 10, 
                  position: "insideTopLeft" 
                }} 
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {showRsi && (
        <div className="h-20 sm:h-28 w-full -ml-2 sm:ml-0 mt-1">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <YAxis orientation="right" domain={[0, 100]} ticks={[30, 70]} stroke="#9ca3af" fontSize={9} tickLine={false} axisLine={false} width={55} />
              <Tooltip formatter={(value: any) => [value ?? "N/A", "RSI"]} labelStyle={{ display: 'none' }} />
              <ReferenceLine y={70} stroke="#ef4444" strokeOpacity={0.3} strokeDasharray="3 3" />
              <ReferenceLine y={30} stroke="#10b981" strokeOpacity={0.3} strokeDasharray="3 3" />
              <Line type="monotone" dataKey="rsi" stroke="#6366f1" strokeWidth={1.5} dot={false} name="RSI" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function IndicatorPill({ active, onClick, color, label }: { active: boolean, onClick: () => void, color: string, label: string }) {
  const colorMap: Record<string, string> = {
    amber: active ? "bg-amber-100 text-amber-700 border-amber-300" : "bg-white text-gray-500 border-gray-200",
    blue: active ? "bg-blue-100 text-blue-700 border-blue-300" : "bg-white text-gray-500 border-gray-200",
    purple: active ? "bg-purple-100 text-purple-700 border-purple-300" : "bg-white text-gray-500 border-gray-200",
    indigo: active ? "bg-indigo-100 text-indigo-700 border-indigo-300" : "bg-white text-gray-500 border-gray-200",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${colorMap[color]}`}
    >
      {label}
    </button>
  );
}