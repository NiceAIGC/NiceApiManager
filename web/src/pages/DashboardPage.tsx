import { Button, Card, Col, Input, Row, Segmented, Select, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { fetchDashboardOverview, fetchDashboardTrends } from '../api/dashboard';
import { fetchInstances } from '../api/instances';
import { MetricTrendChart } from '../components/MetricTrendChart';
import { StatCard } from '../components/StatCard';
import type { InstanceQuery } from '../types/api';
import { formatBillingMode, formatMoney, formatNumber } from '../utils/format';

const { Text } = Typography;

export function DashboardPage() {
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [billingMode, setBillingMode] = useState<'prepaid' | 'postpaid' | undefined>(undefined);
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);
  const [healthStatus, setHealthStatus] = useState<string | undefined>(undefined);
  const [trendDays, setTrendDays] = useState<7 | 30>(7);

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

  const totalInstances = Math.max(data?.instance_count ?? 0, 1);

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
        <Col xs={24} md={12} xl={6}>
          <StatCard
            title="预付费总余额"
            value={formatMoney(data?.total_display_quota ?? 0)}
            caption="仅统计预付费站点"
          />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <StatCard
            title="周期已用额度"
            value={formatMoney(data?.total_display_used_quota ?? 0)}
            caption="预付费 / 后付费合并统计"
          />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <StatCard
            title="今日请求数"
            value={formatNumber(data?.today_request_count ?? 0)}
            caption={`累计 ${formatNumber(data?.total_request_count ?? 0)}`}
          />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <StatCard title="内部已用额度" value={formatNumber(data?.total_used_quota ?? 0)} />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <MetricTrendChart
            title={`近 ${trendDays} 天每日消耗额度`}
            subtitle="按每天最新快照差值聚合，适合看消耗趋势"
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
            subtitle="按每天最新快照差值聚合"
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
    </div>
  );
}
