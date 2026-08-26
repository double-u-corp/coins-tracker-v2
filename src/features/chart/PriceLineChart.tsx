import { useState } from "react";
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
  points: ChartPoint[];
  journalLabels: Set<string>;
  showHigh: boolean;
  showLow: boolean;
  showKeyLevels: boolean;
  showBreakEven: boolean;
  breakEvenPrice: number | null;
  support?: number | null;
  resistance?: number | null;
}

export default function PriceLineChart({
  points,
  journalLabels,
  showHigh,
  showLow,
  showKeyLevels,
  showBreakEven,
  breakEvenPrice,
  support: externalSupport,
  resistance: externalResistance,
}: PriceLineChartProps) {
  // Toggle states for individual SMA levels
  const [showSma20, setShowSma20] = useState<boolean>(true);
  const [showSma50, setShowSma50] = useState<boolean>(true);
  const [showSma200, setShowSma200] = useState<boolean>(true);

  // 1. Calculate local extremes and the 50% Equilibrium Key Level if not provided
  const recentData = points.slice(-Math.min(30, points.length));
  const calculatedSupport = Math.min(...recentData.map((p) => p.low));
  const calculatedResistance = Math.max(...recentData.map((p) => p.high));
  
  // The Key Level is set as the 50% midpoint equilibrium of the current view range
  const equilibriumKeyLevel = (calculatedSupport + calculatedResistance) / 2;

  // 2. Compute chart data, rolling 20 SMA, 50 SMA, 200 SMA, and Key Levels on the fly
  const chartData = points.map((p, index, arr) => {
    // 20-period SMA
    let sma20Value: number | undefined = undefined;
    if (index >= 19) {
      let sum = 0;
      for (let i = index - 19; i <= index; i++) {
        sum += (arr[i].high + arr[i].low) / 2;
      }
      sma20Value = sum / 20;
    }

    // 50-period SMA
    let sma50Value: number | undefined = undefined;
    if (index >= 49) {
      let sum = 0;
      for (let i = index - 49; i <= index; i++) {
        sum += (arr[i].high + arr[i].low) / 2;
      }
      sma50Value = sum / 50;
    }

    // 200-period SMA
    let sma200Value: number | undefined = undefined;
    if (index >= 199) {
      let sum = 0;
      for (let i = index - 199; i <= index; i++) {
        sum += (arr[i].high + arr[i].low) / 2;
      }
      sma200Value = sum / 200;
    }

    return {
      period: p.period,
      label: p.label,
      high: p.high,
      low: p.low,
      sma: "sma" in p && (p as any).sma !== undefined ? (p as any).sma : sma20Value,
      sma20: sma20Value,
      sma50: sma50Value,
      sma200: sma200Value,
      keyLevel: "keyLevel" in p && (p as any).keyLevel !== undefined ? (p as any).keyLevel : equilibriumKeyLevel,
    };
  });

  const support = externalSupport !== undefined && externalSupport !== null ? externalSupport : calculatedSupport;
  const resistance = externalResistance !== undefined && externalResistance !== null ? externalResistance : calculatedResistance;

  return (
    <div className="w-full space-y-2">
      {/* Level Toggle Buttons Bar */}
      <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
        <span className="font-semibold text-gray-500 mr-1">SMA Levels:</span>
        <button
          type="button"
          onClick={() => setShowSma20(!showSma20)}
          className={`px-2.5 py-1 rounded-md text-xs font-bold border transition-colors ${
            showSma20
              ? "bg-amber-100 text-amber-800 border-amber-300"
              : "bg-gray-100 text-gray-400 border-gray-200 hover:bg-gray-200"
          }`}
        >
          20 SMA
        </button>
        <button
          type="button"
          onClick={() => setShowSma50(!showSma50)}
          className={`px-2.5 py-1 rounded-md text-xs font-bold border transition-colors ${
            showSma50
              ? "bg-blue-100 text-blue-800 border-blue-300"
              : "bg-gray-100 text-gray-400 border-gray-200 hover:bg-gray-200"
          }`}
        >
          50 SMA
        </button>
        <button
          type="button"
          onClick={() => setShowSma200(!showSma200)}
          className={`px-2.5 py-1 rounded-md text-xs font-bold border transition-colors ${
            showSma200
              ? "bg-purple-100 text-purple-800 border-purple-300"
              : "bg-gray-100 text-gray-400 border-gray-200 hover:bg-gray-200"
          }`}
        >
          200 SMA
        </button>
      </div>

      <div className="h-96 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" stroke="#9ca3af" fontSize={12} tickLine={false} />
            <YAxis
              stroke="#9ca3af"
              fontSize={12}
              tickLine={false}
              tickFormatter={(val) => formatPhp(val)}
              domain={["auto", "auto"]}
            />
            <Tooltip
              formatter={(value: any, name: string) => [
                value !== undefined ? formatPhp(Number(value)) : "N/A",
                name.toUpperCase(),
              ]}
              labelStyle={{ color: "#374151", fontWeight: "bold" }}
            />

            {showHigh && (
              <Line type="monotone" dataKey="high" stroke="#16a34a" strokeWidth={2} dot={false} name="High" />
            )}

            {showLow && (
              <Line type="monotone" dataKey="low" stroke="#dc2626" strokeWidth={2} dot={false} name="Low" />
            )}

            {/* 20 SMA Line (Amber) */}
            {showSma20 && (
              <Line
                type="monotone"
                dataKey="sma20"
                stroke="#f59e0b"
                strokeWidth={1.5}
                dot={false}
                name="20 SMA"
                connectNulls={false}
              />
            )}

            {/* 50 SMA Line (Blue) */}
            {showSma50 && (
              <Line
                type="monotone"
                dataKey="sma50"
                stroke="#3b82f6"
                strokeWidth={1.5}
                dot={false}
                name="50 SMA"
                connectNulls={false}
              />
            )}

            {/* 200 SMA Line (Purple Dashed) */}
            {showSma200 && (
              <Line
                type="monotone"
                dataKey="sma200"
                stroke="#9333ea"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                name="200 SMA"
                connectNulls={false}
              />
            )}

            {showKeyLevels && (
              <Line type="monotone" dataKey="keyLevel" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Key Level (Equilibrium)" />
            )}

            {/* Average Cost / Break-even Reference Line */}
            {showBreakEven && breakEvenPrice !== null && (
              <ReferenceLine
                y={breakEvenPrice}
                stroke="#2563eb"
                strokeDasharray="3 3"
                label={{
                  value: `Avg Entry: ${formatPhp(breakEvenPrice)}`,
                  fill: "#2563eb",
                  fontSize: 12,
                  position: "insideTopRight",
                }}
              />
            )}

            {/* Resistance Line */}
            {resistance !== undefined && resistance !== null && (
              <ReferenceLine
                y={resistance}
                stroke="#ef4444"
                strokeDasharray="4 4"
                label={{
                  value: `Resistance`,
                  fill: "#ef4444",
                  fontSize: 12,
                  position: "insideTopLeft",
                }}
              />
            )}

            {/* Support Line */}
            {support !== undefined && support !== null && (
              <ReferenceLine
                y={support}
                stroke="#10b981"
                strokeDasharray="4 4"
                label={{
                  value: `Support`,
                  fill: "#10b981",
                  fontSize: 12,
                  position: "insideBottomLeft",
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}