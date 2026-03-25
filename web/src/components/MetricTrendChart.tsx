import { Empty, Typography } from 'antd';
import { useMemo } from 'react';

import { formatMoney, formatNumber } from '../utils/format';

const { Text } = Typography;

interface MetricTrendChartPoint {
  label: string;
  value: number;
}

interface MetricTrendChartProps {
  title: string;
  subtitle: string;
  points: MetricTrendChartPoint[];
  color: string;
  format: 'money' | 'number';
}

export function MetricTrendChart({
  title,
  subtitle,
  points,
  color,
  format,
}: MetricTrendChartProps) {
  const maxValue = useMemo(
    () => points.reduce((currentMax, item) => Math.max(currentMax, item.value), 0),
    [points],
  );

  if (!points.length) {
    return (
      <div className="chart-card">
        <div className="chart-card-header">
          <div>
            <div className="chart-card-title">{title}</div>
            <Text type="secondary">{subtitle}</Text>
          </div>
        </div>
        <Empty description="暂无趋势数据" />
      </div>
    );
  }

  return (
    <div className="chart-card">
      <div className="chart-card-header">
        <div>
          <div className="chart-card-title">{title}</div>
          <Text type="secondary">{subtitle}</Text>
        </div>
      </div>

      <div className="trend-chart">
        {points.map((point) => {
          const heightPercent = maxValue > 0 ? Math.max((point.value / maxValue) * 100, point.value > 0 ? 8 : 0) : 0;
          const displayValue = format === 'money' ? formatMoney(point.value) : formatNumber(point.value);

          return (
            <div key={point.label} className="trend-chart-bar">
              <div className="trend-chart-value">{displayValue}</div>
              <div className="trend-chart-track">
                <div
                  className="trend-chart-fill"
                  style={{ height: `${heightPercent}%`, background: color }}
                  title={`${point.label}: ${displayValue}`}
                />
              </div>
              <div className="trend-chart-label">{point.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
