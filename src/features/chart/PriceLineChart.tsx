import { useState, useMemo, useEffect, useCallback } from "react";
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
import { calculateSMASeries, calculateRSISeries, getSupportResistance, getEffectivePrice } from "./Technicals";

export interface PriceLineChartProps {
  points?: ChartPoint[];
  /** 3h / 8-check series used for the Swing sub-chart (last 7 days). */
  intradayPoints?: ChartPoint[] | null;
  journalLabels?: Set<string>;
  showHigh?: boolean;
  showLow?: boolean;
  showKeyLevels?: boolean;
  showBreakEven?: boolean;
  breakEvenPrice?: number | null;
  support?: number | null;
  resistance?: number | null;
}

type ActivePoint = {
  label: string;
  high?: number;
  low?: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
  rsi?: number;
};

function useIsMobile(breakpointPx = 640) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [breakpointPx]);

  return isMobile;
}

/** Compact desktop floating tooltip — only shows series that have values. */
function DesktopTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-md text-xs max-w-[200px]">
      <div className="mb-1.5 font-semibold text-gray-600 border-b border-gray-100 pb-1">{label}</div>
      <ul className="space-y-0.5">
        {payload.map((entry: any) => {
          if (entry.value == null) return null;
          const isRsi = entry.name === "RSI";
          return (
            <li key={entry.dataKey} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-gray-500">
                <span
                  className="inline-block h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: entry.color }}
                />
                {entry.name}
              </span>
              <span className="font-semibold text-gray-900 tabular-nums">
                {isRsi ? entry.value : formatPhp(Number(entry.value))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Fixed strip under the chart on mobile — never covers the plot. */
function MobileReadout({ point }: { point: ActivePoint | null }) {
  if (!point) {
    return (
      <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-400 text-center sm:hidden">
        Tap the chart to inspect a date
      </div>
    );
  }

  const rows: { label: string; value: string; color: string }[] = [];
  if (point.high != null) rows.push({ label: "High", value: formatPhp(point.high), color: "#22c55e" });
  if (point.low != null) rows.push({ label: "Low", value: formatPhp(point.low), color: "#ef4444" });
  if (point.sma20 != null) rows.push({ label: "20 SMA", value: formatPhp(point.sma20), color: "#f59e0b" });
  if (point.sma50 != null) rows.push({ label: "50 SMA", value: formatPhp(point.sma50), color: "#3b82f6" });
  if (point.sma200 != null) rows.push({ label: "200 SMA", value: formatPhp(point.sma200), color: "#a855f7" });
  if (point.rsi != null) rows.push({ label: "RSI", value: String(point.rsi), color: "#6366f1" });

  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2 shadow-sm sm:hidden">
      <div className="text-[11px] font-bold text-gray-800 mb-1.5">{point.label}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-1 text-[11px]">
            <span className="flex items-center gap-1 text-gray-500">
              <span className="inline-block h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
              {r.label}
            </span>
            <span className="font-semibold text-gray-900 tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PriceLineChart({
  points = [],
  intradayPoints = null,
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
  const [showSwing, setShowSwing] = useState<boolean>(false);
  const isMobile = useIsMobile(640);
  const [mobilePoint, setMobilePoint] = useState<ActivePoint | null>(null);

  // Clear mobile readout when data set changes (e.g. new coin / range)
  useEffect(() => {
    setMobilePoint(null);
  }, [points]);

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
        keyLevel: rawKeyLevel !== undefined && rawKeyLevel !== null ? Number(rawKeyLevel) : undefined,
      };
    });

    return { chartData: data, fallbackLevels: levels, liveEquilibrium: equilibrium };
  }, [points]);

  const support = externalSupport ?? fallbackLevels.support;
  const resistance = externalResistance ?? fallbackLevels.resistance;
  const currentKeyLevel: number | undefined =
    (chartData[chartData.length - 1]?.keyLevel as number | undefined) ?? liveEquilibrium;

  /** Last 7 days of 8-check / 3h prices (single price line, no high-low band). */
  const swingChartData = useMemo(() => {
    if (!intradayPoints?.length) return [] as { label: string; price: number }[];
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return intradayPoints
      .filter((p) => {
        const t = new Date((p as any).period || p.label).getTime();
        return !Number.isNaN(t) && t >= cutoff;
      })
      .map((p) => ({
        label: p.label,
        price: getEffectivePrice(p),
      }));
  }, [intradayPoints]);


  const handleChartInteraction = useCallback(
    (state: any) => {
      if (!isMobile) return;
      if (state?.activePayload?.length && state.activeLabel != null) {
        const row = state.activePayload[0]?.payload ?? {};
        setMobilePoint({
          label: String(state.activeLabel),
          high: row.high,
          low: row.low,
          sma20: row.sma20,
          sma50: row.sma50,
          sma200: row.sma200,
          rsi: row.rsi,
        });
      }
    },
    [isMobile]
  );

  const clearMobilePoint = useCallback(() => {
    if (isMobile) setMobilePoint(null);
  }, [isMobile]);

  if (!points || points.length === 0) {
    return (
      <div className="w-full h-72 sm:h-96 flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/50">
        <svg className="w-8 h-8 text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"
          />
        </svg>
        <span className="text-sm font-medium text-gray-400">Waiting for chart data...</span>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-3">
      <div
        className="flex w-full overflow-x-auto pb-1 -mx-1 px-1 gap-2 scrollbar-hide"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <style dangerouslySetInnerHTML={{ __html: `::-webkit-scrollbar { display: none; }` }} />
        <IndicatorPill active={showSma20} onClick={() => setShowSma20(!showSma20)} color="amber" label="20 SMA" />
        <IndicatorPill active={showSma50} onClick={() => setShowSma50(!showSma50)} color="blue" label="50 SMA" />
        <IndicatorPill active={showSma200} onClick={() => setShowSma200(!showSma200)} color="purple" label="200 SMA" />
        <IndicatorPill active={showRsi} onClick={() => setShowRsi(!showRsi)} color="indigo" label="RSI" />
        <IndicatorPill active={showSwing} onClick={() => setShowSwing(!showSwing)} color="teal" label="Swing" />
      </div>

      <div className="h-64 sm:h-96 w-full -ml-2 sm:ml-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            onMouseMove={(state) => handleChartInteraction(state)}
            onMouseLeave={() => clearMobilePoint()}
          >
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
                if (typeof window !== "undefined" && window.innerWidth < 640 && val >= 1000) {
                  return `${(val / 1000).toFixed(0)}k`;
                }
                return formatPhp(val);
              }}
              domain={["auto", "auto"]}
            />

            {/* Desktop: floating tooltip. Mobile: cursor only — values live in the strip below. */}
            {isMobile ? (
              <Tooltip
                content={() => null}
                cursor={{ stroke: "#94a3b8", strokeWidth: 1, strokeDasharray: "4 4" }}
              />
            ) : (
              <Tooltip
                content={<DesktopTooltipContent />}
                cursor={{ stroke: "#94a3b8", strokeWidth: 1, strokeDasharray: "4 4" }}
              />
            )}

            {showHigh && (
              <Line type="monotone" dataKey="high" stroke="#22c55e" strokeWidth={1.5} dot={false} name="High" />
            )}
            {showLow && (
              <Line type="monotone" dataKey="low" stroke="#ef4444" strokeWidth={1.5} dot={false} name="Low" />
            )}
            {showSma20 && (
              <Line type="monotone" dataKey="sma20" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="20 SMA" />
            )}
            {showSma50 && (
              <Line type="monotone" dataKey="sma50" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="50 SMA" />
            )}
            {showSma200 && (
              <Line
                type="monotone"
                dataKey="sma200"
                stroke="#a855f7"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                name="200 SMA"
              />
            )}

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
                  position: "insideTopLeft",
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
                  position: "insideTopLeft",
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
                  position: "insideBottomLeft",
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
                  position: "insideTopLeft",
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Mobile-only: values sit under the chart so the plot stays visible */}
      {isMobile && <MobileReadout point={mobilePoint} />}

      {showRsi && (
        <div className="h-20 sm:h-28 w-full -ml-2 sm:ml-0 mt-1">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <YAxis
                orientation="right"
                domain={[0, 100]}
                ticks={[30, 70]}
                stroke="#9ca3af"
                fontSize={9}
                tickLine={false}
                axisLine={false}
                width={55}
              />
              {!isMobile && (
                <Tooltip formatter={(value: any) => [value ?? "N/A", "RSI"]} labelStyle={{ display: "none" }} />
              )}
              <ReferenceLine y={70} stroke="#ef4444" strokeOpacity={0.3} strokeDasharray="3 3" />
              <ReferenceLine y={30} stroke="#10b981" strokeOpacity={0.3} strokeDasharray="3 3" />
              <Line type="monotone" dataKey="rsi" stroke="#6366f1" strokeWidth={1.5} dot={false} name="RSI" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {showSwing && (
        <div className="w-full -ml-2 sm:ml-0 mt-1">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold text-teal-800">Swing · 8-check price (7 days)</span>
            <span className="text-[10px] text-gray-400">
              {swingChartData.length ? `${swingChartData.length} checks` : "No intraday data"}
            </span>
          </div>
          {swingChartData.length === 0 ? (
            <div className="flex h-20 sm:h-28 items-center justify-center rounded-md border border-dashed border-teal-200 bg-teal-50/40 text-[11px] text-teal-800/80">
              No 3h / price-check series for the last 7 days
            </div>
          ) : (
            <div className="h-20 sm:h-28 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={swingChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" hide />
                  <YAxis
                    orientation="right"
                    stroke="#9ca3af"
                    fontSize={9}
                    width={55}
                    tickLine={false}
                    axisLine={false}
                    domain={["auto", "auto"]}
                    tickFormatter={(val) =>
                      typeof window !== "undefined" && window.innerWidth < 640 && val >= 1000
                        ? `${(val / 1000).toFixed(0)}k`
                        : formatPhp(val)
                    }
                  />
                  {!isMobile && (
                    <Tooltip
                      formatter={(value: any) => [value != null ? formatPhp(Number(value)) : "N/A", "Price"]}
                      labelStyle={{ fontSize: 11, color: "#6b7280" }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="price"
                    stroke="#0d9488"
                    strokeWidth={1.5}
                    dot={false}
                    name="Price"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IndicatorPill({
  active,
  onClick,
  color,
  label,
}: {
  active: boolean;
  onClick: () => void;
  color: string;
  label: string;
}) {
  const colorMap: Record<string, string> = {
    amber: active ? "bg-amber-100 text-amber-700 border-amber-300" : "bg-white text-gray-500 border-gray-200",
    blue: active ? "bg-blue-100 text-blue-700 border-blue-300" : "bg-white text-gray-500 border-gray-200",
    purple: active ? "bg-purple-100 text-purple-700 border-purple-300" : "bg-white text-gray-500 border-gray-200",
    indigo: active ? "bg-indigo-100 text-indigo-700 border-indigo-300" : "bg-white text-gray-500 border-gray-200",
    teal: active ? "bg-teal-100 text-teal-800 border-teal-300" : "bg-white text-gray-500 border-gray-200",
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