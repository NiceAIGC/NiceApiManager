import { Button, Card, Col, Empty, InputNumber, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { fetchDashboardOverview } from '../api/dashboard';
import { fetchInstances } from '../api/instances';
import { StatCard } from '../components/StatCard';
import { StatusTag } from '../components/StatusTag';
import type { DashboardInstanceSummary } from '../types/api';
import { formatBillingMode, formatDateTime, formatMoney, formatNumber } from '../utils/format';

const { Text } = Typography;

function getQuotaLevelMeta(value?: number | null): { className: string; label: string } {
  if (value === null || value === undefined) {
    return { className: 'quota-badge quota-badge-empty', label: '-' };
  }
  if (value < 0) {
    return { className: 'quota-badge quota-badge-negative', label: formatMoney(value) };
  }
  if (value < 10) {
    return { className: 'quota-badge quota-badge-low', label: formatMoney(value) };
  }
  if (value <= 100) {
    return { className: 'quota-badge quota-badge-medium', label: formatMoney(value) };
  }
  return { className: 'quota-badge quota-badge-high', label: formatMoney(value) };
}

export function DashboardPage() {
  const [selectedTag, setSelectedTag] = useState<string | undefined>(undefined);
  const [minDisplayQuota, setMinDisplayQuota] = useState<number | null>(null);
  const [maxDisplayQuota, setMaxDisplayQuota] = useState<number | null>(null);

  const { data: instanceData } = useQuery({
    queryKey: ['instances'],
    queryFn: () => fetchInstances(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-overview', selectedTag],
    queryFn: () => fetchDashboardOverview(selectedTag),
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

  const filteredItems = useMemo(() => {
    return (data?.items ?? []).filter((item) => {
      const value = item.latest_display_quota;
      const hasRangeFilter = minDisplayQuota !== null || maxDisplayQuota !== null;
      if (!hasRangeFilter) {
        return true;
      }
      if (value === null || value === undefined) {
        return false;
      }
      if (minDisplayQuota !== null && value < minDisplayQuota) {
        return false;
      }
      if (maxDisplayQuota !== null && value > maxDisplayQuota) {
        return false;
      }
      return true;
    });
  }, [data?.items, maxDisplayQuota, minDisplayQuota]);

  const summary = useMemo(() => {
    return filteredItems.reduce(
      (acc, item) => {
        acc.instanceCount += 1;
        if (item.health_status === 'healthy') {
          acc.healthyInstanceCount += 1;
        }
        acc.totalDisplayQuota += item.latest_display_quota ?? 0;
        acc.totalDisplayUsedQuota += item.latest_display_used_quota ?? 0;
        acc.todayRequestCount += item.today_request_count ?? 0;
        acc.totalRequestCount += item.latest_request_count ?? 0;
        return acc;
      },
      {
        instanceCount: 0,
        healthyInstanceCount: 0,
        totalDisplayQuota: 0,
        totalDisplayUsedQuota: 0,
        todayRequestCount: 0,
        totalRequestCount: 0,
      },
    );
  }, [filteredItems]);

  return (
    <div className="page-stack">
      <div className="table-toolbar">
        <div className="table-toolbar-left">
          <Select
            allowClear
            placeholder="按标签筛选"
            style={{ width: 220 }}
            options={tagOptions}
            value={selectedTag}
            onChange={(value) => setSelectedTag(value)}
          />
          <InputNumber
            placeholder="最小余额"
            style={{ width: 160 }}
            value={minDisplayQuota}
            onChange={(value) => setMinDisplayQuota(value)}
          />
          <InputNumber
            placeholder="最大余额"
            style={{ width: 160 }}
            value={maxDisplayQuota}
            onChange={(value) => setMaxDisplayQuota(value)}
          />
          <Button
            onClick={() => {
              setMinDisplayQuota(null);
              setMaxDisplayQuota(null);
            }}
          >
            清空余额筛选
          </Button>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <StatCard title="实例总数" value={formatNumber(summary.instanceCount)} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <StatCard title="健康实例" value={formatNumber(summary.healthyInstanceCount)} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <StatCard
            title="预付费总余额"
            value={formatMoney(summary.totalDisplayQuota)}
            caption="仅统计预付费站点"
          />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <StatCard
            title="周期已用额度"
            value={formatMoney(summary.totalDisplayUsedQuota)}
            caption="预付费/后付费统一累计"
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <StatCard
            title="今日请求数"
            value={formatNumber(summary.todayRequestCount)}
            caption={`累计 ${formatNumber(summary.totalRequestCount)}`}
          />
        </Col>
      </Row>

      <Card className="section-card" title="实例概览">
        <Table
          rowKey="instance_id"
          loading={isLoading}
          dataSource={filteredItems}
          locale={{ emptyText: <Empty description="暂无实例数据" /> }}
          pagination={false}
          scroll={{ x: 960 }}
          columns={[
            {
              title: '实例',
              dataIndex: 'instance_name',
              key: 'instance_name',
              render: (value: string, record: DashboardInstanceSummary) => (
                <Space direction="vertical" size={0}>
                  <Text strong>{value}</Text>
                  <Text type="secondary">ID #{record.instance_id}</Text>
                </Space>
              ),
            },
            {
              title: '状态',
              dataIndex: 'health_status',
              key: 'health_status',
              render: (value: string) => <StatusTag value={value} />,
            },
            {
              title: '启用',
              dataIndex: 'enabled',
              key: 'enabled',
              render: (value: boolean) => (value ? '启用' : '停用'),
            },
            {
              title: '计费方式',
              dataIndex: 'billing_mode',
              key: 'billing_mode',
              render: (value: 'prepaid' | 'postpaid') => (
                <Tag color={value === 'postpaid' ? 'processing' : 'gold'}>
                  {formatBillingMode(value)}
                </Tag>
              ),
            },
            {
              title: '标签',
              dataIndex: 'tags',
              key: 'tags',
              render: (value: string[]) => (
                <Space wrap>
                  {value.length ? value.map((item) => <Tag key={item}>{item}</Tag>) : '-'}
                </Space>
              ),
            },
            {
              title: '当前分组',
              dataIndex: 'latest_group_name',
              key: 'latest_group_name',
              render: (value?: string | null) => value || '-',
            },
            {
              title: '当前余额',
              dataIndex: 'latest_display_quota',
              key: 'latest_display_quota',
              render: (value: number | null | undefined, record: DashboardInstanceSummary) => {
                if (record.billing_mode === 'postpaid') {
                  return '-';
                }
                const meta = getQuotaLevelMeta(value);
                return <span className={meta.className}>{meta.label}</span>;
              },
            },
            {
              title: '周期已用额度',
              dataIndex: 'latest_display_used_quota',
              key: 'latest_display_used_quota',
              render: (value?: number | null) => formatMoney(value),
            },
            {
              title: '今日请求数',
              dataIndex: 'today_request_count',
              key: 'today_request_count',
              render: (value?: number | null) => formatNumber(value),
            },
            {
              title: '最近同步',
              dataIndex: 'last_sync_at',
              key: 'last_sync_at',
              render: (value?: string | null) => formatDateTime(value),
            },
            {
              title: '错误信息',
              dataIndex: 'health_error',
              key: 'health_error',
              render: (value?: string | null) => value || '-',
            },
          ]}
        />
      </Card>
    </div>
  );
}
