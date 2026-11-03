import { useMemo, useState } from 'react';

import { EmptyState } from './ui';
import { cn } from '@/lib/utils';
import type { DashboardTrendPoint, DashboardTrendSeriesItem } from '../types/api';
import { formatMoney } from '../utils/format';

const CHART_COLORS = [
  'var(--chart-series-1)',
  'var(--chart-series-2)',
  'var(--chart-series-3)',
  'var(--chart-series-4)',
  'var(--chart-series-5)',
  'var(--chart-series-6)',
  'var(--chart-series-1)',
  'var(--chart-series-2)',
  'var(--chart-series-3)',
  'var(--chart-series-more)',
];
const LEGEND_VISIBLE_COUNT = 12;

interface StackedUsageChartProps {
  points: DashboardTrendPoint[];
  series: DashboardTrendSeriesItem[];
}

export function StackedUsageChart({ points, series }: StackedUsageChartProps) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const rankedSeries = useMemo(() => [...series].sort((left, right) => right.total_used_display_amount - left.total_used_display_amount), [series]);
  const colorMap = useMemo(() => new Map(rankedSeries.map((item, index) => [item.key, CHART_COLORS[index % CHART_COLORS.length]])), [rankedSeries]);
  const maxValue = useMemo(() => points.reduce((currentMax, item) => Math.max(currentMax, item.used_display_amount), 0), [points]);
  const tickValues = useMemo(() => (maxValue <= 0 ? [0, 0, 0, 0, 0] : [1, 0.75, 0.5, 0.25, 0].map((ratio) => maxValue * ratio)), [maxValue]);
  const visibleLegendItems = rankedSeries.slice(0, LEGEND_VISIBLE_COUNT);
  const collapsedLegendItems = rankedSeries.slice(LEGEND_VISIBLE_COUNT);
  const collapsedTotal = collapsedLegendItems.reduce((sum, item) => sum + item.total_used_display_amount, 0);
  const hoveredPoint = points.find((point) => point.date === hoveredDate) ?? null;

  if (!points.length) {
    return <EmptyState description="暂无区间消耗数据" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-3">
        <div className="flex flex-col justify-between py-2 text-right text-[11px] text-muted-foreground tabular">
          {tickValues.map((tickValue, index) => (
            <span key={`${tickValue}-${index}`}>{formatMoney(tickValue)}</span>
          ))}
        </div>
        <div className="relative min-h-[240px]">
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between pb-6 pt-2">
            {tickValues.map((_, index) => (
              <div key={index} className="border-t border-dashed border-border/70" />
            ))}
          </div>
          <div className="relative flex h-full items-end gap-2 overflow-x-auto pb-6 pt-2">
            {points.map((point) => {
              const heightPercent = maxValue > 0 ? (point.used_display_amount / maxValue) * 100 : 0;
              return (
                <div
                  key={point.date}
                  className="group flex min-w-[52px] flex-1 flex-col items-center justify-end gap-1"
                  onMouseEnter={() => setHoveredDate(point.date)}
                  onMouseLeave={() => setHoveredDate(null)}
                >
                  <span className="whitespace-nowrap text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 tabular">
                    {formatMoney(point.used_display_amount)}
                  </span>
                  <div className="flex h-[190px] w-full items-end overflow-hidden rounded bg-muted/40">
                    <div className="w-full rounded bg-primary/75 transition-colors group-hover:bg-primary" style={{ height: `${Math.max(heightPercent, 1.5)}%` }} />
                  </div>
                  <span className="whitespace-nowrap text-[11px] text-muted-foreground">{point.label ?? point.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {hoveredPoint ? (
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
          <div className="font-medium">{hoveredPoint.date} · {formatMoney(hoveredPoint.used_display_amount)}</div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {visibleLegendItems.map((item, index) => (
          <div key={item.key} className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5">
            <span className="w-4 shrink-0 text-right text-[11px] font-semibold text-muted-foreground">{index + 1}</span>
            <span className={cn('size-2.5 shrink-0 rounded-full')} style={{ backgroundColor: colorMap.get(item.key) ?? CHART_COLORS[0] }} />
            <span className="min-w-0 flex-1 truncate text-xs" title={item.instance_name}>{item.instance_name}</span>
            <strong className="shrink-0 text-xs tabular">{formatMoney(item.total_used_display_amount)}</strong>
          </div>
        ))}
        {collapsedLegendItems.length ? (
          <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5" title={collapsedLegendItems.map((item) => item.instance_name).join('、')}>
            <span className="w-4 shrink-0 text-right text-[11px] font-semibold text-muted-foreground">+</span>
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: 'var(--chart-series-more)' }} />
            <span className="min-w-0 flex-1 truncate text-xs">其余 {collapsedLegendItems.length} 个</span>
            <strong className="shrink-0 text-xs tabular">{formatMoney(collapsedTotal)}</strong>
          </div>
        ) : null}
      </div>
    </div>
  );
}
