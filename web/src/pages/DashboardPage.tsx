import { App, Button, Card, Col, Input, Row, Segmented, Select, Typography } from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getErrorMessage } from '../api/client';
import { fetchDashboardOverview, fetchDashboardTrends } from '../api/dashboard';
import { fetchInstances, syncInstance } from '../api/instances';
import { MetricTrendChart } from '../components/MetricTrendChart';
import { StatCard } from '../components/StatCard';
import { SyncProgressModal, type SyncProgressItem } from '../components/SyncProgressModal';
import type { InstanceQuery } from '../types/api';
import { formatBillingMode, formatMoney, formatNumber } from '../utils/format';

const { Text } = Typography;

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

export function DashboardPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [billingMode, setBillingMode] = useState<'prepaid' | 'postpaid' | undefined>(undefined);
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);
  const [healthStatus, setHealthStatus] = useState<string | undefined>(undefined);
  const [trendDays, setTrendDays] = useState<7 | 30>(7);
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

  const { data: instanceData } = useQuery({
    queryKey: ['instances'],
    queryFn: () => fetchInstances(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-overview', filters],
    queryFn: () => fetchDashboardOverview(filters),
  });

  const { data: trendData, isLoading: trendsLoading } = useQuery({
    queryKey: ['dashboard-trends', trendDays, filters],
    queryFn: () => fetchDashboardTrends(trendDays, filters),
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

  const healthDistribution = useMemo(
    () => [
      {
        key: 'healthy',
        label: '健康',
        count: data?.healthy_instance_count ?? 0,
        color: '#16a34a',
      },
      {
        key: 'unhealthy',
        label: '异常/降级',
        count: data?.unhealthy_instance_count ?? 0,
        color: '#dc2626',
      },
    ],
    [data],
  );

  const billingDistribution = useMemo(
    () => [
      {
        key: 'prepaid',
        label: formatBillingMode('prepaid'),
        count: data?.prepaid_instance_count ?? 0,
        color: '#d97706',
      },
      {
        key: 'postpaid',
        label: formatBillingMode('postpaid'),
        count: data?.postpaid_instance_count ?? 0,
        color: '#2563eb',
      },
    ],
    [data],
  );

  const syncTargets = useMemo(
    () =>
      (data?.items ?? [])
        .filter((item) => item.enabled)
        .map((item) => ({ id: item.instance_id, name: item.instance_name })),
    [data?.items],
  );

  const totalInstances = Math.max(data?.instance_count ?? 0, 1);

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

    let successCount = 0;
    let failedCount = 0;

    for (let index = 0; index < syncTargets.length; index += 1) {
      const target = syncTargets[index];
      setSyncProgress((current) => ({
        ...current,
        currentName: target.name,
        items: current.items.map((item) =>
          item.key === target.id ? { ...item, status: 'running', errorMessage: null } : item,
        ),
      }));

      try {
        await syncInstance(target.id);
        successCount += 1;
        setSyncProgress((current) => ({
          ...current,
          completed: index + 1,
          successCount,
          failedCount,
          items: current.items.map((item) => (item.key === target.id ? { ...item, status: 'success' } : item)),
        }));
      } catch (error) {
        failedCount += 1;
        const errorMessage = getErrorMessage(error);
        setSyncProgress((current) => ({
          ...current,
          completed: index + 1,
          successCount,
          failedCount,
          items: current.items.map((item) =>
            item.key === target.id ? { ...item, status: 'failed', errorMessage } : item,
          ),
        }));
      }
    }

    setSyncProgress((current) => ({
      ...current,
      running: false,
      currentName: null,
      successCount,
      failedCount,
    }));
    await refreshDashboardData();

    if (failedCount) {
      message.warning(`同步完成：成功 ${successCount}，失败 ${failedCount}`);
      return;
    }
    message.success(`已完成 ${successCount} 个实例同步`);
  };

  return (
    <div className="page-stack">
      <Card className="section-card" loading={isLoading}>
        <div className="table-toolbar">
          <div className="table-toolbar-left">
            <Input.Search
              allowClear
              placeholder="搜索实例名、地址、用户名"
              style={{ width: 260 }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Select
              mode="multiple"
              allowClear
              placeholder="按标签筛选"
              style={{ width: 260 }}
              options={tagOptions}
              value={selectedTags}
              onChange={(value) => setSelectedTags(value)}
            />
            <Select
              allowClear
              placeholder="按计费方式筛选"
              style={{ width: 180 }}
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
              style={{ width: 180 }}
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
              style={{ width: 180 }}
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
          <div className="table-toolbar-right">
            <Segmented
              options={[
                { label: '近 7 天', value: 7 },
                { label: '近 30 天', value: 30 },
              ]}
              value={trendDays}
              onChange={(value) => setTrendDays(value as 7 | 30)}
            />
            <Button icon={<SyncOutlined />} loading={syncProgress.running} onClick={runSyncAll}>
              同步全部（{syncTargets.length}）
            </Button>
            <Button
              onClick={() => {
                setSearch('');
                setSelectedTags([]);
                setBillingMode(undefined);
                setEnabled(undefined);
                setHealthStatus(undefined);
              }}
            >
              清空筛选
            </Button>
          </div>
        </div>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <StatCard title="实例总数" value={formatNumber(data?.instance_count ?? 0)} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <StatCard title="启用实例" value={formatNumber(data?.enabled_instance_count ?? 0)} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <StatCard title="健康实例" value={formatNumber(data?.healthy_instance_count ?? 0)} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <StatCard title="后付费实例" value={formatNumber(data?.postpaid_instance_count ?? 0)} />
        </Col>
        <Col xs={24} md={12} xl={8}>
          <StatCard
            title="预付费总余额"
            value={formatMoney(data?.total_display_quota ?? 0)}
            caption="仅统计预付费站点"
          />
        </Col>
        <Col xs={24} md={12} xl={8}>
          <StatCard
            title="周期已用额度"
            value={formatMoney(data?.total_display_used_quota ?? 0)}
            caption="已按近 30 天日志和当前周期同步"
          />
        </Col>
        <Col xs={24} md={12} xl={8}>
          <StatCard
            title="今日请求数"
            value={formatNumber(data?.today_request_count ?? 0)}
            caption={`累计 ${formatNumber(data?.total_request_count ?? 0)}`}
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <MetricTrendChart
            title={`近 ${trendDays} 天每日消耗额度`}
            subtitle="经典柱状图，优先使用近 30 天远端日志统计"
            points={(trendData?.points ?? []).map((item) => ({
              label: item.label,
              value: item.used_display_amount,
            }))}
            color="linear-gradient(180deg, #0f766e 0%, #14b8a6 100%)"
            format="money"
          />
        </Col>
        <Col xs={24} xl={10}>
          <MetricTrendChart
            title={`近 ${trendDays} 天每日请求数`}
            subtitle="优先使用近 30 天远端日志统计"
            points={(trendData?.points ?? []).map((item) => ({
              label: item.label,
              value: item.request_count,
            }))}
            color="linear-gradient(180deg, #1d4ed8 0%, #60a5fa 100%)"
            format="number"
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card className="section-card" loading={isLoading || trendsLoading} title="计费方式分布">
            <div className="distribution-list">
              {billingDistribution.map((item) => (
                <div key={item.key} className="distribution-item">
                  <div className="distribution-item-header">
                    <Text>{item.label}</Text>
                    <Text strong>{formatNumber(item.count)}</Text>
                  </div>
                  <div className="distribution-track">
                    <div
                      className="distribution-fill"
                      style={{ width: `${(item.count / totalInstances) * 100}%`, background: item.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card className="section-card" loading={isLoading || trendsLoading} title="健康状态分布">
            <div className="distribution-list">
              {healthDistribution.map((item) => (
                <div key={item.key} className="distribution-item">
                  <div className="distribution-item-header">
                    <Text>{item.label}</Text>
                    <Text strong>{formatNumber(item.count)}</Text>
                  </div>
                  <div className="distribution-track">
                    <div
                      className="distribution-fill"
                      style={{ width: `${(item.count / totalInstances) * 100}%`, background: item.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
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
