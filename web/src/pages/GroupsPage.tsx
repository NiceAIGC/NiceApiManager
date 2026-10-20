import {
  BarChartOutlined,
  DeleteOutlined,
  EditOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  TagsOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Form } from 'antd';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createGroupLabel,
  deleteGroupLabel,
  fetchGroupComparison,
  fetchGroupLabels,
  fetchGroupNames,
  fetchGroups,
  updateGroupLabel,
} from '../api/groups';
import { fetchInstances } from '../api/instances';
import type { GroupCompareRow, GroupLabelItem, GroupRatioItem } from '../types/api';
import { formatClock, formatRatio } from '../utils/pricing';
import { formatDateTime } from '../utils/format';

type GroupsViewMode = 'detail' | 'compare';

const LABEL_COLORS = ['blue', 'geekblue', 'purple', 'cyan', 'green', 'orange', 'magenta', 'gold'];

function labelColor(label: GroupLabelItem): string {
  return LABEL_COLORS[label.id % LABEL_COLORS.length] ?? 'blue';
}

function ratioTagColor(ratio: number): string {
  return ratio > 1.05 ? 'orange' : ratio < 0.95 ? 'green' : 'blue';
}

function peakWindow(start?: string | null, end?: string | null, multiplier?: number | null) {
  if (!start || !end) {
    return null;
  }
  const label = `${formatClock(start)}–${formatClock(end)}${multiplier != null ? ` ×${Number.parseFloat(multiplier.toFixed(4))}` : ''}`;
  return (
    <Tooltip title="高峰时段内整单消耗额外乘以高峰倍率">
      <Tag color="orange">{label}</Tag>
    </Tooltip>
  );
}

function LabelEditModal({
  open,
  label,
  groupOptions,
  onClose,
}: {
  open: boolean;
  label: GroupLabelItem | null;
  groupOptions: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ name: string; remark?: string; group_names: string[] }>();

  const saveMutation = useMutation({
    mutationFn: async (values: { name: string; remark?: string; group_names: string[] }) => {
      if (label) {
        return updateGroupLabel(label.id, { name: values.name, remark: values.remark ?? null, group_names: values.group_names });
      }
      return createGroupLabel({ name: values.name, remark: values.remark ?? null, group_names: values.group_names });
    },
    onSuccess: () => {
      message.success(label ? '标签已更新' : '标签已创建');
      queryClient.invalidateQueries({ queryKey: ['group-labels'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['group-compare'] });
      onClose();
    },
    onError: (error) => {
      message.error(`保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    },
  });

  return (
    <Modal
      open={open}
      title={label ? `编辑标签：${label.name}` : '新建分组标签'}
      okText="保存"
      cancelText="取消"
      confirmLoading={saveMutation.isPending}
      afterOpenChange={(visible) => {
        if (visible) {
          form.setFieldsValue({
            name: label?.name ?? '',
            remark: label?.remark ?? undefined,
            group_names: label?.group_names ?? [],
          });
        } else {
          form.resetFields();
        }
      }}
      onOk={() => form.submit()}
      onCancel={onClose}
    >
      <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
        <Form.Item name="name" label="标签名称" rules={[{ required: true, message: '请输入标签名称' }]}>
          <Input placeholder="如：高倍率组 / Claude 专属 / 低价组" maxLength={100} />
        </Form.Item>
        <Form.Item name="remark" label="备注">
          <Input placeholder="可选" maxLength={255} />
        </Form.Item>
        <Form.Item
          name="group_names"
          label="包含分组"
          rules={[{ required: true, message: '请选择至少一个分组', type: 'array', min: 1 }]}
          extra="分组名在各实例间通用；对比视图会把同名分组的倍率放到同一行。"
        >
          <Select
            mode="multiple"
            showSearch
            allowClear
            placeholder="选择要打标签的分组"
            options={groupOptions.map((item) => ({ label: item, value: item }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function GroupsPage() {
  const [viewMode, setViewMode] = useState<GroupsViewMode>('detail');
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [instanceId, setInstanceId] = useState<number | undefined>(undefined);
  const [labelId, setLabelId] = useState<number | undefined>(undefined);
  const [compareLabelId, setCompareLabelId] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState<string | undefined>(undefined);
  const [labelModalOpen, setLabelModalOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<GroupLabelItem | null>(null);

  const queryClient = useQueryClient();

  const { data: instanceData } = useQuery({
    queryKey: ['instances', tag],
    queryFn: () => fetchInstances(tag ? { tags: [tag] } : undefined),
  });

  const { data: labelData } = useQuery({
    queryKey: ['group-labels'],
    queryFn: fetchGroupLabels,
  });

  const { data: groupNamesData } = useQuery({
    queryKey: ['group-names'],
    queryFn: fetchGroupNames,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['groups', tag, instanceId, labelId, search, platform],
    queryFn: () =>
      fetchGroups({
        instance_id: instanceId,
        tag,
        label_id: labelId,
        search: search || undefined,
        platform,
      }),
    enabled: viewMode === 'detail',
  });

  const { data: compareData, isLoading: compareLoading } = useQuery({
    queryKey: ['group-compare', compareLabelId, tag],
    queryFn: () => fetchGroupComparison({ label_id: compareLabelId, tag }),
    enabled: viewMode === 'compare' && compareLabelId !== undefined,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteGroupLabel(id),
    onSuccess: () => {
      message.success('标签已删除');
      queryClient.invalidateQueries({ queryKey: ['group-labels'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: (error) => {
      message.error(`删除失败：${error instanceof Error ? error.message : '未知错误'}`);
    },
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

  const platformOptions = useMemo(() => {
    const platforms = new Set<string>();
    for (const item of data?.items ?? []) {
      if (item.platform) {
        platforms.add(item.platform);
      }
    }
    return Array.from(platforms).sort().map((item) => ({ label: item, value: item }));
  }, [data?.items]);

  const labelOptions = (labelData?.items ?? []).map((item) => ({ label: item.name, value: item.id }));
  const labelsById = useMemo(() => {
    const mapping = new Map<number, GroupLabelItem>();
    for (const item of labelData?.items ?? []) {
      mapping.set(item.id, item);
    }
    return mapping;
  }, [labelData]);

  const summary = useMemo(() => {
    const rows = data?.items ?? [];
    const ratios = rows.map((item) => item.ratio);
    return {
      total: rows.length,
      instanceCount: new Set(rows.map((item) => item.instance_id)).size,
      groupCount: new Set(rows.map((item) => item.group_name)).size,
      min: ratios.length ? Math.min(...ratios) : 0,
      max: ratios.length ? Math.max(...ratios) : 0,
    };
  }, [data?.items]);

  const detailColumns: ColumnsType<GroupRatioItem> = [
    {
      title: '实例',
      dataIndex: 'instance_name',
      key: 'instance_name',
      fixed: 'left',
      width: 170,
      render: (value: string, record) => (
        <Space size={4}>
          <span>{value}</span>
          {record.instance_program === 'sub2api' ? <Tag color="geekblue">Sub2API</Tag> : <Tag color="blue">NewAPI</Tag>}
        </Space>
      ),
    },
    {
      title: '分组名',
      dataIndex: 'group_name',
      key: 'group_name',
      width: 180,
      render: (value: string, record) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 600 }}>{value}</span>
          {record.labels.length ? (
            <Space size={4} wrap>
              {record.labels.map((name) => {
                const source = (labelData?.items ?? []).find((item) => item.name === name);
                return source ? <Tag key={name} color={labelColor(source)}>{name}</Tag> : <Tag key={name}>{name}</Tag>;
              })}
            </Space>
          ) : null}
        </Space>
      ),
    },
    {
      title: '分组说明',
      dataIndex: 'group_desc',
      key: 'group_desc',
      ellipsis: true,
      render: (value?: string | null) => value || <Typography.Text type="secondary">未提供说明</Typography.Text>,
    },
    {
      title: '消费倍率',
      dataIndex: 'ratio',
      key: 'ratio',
      width: 130,
      sorter: (left, right) => left.ratio - right.ratio,
      defaultSortOrder: 'ascend',
      render: (value: number) => <Tag color={ratioTagColor(value)}>{formatRatio(value)}</Tag>,
    },
    {
      title: '个人倍率',
      dataIndex: 'user_ratio',
      key: 'user_ratio',
      width: 110,
      render: (value?: number | null) =>
        value == null ? '-' : <Tag color="cyan">{formatRatio(value)}</Tag>,
    },
    {
      title: '平台',
      dataIndex: 'platform',
      key: 'platform',
      width: 110,
      render: (value?: string | null) => value || '-',
    },
    {
      title: '高峰时段',
      key: 'peak',
      width: 190,
      render: (_: unknown, record) =>
        peakWindow(record.peak_start, record.peak_end, record.peak_ratio) ?? '-',
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

  const compareColumns: ColumnsType<GroupCompareRow> = [
    {
      title: '分组',
      dataIndex: 'group_name',
      key: 'group_name',
      fixed: 'left',
      width: 200,
      render: (value: string) => {
        const label = compareData?.label;
        return (
          <Space direction="vertical" size={0}>
            <span style={{ fontWeight: 600 }}>{value}</span>
            {label ? <Tag color={labelColor(label)}>{label.name}</Tag> : null}
          </Space>
        );
      },
    },
    ...compareInstances.map((instance) => ({
      title: (
        <Space size={4}>
          <span>{instance.instance_name}</span>
          {instance.program === 'sub2api' ? <Tag color="geekblue">Sub2API</Tag> : <Tag color="blue">NewAPI</Tag>}
        </Space>
      ),
      key: `instance-${instance.instance_id}`,
      width: 220,
      render: (_: unknown, record: GroupCompareRow) => {
        const entry = record.entries.find((item) => item.instance_id === instance.instance_id);
        if (!entry) {
          return <Typography.Text type="secondary">未提供</Typography.Text>;
        }
        const isBest = record.best_instance_id === entry.instance_id;
        return (
          <Space direction="vertical" size={2}>
            <Space size={4}>
              <Tag color={ratioTagColor(entry.ratio)}>{formatRatio(entry.ratio)}</Tag>
              {isBest ? <Tag color="green" icon={<ThunderboltOutlined />}>最低</Tag> : null}
            </Space>
            <Space size={4} wrap>
              {entry.user_ratio != null ? <Tag color="cyan">个人 {formatRatio(entry.user_ratio)}</Tag> : null}
              {peakWindow(entry.peak_start, entry.peak_end, entry.peak_ratio)}
              {entry.platform ? <Tag>{entry.platform}</Tag> : null}
            </Space>
          </Space>
        );
      },
    })),
    {
      title: '最低/最高',
      key: 'spread',
      width: 170,
      render: (_: unknown, record) =>
        record.min_ratio == null || record.max_ratio == null
          ? '-'
          : `${formatRatio(record.min_ratio)} / ${formatRatio(record.max_ratio)}`,
    },
    {
      title: '差值',
      dataIndex: 'spread',
      key: 'spread_value',
      width: 100,
      sorter: (left, right) => (left.spread ?? 0) - (right.spread ?? 0),
      render: (value?: number | null) =>
        value == null ? '-' : <Tag color={value > 0.1 ? 'red' : 'green'}>+{formatRatio(value)}</Tag>,
    },
  ];

  return (
    <div className="page-stack">
      <Card className="section-card ratio-hero-card">
        <Space direction="vertical" size={4}>
          <Typography.Title level={4} style={{ margin: 0 }}><BarChartOutlined /> 分组倍率</Typography.Title>
          <Typography.Text type="secondary">
            倍率越高，同一模型调用消耗的额度越多。可给分组打标签并在同标签下跨实例对比倍率；Sub2API 分组额外展示个人倍率、平台与高峰时段。
          </Typography.Text>
        </Space>
      </Card>

      {labelData?.items?.length ? (
        <Card size="small" title={<Space size={6}><TagsOutlined /> 标签管理</Space>}>
          <Space size={[8, 8]} wrap>
            {(labelData.items ?? []).map((item) => (
              <Tooltip key={item.id} title={`分组：${item.group_names.join('、') || '未分配'}${item.remark ? `；${item.remark}` : ''}`}>
                <Space size={4} style={{ padding: '2px 8px', border: '1px solid var(--border, #d9d9d9)', borderRadius: 6 }}>
                  <Tag color={labelColor(item)} style={{ marginInlineEnd: 0 }}>{item.name}</Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{item.group_names.length} 组</Typography.Text>
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setEditingLabel(item);
                      setLabelModalOpen(true);
                    }}
                  />
                  <Popconfirm title={`删除标签「${item.name}」？`} onConfirm={() => deleteMutation.mutate(item.id)}>
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              </Tooltip>
            ))}
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingLabel(null);
                setLabelModalOpen(true);
              }}
            >
              新建标签
            </Button>
          </Space>
        </Card>
      ) : (
        <Card size="small">
          <Space>
            <Typography.Text type="secondary">给分组打标签后可在同标签下对比各实例倍率。</Typography.Text>
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingLabel(null);
                setLabelModalOpen(true);
              }}
            >
              新建标签
            </Button>
          </Space>
        </Card>
      )}

      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}><Card><Statistic title="分组记录" value={summary.total} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="覆盖实例" value={summary.instanceCount} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="最低倍率" value={summary.min} suffix="x" precision={4} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="最高倍率" value={summary.max} suffix="x" precision={4} /></Card></Col>
      </Row>

      <Alert showIcon icon={<InfoCircleOutlined />} type="info" message="实际模型消耗通常为：模型基础价格 × 分组倍率（Sub2API 取个人倍率优先，高峰时段再乘高峰倍率）。不同上游计费规则可能存在固定价格或阶梯计费。" />

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
            }}
          />
          {viewMode === 'detail' ? (
            <>
              <Select
                allowClear
                showSearch
                placeholder="按实例筛选"
                style={{ width: 170 }}
                options={instanceOptions}
                value={instanceId}
                onChange={(value) => setInstanceId(value)}
              />
              <Select
                allowClear
                placeholder="按分组标签筛选"
                style={{ width: 160 }}
                options={labelOptions}
                value={labelId}
                onChange={(value) => setLabelId(value)}
              />
              <Input.Search
                allowClear
                placeholder="搜索分组名"
                style={{ width: 200 }}
                onSearch={(value) => setSearch(value)}
              />
              <Select
                allowClear
                placeholder="平台"
                style={{ width: 140 }}
                options={platformOptions}
                value={platform}
                onChange={(value) => setPlatform(value)}
              />
            </>
          ) : (
            <Select
              placeholder="选择对比标签"
              style={{ width: 200 }}
              options={labelOptions}
              value={compareLabelId}
              onChange={(value) => setCompareLabelId(value)}
            />
          )}
        </div>
        <div className="table-toolbar-right">
          <Segmented
            value={viewMode}
            onChange={(value) => setViewMode(value as GroupsViewMode)}
            options={[
              { label: '全部分组', value: 'detail' },
              { label: '标签对比', value: 'compare', icon: <ThunderboltOutlined /> },
            ]}
          />
        </div>
      </div>

      {viewMode === 'detail' ? (
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={data?.items ?? []}
          locale={{ emptyText: <Empty description="暂无分组倍率数据" /> }}
          scroll={{ x: 1280 }}
          pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (total) => `共 ${total} 项` }}
          columns={detailColumns}
        />
      ) : compareLabelId === undefined ? (
        <Card><Empty description="请先选择一个标签开始对比" /></Card>
      ) : (
        <Table
          rowKey="group_name"
          loading={compareLoading}
          dataSource={compareData?.rows ?? []}
          locale={{ emptyText: <Empty description="该标签下暂无可对比的分组数据" /> }}
          scroll={{ x: 200 + compareInstances.length * 220 }}
          pagination={false}
          columns={compareColumns}
        />
      )}

      <LabelEditModal
        open={labelModalOpen}
        label={editingLabel}
        groupOptions={groupNamesData?.items ?? []}
        onClose={() => {
          setLabelModalOpen(false);
          setEditingLabel(null);
          if (editingLabel === null && compareLabelId === undefined && labelData?.items?.length) {
            setCompareLabelId(labelData.items[labelData.items.length - 1].id);
          }
        }}
      />
    </div>
  );
}

