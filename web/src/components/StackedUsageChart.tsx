import { Empty, Space, Tag, Tooltip, Typography } from 'antd';
import { useMemo } from 'react';

import type { DashboardTrendPoint, DashboardTrendSeriesItem } from '../types/api';
import { formatMoney } from '../utils/format';

const { Text } = Typography;

const CHART_COLORS = [
  '#1677ff',
  '#52c41a',
  '#faad14',
  '#13c2c2',
  '#722ed1',
  '#eb2f96',
  '#fa8c16',
  '#2f54eb',
  '#a0d911',
  '#8c8c8c',
];

interface StackedUsageChartProps {
  title: string;
  subtitle?: string;
  points: DashboardTrendPoint[];
  series: DashboardTrendSeriesItem[];
}

export function StackedUsageChart({ title, subtitle, points, series }: StackedUsageChartProps) {
  const colorMap = useMemo(
    () =>
      new Map(
        series.map((item, index) => [
          item.key,
          CHART_COLORS[index % CHART_COLORS.length],
        ]),
      ),
    [series],
  );

  const maxValue = useMemo(
    () => points.reduce((currentMax, item) => Math.max(currentMax, item.used_display_amount), 0),
    [points],
  );

  const tickValues = useMemo(() => {
    if (maxValue <= 0) {
      return [0, 0, 0, 0, 0];
    }
    return [1, 0.75, 0.5, 0.25, 0].map((ratio) => maxValue * ratio);
  }, [maxValue]);

  const minChartWidth = Math.max(points.length * 72, 0);

  if (!points.length) {
    return (
      <div className="stacked-usage-chart-card">
        <div className="stacked-usage-chart-header">
          <div>
            <div className="stacked-usage-chart-title">{title}</div>
            {subtitle ? <Text type="secondary">{subtitle}</Text> : null}
          </div>
        </div>
        <Empty description="暂无区间消耗数据" />
      </div>
    );
  }

  return (
    <div className="stacked-usage-chart-card">
      <div className="stacked-usage-chart-header">
        <div>
          <div className="stacked-usage-chart-title">{title}</div>
          {subtitle ? <Text type="secondary">{subtitle}</Text> : null}
        </div>
      </div>

      <Space size={[8, 8]} wrap className="stacked-usage-chart-legend">
        {series.map((item) => (
          <Tag
            key={item.key}
            bordered={false}
            style={{
              marginInlineEnd: 0,
              color: colorMap.get(item.key),
              backgroundColor: `${colorMap.get(item.key)}1a`,
            }}
          >
            {item.instance_name} {formatMoney(item.total_used_display_amount)}
          </Tag>
        ))}
      </Space>

      <div className="stacked-usage-chart-layout">
        <div className="stacked-usage-chart-axis">
          {tickValues.map((tickValue, index) => (
            <div key={`${tickValue}-${index}`} className="stacked-usage-chart-axis-label">
              {formatMoney(tickValue)}
            </div>
          ))}
        </div>

        <div className="stacked-usage-chart-scroll">
          <div className="stacked-usage-chart-grid" style={{ minWidth: `${minChartWidth}px` }}>
            {tickValues.map((_, index) => (
              <div key={index} className="stacked-usage-chart-grid-line" />
            ))}
          </div>

          <div
            className="stacked-usage-chart-bars"
            style={{
              minWidth: `${minChartWidth}px`,
              gridTemplateColumns: `repeat(${points.length}, minmax(54px, 1fr))`,
            }}
          >
            {points.map((point) => {
              const tooltipTitle = (
                <div className="stacked-usage-chart-tooltip">
                  <div className="stacked-usage-chart-tooltip-title">{point.date}</div>
                  <div className="stacked-usage-chart-tooltip-total">
                    总消耗：{formatMoney(point.used_display_amount)}
                  </div>
                  {point.breakdown.map((item) => {
                    const percent = point.used_display_amount > 0
                      ? ((item.used_display_amount / point.used_display_amount) * 100).toFixed(1)
                      : '0.0';
                    return (
                      <div key={`${point.date}-${item.key}`} className="stacked-usage-chart-tooltip-row">
                        <span
                          className="stacked-usage-chart-tooltip-dot"
                          style={{ backgroundColor: colorMap.get(item.key) ?? CHART_COLORS[0] }}
                        />
                        <span>{item.instance_name}</span>
                        <span>{formatMoney(item.used_display_amount)}</span>
                        <span>{percent}%</span>
                      </div>
                    );
                  })}
                </div>
              );

              return (
                <Tooltip key={point.date} placement="top" title={tooltipTitle}>
                  <div className="stacked-usage-chart-bar-group">
                    <div className="stacked-usage-chart-bar-total">{formatMoney(point.used_display_amount)}</div>
                    <div className="stacked-usage-chart-bar-shell">
                      <div className="stacked-usage-chart-bar-stack">
                        {point.breakdown.map((item) => (
                          <div
                            key={`${point.date}-${item.key}`}
                            className="stacked-usage-chart-segment"
                            style={{
                              height: `${maxValue > 0 ? (item.used_display_amount / maxValue) * 100 : 0}%`,
                              backgroundColor: colorMap.get(item.key) ?? CHART_COLORS[0],
                            }}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="stacked-usage-chart-bar-label">{point.label}</div>
                  </div>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
