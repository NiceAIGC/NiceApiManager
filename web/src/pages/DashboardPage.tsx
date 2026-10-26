import { Button, Card, DateRangePicker, RangeCalendar, Skeleton, Tooltip } from '@heroui/react';
import { parseDate } from '@internationalized/date';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Database, Gauge, HeartPulse, RefreshCw, RotateCcw, TrendingUp, Wallet, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';

import { getErrorMessage } from '../api/client';
import { fetchDashboardOverview, fetchDashboardTrends } from '../api/dashboard';
import { fetchInstances, syncInstance } from '../api/instances';
import { fetchAppSettings } from '../api/settings';
import { StackedUsageChart } from '../components/StackedUsageChart';
import { SyncProgressModal, type SyncProgressItem } from '../components/SyncProgressModal';
import { NumberInput, SegmentedControl, SelectInput, StatCard, TextInput } from '../components/ui';
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
interface SyncTarget { id: number; name: string }

const INITIAL_SYNC_PROGRESS: SyncProgressState = { open: false, running: false, total: 0, completed: 0, successCount: 0, failedCount: 0, activeNames: [], items: [] };
const DEFAULT_RANGE = { start: parseDate(dayjs().subtract(6, 'day').format('YYYY-MM-DD')), end: parseDate(dayjs().format('YYYY-MM-DD')) };
const MAX_TREND_DAYS = 31;
const TREND_OPTIONS = [
  { value: '7d', label: '近 7 天' },
  { value: '15d', label: '近 15 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'custom-days', label: '近 N 天' },
  { value: 'range', label: '自定义' },
];
const BILLING_OPTIONS = [{ value: 'prepaid', label: '预付费' }, { value: 'postpaid', label: '后付费' }];
const ENABLED_OPTIONS = [{ value: 'true', label: '启用' }, { value: 'false', label: '停用' }];
const HEALTH_OPTIONS = [{ value: 'healthy', label: '健康' }, { value: 'unhealthy', label: '异常' }, { value: 'degraded', label: '降级' }, { value: 'unknown', label: '未知' }];

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
  const [billingMode, setBillingMode] = useState<'prepaid' | 'postpaid' | undefined>();
  const [enabled, setEnabled] = useState<boolean | undefined>();
  const [healthStatus, setHealthStatus] = useState<string | undefined>();
  const [trendMode, setTrendMode] = useState<TrendMode>('7d');
  const [customTrendDays, setCustomTrendDays] = useState(14);
  const [customRange, setCustomRange] = useState(DEFAULT_RANGE);
  const [trendBreakdownLimit, setTrendBreakdownLimit] = useState(8);
  const [syncProgress, setSyncProgress] = useState<SyncProgressState>(INITIAL_SYNC_PROGRESS);

  const filters = useMemo<InstanceQuery>(
    () => ({
      search: search.trim() || undefined,
      tags: selectedTags.length ? selectedTags : undefined,
      billing_mode: billingMode,
      enabled,
      health_status: healthStatus,
    }),
    [billingMode, enabled, healthStatus, search, selectedTags],
  );
  const trendQuery = useMemo<DashboardTrendQuery>(() => {
    const baseQuery: DashboardTrendQuery = { ...filters, breakdown_limit: trendBreakdownLimit };
    if (trendMode === 'range') return { ...baseQuery, start_date: customRange.start.toString(), end_date: customRange.end.toString() };
    if (trendMode === 'custom-days') return { ...baseQuery, days: customTrendDays };
    return { ...baseQuery, days: trendMode === '15d' ? 15 : trendMode === '30d' ? 30 : 7 };
  }, [customRange, customTrendDays, filters, trendBreakdownLimit, trendMode]);

  const { data: instanceData } = useQuery({ queryKey: ['instances'], queryFn: () => fetchInstances() });
  const { data: appSettingsData } = useQuery({ queryKey: ['app-settings'], queryFn: fetchAppSettings });
  const { data, isLoading } = useQuery({ queryKey: ['dashboard-overview', filters], queryFn: () => fetchDashboardOverview(filters) });
  const { data: trendData, isLoading: trendsLoading } = useQuery({ queryKey: ['dashboard-trends', trendQuery], queryFn: () => fetchDashboardTrends(trendQuery) });

  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const item of instanceData?.items ?? []) for (const tag of item.tags) tags.add(tag);
    return Array.from(tags).sort().map((tag) => ({ label: tag, value: tag }));
  }, [instanceData]);
  const syncTargets = useMemo(
    () => (data?.items ?? []).filter((item) => item.enabled).map((item) => ({ id: item.instance_id, name: item.instance_name })),
    [data?.items],
  );
  const activeFilterCount = [
    search.trim().length > 0,
    selectedTags.length > 0,
    billingMode !== undefined,
    enabled !== undefined,
    healthStatus !== undefined,
  ].filter(Boolean).length;
  const trendSummary = useMemo(() => {
    const points = trendData?.points ?? [];
    const totalUsed = points.reduce((sum, item) => sum + item.used_display_amount, 0);
    const peakUsagePoint = points.reduce<(typeof points)[number] | null>(
      (currentMax, item) => (currentMax && currentMax.used_display_amount >= item.used_display_amount ? currentMax : item),
      null,
    );
    return {
      totalUsed,
      averageUsed: points.length ? totalUsed / points.length : 0,
      activeDays: points.filter((item) => item.used_display_amount > 0).length,
      peakUsagePoint,
    };
  }, [trendData]);

  const refreshDashboardData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['instances'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-trends'] }),
      queryClient.invalidateQueries({ queryKey: ['sync-runs'] }),
      queryClient.invalidateQueries({ queryKey: ['groups'] }),
      queryClient.invalidateQueries({ queryKey: ['pricing-models'] }),
      queryClient.invalidateQueries({ queryKey: ['app-settings'] }),
    ]);
  };
  const runBatchSync = async (targets: SyncTarget[]) => {
    if (!targets.length) {
      notify.info('当前筛选下没有可同步的启用实例');
      return;
    }
    setSyncProgress({ open: true, running: true, total: targets.length, completed: 0, successCount: 0, failedCount: 0, activeNames: [], items: targets.map((item) => ({ key: item.id, name: item.name, status: 'pending' })) });
    try {
      const result = await runBatchSyncWithConcurrency({
        targets,
        maxWorkers: appSettingsData?.sync_max_workers ?? 5,
        syncOne: syncInstance,
        onStateChange: ({ running, completed, successCount, failedCount, activeNames, items }) =>
          setSyncProgress({ open: true, running, total: targets.length, completed, successCount, failedCount, activeNames, items }),
      });
      await refreshDashboardData();
      if (result.failedCount) {
        notify.warning(`同步完成：成功 ${result.successCount}，失败 ${result.failedCount}，并发 ${appSettingsData?.sync_max_workers ?? 5}`);
        return;
      }
      notify.success(`已完成 ${result.successCount} 个实例同步，并发 ${appSettingsData?.sync_max_workers ?? 5}`);
    } catch (error) {
      setSyncProgress((current) => ({ ...current, running: false, activeNames: [] }));
      notify.error(getErrorMessage(error));
    }
  };
  const resetFilters = () => {
    setSearch('');
    setSelectedTags([]);
    setBillingMode(undefined);
    setEnabled(undefined);
    setHealthStatus(undefined);
  };
  const resetTrendRange = () => {
    setTrendMode('7d');
    setCustomTrendDays(14);
    setCustomRange(DEFAULT_RANGE);
    setTrendBreakdownLimit(8);
  };
  const onRangeChange = (range: typeof customRange | null) => {
    if (!range) return;
    if (dayjs(range.end.toString()).diff(dayjs(range.start.toString()), 'day') >= MAX_TREND_DAYS) {
      notify.warning(`自定义时间范围最多 ${MAX_TREND_DAYS} 天`);
      return;
    }
    setCustomRange(range);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 筛选 + 全局操作 */}
      <Card>
        <Card.Content className="flex flex-wrap items-center gap-3 p-4">
          <TextInput
            className="w-64"
            inputProps={{ 'aria-label': '搜索实例名、地址、用户名', placeholder: '搜索实例名、地址、用户名', value: search, onChange: (event) => setSearch(event.target.value) }}
          />
          <SelectInput className="w-44" options={tagOptions} value={selectedTags} multiple placeholder="按标签筛选" onChange={(value) => setSelectedTags(Array.isArray(value) ? value : [])} />
          <SelectInput className="w-36" options={BILLING_OPTIONS} value={billingMode} placeholder="按计费方式筛选" onChange={(value) => setBillingMode(value === 'prepaid' || value === 'postpaid' ? value : undefined)} />
          <SelectInput className="w-32" options={ENABLED_OPTIONS} value={enabled === undefined ? undefined : String(enabled)} placeholder="按启用状态筛选" onChange={(value) => setEnabled(value === 'true' ? true : value === 'false' ? false : undefined)} />
          <SelectInput className="w-36" options={HEALTH_OPTIONS} value={healthStatus} placeholder="按健康状态筛选" onChange={(value) => setHealthStatus(typeof value === 'string' ? value : undefined)} />
          <div className="ml-auto flex items-center gap-2">
            {activeFilterCount ? (
              <Button variant="ghost" size="sm" onPress={resetFilters}>
                清空筛选（{activeFilterCount}）
              </Button>
            ) : null}
            <Button variant="primary" isPending={syncProgress.running} onPress={() => void runBatchSync(syncTargets)}>
              <RefreshCw size={16} />
              同步全部（{syncTargets.length}）
            </Button>
          </div>
        </Card.Content>
      </Card>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="实例总数" value={formatNumber(data?.instance_count ?? 0)} icon={<Database size={16} />} />
        <StatCard label="启用实例" value={formatNumber(data?.enabled_instance_count ?? 0)} icon={<Zap size={16} />} />
        <StatCard label="健康实例" value={formatNumber(data?.healthy_instance_count ?? 0)} icon={<HeartPulse size={16} />} />
        <StatCard label="预付费总余额" value={formatMoney(data?.total_display_quota ?? 0)} icon={<Wallet size={16} />} />
        <StatCard label="区间已用额度" value={formatMoney(trendSummary.totalUsed)} icon={<TrendingUp size={16} />} />
        <StatCard label="日均消耗额度" value={formatMoney(trendSummary.averageUsed)} icon={<Gauge size={16} />} />
        {isLoading ? <span className="sr-only">加载中</span> : null}
      </div>

      {/* 消耗趋势 */}
      <Card>
        <Card.Header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Card.Title>消耗趋势 · {getTrendModeLabel(trendMode, customTrendDays)}</Card.Title>
            <Card.Description>
              {trendData ? `${trendData.start_date} 至 ${trendData.end_date}，共 ${trendData.days} 天；悬浮单日柱体查看实例构成` : '按天统计各实例消耗额度构成'}
            </Card.Description>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl size="sm" options={TREND_OPTIONS} value={trendMode} onChange={(value) => setTrendMode(value as TrendMode)} />
            {trendMode === 'custom-days' ? (
              <div className="flex items-center gap-1.5">
                <NumberInput className="w-20" value={customTrendDays} min={1} max={MAX_TREND_DAYS} onChange={(value) => setCustomTrendDays(value ?? 7)} />
                <span className="text-sm text-muted">天</span>
              </div>
            ) : null}
            {trendMode === 'range' ? (
              <DateRangePicker value={customRange} onChange={onRangeChange}>
                <DateRangePicker.Trigger className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-foreground">
                  <span>{customRange.start.toString()}</span>
                  <DateRangePicker.RangeSeparator>至</DateRangePicker.RangeSeparator>
                  <span>{customRange.end.toString()}</span>
                  <DateRangePicker.TriggerIndicator>▾</DateRangePicker.TriggerIndicator>
                </DateRangePicker.Trigger>
                <DateRangePicker.Popover>
                  <RangeCalendar aria-label="自定义时间范围" value={customRange} onChange={onRangeChange}>
                    <RangeCalendar.Header>
                      <RangeCalendar.NavButton slot="previous">‹</RangeCalendar.NavButton>
                      <RangeCalendar.Heading />
                      <RangeCalendar.NavButton slot="next">›</RangeCalendar.NavButton>
                    </RangeCalendar.Header>
                    <RangeCalendar.Grid>
                      <RangeCalendar.GridHeader>{(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}</RangeCalendar.GridHeader>
                      <RangeCalendar.GridBody>{(date) => <RangeCalendar.Cell date={date}><RangeCalendar.CellIndicator>{date.day}</RangeCalendar.CellIndicator></RangeCalendar.Cell>}</RangeCalendar.GridBody>
                    </RangeCalendar.Grid>
                  </RangeCalendar>
                </DateRangePicker.Popover>
              </DateRangePicker>
            ) : null}
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-muted">堆叠</span>
              <NumberInput className="w-20" value={trendBreakdownLimit} min={1} max={20} onChange={(value) => setTrendBreakdownLimit(value ?? 8)} />
            </div>
            <Tooltip>
              <Tooltip.Trigger>
                <Button isIconOnly variant="ghost" size="sm" aria-label="恢复默认时间" onPress={resetTrendRange}>
                  <RotateCcw size={14} />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>恢复默认时间范围</Tooltip.Content>
            </Tooltip>
          </div>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-muted">
            <span>活跃消耗 <strong className="text-foreground">{formatNumber(trendSummary.activeDays)} 天</strong></span>
            <span>峰值 <strong className="text-foreground">{trendSummary.peakUsagePoint ? `${trendSummary.peakUsagePoint.date} / ${formatMoney(trendSummary.peakUsagePoint.used_display_amount)}` : '-'}</strong></span>
            <span>筛选 <strong className="text-foreground">{activeFilterCount ? `${activeFilterCount} 项` : '未筛选'}</strong></span>
          </div>
          {trendsLoading ? (
            <Skeleton className="h-80 w-full rounded-xl" />
          ) : (
            <StackedUsageChart
              title="实例构成"
              subtitle={trendData ? '实例按区间总消耗从高到低排序' : undefined}
              points={trendData?.points ?? []}
              series={trendData?.series ?? []}
            />
          )}
        </Card.Content>
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
        onClose={() => setSyncProgress(INITIAL_SYNC_PROGRESS)}
      />
    </div>
  );
}
