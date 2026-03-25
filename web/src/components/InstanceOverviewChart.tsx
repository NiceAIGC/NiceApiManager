import { Empty, Space, Tag, Typography } from 'antd';
import { useMemo } from 'react';

import type { DashboardInstanceSummary } from '../types/api';
import { formatDateTime, formatMoney } from '../utils/format';

const { Text } = Typography;

type InstanceOverviewMode = 'quota' | 'status';

interface InstanceOverviewChartProps {
  items: DashboardInstanceSummary[];
  mode: InstanceOverviewMode;
}

function getHealthMeta(item: DashboardInstanceSummary) {
  if (!item.enabled) {
    return {
      color: '#bfbfbf',
      label: '已停用',
    };
  }

  if (item.health_status === 'healthy') {
    return {
      color: '#52c41a',
      label: '健康',
    };
  }

  if (item.health_status === 'degraded') {
    return {
      color: '#faad14',
      label: '降级',
    };
  }

  return {
    color: '#ff4d4f',
    label: '异常',
  };
}

export function InstanceOverviewChart({ items, mode }: InstanceOverviewChartProps) {
  const maxQuotaValue = useMemo(
    () =>
      items.reduce((currentMax, item) => {
        const total = item.billing_mode === 'prepaid'
          ? Math.max(item.latest_display_quota ?? 0, item.latest_display_used_quota ?? 0)
          : item.latest_display_used_quota ?? 0;
        return Math.max(currentMax, total);
      }, 0),
    [items],
  );

  if (!items.length) {
    return <Empty description="当前筛选下暂无实例" />;
  }

  return (
    <div className="instance-overview-chart">
      {items.map((item) => {
        const usedAmount = item.latest_display_used_quota ?? 0;
        const totalAmount =
          item.billing_mode === 'prepaid'
            ? Math.max(item.latest_display_quota ?? 0, usedAmount)
            : usedAmount;
        const remainingAmount = item.billing_mode === 'prepaid' ? Math.max(totalAmount - usedAmount, 0) : 0;
        const widthPercent = maxQuotaValue > 0 ? Math.max((totalAmount / maxQuotaValue) * 100, 6) : 0;
        const usedPercent = totalAmount > 0 ? (usedAmount / totalAmount) * 100 : 0;
        const healthMeta = getHealthMeta(item);

        return (
          <div key={item.instance_id} className="instance-overview-row">
            <div className="instance-overview-meta">
              <Space size={[8, 8]} wrap>
                <Text strong>{item.instance_name}</Text>
                <Tag color={item.billing_mode === 'postpaid' ? 'blue' : 'orange'}>
                  {item.billing_mode === 'postpaid' ? '后付费' : '预付费'}
                </Tag>
                <Tag
                  bordered={false}
                  style={{
                    color: healthMeta.color,
                    backgroundColor: `${healthMeta.color}1a`,
                  }}
                >
                  {healthMeta.label}
                </Tag>
              </Space>
              <Text type="secondary">最近同步：{formatDateTime(item.last_sync_at)}</Text>
            </div>

            {mode === 'quota' ? (
              <div className="instance-overview-track">
                <div className="instance-overview-bar" style={{ width: `${widthPercent}%` }}>
                  <div
                    className="instance-overview-bar-used"
                    style={{ width: `${Math.min(usedPercent, 100)}%` }}
                  />
                  {item.billing_mode === 'prepaid' ? (
                    <div
                      className="instance-overview-bar-remaining"
                      style={{ width: `${Math.max(100 - usedPercent, 0)}%` }}
                    />
                  ) : null}
                </div>
                <div className="instance-overview-values">
                  {item.billing_mode === 'prepaid' ? (
                    <Text>
                      已用 {formatMoney(usedAmount)} / 剩余 {formatMoney(remainingAmount)}
                    </Text>
                  ) : (
                    <Text>后付费累计已用 {formatMoney(usedAmount)}</Text>
                  )}
                </div>
              </div>
            ) : (
              <div className="instance-overview-status-track">
                <div
                  className="instance-overview-status-fill"
                  style={{ width: '100%', backgroundColor: healthMeta.color }}
                />
                {item.health_error ? <Text type="secondary">{item.health_error}</Text> : <Text type="secondary">状态正常</Text>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
