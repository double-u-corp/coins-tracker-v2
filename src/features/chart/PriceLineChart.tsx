import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatPhp } from "@/lib/format";
import type { ChartPoint } from "@/validators/recordSchema";

interface PriceLineChartProps {
  points: ChartPoint[];
  journalLabels: Set<string>;
  showHigh: boolean;
  showLow: boolean;
  showSma: boolean;
  showKeyLevels: boolean;
}

export default function PriceLineChart({
  points,
  journalLabels,
  showHigh,
  showLow,
  showSma,
  showKeyLevels,
}: PriceLineChartProps) {
  // Enrich points with a 20-period Simple Moving Average (SMA) calculated purely on client side
  const chartData = useMemo(() => {
    return points.map((pt, idx, arr) => {
      if (idx < 19) return { ...pt, sma20: null };
      const window = arr.slice(idx - 19, idx + 1);
      const avg = window.reduce((sum, p) => sum + (p.high + p.low) / 2, 0) / 20;
      return { ...pt, sma20: avg };
    });
  }, [points]);

  // Find min support (lowest low) and max resistance (highest high) in the current view
  const { minLow, maxHigh } = useMemo(() => {
    if (points.length === 0) return { minLow: null, maxHigh: null };
    let min = points[0].low;
    let max = points[0].high;
    for (const p of points) {
      if (p.low < min) min = p.low;
      if (p.high > max) max = p.high;
    }
    return { minLow: min, maxHigh: max };
  }, [points]);

  if (points.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center text-sm text-gray-500">
        No price history in this range yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={384}>
      <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={20} />
        <YAxis
          tick={{ fontSize: 11 }}
          width={80}
          tickFormatter={(value: number) =>
            value.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 })
          }
        />
        <Tooltip
          formatter={(value: number, name: string) => {
            let labelName = name;
            if (name === "high") labelName = "High";
            if (name === "low") labelName = "Low";
            if (name === "sma20") labelName = "20 SMA";
            return [formatPhp(value), labelName];
          }}
          labelFormatter={(label: string) => label}
        />
        <Legend
          formatter={(value) => {
            if (value === "high") return "High";
            if (value === "low") return "Low";
            if (value === "sma20") return "20 SMA";
            return value;
          }}
        />

        {/* Journal Markers */}
        {Array.from(journalLabels).map((label) => (
          <ReferenceLine
            key={label}
            x={label}
            stroke="#9333ea"
            strokeDasharray="4 4"
            ifOverflow="extendDomain"
            label={{ value: "📓", position: "top", fontSize: 12 }}
          />
        ))}

        {/* Key Support & Resistance Reference Lines */}
        {showKeyLevels && minLow !== null && (
          <ReferenceLine
            y={minLow}
            stroke="#16a34a"
            strokeDasharray="3 3"
            strokeWidth={1.5}
            label={{ value: `Support: ${formatPhp(minLow)}`, position: "insideBottomLeft", fill: "#16a34a", fontSize: 11 }}
          />
        )}
        {showKeyLevels && maxHigh !== null && (
          <ReferenceLine
            y={maxHigh}
            stroke="#dc2626"
            strokeDasharray="3 3"
            strokeWidth={1.5}
            label={{ value: `Resistance: ${formatPhp(maxHigh)}`, position: "insideTopLeft", fill: "#dc2626", fontSize: 11 }}
          />
        )}

        {/* Price Lines */}
        {showHigh && (
          <Line type="monotone" dataKey="high" stroke="#16a34a" strokeWidth={2} dot={false} name="high" />
        )}
        {showLow && (
          <Line type="monotone" dataKey="low" stroke="#dc2626" strokeWidth={2} dot={false} name="low" />
        )}

        {/* 20 Simple Moving Average */}
        {showSma && (
          <Line type="monotone" dataKey="sma20" stroke="#f59e0b" strokeWidth={2} dot={false} name="sma20" />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}