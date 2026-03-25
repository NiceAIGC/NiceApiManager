import { Empty, Tooltip, Typography } from 'antd';
import { useMemo } from 'react';

import type { DashboardInstanceSummary } from '../types/api';
import { formatDateTime, formatMoney } from '../utils/format';

const { Text } = Typography;

export type InstanceOverviewMode = 'used' | 'remaining' | 'health';

interface InstanceOverviewChartProps {
  items: DashboardInstanceSummary[];
  mode: InstanceOverviewMode;
}

function getHealthScore(item: DashboardInstanceSummary) {
  if (!item.enabled) {
    return 0;
  }
  if (item.health_status === 'healthy') {
    return 100;
  }
  if (item.health_status === 'degraded') {
    return 60;
  }
  return 20;
}

function getHealthLabel(item: DashboardInstanceSummary) {
  if (!item.enabled) {
    return '已停用';
  }
  if (item.health_status === 'healthy') {
    return '健康';
  }
  if (item.health_status === 'degraded') {
    return '降级';
  }
  return '异常';
}

function getHealthColor(item: DashboardInstanceSummary) {
  if (!item.enabled) {
    return '#bfbfbf';
  }
  if (item.health_status === 'healthy') {
    return '#52c41a';
  }
  if (item.health_status === 'degraded') {
    return '#faad14';
  }
  return '#ff4d4f';
}

export function InstanceOverviewChart({ items, mode }: InstanceOverviewChartProps) {
  const chartData = useMemo(() => {
    return items.map((item) => {
      const usedAmount = item.latest_display_used_quota ?? 0;
      const totalAmount =
        item.billing_mode === 'prepaid'
          ? Math.max(item.latest_display_quota ?? 0, usedAmount)
          : usedAmount;
      const remainingAmount = item.billing_mode === 'prepaid' ? Math.max(totalAmount - usedAmount, 0) : 0;
      const value =
        mode === 'remaining'
          ? remainingAmount
          : mode === 'health'
            ? getHealthScore(item)
            : usedAmount;

      return {
        item,
        usedAmount,
        totalAmount,
        remainingAmount,
        value,
        healthLabel: getHealthLabel(item),
        healthColor: getHealthColor(item),
      };
    });
  }, [items, mode]);

  const maxValue = useMemo(
    () => chartData.reduce((currentMax, item) => Math.max(currentMax, item.value), 0),
    [chartData],
  );

  if (!chartData.length) {
    return <Empty description="当前筛选下暂无实例" />;
  }

  return (
    <div className="instance-chart">
      {chartData.map(({ item, usedAmount, totalAmount, remainingAmount, value, healthLabel, healthColor }) => {
        const widthPercent = maxValue > 0 ? Math.max((value / maxValue) * 100, value > 0 ? 8 : 0) : 0;
        const usedPercent = totalAmount > 0 ? Math.min((usedAmount / totalAmount) * 100, 100) : 0;
        const remainingPercent = totalAmount > 0 ? Math.max(100 - usedPercent, 0) : 0;

        const tooltipTitle = (
          <div className="instance-chart-tooltip">
            <div>{item.instance_name}</div>
            <div>计费方式：{item.billing_mode === 'postpaid' ? '后付费' : '预付费'}</div>
            <div>状态：{healthLabel}</div>
            <div>已用额度：{formatMoney(usedAmount)}</div>
            {item.billing_mode === 'prepaid' ? <div>剩余额度：{formatMoney(remainingAmount)}</div> : null}
            <div>最近同步：{formatDateTime(item.last_sync_at)}</div>
            {item.health_error ? <div>异常信息：{item.health_error}</div> : null}
          </div>
        );

        return (
          <Tooltip key={item.instance_id} placement="topLeft" title={tooltipTitle}>
            <div className="instance-chart-row">
              <div className="instance-chart-label">
                <div className="instance-chart-name">{item.instance_name}</div>
                <div className="instance-chart-subtitle">
                  {mode === 'used'
                    ? `已用 ${formatMoney(usedAmount)}`
                    : mode === 'remaining'
                      ? `剩余 ${formatMoney(remainingAmount)}`
                      : healthLabel}
                </div>
              </div>

              <div className="instance-chart-track">
                {mode === 'health' ? (
                  <div className="instance-chart-health-shell">
                    <div
                      className="instance-chart-health-fill"
                      style={{
                        width: `${widthPercent}%`,
                        backgroundColor: healthColor,
                      }}
                    />
                  </div>
                ) : (
                  <div className="instance-chart-quota-shell" style={{ width: `${widthPercent}%` }}>
                    {mode === 'used' ? (
                      <>
                        <div className="instance-chart-quota-used" style={{ width: `${usedPercent}%` }} />
                        {item.billing_mode === 'prepaid' ? (
                          <div className="instance-chart-quota-remaining" style={{ width: `${remainingPercent}%` }} />
                        ) : null}
                      </>
                    ) : (
                      <div className="instance-chart-quota-remaining" style={{ width: '100%' }} />
                    )}
                  </div>
                )}
              </div>

              <div className="instance-chart-value">
                <Text strong>
                  {mode === 'used'
                    ? formatMoney(usedAmount)
                    : mode === 'remaining'
                      ? formatMoney(remainingAmount)
                      : healthLabel}
                </Text>
              </div>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}
