import { SyncOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
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
  Table,
  Tag,
  Typography,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useMemo, useState } from 'react';

import { getErrorMessage } from '../api/client';
import { fetchDashboardOverview, fetchDashboardTrends } from '../api/dashboard';
import { fetchInstances } from '../api/instances';
import { syncAllInstances } from '../api/sync';
import { InstanceOverviewChart } from '../components/InstanceOverviewChart';
import { StackedUsageChart } from '../components/StackedUsageChart';
import {
  SyncProgressModal,
  type SyncProgressItem,
  type SyncProgressStatus,
} from '../components/SyncProgressModal';
import type { DashboardTrendQuery, InstanceQuery } from '../types/api';
import { formatBillingMode, formatMoney, formatNumber } from '../utils/format';

const { RangePicker } = DatePicker;
const { Text } = Typography;

type TrendMode = '7d' | '15d' | '30d' | 'custom-days' | 'range';
type InstanceViewMode = 'quota' | 'status';
type InstanceSortMode = 'used' | 'balance' | 'sync';

interface SyncProgressState {
  open: boolean;
  running: boolean;
  total: number;
  completed: number;
  successCount: number;
  failedCount: number;
  currentName?: string | null;
  items: SyncProgressItem[];
}

const INITIAL_SYNC_PROGRESS: SyncProgressState = {
  open: false,
  running: false,
  total: 0,
  completed: 0,
  successCount: 0,
  failedCount: 0,
  currentName: null,
  items: [],
};

const DEFAULT_RANGE: [Dayjs, Dayjs] = [dayjs().subtract(6, 'day'), dayjs()];
const MAX_TREND_DAYS = 90;

function normalizeSyncStatus(status?: string): SyncProgressStatus {
  return status === 'success' || status === 'failed' || status === 'running' ? status : 'pending';
}

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

function formatHealthStatusLabel(value?: string) {
  if (value === 'healthy') {
    return '健康';
  }
  if (value === 'unhealthy') {
    return '异常';
  }
  if (value === 'degraded') {
    return '降级';
  }
  if (value === 'unknown') {
    return '未知';
  }
  return value || '全部';
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
  const [instanceViewMode, setInstanceViewMode] = useState<InstanceViewMode>('quota');
  const [instanceSortMode, setInstanceSortMode] = useState<InstanceSortMode>('used');
  const [instanceLimit, setInstanceLimit] = useState(8);
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<number[]>([]);
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

  const instanceOptions = useMemo(
    () =>
      (data?.items ?? []).map((item) => ({
        label: item.instance_name,
        value: item.instance_id,
      })),
    [data?.items],
  );

  const syncTargets = useMemo(
    () =>
      (data?.items ?? [])
        .filter((item) => item.enabled)
        .map((item) => ({ id: item.instance_id, name: item.instance_name })),
    [data?.items],
  );

  const totalInstances = data?.instance_count ?? 0;
  const healthyPercent = totalInstances
    ? Math.round(((data?.healthy_instance_count ?? 0) / totalInstances) * 100)
    : 0;
  const enabledPercent = totalInstances
    ? Math.round(((data?.enabled_instance_count ?? 0) / totalInstances) * 100)
    : 0;
  const prepaidPercent = totalInstances
    ? Math.round(((data?.prepaid_instance_count ?? 0) / totalInstances) * 100)
    : 0;

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

  const topTrendDays = useMemo(
    () =>
      [...(trendData?.points ?? [])]
        .sort((left, right) => right.used_display_amount - left.used_display_amount)
        .slice(0, 5),
    [trendData],
  );

  const visibleInstanceItems = useMemo(() => {
    const items = [...(data?.items ?? [])];
    const filteredItems = selectedInstanceIds.length
      ? items.filter((item) => selectedInstanceIds.includes(item.instance_id))
      : items;

    filteredItems.sort((left, right) => {
      if (instanceSortMode === 'balance') {
        const leftBalance = Math.max((left.latest_display_quota ?? 0) - (left.latest_display_used_quota ?? 0), 0);
        const rightBalance = Math.max((right.latest_display_quota ?? 0) - (right.latest_display_used_quota ?? 0), 0);
        return rightBalance - leftBalance;
      }
      if (instanceSortMode === 'sync') {
        return new Date(right.last_sync_at ?? 0).getTime() - new Date(left.last_sync_at ?? 0).getTime();
      }
      return (right.latest_display_used_quota ?? 0) - (left.latest_display_used_quota ?? 0);
    });

    if (selectedInstanceIds.length) {
      return filteredItems;
    }
    return filteredItems.slice(0, instanceLimit);
  }, [data?.items, instanceLimit, instanceSortMode, selectedInstanceIds]);

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

  const runSyncAll = async () => {
    if (!syncTargets.length) {
      message.info('当前筛选下没有可同步的启用实例');
      return;
    }

    setSyncProgress({
      open: true,
      running: true,
      total: syncTargets.length,
      completed: 0,
      successCount: 0,
      failedCount: 0,
      currentName: syncTargets[0]?.name ?? null,
      items: syncTargets.map((item) => ({
        key: item.id,
        name: item.name,
        status: 'pending',
      })),
    });

    try {
      const result = await syncAllInstances(syncTargets.map((item) => item.id));
      const resultMap = new Map(result.items.map((item) => [item.instance_id, item]));

      setSyncProgress({
        open: true,
        running: false,
        total: result.total,
        completed: result.total,
        successCount: result.success_count,
        failedCount: result.failed_count,
        currentName: null,
        items: syncTargets.map((item) => {
          const current = resultMap.get(item.id);
          return {
            key: item.id,
            name: item.name,
            status: normalizeSyncStatus(current?.status),
            errorMessage: current?.error_message ?? null,
          };
        }),
      });

      await refreshDashboardData();

      if (result.failed_count) {
        message.warning(`同步完成：成功 ${result.success_count}，失败 ${result.failed_count}，并发 ${result.max_workers}`);
        return;
      }
      message.success(`已完成 ${result.success_count} 个实例同步，并发 ${result.max_workers}`);
    } catch (error) {
      setSyncProgress((current) => ({
        ...current,
        running: false,
        currentName: null,
      }));
      message.error(getErrorMessage(error));
    }
  };

  const resetFilters = () => {
    setSearch('');
    setSelectedTags([]);
    setBillingMode(undefined);
    setEnabled(undefined);
    setHealthStatus(undefined);
    setSelectedInstanceIds([]);
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
        title="筛选与区间"
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

          <Alert
            showIcon
            type="info"
            message={`${getTrendModeLabel(trendMode, customTrendDays)}，主图按实例堆叠展示每日消耗额度`}
            description={
              trendData
                ? `${trendData.start_date} 至 ${trendData.end_date}，共 ${trendData.days} 天；超出前 ${trendBreakdownLimit} 个实例会自动合并到“其他实例”。`
                : '区间、筛选和堆叠实例数都会影响主图。'
            }
          />
        </div>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={4}>
          <Card className="section-card" loading={isLoading}>
            <Statistic title="实例总数" value={formatNumber(data?.instance_count ?? 0)} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={4}>
          <Card className="section-card" loading={isLoading}>
            <Statistic title="启用实例" value={formatNumber(data?.enabled_instance_count ?? 0)} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={4}>
          <Card className="section-card" loading={isLoading}>
            <Statistic title="健康实例" value={formatNumber(data?.healthy_instance_count ?? 0)} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={4}>
          <Card className="section-card" loading={isLoading}>
            <Statistic title="预付费总余额" value={formatMoney(data?.total_display_quota ?? 0)} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={4}>
          <Card className="section-card" loading={trendsLoading}>
            <Statistic title="区间已用额度" value={formatMoney(trendSummary.totalUsed)} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={4}>
          <Card className="section-card" loading={trendsLoading}>
            <Statistic title="日均消耗额度" value={formatMoney(trendSummary.averageUsed)} />
          </Card>
        </Col>
      </Row>

      <Card
        className="section-card"
        loading={trendsLoading}
        title={`${getTrendModeLabel(trendMode, customTrendDays)}每日消耗额度`}
      >
        <StackedUsageChart
          title="按实例堆叠"
          subtitle="主图只展示消耗额度，不再混入请求数。"
          points={trendData?.points ?? []}
          series={trendData?.series ?? []}
        />
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={8}>
          <Card className="section-card" title="区间分析" loading={isLoading || trendsLoading}>
            <Descriptions column={1} size="small" colon={false}>
              <Descriptions.Item label="当前区间">
                {trendData ? `${trendData.start_date} 至 ${trendData.end_date}` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="已应用筛选">
                {activeFilterCount ? `${activeFilterCount} 项` : '未筛选'}
              </Descriptions.Item>
              <Descriptions.Item label="健康状态">{formatHealthStatusLabel(healthStatus)}</Descriptions.Item>
              <Descriptions.Item label="计费方式">{billingMode ? formatBillingMode(billingMode) : '全部'}</Descriptions.Item>
              <Descriptions.Item label="命中实例">{formatNumber(totalInstances)}</Descriptions.Item>
              <Descriptions.Item label="活跃消耗天数">{formatNumber(trendSummary.activeDays)}</Descriptions.Item>
              <Descriptions.Item label="启用率">{enabledPercent}%</Descriptions.Item>
              <Descriptions.Item label="健康率">{healthyPercent}%</Descriptions.Item>
              <Descriptions.Item label="预付费占比">{prepaidPercent}%</Descriptions.Item>
            </Descriptions>

            <div className="dashboard-analysis-summary">
              <Alert
                showIcon
                type="success"
                message="峰值消耗日"
                description={
                  trendSummary.peakUsagePoint
                    ? `${trendSummary.peakUsagePoint.date}，消耗 ${formatMoney(trendSummary.peakUsagePoint.used_display_amount)}`
                    : '暂无数据'
                }
              />
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={16}>
          <Card className="section-card" title="高消耗日期" loading={trendsLoading}>
            <Table
              rowKey="date"
              size="small"
              pagination={false}
              dataSource={topTrendDays}
              locale={{ emptyText: <Empty description="暂无区间数据" /> }}
              columns={[
                {
                  title: '日期',
                  dataIndex: 'date',
                  key: 'date',
                  width: 160,
                },
                {
                  title: '消耗额度',
                  dataIndex: 'used_display_amount',
                  key: 'used_display_amount',
                  render: (value: number) => formatMoney(value),
                },
                {
                  title: '主要来源实例',
                  dataIndex: 'breakdown',
                  key: 'breakdown',
                  render: (value: Array<{ instance_name: string; used_display_amount: number }>) => (
                    <Space size={[8, 8]} wrap>
                      {value.slice(0, 4).map((item) => (
                        <Tag key={`${item.instance_name}-${item.used_display_amount}`}>
                          {item.instance_name} {formatMoney(item.used_display_amount)}
                        </Tag>
                      ))}
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card
        className="section-card"
        title="实例可视化概览"
        loading={isLoading}
        extra={
          <Space size={[12, 12]} wrap>
            <Segmented<InstanceViewMode>
              options={[
                { label: '额度结构', value: 'quota' },
                { label: '运行状态', value: 'status' },
              ]}
              value={instanceViewMode}
              onChange={(value) => setInstanceViewMode(value)}
            />
            <Segmented<InstanceSortMode>
              options={[
                { label: '按已用', value: 'used' },
                { label: '按余额', value: 'balance' },
                { label: '按最近同步', value: 'sync' },
              ]}
              value={instanceSortMode}
              onChange={(value) => setInstanceSortMode(value)}
            />
            <InputNumber
              min={1}
              max={20}
              addonAfter="个"
              value={instanceLimit}
              onChange={(value) => setInstanceLimit(value ?? 8)}
              disabled={selectedInstanceIds.length > 0}
            />
            <Select
              mode="multiple"
              allowClear
              placeholder="指定实例"
              style={{ minWidth: 260 }}
              maxTagCount="responsive"
              value={selectedInstanceIds}
              options={instanceOptions}
              onChange={(value) => setSelectedInstanceIds(value)}
            />
          </Space>
        }
      >
        <InstanceOverviewChart items={visibleInstanceItems} mode={instanceViewMode} />
      </Card>

      <SyncProgressModal
        open={syncProgress.open}
        title="批量同步进度"
        running={syncProgress.running}
        total={syncProgress.total}
        completed={syncProgress.completed}
        successCount={syncProgress.successCount}
        failedCount={syncProgress.failedCount}
        currentName={syncProgress.currentName}
        items={syncProgress.items}
        onClose={() => setSyncProgress(INITIAL_SYNC_PROGRESS)}
      />
    </div>
  );
}
