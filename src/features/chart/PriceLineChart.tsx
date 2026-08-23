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
  showSma: boolean;
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
  showSma,
  showKeyLevels,
  showBreakEven,
  breakEvenPrice,
  support,
  resistance,
}: PriceLineChartProps) {
  // Format data points for Recharts
  const chartData = points.map((p) => ({
    period: p.period,
    label: p.label,
    high: p.high,
    low: p.low,
    sma: "sma" in p ? (p as any).sma : undefined,
    keyLevel: "keyLevel" in p ? (p as any).keyLevel : undefined,
  }));

  return (
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
              formatPhp(Number(value)),
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

          {showSma && (
            <Line type="monotone" dataKey="sma" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="20 SMA" />
          )}

          {showKeyLevels && (
            <Line type="monotone" dataKey="keyLevel" stroke="#9333ea" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Key Level" />
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
  );
}