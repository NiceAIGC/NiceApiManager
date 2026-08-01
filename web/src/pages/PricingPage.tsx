import { DollarOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { Alert, Card, Col, Empty, Input, Row, Segmented, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchInstances } from '../api/instances';
import { fetchPricingModels } from '../api/pricing';
import { formatDateTime } from '../utils/format';
import { cacheUsdPerMillion, inputUsdPerMillion, outputUsdPerMillion } from '../utils/pricing';
function formatPricingValue(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }
  return Number.parseFloat(value.toFixed(12)).toString();
}

type PricingDisplayMode = 'ratio' | 'usd';


function formatUsdPerMillion(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }
  return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(value)} / 1M`;
}



export function PricingPage() {
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [instanceId, setInstanceId] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [displayMode, setDisplayMode] = useState<PricingDisplayMode>('ratio');

  const { data: instanceData } = useQuery({
    queryKey: ['instances', tag],
    queryFn: () => fetchInstances(tag ? { tags: [tag] } : undefined),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['pricing-models', tag, instanceId, search, groupName, page, pageSize],
    queryFn: () =>
      fetchPricingModels({
        tag,
        instance_id: instanceId,
        search: search || undefined,
        group_name: groupName,
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }),
  });

  const instanceOptions = useMemo(
    () =>
      (instanceData?.items ?? []).map((item) => ({
        label: item.name,
        value: item.id,
      })),
    [instanceData],
  );

  const groupOptions = useMemo(() => {
    const values = new Set<string>();
    for (const row of data?.items ?? []) {
      for (const group of row.enable_groups) {
        values.add(group);
      }
    }
    return Array.from(values)
      .sort()
      .map((group) => ({ label: group, value: group }));
  }, [data]);

  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const item of instanceData?.items ?? []) {
      for (const tagItem of item.tags) {
        tags.add(tagItem);
      }
    }
    return Array.from(tags)
      .sort()
      .map((tagItem) => ({ label: tagItem, value: tagItem }));
  }, [instanceData]);

  const summary = useMemo(() => {
    const rows = data?.items ?? [];
    return {
      total: data?.total ?? 0,
      tokenModels: rows.filter((item) => item.quota_type === 0).length,
      fixedModels: rows.filter((item) => item.quota_type !== 0).length,
      vendors: new Set(rows.map((item) => item.vendor_name).filter(Boolean)).size,
    };
  }, [data]);

  return (
    <div className="page-stack">
      <Card className="section-card ratio-hero-card">
        <Space direction="vertical" size={4}>
          <Typography.Title level={4} style={{ margin: 0 }}><DollarOutlined /> 定价模型</Typography.Title>
          <Typography.Text type="secondary">倍率口径：1x 输入 = $2 / 1M tokens；输出价格 = 模型倍率 × 补全倍率 × $2；缓存读写价格按各自倍率换算。</Typography.Text>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}><Card><Statistic title="模型总数" value={summary.total} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="当前页倍率计费" value={summary.tokenModels} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="当前页固定计费" value={summary.fixedModels} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="当前页供应商" value={summary.vendors} /></Card></Col>
      </Row>

      <Alert showIcon icon={<InfoCircleOutlined />} type="info" message="可在倍率和美元价格间切换。固定价格模型保持显示每次请求价格，不套用每百万 Token 换算。" />
      <div className="table-toolbar">
        <div className="table-toolbar-left">
          <Select
            allowClear
            placeholder="按标签筛选"
            style={{ width: 220 }}
            options={tagOptions}
            value={tag}
            onChange={(value) => {
              setTag(value);
              setInstanceId(undefined);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="按实例筛选"
            style={{ width: 220 }}
            options={instanceOptions}
            value={instanceId}
            onChange={(value) => {
              setInstanceId(value);
              setPage(1);
            }}
          />
          <Input.Search
            allowClear
            placeholder="搜索模型名"
            style={{ width: 260 }}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="按分组筛选"
            style={{ width: 220 }}
            options={groupOptions}
            value={groupName}
            onChange={(value) => {
              setGroupName(value);
              setPage(1);
            }}
          />
        </div>
        <div className="table-toolbar-right">
          <Segmented
            value={displayMode}
            onChange={(value) => setDisplayMode(value as PricingDisplayMode)}
            options={[
              { label: '倍率', value: 'ratio' },
              { label: '美元 / 1M tokens', value: 'usd' },
            ]}
          />
        </div>
      </div>

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items ?? []}
        locale={{ emptyText: <Empty description="暂无定价模型数据" /> }}
        scroll={{ x: 1380 }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
        }}
        columns={[
          {
            title: '实例',
            dataIndex: 'instance_name',
            key: 'instance_name',
            fixed: 'left',
            width: 160,
          },
          {
            title: '模型名',
            dataIndex: 'model_name',
            key: 'model_name',
            fixed: 'left',
            width: 260,
          },
          {
            title: '供应商',
            dataIndex: 'vendor_name',
            key: 'vendor_name',
            render: (value?: string | null) => value || '-',
          },
          {
            title: '计费方式',
            dataIndex: 'quota_type',
            key: 'quota_type',
            width: 108,
            render: (value: number, record) => (
              <Tag color={record.billing_mode === 'tiered_expr' ? 'purple' : value === 0 ? 'blue' : 'gold'}>
                {record.billing_mode === 'tiered_expr' ? '阶梯计费' : value === 0 ? '倍率计费' : '固定价格'}
              </Tag>
            ),
          },
          {
            title: displayMode === 'ratio' ? '模型倍率 / 固定价' : '输入价格 / 固定价',
            key: 'base_pricing',
            width: 178,
            render: (_: unknown, record) => (
              <div className="pricing-number-cell">
                <strong>
                  {record.quota_type !== 0
                    ? `$${formatPricingValue(record.model_price)} / 请求`
                    : displayMode === 'ratio'
                      ? `${formatPricingValue(record.model_ratio)}x`
                      : formatUsdPerMillion(inputUsdPerMillion(record.model_ratio))}
                </strong>
                <span>{record.quota_type === 0 ? '输入' : '固定价格'}</span>
              </div>
            ),
          },
          {
            title: displayMode === 'ratio' ? '补全倍率' : '输出价格',
            key: 'completion_pricing',
            width: 150,
            render: (_: unknown, record) =>
              record.quota_type !== 0 ? '-' : (
                <div className="pricing-number-cell">
                  <strong>
                    {displayMode === 'ratio'
                      ? `${formatPricingValue(record.completion_ratio)}x`
                      : formatUsdPerMillion(outputUsdPerMillion(record.model_ratio, record.completion_ratio))}
                  </strong>
                  <span>输出 ÷ 输入</span>
                </div>
              ),
          },
          {
            title: displayMode === 'ratio' ? '缓存倍率' : '缓存价格',
            key: 'cache_ratios',
            width: 190,
            render: (_: unknown, record) => {
              if (record.quota_type !== 0) {
                return '-';
              }
              const readValue = record.cache_ratio == null
                ? '-'
                : displayMode === 'ratio'
                  ? `${formatPricingValue(record.cache_ratio)}x`
                  : formatUsdPerMillion(cacheUsdPerMillion(record.model_ratio, record.cache_ratio));
              const writeValue = record.create_cache_ratio == null
                ? '-'
                : displayMode === 'ratio'
                  ? `${formatPricingValue(record.create_cache_ratio)}x`
                  : formatUsdPerMillion(cacheUsdPerMillion(record.model_ratio, record.create_cache_ratio));
              return (
                <div className="pricing-number-cell">
                  <strong>读 {readValue}</strong>
                  <span>写 {writeValue}</span>
                </div>
              );
            },
          },
          {
            title: '可用分组',
            dataIndex: 'enable_groups',
            key: 'enable_groups',
            render: (value: string[]) => (
              <Space wrap>
                {value.length ? value.map((item) => <Tag key={item}>{item}</Tag>) : '-'}
              </Space>
            ),
          },
          {
            title: '支持端点',
            dataIndex: 'supported_endpoint_types',
            key: 'supported_endpoint_types',
            render: (value: string[]) => (
              <Space wrap>
                {value.length ? value.map((item) => <Tag color="blue" key={item}>{item}</Tag>) : '-'}
              </Space>
            ),
          },
          {
            title: '快照时间',
            dataIndex: 'snapshot_at',
            key: 'snapshot_at',
            render: (value: string) => formatDateTime(value),
          },
        ]}
      />
    </div>
  );
}
