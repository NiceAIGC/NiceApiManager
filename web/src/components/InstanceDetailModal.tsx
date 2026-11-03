import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Pencil, RotateCw } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { fetchInstanceBalanceHistory, fetchInstanceInsights } from '../api/instances';
import {
  AppModal,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  EmptyState,
  Skeleton,
  StatusBadge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui';
import type { DataTableColumn } from './ui';
import { cn } from '../lib/utils';
import type { Instance } from '../types/api';
import type { InstanceInsightAnnouncement, InstanceInsightGroup, InstanceInsightRateChange, InstanceInsightUsageRow } from '../api/instances';
import { formatDateTime, formatMoney, formatNumber, formatProgramType, formatShortDateTime } from '../utils/format';
import { formatClock, formatRatio } from '../utils/pricing';

const CHANGE_META: Record<InstanceInsightRateChange['change_type'], { label: string; tone: 'success' | 'destructive' | 'warning' }> = {
  added: { label: '新增', tone: 'success' },
  removed: { label: '删除', tone: 'destructive' },
  changed: { label: '变动', tone: 'warning' },
};

function Section({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold">{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

function UsageBars({ points }: { points: Instance['last_7d_usage'] }) {
  const max = Math.max(...points.map((point) => point.used_display_amount), 0.0001);
  const total = points.reduce((sum, point) => sum + point.used_display_amount, 0);
  const requests = points.reduce((sum, point) => sum + point.request_count, 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-muted-foreground">
        7 日消耗 <strong className="text-foreground tabular">{formatMoney(total)}</strong> · 请求{' '}
        <strong className="text-foreground tabular">{formatNumber(requests)}</strong> 次
      </div>
      <div className="flex items-end gap-2">
        {points.map((point, index) => (
          <div key={`${point.date}-${index}`} className="group flex min-w-0 flex-1 flex-col items-center gap-1" title={`${point.date}：${formatMoney(point.used_display_amount)}`}>
            <div className="flex h-20 w-full items-end overflow-hidden rounded bg-muted/60">
              <div className="w-full rounded bg-primary/75 transition-colors group-hover:bg-primary" style={{ height: `${Math.max((point.used_display_amount / max) * 100, 2)}%` }} />
            </div>
            <span className="text-[11px] text-muted-foreground">{point.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BalanceBars({ instanceId }: { instanceId: number }) {
  const { data, isLoading } = useQuery({ queryKey: ['balance-history', instanceId], queryFn: () => fetchInstanceBalanceHistory(instanceId, 30), staleTime: 60_000 });
  const items = (data ?? []).filter((item) => item.balance !== null);
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!items.length) return <p className="m-0 text-xs text-muted-foreground">暂无余额快照</p>;
  const max = Math.max(...items.map((item) => item.balance ?? 0), 0.0001);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-muted-foreground">
        当前余额 <strong className="text-foreground tabular">{formatMoney(items[items.length - 1]?.balance)}</strong> · {items.length} 个快照
      </div>
      <div className="flex items-end gap-1">
        {items.map((item, index) => (
          <div key={index} className="group flex min-w-0 flex-1 items-end" title={`${item.snapshot_at.slice(0, 16).replace('T', ' ')}：${formatMoney(item.balance)}`}>
            <div className="flex h-20 w-full items-end overflow-hidden rounded-sm bg-muted/60">
              <div className="w-full rounded-sm bg-emerald-500/70 group-hover:bg-emerald-500" style={{ height: `${Math.max((Number(item.balance) / max) * 100, 2)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{items[0]?.snapshot_at.slice(0, 10)}</span>
        <span>{items[items.length - 1]?.snapshot_at.slice(0, 10)}</span>
      </div>
    </div>
  );
}

function AnnouncementList({ items }: { items: InstanceInsightAnnouncement[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (!items.length) return <p className="m-0 text-xs text-muted-foreground">暂无已同步公告</p>;
  return (
    <div className="flex flex-col divide-y rounded-lg border">
      {items.slice(0, 10).map((item) => (
        <div key={item.id} className="px-3 py-2">
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left"
            onClick={() => setOpenId((current) => (current === item.id ? null : item.id))}
          >
            <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{formatShortDateTime(item.published_at || item.synced_at)}</span>
          </button>
          {openId === item.id ? <p className="m-0 mt-1.5 whitespace-pre-wrap break-words text-xs text-muted-foreground">{item.content || '（无正文）'}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function InstanceDetailModal({
  instance,
  open,
  onOpenChange,
  onEdit,
  onSync,
  syncing,
}: {
  instance: Instance | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (instance: Instance) => void;
  onSync: (instance: Instance) => void;
  syncing?: boolean;
}) {
  const instanceId = instance?.id ?? 0;
  const { data: insights, isLoading } = useQuery({
    queryKey: ['instance-insights', instanceId],
    queryFn: () => fetchInstanceInsights(instanceId, 7),
    enabled: open && Boolean(instance),
    staleTime: 30_000,
  });

  const groupColumns: Array<DataTableColumn<InstanceInsightGroup>> = [
    {
      id: 'group_name',
      header: '分组',
      cell: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{row.group_name}</span>
          {row.labels.length ? (
            <span className="flex flex-wrap gap-1">{row.labels.map((label) => <Badge key={label} variant="secondary">{label}</Badge>)}</span>
          ) : null}
        </div>
      ),
    },
    { id: 'desc', header: '说明', cell: (row) => row.group_desc || <span className="text-muted-foreground">-</span> },
    {
      id: 'platform',
      header: '平台/个人',
      width: 140,
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.platform ? <Badge variant="muted">{row.platform}</Badge> : null}
          {row.user_ratio != null ? <Badge variant="warning">个人 ×{Number.parseFloat(row.user_ratio.toFixed(3))}</Badge> : null}
        </span>
      ),
    },
    {
      id: 'peak',
      header: '高峰时段',
      width: 176,
      cell: (row) => (row.peak_start && row.peak_end ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span><Badge variant="warning">{formatClock(row.peak_start)}–{formatClock(row.peak_end)} ×{Number.parseFloat((row.peak_ratio ?? 1).toFixed(2))}</Badge></span>
          </TooltipTrigger>
          <TooltipContent>高峰时段整单消耗额外乘 {Number.parseFloat((row.peak_ratio ?? 1).toFixed(4))} 倍</TooltipContent>
        </Tooltip>
      ) : <span className="text-muted-foreground">-</span>),
    },
    { id: 'ratio', header: '消费倍率', width: 100, align: 'right', cell: (row) => <span className="tabular font-medium">{formatRatio(row.ratio)}</span> },
  ];

  const modelColumns: Array<DataTableColumn<InstanceInsightUsageRow>> = [
    { id: 'name', header: '模型', cell: (row) => row.model_name ?? row.group_name ?? '-' },
    { id: 'requests', header: '请求数', width: 100, align: 'right', cell: (row) => <span className="tabular">{formatNumber(row.requests)}</span> },
    { id: 'amount', header: '消耗额度', width: 120, align: 'right', cell: (row) => <span className="tabular">{formatMoney(row.used_amount)}</span> },
  ];

  return (
    <AppModal
      open={open}
      onOpenChange={onOpenChange}
      title={instance ? instance.name : '实例详情'}
      description={instance ? `${formatProgramType(instance.program_type)} · ${instance.base_url}` : undefined}
      size="xl"
      footer={
        instance ? (
          <>
            <Button variant="outline" onClick={() => window.open(instance.base_url, '_blank', 'noopener,noreferrer')}>
              <ArrowUpRight className="size-4" />
              打开站点
            </Button>
            <Button variant="outline" onClick={() => onEdit(instance)}>
              <Pencil className="size-4" />
              编辑
            </Button>
            <Button isPending={syncing} onClick={() => onSync(instance)}>
              <RotateCw className="size-4" />
              立即同步
            </Button>
          </>
        ) : null
      }
    >
      {instance ? (
        <div className="flex flex-col gap-5">
          {/* 概览 */}
          <Section title="概览" extra={<StatusBadge status={instance.last_health_status} />}>
            <DescriptionList
              columns={3}
              items={[
                { label: '实例地址', value: <a className="break-all text-primary hover:underline" href={instance.base_url} target="_blank" rel="noreferrer">{instance.base_url}</a> },
                { label: '认证信息', value: instance.username ? `用户：${instance.username}` : `远端用户 ID：${instance.remote_user_id ?? '-'}` },
                { label: '标签', value: instance.tags.length ? <span className="flex flex-wrap gap-1">{instance.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</span> : '-' },
                { label: '备注', value: instance.remark || '-' },
                { label: '启停来源', value: instance.enabled ? '已启用' : instance.auto_disabled ? '系统自动禁用' : '手动禁用' },
                { label: '同步周期', value: `${instance.sync_interval_minutes} 分钟` },
                { label: '最近同步', value: formatDateTime(instance.last_sync_at) },
                { label: '兑换比', value: formatNumber(instance.quota_per_unit) },
                { label: '当前分组', value: instance.latest_group_name || '-' },
                { label: '累计请求', value: formatNumber(instance.latest_request_count) },
                { label: '周期已用', value: formatMoney(instance.latest_display_used_quota) },
                { label: '今日 / 近 7 日', value: `${formatMoney(instance.today_display_used_amount)} / ${formatMoney(instance.last_7d_display_used_amount)}` },
              ]}
            />
            {instance.last_health_error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-destructive">最近错误：</span>
                {instance.last_health_error}
              </div>
            ) : null}
          </Section>

          {/* 用量 */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="近 7 天用量"><UsageBars points={instance.last_7d_usage ?? []} /></Section>
            <Section title="近 30 天余额"><BalanceBars instanceId={instance.id} /></Section>
          </div>

          {/* 模型 / 分组消耗 */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="模型消耗 Top（近 7 天）">
              {isLoading ? <Skeleton className="h-24 w-full" /> : insights?.model_usage?.length ? (
                <DataTable rows={insights.model_usage} columns={modelColumns} rowKey={(row) => row.model_name ?? row.group_name ?? ''} dense className="text-xs" />
              ) : (
                <p className="m-0 text-xs text-muted-foreground">{insights?.usage_error ? `上游明细不可用：${insights.usage_error}` : '上游暂无模型消耗明细'}</p>
              )}
            </Section>
            <Section title="分组消耗 Top（近 7 天）">
              {isLoading ? <Skeleton className="h-24 w-full" /> : insights?.group_usage?.length ? (
                <DataTable rows={insights.group_usage} columns={modelColumns} rowKey={(row) => row.group_name ?? ''} dense className="text-xs" />
              ) : (
                <p className="m-0 text-xs text-muted-foreground">上游日志未提供分组维度（Sub2API 仅提供模型维度）</p>
              )}
            </Section>
          </div>

          {/* 倍率信息 */}
          <Section title="分组倍率" extra={<span className="text-xs text-muted-foreground">共 {insights?.groups.length ?? 0} 个分组</span>}>
            {isLoading ? <Skeleton className="h-24 w-full" /> : insights?.groups?.length ? (
              <DataTable rows={insights.groups} columns={groupColumns} rowKey={(row) => `${row.group_name}-${row.platform ?? ''}`} dense className="text-xs" />
            ) : (
              <EmptyState title="暂无分组倍率" description="同步一次实例即可拉取分组倍率。" className="py-6" />
            )}
          </Section>

          {/* 倍率变更 */}
          <Section title="最近倍率变更">
            {isLoading ? <Skeleton className="h-16 w-full" /> : insights?.rate_changes?.length ? (
              <div className="flex flex-col divide-y rounded-lg border">
                {insights.rate_changes.slice(0, 10).map((event) => (
                  <div key={event.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <StatusBadge tone={CHANGE_META[event.change_type].tone}>{CHANGE_META[event.change_type].label}</StatusBadge>
                    <span className="min-w-0 flex-1 truncate">{event.group_name}{event.platform ? `（${event.platform}）` : ''}</span>
                    <span className="shrink-0 text-xs tabular text-muted-foreground">
                      {event.change_type === 'added' ? `新倍率 ${event.new_ratio}`
                        : event.change_type === 'removed' ? `原倍率 ${event.old_ratio}`
                          : `${event.old_ratio} → ${event.new_ratio}${event.change_percent != null ? `（${event.change_percent > 0 ? '+' : ''}${event.change_percent.toFixed(1)}%）` : ''}`}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatShortDateTime(event.detected_at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="m-0 text-xs text-muted-foreground">暂无倍率变更记录</p>
            )}
          </Section>

          {/* 公告 */}
          <Section title="上游公告">
            {isLoading ? <Skeleton className="h-16 w-full" /> : <AnnouncementList items={insights?.announcements ?? []} />}
          </Section>
        </div>
      ) : null}
    </AppModal>
  );
}
