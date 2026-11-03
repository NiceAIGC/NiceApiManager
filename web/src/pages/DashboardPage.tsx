import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Database, Gauge, HeartPulse, RefreshCw, RotateCcw, Search, TrendingUp, Wallet, X, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';

import { getErrorMessage } from '../api/client';
import { fetchDashboardOverview, fetchDashboardTrends } from '../api/dashboard';
import { fetchInstances, syncInstance } from '../api/instances';
import { fetchAppSettings } from '../api/settings';
import { StackedUsageChart } from '../components/StackedUsageChart';
import { SyncProgressModal, type SyncProgressItem } from '../components/SyncProgressModal';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  MultiSelect,
  NumberField,
  PageHeader,
  SegmentedControl,
  SelectField,
  Skeleton,
  StatCard,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui';
import { notify } from '../lib/toast';
import type { DashboardTrendQuery, InstanceQuery } from '../types/api';
import { formatMoney, formatNumber } from '../utils/format';
import { runBatchSyncWithConcurrency } from '../utils/batchSync';

type TrendMode = '7d' | '15d' | '30d' | 'custom-days' | 'range';

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
const MAX_TREND_DAYS = 31;
const TREND_OPTIONS = [
  { value: '7d', label: '近 7 天' },
  { value: '15d', label: '近 15 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'custom-days', label: '近 N 天' },
  { value: 'range', label: '自定义' },
];
const BILLING_OPTIONS = [{ value: 'all', label: '全部计费' }, { value: 'prepaid', label: '预付费' }, { value: 'postpaid', label: '后付费' }];
const ENABLED_OPTIONS = [{ value: 'all', label: '全部状态' }, { value: 'true', label: '启用' }, { value: 'false', label: '停用' }];
const HEALTH_OPTIONS = [
  { value: 'all', label: '全部健康' },
  { value: 'healthy', label: '健康' },
  { value: 'unhealthy', label: '异常' },
  { value: 'degraded', label: '降级' },
  { value: 'unknown', label: '未知' },
];

function getTrendModeLabel(mode: TrendMode, customDays: number) {
  if (mode === '15d') return '近 15 天';
  if (mode === '30d') return '近 30 天';
  if (mode === 'custom-days') return `近 ${customDays} 天`;
  if (mode === 'range') return '自定义区间';
  return '近 7 天';
}

export function DashboardPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [billingMode, setBillingMode] = useState('all');
  const [enabled, setEnabled] = useState('all');
  const [healthStatus, setHealthStatus] = useState('all');
  const [trendMode, setTrendMode] = useState<TrendMode>('7d');
  const [customTrendDays, setCustomTrendDays] = useState(14);
  const [rangeStart, setRangeStart] = useState(dayjs().subtract(6, 'day').format('YYYY-MM-DD'));
  const [rangeEnd, setRangeEnd] = useState(dayjs().format('YYYY-MM-DD'));
  const [trendBreakdownLimit, setTrendBreakdownLimit] = useState(8);
  const [syncProgress, setSyncProgress] = useState<SyncProgressState>(INITIAL_PROGRESS);

  const filters = useMemo<InstanceQuery>(() => ({
    search: search.trim() || undefined,
    tags: selectedTags.length ? selectedTags : undefined,
    billing_mode: billingMode === 'all' ? undefined : (billingMode as InstanceQuery['billing_mode']),
    enabled: enabled === 'all' ? undefined : enabled === 'true',
    health_status: healthStatus === 'all' ? undefined : healthStatus,
  }), [billingMode, enabled, healthStatus, search, selectedTags]);

  const trendQuery = useMemo<DashboardTrendQuery>(() => {
    const base: DashboardTrendQuery = { ...filters, breakdown_limit: trendBreakdownLimit };
    if (trendMode === 'range') return { ...base, start_date: rangeStart, end_date: rangeEnd };
    if (trendMode === 'custom-days') return { ...base, days: customTrendDays };
    return { ...base, days: trendMode === '15d' ? 15 : trendMode === '30d' ? 30 : 7 };
  }, [customTrendDays, filters, rangeEnd, rangeStart, trendBreakdownLimit, trendMode]);

  const { data: instanceData } = useQuery({ queryKey: ['instances'], queryFn: () => fetchInstances() });
  const { data: appSettings } = useQuery({ queryKey: ['app-settings'], queryFn: fetchAppSettings });
  const { data, isLoading } = useQuery({ queryKey: ['dashboard-overview', filters], queryFn: () => fetchDashboardOverview(filters) });
  const { data: trendData, isLoading: trendsLoading } = useQuery({ queryKey: ['dashboard-trends', trendQuery], queryFn: () => fetchDashboardTrends(trendQuery) });

  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const item of instanceData?.items ?? []) for (const tag of item.tags) tags.add(tag);
    return Array.from(tags).sort().map((tag) => ({ label: tag, value: tag }));
  }, [instanceData]);

  const syncTargets = useMemo(() => (data?.items ?? []).filter((item) => item.enabled).map((item) => ({ id: item.instance_id, name: item.instance_name })), [data?.items]);
  const activeFilterCount = [search.trim().length > 0, selectedTags.length > 0, billingMode !== 'all', enabled !== 'all', healthStatus !== 'all'].filter(Boolean).length;
  const trendSummary = useMemo(() => {
    const points = trendData?.points ?? [];
    const totalUsed = points.reduce((sum, item) => sum + item.used_display_amount, 0);
    const peak = points.reduce<(typeof points)[number] | null>((current, item) => (current && current.used_display_amount >= item.used_display_amount ? current : item), null);
    return { totalUsed, averageUsed: points.length ? totalUsed / points.length : 0, activeDays: points.filter((item) => item.used_display_amount > 0).length, peak };
  }, [trendData]);

  const refreshAll = async () => {
    await Promise.all(
      ['instances', 'dashboard-overview', 'dashboard-trends', 'sync-runs', 'groups', 'pricing-models', 'app-settings', 'rate-changes', 'announcements']
        .map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
  };

  const runBatchSync = async (targets: Array<{ id: number; name: string }>) => {
    if (!targets.length) { notify.info('当前筛选下没有可同步的启用实例'); return; }
    setSyncProgress({ open: true, running: true, total: targets.length, completed: 0, successCount: 0, failedCount: 0, activeNames: [], items: targets.map((item) => ({ key: item.id, name: item.name, status: 'pending' })) });
    try {
      const result = await runBatchSyncWithConcurrency({
        targets,
        maxWorkers: appSettings?.sync_max_workers ?? 5,
        syncOne: syncInstance,
        onStateChange: (state) => setSyncProgress({ open: true, total: targets.length, ...state }),
      });
      await refreshAll();
      if (result.failedCount) notify.warning(`同步完成：成功 ${result.successCount}，失败 ${result.failedCount}，并发 ${appSettings?.sync_max_workers ?? 5}`);
      else notify.success(`已完成 ${result.successCount} 个实例同步，并发 ${appSettings?.sync_max_workers ?? 5}`);
    } catch (error) {
      setSyncProgress((current) => ({ ...current, running: false, activeNames: [] }));
      notify.error(getErrorMessage(error));
    }
  };

  const resetFilters = () => {
    setSearch('');
    setSelectedTags([]);
    setBillingMode('all');
    setEnabled('all');
    setHealthStatus('all');
  };

  const resetTrendRange = () => {
    setTrendMode('7d');
    setCustomTrendDays(14);
    setRangeStart(dayjs().subtract(6, 'day').format('YYYY-MM-DD'));
    setRangeEnd(dayjs().format('YYYY-MM-DD'));
    setTrendBreakdownLimit(8);
  };

  const applyRange = (nextStart: string, nextEnd: string) => {
    if (!nextStart || !nextEnd) return;
    const days = dayjs(nextEnd).diff(dayjs(nextStart), 'day');
    if (days < 0) { notify.warning('结束日期不能早于开始日期'); return; }
    if (days >= MAX_TREND_DAYS) { notify.warning(`自定义时间范围最多 ${MAX_TREND_DAYS} 天`); return; }
    setRangeStart(nextStart);
    setRangeEnd(nextEnd);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="仪表盘"
        subtitle="全部实例的余额、消耗与趋势总览。"
        extra={
          <>
            <Button variant="outline" onClick={() => void refreshAll()}>
              <RefreshCw className="size-4" />
              刷新
            </Button>
            <Button isPending={syncProgress.running} onClick={() => void runBatchSync(syncTargets)}>
              <RefreshCw className="size-4" />
              同步全部（{syncTargets.length}）
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 pt-4">
          <div className="relative w-60">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="搜索实例名、地址、用户名" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <MultiSelect className="w-48" options={tagOptions} value={selectedTags} onChange={setSelectedTags} placeholder="按标签筛选" />
          <SelectField className="w-36" value={billingMode} onValueChange={setBillingMode} options={BILLING_OPTIONS} />
          <SelectField className="w-32" value={enabled} onValueChange={setEnabled} options={ENABLED_OPTIONS} />
          <SelectField className="w-32" value={healthStatus} onValueChange={setHealthStatus} options={HEALTH_OPTIONS} />
          {activeFilterCount ? (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <X className="size-4" />
              清空筛选（{activeFilterCount}）
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="实例总数" value={formatNumber(data?.instance_count ?? 0)} icon={<Database className="size-4" />} />
        <StatCard label="启用实例" value={formatNumber(data?.enabled_instance_count ?? 0)} icon={<Zap className="size-4" />} />
        <StatCard label="健康实例" value={formatNumber(data?.healthy_instance_count ?? 0)} icon={<HeartPulse className="size-4" />} />
        <StatCard label="预付费总余额" value={formatMoney(data?.total_display_quota ?? 0)} icon={<Wallet className="size-4" />} />
        <StatCard label="区间已用额度" value={formatMoney(trendSummary.totalUsed)} icon={<TrendingUp className="size-4" />} />
        <StatCard label="日均消耗额度" value={formatMoney(trendSummary.averageUsed)} icon={<Gauge className="size-4" />} />
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle>消耗趋势 · {getTrendModeLabel(trendMode, customTrendDays)}</CardTitle>
              <CardDescription>
                {trendData ? `${trendData.start_date} 至 ${trendData.end_date}，共 ${trendData.days} 天` : '按天统计各实例消耗额度构成'}
              </CardDescription>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="恢复默认时间" onClick={resetTrendRange}>
                  <RotateCcw className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>恢复默认时间范围</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <SegmentedControl size="sm" options={TREND_OPTIONS} value={trendMode} onChange={(value) => setTrendMode(value as TrendMode)} />
            {trendMode === 'custom-days' ? (
              <NumberField className="w-28" value={customTrendDays} onValueChange={(value) => setCustomTrendDays(Math.min(Math.max(Math.round(value || 1), 1), MAX_TREND_DAYS))} min={1} max={MAX_TREND_DAYS} />
            ) : null}
            {trendMode === 'range' ? (
              <div className="flex items-end gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">开始</span>
                  <Input type="date" className="h-8 w-36" value={rangeStart} onChange={(event) => applyRange(event.target.value, rangeEnd)} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">结束</span>
                  <Input type="date" className="h-8 w-36" value={rangeEnd} onChange={(event) => applyRange(rangeStart, event.target.value)} />
                </div>
              </div>
            ) : null}
            <NumberField className="ml-auto w-32" label="堆叠实例数" value={trendBreakdownLimit} onValueChange={(value) => setTrendBreakdownLimit(Math.min(Math.max(Math.round(value || 1), 1), 20))} min={1} max={20} />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-muted-foreground">
            <span>活跃消耗 <strong className="text-foreground tabular">{formatNumber(trendSummary.activeDays)} 天</strong></span>
            <span>峰值 <strong className="text-foreground tabular">{trendSummary.peak ? `${trendSummary.peak.date} / ${formatMoney(trendSummary.peak.used_display_amount)}` : '-'}</strong></span>
            <span>筛选 <strong className="text-foreground">{activeFilterCount ? `${activeFilterCount} 项` : '未筛选'}</strong></span>
          </div>
          {trendsLoading ? <Skeleton className="h-72 w-full" /> : <StackedUsageChart points={trendData?.points ?? []} series={trendData?.series ?? []} />}
        </CardContent>
      </Card>

      <SyncProgressModal
        open={syncProgress.open}
        title="批量同步进度"
        running={syncProgress.running}
        total={syncProgress.total}
        completed={syncProgress.completed}
        successCount={syncProgress.successCount}
        failedCount={syncProgress.failedCount}
        activeNames={syncProgress.activeNames}
        items={syncProgress.items}
        onRetryFailed={(items) => void runBatchSync(items.map((item) => ({ id: Number(item.key), name: item.name })))}
        onClose={() => setSyncProgress(INITIAL_PROGRESS)}
      />
    </div>
  );
}
