'use client';

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

const chartConfig = {
  // A light neutral next to the theme colour, so completed work stands out.
  created: {
    label: 'Created',
    color: 'color-mix(in oklab, var(--muted-foreground) 40%, transparent)'
  },
  done: { label: 'Completed', color: 'var(--primary)' }
} satisfies ChartConfig;

/** Tasks created and completed per week; the latest week is on the right. */
export function ThroughputChart({
  weeks
}: {
  weeks: { label: string; range: string; created: number; done: number }[];
}) {
  return (
    <>
      <ChartContainer config={chartConfig} className='aspect-auto h-56 w-full'>
        <BarChart data={weeks} barGap={2} margin={{ left: -20, right: 4, top: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray='3 3' />
          <XAxis dataKey='label' tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
          <ChartTooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
            content={
              <ChartTooltipContent
                indicator='dot'
                labelFormatter={(_, payload) => payload?.[0]?.payload?.range ?? ''}
              />
            }
          />
          <Bar
            dataKey='created'
            fill='var(--color-created)'
            radius={[4, 4, 0, 0]}
            maxBarSize={18}
          />
          <Bar dataKey='done' fill='var(--color-done)' radius={[4, 4, 0, 0]} maxBarSize={18} />
          <ChartLegend content={<ChartLegendContent />} />
        </BarChart>
      </ChartContainer>
      <table className='sr-only'>
        <caption>Tasks created and completed per week</caption>
        <thead>
          <tr>
            <th>Week</th>
            <th>Created</th>
            <th>Completed</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.range}>
              <td>{week.range}</td>
              <td>{week.created}</td>
              <td>{week.done}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
