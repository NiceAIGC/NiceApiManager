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

function formatValue(value: number, format: 'money' | 'number') {
  return format === 'money' ? formatMoney(value) : formatNumber(value);
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

  const tickValues = useMemo(() => {
    if (maxValue <= 0) {
      return [0, 0, 0, 0, 0];
    }
    return [1, 0.75, 0.5, 0.25, 0].map((ratio) => maxValue * ratio);
  }, [maxValue]);

  const labelStep = points.length > 24 ? 5 : points.length > 14 ? 3 : 1;

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

      <div className="classic-chart-layout">
        <div className="classic-chart-axis">
          {tickValues.map((tickValue, index) => (
            <div key={`${tickValue}-${index}`} className="classic-chart-axis-label">
              {formatValue(tickValue, format)}
            </div>
          ))}
        </div>

        <div className="classic-chart-plot">
          <div className="classic-chart-grid">
            {tickValues.map((_, index) => (
              <div key={index} className="classic-chart-grid-line" />
            ))}
          </div>

          <div className="classic-chart-bars">
            {points.map((point, index) => {
              const heightPercent =
                maxValue > 0 ? Math.max((point.value / maxValue) * 100, point.value > 0 ? 6 : 0) : 0;
              const displayValue = formatValue(point.value, format);
              return (
                <div key={`${point.label}-${index}`} className="classic-chart-bar-group" title={`${point.label}: ${displayValue}`}>
                  <div className="classic-chart-bar-value">{displayValue}</div>
                  <div className="classic-chart-bar-track">
                    <div
                      className="classic-chart-bar-fill"
                      style={{
                        height: `${heightPercent}%`,
                        background: color,
                      }}
                    />
                  </div>
                  <div className="classic-chart-bar-label">{index % labelStep === 0 ? point.label : ' '}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
