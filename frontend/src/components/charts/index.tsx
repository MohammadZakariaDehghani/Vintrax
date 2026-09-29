'use client';

import dynamic from 'next/dynamic';
import type { SeriesChartProps } from './series-chart';

const Chart = dynamic(() => import('./series-chart'), { ssr: false });

/**
 * A dashboard chart, with recharts split into its own chunk rather than
 * shipped in the page's first load. The box keeps the chart's height while
 * the chunk arrives, so nothing below it moves when it does.
 */
export function SeriesChart(props: SeriesChartProps) {
  return (
    <div style={{ height: props.height }}>
      <Chart {...props} />
    </div>
  );
}
