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
  Progress,
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
import { StatusTag } from '../components/StatusTag';
import {
  SyncProgressModal,
  type SyncProgressItem,
  type SyncProgressStatus,
} from '../components/SyncProgressModal';
import type { DashboardTrendQuery, InstanceQuery } from '../types/api';
import {
  formatBillingMode,
  formatDateTime,
  formatMoney,
  formatNumber,
  getBillingModeTagColor,
} from '../utils/format';

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
    if (trendMode === 'range') {
      return {
        ...filters,
        start_date: customRange[0].format('YYYY-MM-DD'),
        end_date: customRange[1].format('YYYY-MM-DD'),
      };
    }

    if (trendMode === 'custom-days') {
      return {
        ...filters,
        days: customTrendDays,
      };
    }

    return {
      ...filters,
      days: trendMode === '15d' ? 15 : trendMode === '30d' ? 30 : 7,
    };
  }, [customRange, customTrendDays, filters, trendMode]);

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
    const totalRequests = points.reduce((sum, item) => sum + item.request_count, 0);
    const peakUsagePoint = points.reduce<(typeof points)[number] | null>(
      (currentMax, item) =>
        currentMax && currentMax.used_display_amount >= item.used_display_amount ? currentMax : item,
      null,
    );
    const peakRequestPoint = points.reduce<(typeof points)[number] | null>(
      (currentMax, item) => (currentMax && currentMax.request_count >= item.request_count ? currentMax : item),
      null,
    );

    return {
      totalUsed,
      totalRequests,
      averageUsed: points.length ? totalUsed / points.length : 0,
      averageRequests: points.length ? totalRequests / points.length : 0,
      peakUsagePoint,
      peakRequestPoint,
      peakUsageValue: peakUsagePoint?.used_display_amount ?? 0,
    };
  }, [trendData]);

  const trendRows = useMemo(
    () =>
      [...(trendData?.points ?? [])]
        .reverse()
        .map((item) => ({
          ...item,
          usagePercent:
            trendSummary.peakUsageValue > 0
              ? Math.round((item.used_display_amount / trendSummary.peakUsageValue) * 100)
              : 0,
        })),
    [trendData, trendSummary.peakUsageValue],
  );

  const instanceRows = useMemo(
    () =>
      [...(data?.items ?? [])]
        .sort((left, right) => {
          if (right.today_request_count !== left.today_request_count) {
            return right.today_request_count - left.today_request_count;
          }
          return (right.latest_display_used_quota ?? 0) - (left.latest_display_used_quota ?? 0);
        })
        .slice(0, 8),
    [data?.items],
  );

  const refreshDashboardData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['instances'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-trends'] }),
      queryClient.invalidateQueries({ queryKey: ['sync-runs'] }),
      queryClient.invalidateQueries({ queryKey: ['groups'] }),
      queryClient.invalidateQueries({ queryKey: ['pricing-models'] }),
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
  };

  const resetTrendRange = () => {
    setTrendMode('7d');
    setCustomTrendDays(14);
    setCustomRange(DEFAULT_RANGE);
  };

  return (
    <div className="page-stack">
      <Card
        className="section-card"
        title="筛选与时间范围"
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
            <Text type="secondary">趋势时间</Text>
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
          </Space>

          <Alert
            showIcon
            type="info"
            message={`${getTrendModeLabel(trendMode, customTrendDays)}，用于查看每日消耗额度与请求数`}
            description={
              trendData
                ? `${trendData.start_date} 至 ${trendData.end_date}，共 ${trendData.days} 天`
                : '按当前筛选条件统计，时间范围可随时切换。'
            }
          />
        </div>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <Card className="section-card" loading={isLoading}>
            <Statistic title="实例总数" value={formatNumber(data?.instance_count ?? 0)} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card className="section-card" loading={isLoading}>
            <Statistic title="启用实例" value={formatNumber(data?.enabled_instance_count ?? 0)} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card className="section-card" loading={isLoading}>
            <Statistic title="健康实例" value={formatNumber(data?.healthy_instance_count ?? 0)} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card className="section-card" loading={isLoading}>
            <Statistic title="后付费实例" value={formatNumber(data?.postpaid_instance_count ?? 0)} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={8}>
          <Card className="section-card" loading={isLoading}>
            <Statistic title="预付费总余额" value={formatMoney(data?.total_display_quota ?? 0)} />
            <Text type="secondary">仅统计预付费实例的当前余额</Text>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={8}>
          <Card className="section-card" loading={isLoading}>
            <Statistic title="周期已用额度" value={formatMoney(data?.total_display_used_quota ?? 0)} />
            <Text type="secondary">按当前最新同步结果汇总</Text>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={8}>
          <Card className="section-card" loading={isLoading}>
            <Statistic title="今日请求数" value={formatNumber(data?.today_request_count ?? 0)} />
            <Text type="secondary">累计请求 {formatNumber(data?.total_request_count ?? 0)}</Text>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={10}>
          <Card className="section-card" title="当前筛选概览" loading={isLoading}>
            <Descriptions column={1} size="small" colon={false}>
              <Descriptions.Item label="已命中实例">{formatNumber(totalInstances)}</Descriptions.Item>
              <Descriptions.Item label="已应用筛选">{activeFilterCount ? `${activeFilterCount} 项` : '未筛选'}</Descriptions.Item>
              <Descriptions.Item label="关键词">{search.trim() || '全部实例'}</Descriptions.Item>
              <Descriptions.Item label="标签">
                {selectedTags.length ? (
                  <Space size={[6, 6]} wrap>
                    {selectedTags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </Space>
                ) : (
                  '全部标签'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="计费方式">{billingMode ? formatBillingMode(billingMode) : '全部'}</Descriptions.Item>
              <Descriptions.Item label="启用状态">
                {enabled === undefined ? '全部' : enabled ? '仅启用' : '仅停用'}
              </Descriptions.Item>
              <Descriptions.Item label="健康状态">{formatHealthStatusLabel(healthStatus)}</Descriptions.Item>
            </Descriptions>

            <div className="dashboard-progress-stack">
              <div className="dashboard-progress-item">
                <div className="dashboard-progress-header">
                  <Text>启用率</Text>
                  <Text strong>{enabledPercent}%</Text>
                </div>
                <Progress percent={enabledPercent} showInfo={false} />
              </div>
              <div className="dashboard-progress-item">
                <div className="dashboard-progress-header">
                  <Text>健康率</Text>
                  <Text strong>{healthyPercent}%</Text>
                </div>
                <Progress percent={healthyPercent} status="active" showInfo={false} />
              </div>
              <div className="dashboard-progress-item">
                <div className="dashboard-progress-header">
                  <Text>预付费占比</Text>
                  <Text strong>{prepaidPercent}%</Text>
                </div>
                <Progress percent={prepaidPercent} strokeColor="#faad14" showInfo={false} />
              </div>
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={14}>
          <Card
            className="section-card"
            title="时间范围分析"
            loading={trendsLoading}
            extra={
              trendData ? (
                <Tag color="blue">
                  {trendData.start_date} 至 {trendData.end_date}
                </Tag>
              ) : null
            }
          >
            <Row gutter={[12, 12]}>
              <Col xs={24} sm={12}>
                <Card size="small">
                  <Statistic title="区间总消耗额度" value={formatMoney(trendSummary.totalUsed)} />
                </Card>
              </Col>
              <Col xs={24} sm={12}>
                <Card size="small">
                  <Statistic title="日均消耗额度" value={formatMoney(trendSummary.averageUsed)} />
                </Card>
              </Col>
              <Col xs={24} sm={12}>
                <Card size="small">
                  <Statistic title="区间总请求数" value={formatNumber(trendSummary.totalRequests)} />
                </Card>
              </Col>
              <Col xs={24} sm={12}>
                <Card size="small">
                  <Statistic title="日均请求数" value={formatNumber(trendSummary.averageRequests)} />
                </Card>
              </Col>
            </Row>

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
              <Alert
                showIcon
                type="warning"
                message="峰值请求日"
                description={
                  trendSummary.peakRequestPoint
                    ? `${trendSummary.peakRequestPoint.date}，请求 ${formatNumber(trendSummary.peakRequestPoint.request_count)}`
                    : '暂无数据'
                }
              />
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card
            className="section-card"
            title={`${getTrendModeLabel(trendMode, customTrendDays)}每日消耗额度`}
            loading={trendsLoading}
          >
            <Table
              rowKey="date"
              size="small"
              pagination={false}
              dataSource={trendRows}
              locale={{ emptyText: <Empty description="暂无趋势数据" /> }}
              scroll={{ x: 720 }}
              columns={[
                {
                  title: '日期',
                  dataIndex: 'date',
                  key: 'date',
                  width: 140,
                },
                {
                  title: '消耗额度',
                  dataIndex: 'used_display_amount',
                  key: 'used_display_amount',
                  width: 140,
                  sorter: (left, right) => left.used_display_amount - right.used_display_amount,
                  render: (value: number) => formatMoney(value),
                },
                {
                  title: '占峰值比例',
                  dataIndex: 'usagePercent',
                  key: 'usagePercent',
                  width: 220,
                  render: (value: number) => <Progress percent={value} size="small" />,
                },
                {
                  title: '请求数',
                  dataIndex: 'request_count',
                  key: 'request_count',
                  width: 140,
                  sorter: (left, right) => left.request_count - right.request_count,
                  render: (value: number) => formatNumber(value),
                },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card
            className="section-card"
            title="实例状态概览"
            loading={isLoading}
            extra={<Text type="secondary">按今日请求数排序，最多展示 8 个</Text>}
          >
            <Table
              rowKey="instance_id"
              size="small"
              pagination={false}
              dataSource={instanceRows}
              locale={{ emptyText: <Empty description="暂无实例数据" /> }}
              scroll={{ x: 860 }}
              columns={[
                {
                  title: '实例',
                  dataIndex: 'instance_name',
                  key: 'instance_name',
                  width: 180,
                },
                {
                  title: '状态',
                  dataIndex: 'health_status',
                  key: 'health_status',
                  width: 110,
                  render: (value: string) => <StatusTag value={value} />,
                },
                {
                  title: '计费',
                  dataIndex: 'billing_mode',
                  key: 'billing_mode',
                  width: 110,
                  render: (value: string) => (
                    <Tag color={getBillingModeTagColor(value)}>{formatBillingMode(value)}</Tag>
                  ),
                },
                {
                  title: '额度概览',
                  key: 'quota',
                  width: 220,
                  render: (_, record) => {
                    const used = record.latest_display_used_quota ?? 0;
                    if (record.billing_mode === 'postpaid') {
                      return (
                        <Space direction="vertical" size={2}>
                          <Text>{formatMoney(used)}</Text>
                          <Text type="secondary">后付费累计已用</Text>
                        </Space>
                      );
                    }

                    const total = record.latest_display_quota ?? 0;
                    const percent = total > 0 ? Math.min(Math.round((used / total) * 100), 100) : 0;
                    return (
                      <Space direction="vertical" size={2} style={{ width: '100%' }}>
                        <Text>
                          {formatMoney(used)} / {formatMoney(total)}
                        </Text>
                        <Progress percent={percent} size="small" showInfo={false} />
                      </Space>
                    );
                  },
                },
                {
                  title: '今日请求',
                  dataIndex: 'today_request_count',
                  key: 'today_request_count',
                  width: 110,
                  render: (value: number) => formatNumber(value),
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
          </Card>
        </Col>
      </Row>

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
