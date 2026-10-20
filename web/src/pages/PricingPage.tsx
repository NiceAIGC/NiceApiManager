import {
  ClockCircleOutlined,
  DollarOutlined,
  InfoCircleOutlined,
  AppstoreOutlined,
  SwapOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchInstances } from '../api/instances';
import { fetchPricingComparison, fetchPricingFacets, fetchPricingModels } from '../api/pricing';
import type { PricingCompareModelRow, PricingModelItem, PricingTier } from '../types/api';
import { formatDateTime } from '../utils/format';
import {
  formatClock,
  formatHourWindow,
  formatPricePerMillion,
  formatPricePerRequest,
  formatRatio,
  tierFixedPrice,
  tierPrice,
} from '../utils/pricing';

type PricingDisplayMode = 'price' | 'ratio';
type PricingViewMode = 'detail' | 'compare';

const BILLING_KIND_OPTIONS = [
  { label: '全部计费', value: '' },
  { label: '倍率计费', value: 'token' },
  { label: '固定/按次', value: 'fixed' },
  { label: '阶梯计费', value: 'tiered' },
  { label: '分时计价', value: 'time' },
];

function isTieredRow(record: PricingModelItem): boolean {
  return record.billing_mode === 'tiered_expr' || (record.tiers?.length ?? 0) > 1;
}

function isFixedRow(record: PricingModelItem): boolean {
  return !isTieredRow(record) && (record.quota_type !== 0 || record.price_per_request != null);
}

function programTag(program: string) {
  if (program === 'sub2api') {
    return <Tag color="geekblue">Sub2API</Tag>;
  }
  if (program === 'rixapi') {
    return <Tag color="purple">RixAPI</Tag>;
  }
  if (program === 'shellapi') {
    return <Tag color="cyan">ShellAPI</Tag>;
  }
  return <Tag color="blue">NewAPI</Tag>;
}

function tierConditionText(tier: PricingTier): string {
  const parts: string[] = [];
  for (const condition of tier.conditions ?? []) {
    if (condition.var && condition.op && condition.value !== undefined) {
      const varLabel = condition.var === 'len' ? '上下文' : condition.var === 'p' ? '输入' : condition.var === 'c' ? '输出' : condition.var;
      parts.push(`${varLabel} ${condition.op} ${condition.value.toLocaleString('zh-CN')}`);
    } else if (condition.raw) {
      parts.push(condition.raw);
    }
  }
  if (tier.min_tokens !== undefined || tier.max_tokens !== undefined) {
    const low = tier.min_tokens ?? 0;
    parts.push(tier.max_tokens == null ? `≥ ${low.toLocaleString('zh-CN')} tokens` : `${low.toLocaleString('zh-CN')}–${(tier.max_tokens ?? 0).toLocaleString('zh-CN')} tokens`);
  }
  return parts.join(' 且 ') || '无条件';
}

function tierTimeText(tier: PricingTier): string {
  const windows = (tier.time_windows ?? []).map((window) => formatHourWindow(window.from_hour, window.to_hour)).join(' / ');
  if (!windows) {
    return tier.time_condition ?? '';
  }
  const tz = tier.time_windows?.[0]?.timezone ? `（${tier.time_windows[0].timezone}）` : '';
  return `${windows}${tier.weekdays_only ? '，仅工作日' : ''}${tz}`;
}

function TierTable({ tiers }: { tiers: PricingTier[] }) {
  return (
    <Table
      size="small"
      rowKey={(tier) => `${tier.label}-${tierConditionText(tier)}`}
      dataSource={tiers}
      pagination={false}
      columns={[
        {
          title: '档位',
          dataIndex: 'label',
          width: 120,
          render: (value: string) => <Tag color="purple">{value || '-'}</Tag>,
        },
        {
          title: '条件',
          key: 'condition',
          render: (_: unknown, tier: PricingTier) => tierConditionText(tier),
        },
        {
          title: '生效时段',
          key: 'time',
          render: (_: unknown, tier: PricingTier) => {
            const text = tierTimeText(tier);
            return text ? <Tag color="orange">{text}</Tag> : '-';
          },
        },
        {
          title: '输入价格',
          key: 'input',
          align: 'right',
          render: (_: unknown, tier: PricingTier) => {
            const fixed = tierFixedPrice(tier);
            if (fixed !== null) {
              return formatPricePerRequest(fixed);
            }
            return formatPricePerMillion(tierPrice(tier, 'input'));
          },
        },
        {
          title: '输出价格',
          key: 'output',
          align: 'right',
          render: (_: unknown, tier: PricingTier) => formatPricePerMillion(tierPrice(tier, 'output')),
        },
        {
          title: '缓存读',
          key: 'cache_read',
          align: 'right',
          render: (_: unknown, tier: PricingTier) => formatPricePerMillion(tierPrice(tier, 'cache_read')),
        },
        {
          title: '缓存写',
          key: 'cache_write',
          align: 'right',
          render: (_: unknown, tier: PricingTier) => {
            const write = tierPrice(tier, 'cache_write');
            const write1h = tierPrice(tier, 'cache_write_1h');
            if (write === null && write1h === null) {
              return '-';
            }
            return (
              <Space size={4}>
                <span>{formatPricePerMillion(write)}</span>
                {write1h !== null && <Tooltip title="1 小时 TTL 缓存写入价"><Tag>1h {formatPricePerMillion(write1h)}</Tag></Tooltip>}
              </Space>
            );
          },
        },
      ]}
    />
  );
}

function TimePricingTags({ record }: { record: PricingModelItem }) {
  if (!record.time_pricing?.periods?.length) {
    return null;
  }
  return (
    <Tooltip
      title={record.time_pricing.periods
        .map((period) => `${formatClock(period.start_time)}–${formatClock(period.end_time)} ×${period.multiplier}`)
        .join('；') + (record.time_pricing.weekdays_only ? '（仅工作日）' : '') + (record.time_pricing.timezone ? ` 时区 ${record.time_pricing.timezone}` : '')}
    >
      <Tag color="orange" icon={<ClockCircleOutlined />}>
        分时 ×{record.time_pricing.periods.length} 段
      </Tag>
    </Tooltip>
  );
}

export function PricingPage() {
  const [viewMode, setViewMode] = useState<PricingViewMode>('detail');
  const [displayMode, setDisplayMode] = useState<PricingDisplayMode>('price');
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [instanceId, setInstanceId] = useState<number | undefined>(undefined);
  const [compareInstanceIds, setCompareInstanceIds] = useState<number[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState<string | undefined>(undefined);
  const [billingKind, setBillingKind] = useState<string>('');
  const [vendor, setVendor] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data: instanceData } = useQuery({
    queryKey: ['instances', tag],
    queryFn: () => fetchInstances(tag ? { tags: [tag] } : undefined),
  });

  const { data: facetData } = useQuery({
    queryKey: ['pricing-facets', instanceId, tag],
    queryFn: () => fetchPricingFacets({ instance_id: instanceId, tag }),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['pricing-models', tag, instanceId, search, groupName, billingKind, vendor, page, pageSize],
    queryFn: () =>
      fetchPricingModels({
        tag,
        instance_id: instanceId,
        search: search || undefined,
        group_name: groupName,
        vendor,
        billing_kind: billingKind || undefined,
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }),
    enabled: viewMode === 'detail',
  });

  const { data: compareData, isLoading: compareLoading } = useQuery({
    queryKey: ['pricing-compare', tag, compareInstanceIds, search, groupName, vendor, page, pageSize],
    queryFn: () =>
      fetchPricingComparison({
        tag,
        instance_ids: compareInstanceIds,
        search: search || undefined,
        group_name: groupName,
        vendor,
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }),
    enabled: viewMode === 'compare',
  });

  const instanceOptions = useMemo(
    () => (instanceData?.items ?? []).map((item) => ({ label: item.name, value: item.id })),
    [instanceData],
  );

  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const item of instanceData?.items ?? []) {
      for (const tagItem of item.tags) {
        tags.add(tagItem);
      }
    }
    return Array.from(tags).sort().map((tagItem) => ({ label: tagItem, value: tagItem }));
  }, [instanceData]);

  const summary = useMemo(() => {
    const rows = data?.items ?? [];
    return {
      total: data?.total ?? 0,
      tokenModels: rows.filter((item) => !isTieredRow(item) && !isFixedRow(item)).length,
      fixedModels: rows.filter((item) => isFixedRow(item)).length,
      tieredModels: rows.filter((item) => isTieredRow(item)).length,
      timePriced: rows.filter((item) => item.time_pricing?.periods?.length).length,
    };
  }, [data]);

  const paginationConfig = {
    current: page,
    pageSize,
    total: (viewMode === 'detail' ? data?.total : compareData?.total) ?? 0,
    showSizeChanger: true,
    showTotal: (total: number) => `共 ${total} 项`,
    onChange: (nextPage: number, nextPageSize: number) => {
      setPage(nextPage);
      setPageSize(nextPageSize);
    },
  };

  const detailColumns: ColumnsType<PricingModelItem> = [
    {
      title: '实例',
      dataIndex: 'instance_name',
      key: 'instance_name',
      fixed: 'left',
      width: 170,
      render: (value: string, record) => (
        <Space size={4}>
          <span>{value}</span>
          {programTag(record.instance_program)}
        </Space>
      ),
    },
    {
      title: '模型名',
      dataIndex: 'model_name',
      key: 'model_name',
      fixed: 'left',
      width: 240,
      render: (value: string, record) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 600 }}>{value}</span>
          {record.vendor_name ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{record.vendor_name}</Typography.Text> : null}
        </Space>
      ),
    },
    {
      title: '计费方式',
      key: 'billing',
      width: 170,
      filters: [
        { text: '倍率计费', value: 'token' },
        { text: '固定/按次', value: 'fixed' },
        { text: '阶梯计费', value: 'tiered' },
      ],
      onFilter: (value, record) => (value === 'tiered' ? isTieredRow(record) : value === 'fixed' ? isFixedRow(record) : !isTieredRow(record) && !isFixedRow(record)),
      render: (_: unknown, record) => (
        <Space size={4} wrap>
          {isTieredRow(record) ? (
            <Tooltip title={`共 ${record.tiers?.length ?? 0} 档`}>
              <Tag color="purple" icon={<AppstoreOutlined />}>阶梯 ×{record.tiers?.length ?? 0}</Tag>
            </Tooltip>
          ) : isFixedRow(record) ? (
            <Tag color="gold">固定/按次</Tag>
          ) : (
            <Tag color="blue">倍率计费</Tag>
          )}
          <TimePricingTags record={record} />
        </Space>
      ),
    },
    {
      title: displayMode === 'price' ? '输入价格' : '模型倍率',
      key: 'input',
      width: 190,
      align: 'right',
      render: (_: unknown, record) => {
        if (isFixedRow(record)) {
          return <strong>{formatPricePerRequest(record.price_per_request ?? record.model_price)}</strong>;
        }
        if (displayMode === 'ratio' && record.instance_program !== 'sub2api' && !isTieredRow(record)) {
          return <strong>{formatRatio(record.model_ratio)}</strong>;
        }
        return (
          <Space direction="vertical" size={0}>
            <strong>{formatPricePerMillion(record.price_input)}</strong>
            {isTieredRow(record) ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>首档价，展开查看全部档位</Typography.Text> : null}
          </Space>
        );
      },
    },
    {
      title: displayMode === 'price' ? '输出价格' : '补全倍率',
      key: 'output',
      width: 170,
      align: 'right',
      render: (_: unknown, record) => {
        if (isFixedRow(record)) {
          return '-';
        }
        if (displayMode === 'ratio' && record.instance_program !== 'sub2api' && !isTieredRow(record)) {
          return formatRatio(record.completion_ratio);
        }
        return formatPricePerMillion(record.price_output);
      },
    },
    {
      title: '缓存价格',
      key: 'cache',
      width: 210,
      align: 'right',
      render: (_: unknown, record) => {
        if (isFixedRow(record)) {
          return '-';
        }
        if (record.price_cache_read == null && record.price_cache_write == null && record.price_cache_write_1h == null) {
          return '-';
        }
        return (
          <Space direction="vertical" size={0} align="end">
            <span>读 {formatPricePerMillion(record.price_cache_read)}</span>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              写 {formatPricePerMillion(record.price_cache_write)}
              {record.price_cache_write_1h != null ? ` / 1h ${formatPricePerMillion(record.price_cache_write_1h)}` : ''}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '可用分组',
      dataIndex: 'enable_groups',
      key: 'enable_groups',
      width: 220,
      render: (value: string[]) =>
        value.length ? (
          <Tooltip title={value.join('、')}>
            <Space size={4} wrap>
              {value.slice(0, 3).map((item) => <Tag key={item}>{item}</Tag>)}
              {value.length > 3 ? <Tag>+{value.length - 3}</Tag> : null}
            </Space>
          </Tooltip>
        ) : (
          '-'
        ),
    },
    {
      title: '快照时间',
      dataIndex: 'snapshot_at',
      key: 'snapshot_at',
      width: 170,
      render: (value: string) => formatDateTime(value),
    },
  ];

  const compareInstances = compareData?.instances ?? [];
  const compareColumns: ColumnsType<PricingCompareModelRow> = [
    {
      title: '模型',
      dataIndex: 'model_name',
      key: 'model_name',
      fixed: 'left',
      width: 240,
      render: (value: string, record) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 600 }}>{value}</span>
          {record.vendor_name ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{record.vendor_name}</Typography.Text> : null}
        </Space>
      ),
    },
    ...compareInstances.map((instance) => ({
      title: (
        <Space size={4}>
          <span>{instance.instance_name}</span>
          {programTag(instance.program)}
        </Space>
      ),
      key: `instance-${instance.instance_id}`,
      width: 210,
      render: (_: unknown, record: PricingCompareModelRow) => {
        const entry = record.entries.find((item) => item.instance_id === instance.instance_id);
        if (!entry) {
          return <Typography.Text type="secondary">未上架</Typography.Text>;
        }
        const price = entry.effective_input ?? entry.price_input;
        const isBest = record.best_instance_id === entry.instance_id;
        const ratioSuffix = entry.min_group_ratio != null && entry.min_group_ratio !== 1 ? ` ×${Number.parseFloat(entry.min_group_ratio.toFixed(4))}` : '';
        return (
          <Space direction="vertical" size={2}>
            {entry.price_per_request != null ? (
              <strong>{formatPricePerRequest(entry.price_per_request)}</strong>
            ) : (
              <strong style={{ color: isBest ? undefined : undefined }}>
                {formatPricePerMillion(price)}
                {ratioSuffix ? <Typography.Text type="secondary" style={{ fontWeight: 400 }}>{ratioSuffix}</Typography.Text> : null}
              </strong>
            )}
            <Space size={4} wrap>
              {isBest ? <Tag color="green" icon={<ThunderboltOutlined />}>最低</Tag> : null}
              {entry.tier_count > 1 ? <Tag color="purple">阶梯 ×{entry.tier_count}</Tag> : null}
              {entry.has_time_pricing ? <Tag color="orange">分时</Tag> : null}
            </Space>
          </Space>
        );
      },
    })),
  ];

  return (
    <div className="page-stack">
      <Card className="section-card ratio-hero-card">
        <Space direction="vertical" size={4}>
          <Typography.Title level={4} style={{ margin: 0 }}><DollarOutlined /> 定价模型</Typography.Title>
          <Typography.Text type="secondary">
            价格统一换算为美元/1M tokens：NewAPI 按模型倍率与站点 quota_per_unit 换算；Sub2API 直接读取模型广场单价（未含分组倍率）。
            阶梯与分时计价展开行查看明细；对比模式高亮同模型最低价。
          </Typography.Text>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={12} lg={4}><Card><Statistic title="模型总数" value={viewMode === 'detail' ? summary.total : (compareData?.total ?? 0)} /></Card></Col>
        <Col xs={12} lg={4}><Card><Statistic title="当前页倍率计费" value={summary.tokenModels} /></Card></Col>
        <Col xs={12} lg={4}><Card><Statistic title="当前页固定/按次" value={summary.fixedModels} /></Card></Col>
        <Col xs={12} lg={4}><Card><Statistic title="当前页阶梯计费" value={summary.tieredModels} /></Card></Col>
        <Col xs={12} lg={4}><Card><Statistic title="当前页分时计价" value={summary.timePriced} /></Card></Col>
        <Col xs={12} lg={4}><Card><Statistic title="覆盖实例" value={facetData?.instance_count ?? 0} /></Card></Col>
      </Row>

      <Alert
        showIcon
        icon={<InfoCircleOutlined />}
        type="info"
        message="NewAPI 实际消耗 = 输入/输出/缓存价 × 分组倍率；Sub2API 实际消耗 = 广场单价 × 分组（或个人专属）倍率，高峰时段再乘高峰倍率。"
      />

      <div className="table-toolbar">
        <div className="table-toolbar-left">
          <Select
            allowClear
            placeholder="按标签筛选"
            style={{ width: 160 }}
            options={tagOptions}
            value={tag}
            onChange={(value) => {
              setTag(value);
              setInstanceId(undefined);
              setCompareInstanceIds([]);
              setPage(1);
            }}
          />
          {viewMode === 'detail' ? (
            <Select
              allowClear
              showSearch
              placeholder="按实例筛选"
              style={{ width: 180 }}
              options={instanceOptions}
              value={instanceId}
              onChange={(value) => {
                setInstanceId(value);
                setPage(1);
              }}
            />
          ) : (
            <Select
              allowClear
              mode="multiple"
              showSearch
              placeholder="对比实例（默认全部）"
              style={{ minWidth: 240 }}
              options={instanceOptions}
              value={compareInstanceIds}
              onChange={(value) => {
                setCompareInstanceIds(value);
                setPage(1);
              }}
            />
          )}
          <Input.Search
            allowClear
            placeholder="搜索模型/供应商"
            style={{ width: 220 }}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <Select
            allowClear
            showSearch
            placeholder="按分组筛选"
            style={{ width: 160 }}
            options={(facetData?.groups ?? []).map((item) => ({ label: item, value: item }))}
            value={groupName}
            onChange={(value) => {
              setGroupName(value);
              setPage(1);
            }}
          />
          <Select
            showSearch
            placeholder="计费类型"
            style={{ width: 140 }}
            options={BILLING_KIND_OPTIONS}
            value={billingKind}
            onChange={(value) => {
              setBillingKind(value);
              setPage(1);
            }}
          />
          <Select
            allowClear
            showSearch
            placeholder="供应商"
            style={{ width: 160 }}
            options={(facetData?.vendors ?? []).map((item) => ({ label: item, value: item }))}
            value={vendor}
            onChange={(value) => {
              setVendor(value);
              setPage(1);
            }}
          />
        </div>
        <div className="table-toolbar-right">
          <Segmented
            value={displayMode}
            onChange={(value) => setDisplayMode(value as PricingDisplayMode)}
            options={[
              { label: '美元价格', value: 'price' },
              { label: '倍率', value: 'ratio' },
            ]}
          />
          <Segmented
            value={viewMode}
            onChange={(value) => {
              setViewMode(value as PricingViewMode);
              setPage(1);
            }}
            options={[
              { label: '明细', value: 'detail', icon: <SwapOutlined /> },
              { label: '跨实例对比', value: 'compare', icon: <ThunderboltOutlined /> },
            ]}
          />
        </div>
      </div>

      {viewMode === 'detail' ? (
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={data?.items ?? []}
          locale={{ emptyText: <Empty description="暂无定价模型数据" /> }}
          scroll={{ x: 1420 }}
          pagination={paginationConfig}
          columns={detailColumns}
          expandable={{
            rowExpandable: (record) => isTieredRow(record) || Boolean(record.tiers?.length) || Boolean(record.billing_expr) || Boolean(record.time_pricing?.periods?.length) || Boolean(record.extra && Object.values(record.extra).some(v => v != null)),
            expandedRowRender: (record) => (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {record.tiers?.length ? <TierTable tiers={record.tiers} /> : null}
                {record.time_pricing?.periods?.length ? (
                  <Space size={4} wrap>
                    <Typography.Text type="secondary">分时段：</Typography.Text>
                    {record.time_pricing.periods.map((period) => (
                      <Tag key={`${period.start_time}-${period.end_time}`} color="orange">
                        {formatClock(period.start_time)}–{formatClock(period.end_time)} ×{period.multiplier}
                      </Tag>
                    ))}
                    {record.time_pricing.weekdays_only ? <Tag>仅工作日</Tag> : null}
                    {record.time_pricing.timezone ? <Tag>时区 {record.time_pricing.timezone}</Tag> : null}
                  </Space>
                ) : null}
                {/* 图片/音频等扩展价格（NewAPI 倍率字段 / Sub2API 显式价格） */}
                {(record.extra?.image_ratio != null ||
                  record.extra?.audio_ratio != null ||
                  record.extra?.audio_completion_ratio != null ||
                  record.extra?.image_input_price != null ||
                  record.extra?.image_output_price != null) && (
                  <Space size={4} wrap>
                    {record.extra?.image_ratio != null ? (
                      <Tag color="purple">图片倍率 {formatRatio(record.extra.image_ratio)}</Tag>
                    ) : null}
                    {record.extra?.audio_ratio != null ? (
                      <Tag color="purple">音频倍率 {formatRatio(record.extra.audio_ratio)}</Tag>
                    ) : null}
                    {record.extra?.audio_completion_ratio != null ? (
                      <Tag color="purple">音频补全 {formatRatio(record.extra.audio_completion_ratio)}</Tag>
                    ) : null}
                    {record.extra?.image_input_price != null ? (
                      <Tag color="purple">图片输入 {formatPricePerMillion(record.extra.image_input_price)}</Tag>
                    ) : null}
                    {record.extra?.image_output_price != null ? (
                      <Tag color="purple">图片输出 {formatPricePerMillion(record.extra.image_output_price)}</Tag>
                    ) : null}
                    {record.extra?.official_price_input != null ? (
                      <Tooltip title="官方参考价（未含分组倍率）">
                        <Tag>官方参考 {formatPricePerMillion(record.extra.official_price_input)}</Tag>
                      </Tooltip>
                    ) : null}
                    {record.extra?.long_context_basis ? (
                      <Tooltip title="长上下文阶梯计价基准：整单按所在档单价">
                        <Tag color="geekblue">{record.extra.long_context_basis === 'whole_request' ? '长上下文整单' : record.extra.long_context_basis}</Tag>
                      </Tooltip>
                    ) : null}
                  </Space>
                )}
                {record.billing_expr ? (
                  <Typography.Paragraph code copyable style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                    {record.billing_expr}
                  </Typography.Paragraph>
                ) : null}
              </Space>
            ),
          }}
        />
      ) : (
        <Table
          rowKey="model_name"
          loading={compareLoading}
          dataSource={compareData?.models ?? []}
          locale={{ emptyText: <Empty description="暂无对比数据，请先同步多个实例" /> }}
          scroll={{ x: 240 + compareInstances.length * 210 }}
          pagination={paginationConfig}
          columns={compareColumns}
        />
      )}
    </div>
  );
}
