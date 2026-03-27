import { Empty, Progress, Space, Table, Tag, Typography } from 'antd';
import { useMemo } from 'react';

import type { DashboardInstanceSummary } from '../types/api';
import { formatDateTime, formatMoney, formatNumber } from '../utils/format';

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
    return 65;
  }
  if (item.health_status === 'unknown') {
    return 40;
  }
  return 15;
}

function getHealthMeta(item: DashboardInstanceSummary) {
  if (!item.enabled) {
    return { label: '已停用', color: 'default' as const };
  }
  if (item.health_status === 'healthy') {
    return { label: '健康', color: 'success' as const };
  }
  if (item.health_status === 'degraded') {
    return { label: '降级', color: 'warning' as const };
  }
  if (item.health_status === 'unknown') {
    return { label: '未知', color: 'default' as const };
  }
  return { label: '异常', color: 'error' as const };
}

export function InstanceOverviewChart({ items, mode }: InstanceOverviewChartProps) {
  const rows = useMemo(
    () =>
      items.map((item) => {
        const usedAmount = item.latest_display_used_quota ?? 0;
        const remainingAmount =
          item.billing_mode === 'prepaid'
            ? Math.max((item.latest_display_quota ?? 0) - usedAmount, 0)
            : 0;
        const healthMeta = getHealthMeta(item);
        const metricValue = mode === 'remaining' ? remainingAmount : mode === 'health' ? getHealthScore(item) : usedAmount;

        return {
          ...item,
          usedAmount,
          remainingAmount,
          healthMeta,
          metricValue,
        };
      }),
    [items, mode],
  );

  const maxMetricValue = useMemo(
    () => rows.reduce((maxValue, item) => Math.max(maxValue, item.metricValue), 0),
    [rows],
  );

  if (!rows.length) {
    return <Empty description="当前筛选下暂无实例" />;
  }

  return (
    <Table
      size="small"
      rowKey="instance_id"
      dataSource={rows}
      pagination={false}
      scroll={{ x: 900 }}
      columns={[
        {
          title: '实例',
          dataIndex: 'instance_name',
          key: 'instance_name',
          width: 180,
          render: (value: string, record) => (
            <Space direction="vertical" size={0}>
              <Text strong>{value}</Text>
              <Space size={8} wrap>
                <Tag>{record.billing_mode === 'postpaid' ? '后付费' : '预付费'}</Tag>
                {record.latest_group_name ? <Tag color="blue">{record.latest_group_name}</Tag> : null}
              </Space>
            </Space>
          ),
        },
        {
          title: '健康状态',
          dataIndex: 'health_status',
          key: 'health_status',
          width: 110,
          render: (_: string, record) => <Tag color={record.healthMeta.color}>{record.healthMeta.label}</Tag>,
        },
        {
          title: mode === 'used' ? '已用强度' : mode === 'remaining' ? '剩余强度' : '健康得分',
          key: 'metric',
          width: 280,
          render: (_: unknown, record) => {
            const percent =
              mode === 'health'
                ? record.metricValue
                : maxMetricValue > 0
                  ? Math.max((record.metricValue / maxMetricValue) * 100, record.metricValue > 0 ? 6 : 0)
                  : 0;
            const label =
              mode === 'used'
                ? formatMoney(record.usedAmount)
                : mode === 'remaining'
                  ? formatMoney(record.remainingAmount)
                  : `${record.metricValue} / 100`;
            const strokeColor =
              mode === 'used' ? '#1677ff' : mode === 'remaining' ? '#52c41a' : record.healthMeta.color === 'success' ? '#52c41a' : record.healthMeta.color === 'warning' ? '#faad14' : record.healthMeta.color === 'error' ? '#ff4d4f' : '#8c8c8c';

            return (
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Text strong>{label}</Text>
                <Progress percent={Math.round(percent)} showInfo={false} strokeColor={strokeColor} />
              </Space>
            );
          },
        },
        {
          title: '当前余额',
          dataIndex: 'latest_display_quota',
          key: 'latest_display_quota',
          width: 120,
          render: (value: number | null | undefined, record) =>
            record.billing_mode === 'postpaid' ? '-' : formatMoney(value),
        },
        {
          title: '今日请求',
          dataIndex: 'today_request_count',
          key: 'today_request_count',
          width: 110,
          render: (value: number) => formatNumber(value),
        },
        {
          title: '累计请求',
          dataIndex: 'latest_request_count',
          key: 'latest_request_count',
          width: 110,
          render: (value?: number | null) => formatNumber(value),
        },
        {
          title: '最近同步',
          dataIndex: 'last_sync_at',
          key: 'last_sync_at',
          width: 180,
          render: (value?: string | null) => formatDateTime(value),
        },
      ]}
    />
  );
}
