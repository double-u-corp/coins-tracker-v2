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

  const chartData = useMemo(() => {
    const recentData = points.slice(-Math.min(30, points.length));
    const calcSupport = Math.min(...recentData.map((p) => p.low));
    const calcResistance = Math.max(...recentData.map((p) => p.high));
    const equilibrium = Number((calcSupport + calcResistance) / 2);

    const rsiPeriod = 14;
    const rsiValues: (number | null)[] = new Array(points.length).fill(null);
    
    if (points.length > rsiPeriod) {
      let gains = 0, losses = 0;
      for (let i = 1; i <= rsiPeriod; i++) {
        const diff = ((points[i].high + points[i].low) / 2) - ((points[i - 1].high + points[i - 1].low) / 2);
        diff >= 0 ? (gains += diff) : (losses += Math.abs(diff));
      }
      let avgGain = gains / rsiPeriod;
      let avgLoss = losses / rsiPeriod;
      rsiValues[rsiPeriod] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

      for (let i = rsiPeriod + 1; i < points.length; i++) {
        const diff = ((points[i].high + points[i].low) / 2) - ((points[i - 1].high + points[i - 1].low) / 2);
        avgGain = (avgGain * (rsiPeriod - 1) + (diff > 0 ? diff : 0)) / rsiPeriod;
        avgLoss = (avgLoss * (rsiPeriod - 1) + (diff < 0 ? Math.abs(diff) : 0)) / rsiPeriod;
        rsiValues[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    }

    return points.map((p, index, arr) => {
      const calcSma = (period: number) => {
        if (index < period - 1) return undefined;
        let sum = 0;
        for (let i = index - period + 1; i <= index; i++) sum += (arr[i].high + arr[i].low) / 2;
        return sum / period;
      };

      const rawKeyLevel = "keyLevel" in p ? (p as any).keyLevel : undefined;

      return {
        ...p,
        sma20: calcSma(20),
        sma50: calcSma(50),
        sma200: calcSma(200),
        rsi: rsiValues[index] !== null ? Number(rsiValues[index]?.toFixed(2)) : undefined,
        keyLevel: rawKeyLevel !== undefined && rawKeyLevel !== null ? Number(rawKeyLevel) : equilibrium,
      };
    });
  }, [points]);

  const support = externalSupport ?? Math.min(...chartData.slice(-30).map(d => d.low));
  const resistance = externalResistance ?? Math.max(...chartData.slice(-30).map(d => d.high));
  const currentKeyLevel: number | undefined = chartData[chartData.length - 1]?.keyLevel;

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
          <ComposedChart data={chartData} margin={{ top: 15, right: 0, left: 0, bottom: 0 }}>
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
              width={55}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val) => formatPhp(val)}
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
            <ComposedChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
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