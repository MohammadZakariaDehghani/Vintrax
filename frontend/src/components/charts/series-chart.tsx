'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface SeriesChartProps {
  data: { date: string; value: number }[];
  kind: 'area' | 'line' | 'bar';
  /** Theme colour the series is drawn in. */
  tone: 'primary' | 'accent';
  height: number;
  /** Counts are whole numbers; money is not. */
  allowDecimals?: boolean;
  formatValue?: (value: number) => string;
}

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  color: 'hsl(var(--popover-foreground))',
};

/**
 * One date series, drawn the way the admin and dealer dashboards draw them.
 * Imported only through ./index.tsx, which loads it — and recharts, about
 * 370 kB of script — once a dashboard is actually on screen.
 */
export default function SeriesChart({
  data,
  kind,
  tone,
  height,
  allowDecimals = true,
  formatValue,
}: SeriesChartProps) {
  const colour = `hsl(var(--${tone}))`;
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
      <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
      <YAxis
        tick={{ fontSize: 11 }}
        stroke="hsl(var(--muted-foreground))"
        allowDecimals={allowDecimals}
      />
      <Tooltip
        contentStyle={TOOLTIP_STYLE}
        {...(formatValue ? { formatter: (value: number) => formatValue(value) } : {})}
      />
    </>
  );

  return (
    <ResponsiveContainer width="100%" height={height}>
      {kind === 'line' ? (
        <LineChart data={data}>
          {axes}
          <Line type="monotone" dataKey="value" stroke={colour} strokeWidth={2} dot={false} />
        </LineChart>
      ) : kind === 'bar' ? (
        <BarChart data={data}>
          {axes}
          <Bar dataKey="value" fill={colour} radius={[4, 4, 0, 0]} />
        </BarChart>
      ) : (
        <AreaChart data={data}>
          {axes}
          <Area
            type="monotone"
            dataKey="value"
            stroke={colour}
            fill={`hsl(var(--${tone}) / 0.18)`}
          />
        </AreaChart>
      )}
    </ResponsiveContainer>
  );
}
