"use client";

import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_COLORS, ChartContainer, ChartTooltip, chartAxis, chartGrid } from "@/components/patterns/chart-container";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ValueFormat = "money" | "count" | "percent";

function formatter(format: ValueFormat, currency: string, compact = false) {
  return (v: number) => (format === "money" ? formatMoney(v, currency, "en-US", compact) : format === "percent" ? `${Math.round(v * 100)}%` : formatNumber(v));
}

/** Accessible data table under every chart ("Show data"). */
function DataTable({ columns, rows }: { columns: string[]; rows: Array<Array<string | number>> }) {
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer text-text-muted hover:text-foreground">Show data</summary>
      <div className="mt-2 max-h-56 overflow-auto rounded border border-border">
        <table className="w-full">
          <thead className="bg-surface-subtle text-text-muted">
            <tr>
              {columns.map((c, i) => (
                <th key={c} scope="col" className={cn("px-2 py-1 font-medium", i === 0 ? "text-left" : "text-right")}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                {r.map((cell, j) => (
                  <td key={j} className={cn("px-2 py-1", j === 0 ? "text-left" : "text-right tabular-nums")}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const BUCKET_LABEL = (key: string, bucket: "day" | "week" | "month") => {
  const d = new Date(key.length === 7 ? `${key}-01T00:00:00Z` : `${key}T00:00:00Z`);
  // "Jan 2026", never "Jan 26" (which reads like a day).
  if (bucket === "month") return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(d);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
};

/** Last day covered by a bucket key, for drill-down links. */
function bucketEnd(key: string, bucket: "day" | "week" | "month"): string {
  if (bucket === "day") return key;
  if (bucket === "week") return new Date(Date.parse(`${key}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const [y, m] = key.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Won deal value and collected payments over time: two clearly labelled series on one
 * money axis. Clicking a period opens the deals won in it.
 */
export function RevenueChart({
  data,
  bucket,
  currency,
  period,
  title = "Sales over time",
  description = "Won deal value (by close date) and collected payments (simulated, by payment date).",
}: {
  data: Array<{ bucket: string; won: number; collected: number }>;
  bucket: "day" | "week" | "month";
  currency: string;
  period: { from: string; to: string };
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  const fmt = formatter("money", currency);
  const rows = data.map((d) => ({ ...d, label: BUCKET_LABEL(d.bucket, bucket) }));
  const empty = data.every((d) => d.won === 0 && d.collected === 0);
  const totalWon = data.reduce((s, d) => s + d.won, 0);
  const totalCollected = data.reduce((s, d) => s + d.collected, 0);
  return (
    <ChartContainer
      title={title}
      description={description}
      summary={`${title}: won ${fmt(totalWon)} and collected ${fmt(totalCollected)} between ${period.from} and ${period.to}, by ${bucket}.`}
    
      empty={empty ? <EmptyChart text="No won deals or payments in this period." /> : undefined}
      footer={<DataTable columns={["Period", "Won deal value", "Collected"]} rows={rows.map((r) => [r.label, fmt(r.won), fmt(r.collected)])} />}
    >
      <LineChart
        data={rows}
        margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
        onClick={(state) => {
          const index = typeof state?.activeTooltipIndex === "number" ? state.activeTooltipIndex : Number(state?.activeTooltipIndex);
          const row = Number.isFinite(index) ? rows[index] : undefined;
          if (!row) return;
          const from = row.bucket.length === 7 ? `${row.bucket}-01` : row.bucket;
          const clamp = (d: string, lo: string, hi: string) => (d < lo ? lo : d > hi ? hi : d);
          router.push(`/deals?status=won&closed_from=${clamp(from, period.from, period.to)}&closed_to=${clamp(bucketEnd(row.bucket, bucket), period.from, period.to)}`);
        }}
        className="cursor-pointer"
      >
        <CartesianGrid {...chartGrid} />
        {/* Evenly spaced labels (every n-th bucket) instead of Recharts dropping random ones. */}
        <XAxis dataKey="label" {...chartAxis} interval={rows.length > 10 ? Math.ceil(rows.length / 10) - 1 : 0} />
        <YAxis {...chartAxis} width={64} tickFormatter={formatter("money", currency, true)} />
        <Tooltip content={<ChartTooltip formatValue={fmt} />} cursor={{ stroke: "var(--nx-border-strong)" }} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--nx-text-subtle)" }} />
        <Line type="monotone" dataKey="won" name="Won deal value" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--nx-surface)" }} />
        <Line type="monotone" dataKey="collected" name="Collected" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--nx-surface)" }} />
      </LineChart>
    </ChartContainer>
  );
}

function EmptyChart({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border-strong text-sm text-text-muted">{text}</div>;
}

/** Single-series bar chart. Bars with an href open the matching filtered list when clicked. */
export function BarsChart({
  title,
  description,
  data,
  format,
  currency = "USD",
  layout = "vertical",
  colorIndex = 0,
  height = 260,
  emptyText = "No data in this period.",
  valueLabel = "Value",
}: {
  title: string;
  description?: string;
  data: Array<{ label: string; value: number; href?: string; muted?: boolean }>;
  format: ValueFormat;
  currency?: string;
  /** "vertical" = columns, "horizontal" = bars with labels on the left (long names). */
  layout?: "vertical" | "horizontal";
  colorIndex?: number;
  height?: number;
  emptyText?: string;
  valueLabel?: string;
}) {
  const router = useRouter();
  const fmt = formatter(format, currency);
  const empty = data.length === 0 || data.every((d) => d.value === 0);
  const color = CHART_COLORS[colorIndex % CHART_COLORS.length];
  const horizontal = layout === "horizontal";
  return (
    <ChartContainer
      title={title}
      description={description}
      height={height}
      summary={`${title}: ${data.map((d) => `${d.label} ${fmt(d.value)}`).join(", ")}.`}
    
      empty={empty ? <EmptyChart text={emptyText} /> : undefined}
      footer={<DataTable columns={["", valueLabel]} rows={data.map((d) => [d.label, fmt(d.value)])} />}
    >
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, bottom: 0, left: horizontal ? 8 : 0 }} barCategoryGap={horizontal ? 6 : "20%"}>
        <CartesianGrid {...chartGrid} vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...chartAxis} tickFormatter={formatter(format, currency, true)} />
            <YAxis type="category" dataKey="label" {...chartAxis} width={120} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" {...chartAxis} interval={0} />
            <YAxis {...chartAxis} width={56} tickFormatter={formatter(format, currency, true)} allowDecimals={false} />
          </>
        )}
        <Tooltip content={<ChartTooltip formatValue={fmt} />} cursor={{ fill: "var(--nx-surface-muted)" }} />
        <Bar
          dataKey="value"
          name={valueLabel}
          fill={color}
          radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
          maxBarSize={horizontal ? 18 : 44}
          onClick={(entry) => {
            const href = (entry as unknown as { payload?: { href?: string } }).payload?.href;
            if (href) router.push(href);
          }}
          className={data.some((d) => d.href) ? "cursor-pointer" : undefined}
        >
          {data.map((d) => (
            <Cell key={d.label} fill={color} fillOpacity={d.muted ? 0.45 : 1} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** Two series of the same unit side by side (e.g. pipeline amount vs weighted amount). */
export function PairedBarsChart({
  title,
  description,
  data,
  series,
  currency,
}: {
  title: string;
  description?: string;
  data: Array<{ label: string; a: number; b: number; href?: string }>;
  series: [string, string];
  currency: string;
}) {
  const router = useRouter();
  const fmt = formatter("money", currency);
  const empty = data.every((d) => d.a === 0 && d.b === 0);
  return (
    <ChartContainer title={title} description={description} summary={`${title}: ${data.map((d) => `${d.label} ${series[0]} ${fmt(d.a)}, ${series[1]} ${fmt(d.b)}`).join("; ")}.`}
      empty={empty ? <EmptyChart text="No open deals." /> : undefined}
      footer={<DataTable columns={["Stage", series[0], series[1]]} rows={data.map((d) => [d.label, fmt(d.a), fmt(d.b)])} />}
    >
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barGap={2}>
        <CartesianGrid {...chartGrid} />
        <XAxis dataKey="label" {...chartAxis} interval={0} />
        <YAxis {...chartAxis} width={64} tickFormatter={formatter("money", currency, true)} />
        <Tooltip content={<ChartTooltip formatValue={fmt} />} cursor={{ fill: "var(--nx-surface-muted)" }} />
        <Legend iconType="square" wrapperStyle={{ fontSize: 12, color: "var(--nx-text-subtle)" }} />
        {(["a", "b"] as const).map((key, i) => (
          <Bar
            key={key}
            dataKey={key}
            name={series[i]}
            fill={CHART_COLORS[i]}
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
            className="cursor-pointer"
            onClick={(entry) => {
              const href = (entry as unknown as { payload?: { href?: string } }).payload?.href;
              if (href) router.push(href);
            }}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
