import { ProgressBar } from '@heroui/react';
import { useMemo } from 'react';

import { DataTable, EmptyState, StatusChip } from './ui';
import type { DataTableColumn } from './ui';
import type { DashboardInstanceSummary } from '../types/api';
import { formatDateTime, formatMoney, formatNumber } from '../utils/format';

export type InstanceOverviewMode = 'used' | 'remaining' | 'health';

interface InstanceOverviewChartProps {
  items: DashboardInstanceSummary[];
  mode: InstanceOverviewMode;
}

interface InstanceOverviewRow extends DashboardInstanceSummary {
  metricValue: number;
  usedAmount: number;
  remainingAmount: number;
  healthMeta: { label: string; color: 'default' | 'success' | 'warning' | 'danger' };
}

function getHealthScore(item: DashboardInstanceSummary) {
  if (!item.enabled) return 0;
  if (item.health_status === 'healthy') return 100;
  if (item.health_status === 'degraded') return 65;
  if (item.health_status === 'unknown') return 40;
  return 15;
}

function getHealthMeta(item: DashboardInstanceSummary): InstanceOverviewRow['healthMeta'] {
  if (!item.enabled) return { label: '已停用', color: 'default' };
  if (item.health_status === 'healthy') return { label: '健康', color: 'success' };
  if (item.health_status === 'degraded') return { label: '降级', color: 'warning' };
  if (item.health_status === 'unknown') return { label: '未知', color: 'default' };
  return { label: '异常', color: 'danger' };
}

export function InstanceOverviewChart({ items, mode }: InstanceOverviewChartProps) {
  const rows = useMemo<InstanceOverviewRow[]>(
    () => items.map((item) => {
      const usedAmount = item.latest_display_used_quota ?? 0;
      const remainingAmount = item.billing_mode === 'prepaid' ? Math.max((item.latest_display_quota ?? 0) - usedAmount, 0) : 0;
      const healthScore = getHealthScore(item);
      return {
        ...item,
        usedAmount,
        remainingAmount,
        healthMeta: getHealthMeta(item),
        metricValue: mode === 'used' ? usedAmount : mode === 'remaining' ? remainingAmount : healthScore,
      };
    }),
    [items, mode],
  );
  const maxMetricValue = useMemo(() => rows.reduce((maxValue, item) => Math.max(maxValue, item.metricValue), 0), [rows]);

  if (!rows.length) return <EmptyState description="当前筛选下暂无实例" />;

  const columns: DataTableColumn<InstanceOverviewRow>[] = [
    {
      id: 'instance_name', title: '实例', width: 180,
      render: (row) => <div className="flex flex-col gap-1"><strong>{row.instance_name}</strong><div className="flex flex-wrap gap-1"><StatusChip>{row.billing_mode === 'postpaid' ? '后付费' : '预付费'}</StatusChip>{row.latest_group_name ? <StatusChip color="accent">{row.latest_group_name}</StatusChip> : null}</div></div>,
    },
    { id: 'health_status', title: '健康状态', width: 110, render: (row) => <StatusChip color={row.healthMeta.color}>{row.healthMeta.label}</StatusChip> },
    {
      id: 'metric', title: mode === 'used' ? '已用强度' : mode === 'remaining' ? '剩余强度' : '健康得分', width: 280,
      render: (row) => {
        const percent = mode === 'health' ? row.metricValue : maxMetricValue > 0 ? Math.max((row.metricValue / maxMetricValue) * 100, row.metricValue > 0 ? 6 : 0) : 0;
        const label = mode === 'used' ? formatMoney(row.usedAmount) : mode === 'remaining' ? formatMoney(row.remainingAmount) : `${row.metricValue} / 100`;
        const color = mode === 'used' ? 'accent' : mode === 'remaining' ? 'success' : row.healthMeta.color;
        return <div className="flex w-full flex-col gap-1"><strong>{label}</strong><ProgressBar color={color} value={Math.round(percent)} minValue={0} maxValue={100} aria-label={label}><ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track></ProgressBar></div>;
      },
    },
    { id: 'latest_display_quota', title: '当前余额', width: 120, render: (row) => row.billing_mode === 'postpaid' ? '-' : formatMoney(row.latest_display_quota) },
    { id: 'today_request_count', title: '今日请求', width: 110, render: (row) => formatNumber(row.today_request_count) },
    { id: 'latest_request_count', title: '累计请求', width: 110, render: (row) => formatNumber(row.latest_request_count) },
    { id: 'last_sync_at', title: '最近同步', width: 180, render: (row) => formatDateTime(row.last_sync_at) },
  ];

  return <DataTable rows={rows} columns={columns} rowKey={(row) => row.instance_id} minWidth={900} ariaLabel="实例概览" />;
}
