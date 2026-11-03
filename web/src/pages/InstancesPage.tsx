import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { getErrorMessage } from '../api/client';
import {
  createInstance,
  createInstancesBatch,
  deleteInstancesBatch,
  fetchInstanceBalanceHistory,
  fetchInstances,
  syncInstance,
  updateInstance,
  updateInstancesBatch,
} from '../api/instances';
import { fetchAppSettings } from '../api/settings';
import { InstanceBatchModal } from '../components/InstanceBatchModal';
import { InstanceCreateModal } from '../components/InstanceCreateModal';
import { SyncProgressModal, type SyncProgressItem } from '../components/SyncProgressModal';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmPopover,
  DataTable,
  DescriptionList,
  Input,
  MultiSelect,
  PageHeader,
  SelectField,
  StarRating,
  StatCard,
  StatusBadge,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui';
import type { DataTableColumn, DataTableSort } from '../components/ui';
import { notify } from '../lib/toast';
import { cn } from '../lib/utils';
import type { BatchInstanceUpdatePayload, Instance, InstanceCreatePayload, InstanceQuery, InstanceUpdatePayload } from '../types/api';
import { runBatchSyncWithConcurrency } from '../utils/batchSync';
import { formatBillingMode, formatMoney, formatNumber, formatProgramType, formatShortDateTime } from '../utils/format';

interface SyncProgressState {
  open: boolean;
  running: boolean;
  total: number;
  completed: number;
  successCount: number;
  failedCount: number;
  activeNames: string[];
  items: SyncProgressItem[];
}

const INITIAL_PROGRESS: SyncProgressState = { open: false, running: false, total: 0, completed: 0, successCount: 0, failedCount: 0, activeNames: [], items: [] };
const PAGE_SIZE_OPTIONS = [30, 50, 100, 1000];

function healthDotClass(status?: string | null): string {
  if (status === 'healthy') return 'bg-emerald-500';
  if (status === 'unhealthy') return 'bg-destructive';
  if (status === 'degraded') return 'bg-amber-500';
  return 'bg-muted-foreground/50';
}

function balanceClass(value?: number | null) {
  if (value == null) return 'text-muted-foreground';
  if (value < 20) return 'text-destructive';
  if (value < 100) return 'text-amber-600 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

function buildUpdate(instance: Instance, overrides: Partial<InstanceUpdatePayload> = {}): InstanceUpdatePayload {
  return {
    name: instance.name,
    remark: instance.remark,
    base_url: instance.base_url,
    program_type: instance.program_type,
    username: instance.username,
    remote_user_id: instance.remote_user_id,
    access_token: '',
    proxy_mode: instance.proxy_mode,
    socks5_proxy_url: instance.socks5_proxy_url ?? '',
    enabled: instance.enabled,
    balance_alert_enabled: instance.balance_alert_enabled,
    balance_alert_threshold: instance.balance_alert_threshold,
    notification_channel_ids: instance.notification_channel_ids,
    notification_channel_group_ids: instance.notification_channel_group_ids ?? [],
    notify_rate_changes: instance.notify_rate_changes ?? true,
    notify_announcements: instance.notify_announcements ?? true,
    billing_mode: instance.billing_mode,
    quota_per_unit: instance.quota_per_unit,
    priority: instance.priority,
    sync_interval_minutes: instance.sync_interval_minutes,
    tags: instance.tags,
    ...overrides,
  };
}

function UsageTrend({ points }: { points: Instance['last_7d_usage'] }) {
  const values = points.map((point) => point.used_display_amount);
  const requests = points.map((point) => point.request_count);
  const max = Math.max(...values, 0.0001);
  const total = values.reduce((sum, value) => sum + value, 0);
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <strong className="text-sm">近 7 天用量</strong>
        <span className="text-xs text-muted-foreground">
          消耗 <strong className="text-foreground tabular">{formatMoney(total)}</strong> · 请求{' '}
          <strong className="text-foreground tabular">{formatNumber(requests.reduce((sum, value) => sum + value, 0))}</strong> 次
        </span>
      </div>
      {points.length ? (
        <div className="flex items-end gap-2">
          {points.map((point, index) => (
            <div key={`${point.date}-${index}`} className="group flex min-w-0 flex-1 flex-col items-center gap-1.5" title={`${point.date}：${formatMoney(point.used_display_amount)} / ${point.request_count} 次`}>
              <span className="whitespace-nowrap text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 tabular">
                {formatMoney(point.used_display_amount)}
              </span>
              <div className="flex h-24 w-full items-end overflow-hidden rounded bg-muted/60">
                <div
                  className="w-full rounded bg-primary/80 transition-all group-hover:bg-primary"
                  style={{ height: `${Math.max((point.used_display_amount / max) * 100, 2)}%` }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground">{point.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-6 text-center text-sm text-muted-foreground">暂无近 7 天数据</div>
      )}
    </div>
  );
}

function BalanceTrend({ instanceId }: { instanceId: number }) {
  const { data: points } = useQuery({ queryKey: ['balance-history', instanceId], queryFn: () => fetchInstanceBalanceHistory(instanceId, 30), staleTime: 60_000 });
  const items = (points ?? []).filter((item) => item.balance !== null);
  if (!items.length) return null;
  const values = items.map((item) => item.balance ?? 0);
  const max = Math.max(...values, 0.0001);
  const latest = values[values.length - 1];
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <strong className="text-sm">近 30 天余额</strong>
        <span className="text-xs text-muted-foreground">
          当前 <strong className="text-foreground tabular">{formatMoney(latest)}</strong> · {items.length} 个快照
        </span>
      </div>
      <div className="flex items-end gap-1">
        {items.map((item, index) => (
          <div key={index} className="group flex min-w-0 flex-1 flex-col items-center" title={`${item.snapshot_at.slice(0, 16).replace('T', ' ')}：${formatMoney(item.balance)}`}>
            <div className="flex h-24 w-full items-end overflow-hidden rounded-sm bg-muted/60">
              <div
                className="w-full rounded-sm bg-emerald-500/70 transition-all group-hover:bg-emerald-500"
                style={{ height: `${Math.max((Number(item.balance) / max) * 100, 2)}%` }}
              />
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

export function InstancesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [billingMode, setBillingMode] = useState<string>('all');
  const [enabled, setEnabled] = useState<string>('all');
  const [healthStatus, setHealthStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [sort, setSort] = useState<DataTableSort>({ column: 'last_sync_at', direction: 'descending' });
  const [selected, setSelected] = useState<Set<number | string>>(new Set());
  const [expanded, setExpanded] = useState<Set<number | string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [batchCreateOpen, setBatchCreateOpen] = useState(false);
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [editing, setEditing] = useState<Instance | null>(null);
  const [progress, setProgress] = useState<SyncProgressState>(INITIAL_PROGRESS);

  const filters = useMemo<InstanceQuery>(() => ({
    search: search.trim() || undefined,
    tags: selectedTags.length ? selectedTags : undefined,
    billing_mode: billingMode === 'all' ? undefined : (billingMode as InstanceQuery['billing_mode']),
    enabled: enabled === 'all' ? undefined : enabled === 'true',
    health_status: healthStatus === 'all' ? undefined : healthStatus,
  }), [billingMode, enabled, healthStatus, search, selectedTags]);

  useEffect(() => {
    setPage(1);
  }, [filters]);

  const { data: allData } = useQuery({ queryKey: ['instances'], queryFn: () => fetchInstances() });
  const { data, isLoading } = useQuery({ queryKey: ['instances', filters, page, pageSize, sort], queryFn: () => fetchInstances(filters) });
  const { data: settings } = useQuery({ queryKey: ['app-settings'], queryFn: fetchAppSettings });

  const refresh = async () => {
    await Promise.all(
      ['instances', 'dashboard-overview', 'dashboard-trends', 'groups', 'pricing-models', 'sync-runs', 'app-settings', 'rate-changes', 'announcements']
        .map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
      notify.success('数据已刷新');
    } catch {
      notify.error('刷新失败，请稍后重试');
    } finally {
      setRefreshing(false);
    }
  };

  const syncMutation = useMutation({ mutationFn: syncInstance, onSuccess: async () => { await refresh(); notify.success('实例同步完成'); }, onError: (error) => notify.error(getErrorMessage(error)) });
  const createMutation = useMutation({
    mutationFn: createInstance,
    onSuccess: async (item) => { setCreateOpen(false); notify.success('实例创建成功'); await refresh(); void autoSync([item]); },
    onError: (error) => notify.error(getErrorMessage(error)),
  });
  const batchCreateMutation = useMutation({
    mutationFn: createInstancesBatch,
    onSuccess: async (result) => { setBatchCreateOpen(false); notify.success(`批量新增完成，共创建 ${result.count} 个实例`); await refresh(); void autoSync(result.items); },
    onError: (error) => notify.error(getErrorMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: InstanceUpdatePayload }) => updateInstance(id, payload),
    onSuccess: async () => { setEditing(null); await refresh(); notify.success('实例更新成功'); },
    onError: (error) => notify.error(getErrorMessage(error)),
  });
  const batchUpdateMutation = useMutation({
    mutationFn: updateInstancesBatch,
    onSuccess: async (result) => { setBatchEditOpen(false); setSelected(new Set()); await refresh(); notify.success(`批量更新完成，共更新 ${result.count} 个实例`); },
    onError: (error) => notify.error(getErrorMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteInstancesBatch,
    onSuccess: async (result) => { setSelected(new Set()); await refresh(); notify.success(`批量删除完成，共删除 ${result.count} 个实例`); },
    onError: (error) => notify.error(getErrorMessage(error)),
  });

  const autoSync = async (items: Instance[]) => {
    if (!items.length) return;
    notify.info(`正在自动同步 ${items.length} 个新实例…`);
    const results = await Promise.allSettled(items.map((item) => syncInstance(item.id)));
    const failures = results.filter((result) => result.status === 'rejected').length;
    if (failures) notify.warning(`实例已创建，但自动同步失败 ${failures} 个，请稍后手动同步`);
    else notify.success('新增实例已自动完成首次同步');
    await refresh();
  };

  const runBatch = async (targets: Array<{ id: number; name: string }>) => {
    if (!targets.length) { notify.info('当前筛选下没有可同步的启用实例'); return; }
    setProgress({ open: true, running: true, total: targets.length, completed: 0, successCount: 0, failedCount: 0, activeNames: [], items: targets.map((item) => ({ key: item.id, name: item.name, status: 'pending' })) });
    try {
      const result = await runBatchSyncWithConcurrency({
        targets,
        maxWorkers: settings?.sync_max_workers ?? 5,
        syncOne: syncInstance,
        onStateChange: (state) => setProgress({ open: true, total: targets.length, ...state }),
      });
      await refresh();
      if (result.failedCount) notify.warning(`同步完成：成功 ${result.successCount}，失败 ${result.failedCount}，并发 ${settings?.sync_max_workers ?? 5}`);
      else notify.success(`已完成 ${result.successCount} 个实例同步，并发 ${settings?.sync_max_workers ?? 5}`);
    } catch (error) {
      setProgress((current) => ({ ...current, running: false, activeNames: [] }));
      notify.error(getErrorMessage(error));
    }
  };

  const tagOptions = useMemo(() => Array.from(new Set((allData?.items ?? []).flatMap((item) => item.tags))).sort().map((value) => ({ label: value, value })), [allData]);
  const channelOptions = useMemo(() => (settings?.notification_channels ?? []).filter((item) => item.enabled).map((item) => ({ label: item.name, value: item.id })), [settings]);
  const channelGroupOptions = useMemo(() => (settings?.notification_channel_groups ?? []).map((item) => ({ label: `${item.name}（${item.channel_ids.length} 个渠道）`, value: item.id })), [settings]);
  const selectedInstances = useMemo(() => (data?.items ?? []).filter((item) => selected.has(item.id)), [data, selected]);
  const syncTargets = useMemo(() => (data?.items ?? []).filter((item) => item.enabled).map((item) => ({ id: item.id, name: item.name })), [data]);
  const summary = useMemo(
    () => (data?.items ?? []).reduce(
      (acc, item) => ({
        count: acc.count + 1,
        enabled: acc.enabled + Number(item.enabled),
        healthy: acc.healthy + Number(item.last_health_status === 'healthy'),
        postpaid: acc.postpaid + Number(item.billing_mode === 'postpaid'),
        balance: acc.balance + (item.latest_display_quota ?? 0),
        requests: acc.requests + (item.today_request_count ?? 0),
      }),
      { count: 0, enabled: 0, healthy: 0, postpaid: 0, balance: 0, requests: 0 },
    ),
    [data],
  );

  const rows = useMemo(() => {
    const list = [...(data?.items ?? [])];
    const direction = sort.direction === 'ascending' ? 1 : -1;
    return list.sort((left, right) => {
      const a = left[sort.column as keyof Instance];
      const b = right[sort.column as keyof Instance];
      if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, 'zh-Hans-CN') * direction;
      return ((Number(a) || 0) - (Number(b) || 0)) * direction;
    });
  }, [data, sort]);

  const syncOne = (item: Instance) => {
    if (syncMutation.isPending) return;
    notify.info(`正在同步「${item.name}」…`);
    syncMutation.mutate(item.id);
  };

  const columns: DataTableColumn<Instance>[] = [
    { id: 'priority', header: '优先级', width: 72, sortable: true, cell: (item) => <StarRating value={item.priority} size={13} /> },
    {
      id: 'name',
      header: '实例',
      width: 220,
      sortable: true,
      cell: (item) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className={cn('size-1.5 shrink-0 rounded-full', healthDotClass(item.last_health_status))} />
            <strong className="truncate">{item.name}</strong>
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {item.username ? `${item.username} · ` : ''}
            {formatProgramType(item.program_type)} · {formatBillingMode(item.billing_mode)}
            {item.auto_disabled ? ' · 系统禁用' : ''}
          </span>
        </div>
      ),
    },
    {
      id: 'latest_display_quota',
      header: '当前余额',
      width: 96,
      align: 'right',
      sortable: true,
      cell: (item) => (item.billing_mode === 'postpaid' ? <span className="text-muted-foreground">-</span> : <span className={cn('tabular font-medium', balanceClass(item.latest_display_quota))}>{formatMoney(item.latest_display_quota)}</span>),
    },
    {
      id: 'today_display_used_amount',
      header: '今日',
      width: 104,
      align: 'right',
      sortable: true,
      cell: (item) => (
        <div className="flex flex-col items-end gap-0.5">
          <strong className="tabular">{formatMoney(item.today_display_used_amount)}</strong>
          <span className="text-xs text-muted-foreground tabular">{formatNumber(item.today_request_count)} 次</span>
        </div>
      ),
    },
    {
      id: 'last_7d_display_used_amount',
      header: '近 7 日',
      width: 104,
      align: 'right',
      sortable: true,
      cell: (item) => (
        <div className="flex flex-col items-end gap-0.5">
          <span className="tabular">{formatMoney(item.last_7d_display_used_amount)}</span>
          <span className="text-xs text-muted-foreground tabular">{formatNumber(item.last_7d_request_count)} 次</span>
        </div>
      ),
    },
    { id: 'last_sync_at', header: '最近同步', width: 104, sortable: true, cell: (item) => <span className="text-muted-foreground tabular">{formatShortDateTime(item.last_sync_at)}</span> },
    { id: 'remark', header: '备注', width: 110, cell: (item) => <span className="text-muted-foreground">{item.remark || '-'}</span> },
    {
      id: 'balance_alert_enabled',
      header: '余额告警',
      width: 84,
      align: 'center',
      cell: (item) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Switch
                checked={item.balance_alert_enabled}
                aria-label="余额告警"
                onCheckedChange={(value) => updateMutation.mutate({ id: item.id, payload: buildUpdate(item, { balance_alert_enabled: value }) })}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {item.balance_alert_enabled
              ? `余额 ≤ ${formatMoney(item.effective_balance_alert_threshold)} 时通知${item.notification_channel_ids.length ? '指定渠道' : '默认渠道'}`
              : '开启后使用全局默认阈值，可在编辑实例里自定义'}
          </TooltipContent>
        </Tooltip>
      ),
    },
    {
      id: 'actions',
      header: '操作',
      width: 152,
      cell: (item) => (
        <div className="flex items-center gap-0.5">
          <Switch
            checked={item.enabled}
            aria-label="启用状态"
            onCheckedChange={(value) => updateMutation.mutate({ id: item.id, payload: buildUpdate(item, { enabled: value }) })}
          />
          <Button variant="ghost" size="icon-sm" aria-label="打开站点" onClick={() => window.open(item.base_url, '_blank', 'noopener,noreferrer')}>
            <ArrowUpRight className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="编辑实例" onClick={() => setEditing(item)}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="同步实例" isPending={syncMutation.isPending && syncMutation.variables === item.id} onClick={() => syncOne(item)}>
            <RotateCw className="size-4" />
          </Button>
        </div>
      ),
    },
  ];

  const toggleExpanded = (id: number | string) =>
    setExpanded((keys) => {
      const next = new Set(keys);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const resetFilters = () => {
    setSearch('');
    setSelectedTags([]);
    setBillingMode('all');
    setEnabled('all');
    setHealthStatus('all');
    setSelected(new Set());
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="实例管理"
        subtitle="集中管理所有被监控的上游站点；单击行展开详情，双击行同步。"
        extra={
          <>
            <Button variant="outline" isPending={refreshing} onClick={() => void handleRefresh()}>
              <RefreshCw className="size-4" />
              刷新
            </Button>
            <Button variant="default" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              新增实例
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="实例总数" value={formatNumber(summary.count)} />
        <StatCard label="启用实例" value={formatNumber(summary.enabled)} />
        <StatCard label="健康实例" value={formatNumber(summary.healthy)} />
        <StatCard label="后付费实例" value={formatNumber(summary.postpaid)} />
        <StatCard label="预付费余额" value={formatMoney(summary.balance)} />
        <StatCard label="今日请求数" value={formatNumber(summary.requests)} />
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>实例列表</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" isPending={progress.running} onClick={() => void runBatch(syncTargets)}>
                <RotateCw className="size-4" />
                同步全部（{syncTargets.length}）
              </Button>
              <Button variant="outline" size="sm" onClick={() => setBatchCreateOpen(true)}>
                <Plus className="size-4" />
                批量新增
              </Button>
              <Button variant="outline" size="sm" disabled={!selectedInstances.length} onClick={() => setBatchEditOpen(true)}>
                <Pencil className="size-4" />
                批量编辑
              </Button>
              <ConfirmPopover
                title={`删除选中的 ${selectedInstances.length} 个实例？`}
                description="将同时清理其快照、倍率、日志等关联数据，不可恢复。"
                confirmText="删除"
                onConfirm={() => deleteMutation.mutateAsync(selectedInstances.map((item) => item.id))}
              >
                <Button variant="outline" size="sm" className="text-destructive" disabled={!selectedInstances.length}>
                  <Trash2 className="size-4" />
                  批量删除
                </Button>
              </ConfirmPopover>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="relative w-60">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="搜索实例名、地址、用户名" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <MultiSelect className="w-48" options={tagOptions} value={selectedTags} onChange={setSelectedTags} placeholder="按标签筛选" />
            <SelectField className="w-36" value={billingMode} onValueChange={setBillingMode} options={[{ value: 'all', label: '全部计费' }, { value: 'prepaid', label: '预付费' }, { value: 'postpaid', label: '后付费' }]} />
            <SelectField className="w-32" value={enabled} onValueChange={setEnabled} options={[{ value: 'all', label: '全部状态' }, { value: 'true', label: '启用' }, { value: 'false', label: '停用' }]} />
            <SelectField className="w-32" value={healthStatus} onValueChange={setHealthStatus} options={[{ value: 'all', label: '全部健康' }, { value: 'healthy', label: '健康' }, { value: 'unhealthy', label: '异常' }, { value: 'degraded', label: '降级' }, { value: 'unknown', label: '未知' }]} />
            <Button variant="ghost" size="sm" onClick={resetFilters} disabled={!search && !selectedTags.length && billingMode === 'all' && enabled === 'all' && healthStatus === 'all'}>
              <X className="size-4" />
              清空筛选
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(item) => item.id}
            loading={isLoading}
            dense
            ariaLabel="实例列表"
            minWidth={1180}
            sort={sort}
            onSortChange={setSort}
            selectedKeys={selected}
            onSelectionChange={setSelected}
            onRowDoubleClick={(item) => syncOne(item)}
            expandable={{
              expandedKeys: expanded,
              onToggle: toggleExpanded,
              render: (item) => (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <DescriptionList columns={1} items={[
                      { label: '实例地址', value: <a className="break-all text-primary hover:underline" href={item.base_url} target="_blank" rel="noreferrer">{item.base_url}</a> },
                      { label: '备注', value: item.remark || '-' },
                      { label: '认证信息', value: item.username ? `用户：${item.username}` : `远端用户 ID：${item.remote_user_id ?? '-'}` },
                      { label: '程序类型', value: formatProgramType(item.program_type) },
                    ]} />
                    <DescriptionList columns={1} items={[
                      { label: '启停来源', value: item.enabled ? '已启用' : item.auto_disabled ? '系统自动禁用（定时同步会继续探测）' : '手动禁用' },
                      { label: 'Session / Token', value: item.has_access_token ? 'Access Token' : '-' },
                      { label: '当前分组', value: item.latest_group_name || '-' },
                      { label: '同步周期', value: `${item.sync_interval_minutes} 分钟` },
                    ]} />
                    <DescriptionList columns={1} items={[
                      { label: '兑换比', value: formatNumber(item.quota_per_unit) },
                      { label: '周期已用', value: formatMoney(item.latest_display_used_quota) },
                      { label: '累计请求数', value: formatNumber(item.latest_request_count) },
                      { label: '最近更新', value: formatShortDateTime(item.updated_at) },
                    ]} />
                  </div>
                  {item.last_health_error ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-muted-foreground">
                      <span className="font-medium text-destructive">最近错误：</span>
                      {item.last_health_error}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <UsageTrend points={item.last_7d_usage ?? []} />
                    <BalanceTrend instanceId={item.id} />
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(item)}>
                      <Pencil className="size-4" />
                      编辑
                    </Button>
                    <Button size="sm" onClick={() => syncOne(item)}>
                      <RotateCw className="size-4" />
                      同步
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleExpanded(item.id)}>
                      <X className="size-4" />
                      收起
                    </Button>
                  </div>
                </div>
              ),
            }}
            pagination={{
              page,
              pageSize,
              total: data?.total ?? 0,
              onPageChange: setPage,
              onPageSizeChange: (size) => { setPageSize(size); setPage(1); },
              pageSizeOptions: PAGE_SIZE_OPTIONS,
              persistenceKey: 'instances',
            }}
          />
        </CardContent>
      </Card>

      <InstanceCreateModal
        open={createOpen}
        loading={createMutation.isPending}
        mode="create"
        defaultSyncIntervalMinutes={settings?.default_sync_interval_minutes ?? 120}
        defaultProxyMode={settings?.default_instance_proxy_mode ?? 'direct'}
        tagOptions={tagOptions}
        notificationChannelOptions={channelOptions}
        notificationChannelGroupOptions={channelGroupOptions}
        onCancel={() => setCreateOpen(false)}
        onSubmit={(values) => createMutation.mutate(values as InstanceCreatePayload)}
      />
      <InstanceCreateModal
        open={Boolean(editing)}
        loading={updateMutation.isPending}
        mode="edit"
        initialValues={editing}
        defaultSyncIntervalMinutes={settings?.default_sync_interval_minutes ?? 120}
        tagOptions={tagOptions}
        notificationChannelOptions={channelOptions}
        notificationChannelGroupOptions={channelGroupOptions}
        onCancel={() => setEditing(null)}
        onSubmit={(values) => { if (editing) updateMutation.mutate({ id: editing.id, payload: values as InstanceUpdatePayload }); }}
      />
      <InstanceBatchModal
        open={batchCreateOpen}
        loading={batchCreateMutation.isPending}
        mode="create"
        defaultSyncIntervalMinutes={settings?.default_sync_interval_minutes ?? 120}
        defaultProxyMode={settings?.default_instance_proxy_mode ?? 'direct'}
        tagOptions={tagOptions}
        notificationChannelOptions={channelOptions}
        notificationChannelGroupOptions={channelGroupOptions}
        onCancel={() => setBatchCreateOpen(false)}
        onSubmit={(items) => batchCreateMutation.mutate(items as InstanceCreatePayload[])}
      />
      <InstanceBatchModal
        open={batchEditOpen}
        loading={batchUpdateMutation.isPending}
        mode="edit"
        initialItems={selectedInstances}
        tagOptions={tagOptions}
        notificationChannelOptions={channelOptions}
        notificationChannelGroupOptions={channelGroupOptions}
        onCancel={() => setBatchEditOpen(false)}
        onSubmit={(items) => batchUpdateMutation.mutate(items as BatchInstanceUpdatePayload[])}
      />
      <SyncProgressModal
        open={progress.open}
        title="实例批量同步"
        running={progress.running}
        total={progress.total}
        completed={progress.completed}
        successCount={progress.successCount}
        failedCount={progress.failedCount}
        activeNames={progress.activeNames}
        items={progress.items}
        onRetryFailed={(items) => void runBatch(items.map((item) => ({ id: Number(item.key), name: item.name })))}
        onClose={() => setProgress(INITIAL_PROGRESS)}
      />
    </div>
  );
}
