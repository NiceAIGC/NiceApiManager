import { Chip, Tooltip } from '@heroui/react';
import { useMemo } from 'react';

import { EmptyState } from './ui';
import type { DashboardTrendPoint, DashboardTrendSeriesItem } from '../types/api';
import { formatMoney } from '../utils/format';

const CHART_COLORS = [
  'var(--chart-series-1)', 'var(--chart-series-2)', 'var(--chart-series-3)',
  'var(--chart-series-4)', 'var(--chart-series-5)', 'var(--chart-series-6)',
  'var(--chart-series-1)', 'var(--chart-series-2)', 'var(--chart-series-3)',
  'var(--chart-series-more)',
];
const LEGEND_VISIBLE_COUNT = 12;

interface StackedUsageChartProps {
  title: string;
  subtitle?: string;
  points: DashboardTrendPoint[];
  series: DashboardTrendSeriesItem[];
}

export function StackedUsageChart({ title, subtitle, points, series }: StackedUsageChartProps) {
  const rankedSeries = useMemo(() => [...series].sort((left, right) => right.total_used_display_amount - left.total_used_display_amount), [series]);
  const colorMap = useMemo(() => new Map(rankedSeries.map((item, index) => [item.key, CHART_COLORS[index % CHART_COLORS.length]])), [rankedSeries]);
  const maxValue = useMemo(() => points.reduce((currentMax, item) => Math.max(currentMax, item.used_display_amount), 0), [points]);
  const visibleLegendItems = rankedSeries.slice(0, LEGEND_VISIBLE_COUNT);
  const collapsedLegendItems = rankedSeries.slice(LEGEND_VISIBLE_COUNT);
  const collapsedTotal = collapsedLegendItems.reduce((sum, item) => sum + item.total_used_display_amount, 0);
  const tickValues = useMemo(() => maxValue <= 0 ? [0, 0, 0, 0, 0] : [1, 0.75, 0.5, 0.25, 0].map((ratio) => maxValue * ratio), [maxValue]);
  const minChartWidth = Math.max(points.length * 72, 0);

  return (
    <div className="stacked-usage-chart-card">
      <div className="stacked-usage-chart-header"><div><div className="stacked-usage-chart-title">{title}</div>{subtitle ? <p className="m-0 text-sm text-muted">{subtitle}</p> : null}</div></div>
      {!points.length ? <EmptyState description="暂无区间消耗数据" /> : <>
        <div className="stacked-usage-chart-legend">
          {visibleLegendItems.map((item, index) => (
            <div key={item.key} className="stacked-usage-chart-legend-item">
              <span className="stacked-usage-chart-legend-rank">{index + 1}</span>
              <span className="stacked-usage-chart-legend-dot" style={{ backgroundColor: colorMap.get(item.key) ?? CHART_COLORS[0] }} />
              <span className="stacked-usage-chart-legend-name" title={item.instance_name}>{item.instance_name}</span>
              <strong className="stacked-usage-chart-legend-value">{formatMoney(item.total_used_display_amount)}</strong>
            </div>
          ))}
          {collapsedLegendItems.length > 0 ? (
            <Tooltip>
              <Tooltip.Trigger><div className="stacked-usage-chart-legend-item stacked-usage-chart-legend-more" tabIndex={0}>
                <span className="stacked-usage-chart-legend-rank">+</span><span className="stacked-usage-chart-legend-dot stacked-usage-chart-legend-dot-more" />
                <span className="stacked-usage-chart-legend-name">其余 {collapsedLegendItems.length} 个</span><strong className="stacked-usage-chart-legend-value">{formatMoney(collapsedTotal)}</strong>
              </div></Tooltip.Trigger>
              <Tooltip.Content><div className="stacked-usage-chart-tooltip"><div className="stacked-usage-chart-tooltip-title">其余实例</div>{collapsedLegendItems.map((item) => (
                <div key={item.key} className="stacked-usage-chart-tooltip-row"><span className="stacked-usage-chart-tooltip-dot" style={{ backgroundColor: colorMap.get(item.key) ?? CHART_COLORS[0] }} /><span>{item.instance_name}</span><span>{formatMoney(item.total_used_display_amount)}</span><span /></div>
              ))}</div></Tooltip.Content>
            </Tooltip>
          ) : null}
        </div>
        <div className="stacked-usage-chart-layout">
          <div className="stacked-usage-chart-axis">{tickValues.map((tickValue, index) => <div key={`${tickValue}-${index}`} className="stacked-usage-chart-axis-label">{formatMoney(tickValue)}</div>)}</div>
          <div className="stacked-usage-chart-scroll">
            <div className="stacked-usage-chart-grid" style={{ minWidth: `${minChartWidth}px` }}>{tickValues.map((_, index) => <div key={index} className="stacked-usage-chart-grid-line" />)}</div>
            <div className="stacked-usage-chart-bars" style={{ minWidth: `${minChartWidth}px`, gridTemplateColumns: `repeat(${points.length}, minmax(54px, 1fr))` }}>
              {points.map((point) => {
                const sortedBreakdown = [...point.breakdown].sort((left, right) => right.used_display_amount - left.used_display_amount);
                const topContributor = sortedBreakdown[0];
                const tooltipContent = <div className="stacked-usage-chart-tooltip"><div className="stacked-usage-chart-tooltip-title">{point.date}</div><div className="stacked-usage-chart-tooltip-total">总消耗：{formatMoney(point.used_display_amount)}</div>{topContributor ? <Chip color="accent" size="sm">当日最高：{topContributor.instance_name} {formatMoney(topContributor.used_display_amount)}</Chip> : null}{sortedBreakdown.map((item) => {
                  const percent = point.used_display_amount > 0 ? ((item.used_display_amount / point.used_display_amount) * 100).toFixed(1) : '0.0';
                  return <div key={`${point.date}-${item.key}`} className="stacked-usage-chart-tooltip-row"><span className="stacked-usage-chart-tooltip-dot" style={{ backgroundColor: colorMap.get(item.key) ?? CHART_COLORS[0] }} /><span>{item.instance_name}</span><span>{formatMoney(item.used_display_amount)}</span><span>{percent}%</span></div>;
                })}</div>;
                return <Tooltip key={point.date}><Tooltip.Trigger><div className="stacked-usage-chart-bar-group" tabIndex={0}><div className="stacked-usage-chart-bar-total">{formatMoney(point.used_display_amount)}</div><div className="stacked-usage-chart-bar-shell"><div className="stacked-usage-chart-bar-stack">{sortedBreakdown.map((item) => <div key={`${point.date}-${item.key}`} className="stacked-usage-chart-segment" style={{ height: `${maxValue > 0 ? (item.used_display_amount / maxValue) * 100 : 0}%`, backgroundColor: colorMap.get(item.key) ?? CHART_COLORS[0] }} />)}</div></div><div className="stacked-usage-chart-bar-label">{point.label}</div></div></Tooltip.Trigger><Tooltip.Content>{tooltipContent}</Tooltip.Content></Tooltip>;
              })}
            </div>
          </div>
        </div>
      </>}
    </div>
  );
}
