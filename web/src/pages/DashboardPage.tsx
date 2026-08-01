import { SyncOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Empty,
  Input,
  InputNumber,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useMemo, useState } from 'react';

import { getErrorMessage } from '../api/client';
import { fetchDashboardOverview, fetchDashboardTrends } from '../api/dashboard';
import { fetchInstances, syncInstance } from '../api/instances';
import { fetchAppSettings } from '../api/settings';
import { StackedUsageChart } from '../components/StackedUsageChart';
import {
  SyncProgressModal,
  type SyncProgressItem,
} from '../components/SyncProgressModal';
import type { DashboardTrendQuery, InstanceQuery } from '../types/api';
import { formatBillingMode, formatMoney, formatNumber } from '../utils/format';
import { runBatchSyncWithConcurrency } from '../utils/batchSync';

const { RangePicker } = DatePicker;
const { Text } = Typography;

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

interface SyncTarget {
  id: number;
  name: string;
}

const INITIAL_SYNC_PROGRESS: SyncProgressState = {
  open: false,
  running: false,
  total: 0,
  completed: 0,
  successCount: 0,
  failedCount: 0,
  activeNames: [],
  items: [],
};

const DEFAULT_RANGE: [Dayjs, Dayjs] = [dayjs().subtract(6, 'day'), dayjs()];
const MAX_TREND_DAYS = 90;

function getTrendModeLabel(mode: TrendMode, customDays: number) {
  if (mode === '15d') {
    return '近 15 天';
  }
  if (mode === '30d') {
    return '近 30 天';
  }
  if (mode === 'custom-days') {
    return `近 ${customDays} 天`;
  }
  if (mode === 'range') {
    return '自定义区间';
  }
  return '近 7 天';
}

export function DashboardPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [billingMode, setBillingMode] = useState<'prepaid' | 'postpaid' | undefined>(undefined);
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);
  const [healthStatus, setHealthStatus] = useState<string | undefined>(undefined);
  const [trendMode, setTrendMode] = useState<TrendMode>('7d');
  const [customTrendDays, setCustomTrendDays] = useState(14);
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs]>(DEFAULT_RANGE);
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
    const baseQuery: DashboardTrendQuery = {
      ...filters,
      breakdown_limit: trendBreakdownLimit,
    };

    if (trendMode === 'range') {
      return {
        ...baseQuery,
        start_date: customRange[0].format('YYYY-MM-DD'),
        end_date: customRange[1].format('YYYY-MM-DD'),
      };
    }

    if (trendMode === 'custom-days') {
      return {
        ...baseQuery,
        days: customTrendDays,
      };
    }

    return {
      ...baseQuery,
      days: trendMode === '15d' ? 15 : trendMode === '30d' ? 30 : 7,
    };
  }, [customRange, customTrendDays, filters, trendBreakdownLimit, trendMode]);

  const { data: instanceData } = useQuery({
    queryKey: ['instances'],
    queryFn: () => fetchInstances(),
  });

  const { data: appSettingsData } = useQuery({
    queryKey: ['app-settings'],
    queryFn: fetchAppSettings,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-overview', filters],
    queryFn: () => fetchDashboardOverview(filters),
  });

  const { data: trendData, isLoading: trendsLoading } = useQuery({
    queryKey: ['dashboard-trends', trendQuery],
    queryFn: () => fetchDashboardTrends(trendQuery),
  });

  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const item of instanceData?.items ?? []) {
      for (const tag of item.tags) {
        tags.add(tag);
      }
    }
    return Array.from(tags)
      .sort()
      .map((tag) => ({ label: tag, value: tag }));
  }, [instanceData]);

  const syncTargets = useMemo(
    () =>
      (data?.items ?? [])
        .filter((item) => item.enabled)
        .map((item) => ({ id: item.instance_id, name: item.instance_name })),
    [data?.items],
  );

  const activeFilterCount = useMemo(
    () =>
      [
        search.trim().length > 0,
        selectedTags.length > 0,
        billingMode !== undefined,
        enabled !== undefined,
        healthStatus !== undefined,
      ].filter(Boolean).length,
    [billingMode, enabled, healthStatus, search, selectedTags],
  );

  const trendSummary = useMemo(() => {
    const points = trendData?.points ?? [];
    const totalUsed = points.reduce((sum, item) => sum + item.used_display_amount, 0);
    const peakUsagePoint = points.reduce<(typeof points)[number] | null>(
      (currentMax, item) =>
        currentMax && currentMax.used_display_amount >= item.used_display_amount ? currentMax : item,
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
      message.info('当前筛选下没有可同步的启用实例');
      return;
    }

    setSyncProgress({
      open: true,
      running: true,
      total: targets.length,
      completed: 0,
      successCount: 0,
      failedCount: 0,
      activeNames: [],
      items: targets.map((item) => ({
        key: item.id,
        name: item.name,
        status: 'pending',
      })),
    });

    try {
      const result = await runBatchSyncWithConcurrency({
        targets,
        maxWorkers: appSettingsData?.sync_max_workers ?? 5,
        syncOne: syncInstance,
        onStateChange: ({ running, completed, successCount, failedCount, activeNames, items }) => {
          setSyncProgress({
            open: true,
            running,
            total: targets.length,
            completed,
            successCount,
            failedCount,
            activeNames,
            items,
          });
        },
      });

      await refreshDashboardData();

      if (result.failedCount) {
        message.warning(
          `同步完成：成功 ${result.successCount}，失败 ${result.failedCount}，并发 ${appSettingsData?.sync_max_workers ?? 5}`,
        );
        return;
      }
      message.success(`已完成 ${result.successCount} 个实例同步，并发 ${appSettingsData?.sync_max_workers ?? 5}`);
    } catch (error) {
      setSyncProgress((current) => ({
        ...current,
        running: false,
        activeNames: [],
      }));
      message.error(getErrorMessage(error));
    }
  };

  const runSyncAll = async () => {
    await runBatchSync(syncTargets);
  };

  const retryFailedSyncItems = async (items: SyncProgressItem[]) => {
    await runBatchSync(
      items.map((item) => ({
        id: Number(item.key),
        name: item.name,
      })),
    );
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

  return (
    <div className="page-stack">
      <Card
        className="section-card"
        title="筛选与分析维度"
        extra={
          <Space wrap>
            <Button onClick={resetFilters}>清空筛选</Button>
            <Button onClick={resetTrendRange}>恢复默认时间</Button>
            <Button icon={<SyncOutlined />} loading={syncProgress.running} onClick={runSyncAll}>
              同步全部（{syncTargets.length}）
            </Button>
          </Space>
        }
      >
        <div className="dashboard-filter-grid">
          <Input.Search
            allowClear
            placeholder="搜索实例名、地址、用户名"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按标签筛选"
            options={tagOptions}
            value={selectedTags}
            onChange={(value) => setSelectedTags(value)}
          />
          <Select
            allowClear
            placeholder="按计费方式筛选"
            value={billingMode}
            options={[
              { label: '预付费', value: 'prepaid' },
              { label: '后付费', value: 'postpaid' },
            ]}
            onChange={(value) => setBillingMode(value)}
          />
          <Select
            allowClear
            placeholder="按启用状态筛选"
            value={enabled}
            options={[
              { label: '启用', value: true },
              { label: '停用', value: false },
            ]}
            onChange={(value) => setEnabled(value)}
          />
          <Select
            allowClear
            placeholder="按健康状态筛选"
            value={healthStatus}
            options={[
              { label: '健康', value: 'healthy' },
              { label: '异常', value: 'unhealthy' },
              { label: '降级', value: 'degraded' },
              { label: '未知', value: 'unknown' },
            ]}
            onChange={(value) => setHealthStatus(value)}
          />
        </div>

        <div className="dashboard-toolbar-secondary">
          <Space size={[12, 12]} wrap>
            <Text type="secondary">时间范围</Text>
            <Segmented<TrendMode>
              options={[
                { label: '近 7 天', value: '7d' },
                { label: '近 15 天', value: '15d' },
                { label: '近 30 天', value: '30d' },
                { label: '近 N 天', value: 'custom-days' },
                { label: '自定义区间', value: 'range' },
              ]}
              value={trendMode}
              onChange={(value) => setTrendMode(value)}
            />
            {trendMode === 'custom-days' ? (
              <InputNumber
                min={1}
                max={MAX_TREND_DAYS}
                addonAfter="天"
                value={customTrendDays}
                onChange={(value) => setCustomTrendDays(value ?? 7)}
              />
            ) : null}
            {trendMode === 'range' ? (
              <RangePicker
                allowClear={false}
                value={customRange}
                onChange={(value) => {
                  if (!value?.[0] || !value[1]) {
                    return;
                  }
                  if (value[1].diff(value[0], 'day') >= MAX_TREND_DAYS) {
                    message.warning(`自定义时间范围最多 ${MAX_TREND_DAYS} 天`);
                    return;
                  }
                  setCustomRange([value[0], value[1]]);
                }}
              />
            ) : null}
            <Text type="secondary">堆叠实例数</Text>
            <InputNumber
              min={1}
              max={20}
              addonAfter="个"
              value={trendBreakdownLimit}
              onChange={(value) => setTrendBreakdownLimit(value ?? 8)}
            />
          </Space>
        </div>
      </Card>

      <div className="dashboard-kpi-grid">
        <Card className="section-card" loading={isLoading}>
          <Statistic title="实例总数" value={formatNumber(data?.instance_count ?? 0)} />
        </Card>
        <Card className="section-card" loading={isLoading}>
          <Statistic title="启用实例" value={formatNumber(data?.enabled_instance_count ?? 0)} />
        </Card>
        <Card className="section-card" loading={isLoading}>
          <Statistic title="健康实例" value={formatNumber(data?.healthy_instance_count ?? 0)} />
        </Card>
        <Card className="section-card" loading={isLoading}>
          <Statistic title="预付费总余额" value={formatMoney(data?.total_display_quota ?? 0)} />
        </Card>
        <Card className="section-card" loading={trendsLoading}>
          <Statistic title="区间已用额度" value={formatMoney(trendSummary.totalUsed)} />
        </Card>
        <Card className="section-card" loading={trendsLoading}>
          <Statistic title="日均消耗额度" value={formatMoney(trendSummary.averageUsed)} />
        </Card>
      </div>

      <Card
        className="section-card dashboard-main-chart-card"
        loading={trendsLoading}
        title={`${getTrendModeLabel(trendMode, customTrendDays)}每日消耗额度`}
      >
        <div className="dashboard-main-chart-meta">
          <div className="dashboard-main-chart-meta-item">
            <Text type="secondary">活跃消耗天数</Text>
            <Text strong>{formatNumber(trendSummary.activeDays)}</Text>
          </div>
          <div className="dashboard-main-chart-meta-item">
            <Text type="secondary">峰值消耗日</Text>
            <Text strong>
              {trendSummary.peakUsagePoint
                ? `${trendSummary.peakUsagePoint.date} / ${formatMoney(trendSummary.peakUsagePoint.used_display_amount)}`
                : '-'}
            </Text>
          </div>
          <div className="dashboard-main-chart-meta-item">
            <Text type="secondary">当前筛选</Text>
            <Text strong>{activeFilterCount ? `${activeFilterCount} 项` : '未筛选'}</Text>
          </div>
        </div>

        <StackedUsageChart
          title="实例构成"
          subtitle={
            trendData
              ? `${trendData.start_date} 至 ${trendData.end_date}，共 ${trendData.days} 天。悬浮单日柱体时，实例会按当日消耗从高到低排序。`
              : '数据按实例堆叠，悬浮单日柱体可查看详细构成。'
          }
          points={trendData?.points ?? []}
          series={trendData?.series ?? []}
        />
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
        onRetryFailed={retryFailedSyncItems}
        onClose={() => setSyncProgress(INITIAL_SYNC_PROGRESS)}
      />
    </div>
  );
}
