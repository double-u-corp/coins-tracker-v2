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
}

/**
 * Renders as raw SVG via recharts — this file is loaded with
 * `next/dynamic(..., { ssr: false })` by ChartView, since recharts'
 * ResponsiveContainer needs real DOM measurements and doesn't play well
 * with Next's server-side render pass.
 */
export default function PriceLineChart({ points, journalLabels }: PriceLineChartProps) {
  if (points.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center text-sm text-gray-500">
        No price history in this range yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={384}>
      <LineChart data={points} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
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
          formatter={(value: number, name: string) => [formatPhp(value), name === "high" ? "High" : "Low"]}
          labelFormatter={(label: string) => label}
        />
        <Legend formatter={(value) => (value === "high" ? "High" : "Low")} />
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
        <Line type="monotone" dataKey="high" stroke="#16a34a" strokeWidth={2} dot={false} name="high" />
        <Line type="monotone" dataKey="low" stroke="#dc2626" strokeWidth={2} dot={false} name="low" />
      </LineChart>
    </ResponsiveContainer>
  );
}
