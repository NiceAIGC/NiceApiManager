import {
  App,
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Row,
  Col,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import {
  createInstance,
  createInstancesBatch,
  deleteInstancesBatch,
  fetchInstances,
  syncInstance,
  testInstance,
  updateInstance,
  updateInstancesBatch,
} from '../api/instances';
import { syncAllInstances } from '../api/sync';
import { InstanceBatchModal } from '../components/InstanceBatchModal';
import { InstanceCreateModal } from '../components/InstanceCreateModal';
import { StatCard } from '../components/StatCard';
import { StatusTag } from '../components/StatusTag';
import type {
  BatchInstanceUpdatePayload,
  Instance,
  InstanceCreatePayload,
  InstanceQuery,
  InstanceTestResponse,
  InstanceUpdatePayload,
} from '../types/api';
import { getErrorMessage } from '../api/client';
import { formatBillingMode, formatDateTime, formatMoney, formatNumber } from '../utils/format';

const { Text } = Typography;

export function InstancesPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [batchCreateOpen, setBatchCreateOpen] = useState(false);
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null);
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [billingMode, setBillingMode] = useState<'prepaid' | 'postpaid' | undefined>(undefined);
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);
  const [healthStatus, setHealthStatus] = useState<string | undefined>(undefined);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [testResult, setTestResult] = useState<InstanceTestResponse | null>(null);

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

  const { data: allInstancesData } = useQuery({
    queryKey: ['instances'],
    queryFn: () => fetchInstances(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['instances', filters],
    queryFn: () => fetchInstances(filters),
  });

  const refreshAllData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['instances'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-trends'] }),
      queryClient.invalidateQueries({ queryKey: ['groups'] }),
      queryClient.invalidateQueries({ queryKey: ['pricing-models'] }),
      queryClient.invalidateQueries({ queryKey: ['sync-runs'] }),
    ]);
  };

  const clearFilters = () => {
    setSearch('');
    setSelectedTags([]);
    setBillingMode(undefined);
    setEnabled(undefined);
    setHealthStatus(undefined);
    setSelectedRowKeys([]);
  };

  const autoSyncNewInstances = async (instances: Instance[]) => {
    if (!instances.length) {
      return;
    }

    message.info(`正在自动同步 ${instances.length} 个新实例...`);
    const results = await Promise.allSettled(instances.map((item) => syncInstance(item.id)));
    const failedCount = results.filter((item) => item.status === 'rejected').length;

    if (failedCount === 0) {
      message.success('新增实例已自动完成首次同步');
    } else {
      message.warning(`实例已创建，但自动同步失败 ${failedCount} 个，请稍后手动同步。`);
    }
  };

  const createMutation = useMutation({
    mutationFn: (payload: InstanceCreatePayload) => createInstance(payload),
    onSuccess: async (result) => {
      setCreateOpen(false);
      clearFilters();
      await autoSyncNewInstances([result]);
      await refreshAllData();
      message.success('实例创建成功');
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const batchCreateMutation = useMutation({
    mutationFn: (payloads: InstanceCreatePayload[]) => createInstancesBatch(payloads),
    onSuccess: async (result) => {
      setBatchCreateOpen(false);
      clearFilters();
      await autoSyncNewInstances(result.items);
      await refreshAllData();
      message.success(`批量新增完成，共创建 ${result.count} 个实例`);
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ instanceId, payload }: { instanceId: number; payload: InstanceUpdatePayload }) =>
      updateInstance(instanceId, payload),
    onSuccess: async () => {
      setEditingInstance(null);
      await refreshAllData();
      message.success('实例更新成功');
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const batchUpdateMutation = useMutation({
    mutationFn: (payloads: BatchInstanceUpdatePayload[]) => updateInstancesBatch(payloads),
    onSuccess: async (result) => {
      setBatchEditOpen(false);
      setSelectedRowKeys([]);
      await refreshAllData();
      message.success(`批量更新完成，共更新 ${result.count} 个实例`);
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => deleteInstancesBatch(ids),
    onSuccess: async (result) => {
      setSelectedRowKeys([]);
      await refreshAllData();
      message.success(`批量删除完成，共删除 ${result.count} 个实例`);
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const testMutation = useMutation({
    mutationFn: (instanceId: number) => testInstance(instanceId),
    onSuccess: async (result) => {
      setTestResult(result);
      await refreshAllData();
      message.success('实例连通性测试成功');
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const syncMutation = useMutation({
    mutationFn: (instanceId: number) => syncInstance(instanceId),
    onSuccess: async () => {
      await refreshAllData();
      message.success('实例同步完成');
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const syncAllMutation = useMutation({
    mutationFn: syncAllInstances,
    onSuccess: async (result) => {
      await refreshAllData();
      message.success(`批量同步完成：成功 ${result.success_count}，失败 ${result.failed_count}`);
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const item of allInstancesData?.items ?? []) {
      for (const tag of item.tags) {
        tags.add(tag);
      }
    }

    return Array.from(tags)
      .sort()
      .map((tag) => ({ label: tag, value: tag }));
  }, [allInstancesData]);

  const selectedInstances = useMemo(() => {
    const selectedIds = new Set(selectedRowKeys.map((item) => Number(item)));
    return (allInstancesData?.items ?? []).filter((item) => selectedIds.has(item.id));
  }, [allInstancesData, selectedRowKeys]);

  const summary = useMemo(
    () =>
      (data?.items ?? []).reduce(
        (acc, item) => {
          acc.instanceCount += 1;
          if (item.enabled) {
            acc.enabledCount += 1;
          }
          if (item.last_health_status === 'healthy') {
            acc.healthyCount += 1;
          }
          if (item.billing_mode === 'postpaid') {
            acc.postpaidCount += 1;
          }
          acc.totalBalance += item.latest_display_quota ?? 0;
          acc.totalUsed += item.latest_display_used_quota ?? 0;
          acc.todayRequests += item.today_request_count ?? 0;
          return acc;
        },
        {
          instanceCount: 0,
          enabledCount: 0,
          healthyCount: 0,
          postpaidCount: 0,
          totalBalance: 0,
          totalUsed: 0,
          todayRequests: 0,
        },
      ),
    [data?.items],
  );

  const handleBatchDelete = async () => {
    if (!selectedInstances.length) {
      return;
    }

    modal.confirm({
      title: '确认批量删除',
      content: `将删除选中的 ${selectedInstances.length} 个实例，此操作不可恢复。`,
      okText: '确认删除',
      okButtonProps: { danger: true, loading: batchDeleteMutation.isPending },
      cancelText: '取消',
      onOk: async () => {
        await batchDeleteMutation.mutateAsync(selectedInstances.map((item) => item.id));
      },
    });
  };

  const columns = useMemo(
    () => [
      {
        title: '实例',
        dataIndex: 'name',
        key: 'name',
        fixed: 'left' as const,
        width: 260,
        render: (value: string, record: Instance) => (
          <Space direction="vertical" size={0}>
            <Text strong>{value}</Text>
            <Text type="secondary">{record.base_url}</Text>
            <Text type="secondary">用户：{record.username}</Text>
          </Space>
        ),
      },
      {
        title: '计费方式',
        dataIndex: 'billing_mode',
        key: 'billing_mode',
        width: 120,
        render: (value: Instance['billing_mode']) => (
          <Tag color={value === 'postpaid' ? 'processing' : 'gold'}>
            {formatBillingMode(value)}
          </Tag>
        ),
      },
      {
        title: '标签',
        dataIndex: 'tags',
        key: 'tags',
        width: 220,
        render: (value: string[]) => (
          <Space wrap>
            {value.length ? value.map((item) => <Tag key={item}>{item}</Tag>) : '-'}
          </Space>
        ),
      },
      {
        title: '状态',
        dataIndex: 'last_health_status',
        key: 'last_health_status',
        width: 110,
        render: (value: string) => <StatusTag value={value} />,
      },
      {
        title: '启用',
        dataIndex: 'enabled',
        key: 'enabled',
        width: 90,
        render: (value: boolean) => (value ? '启用' : '停用'),
      },
      {
        title: '当前分组',
        dataIndex: 'latest_group_name',
        key: 'latest_group_name',
        width: 120,
        render: (value?: string | null) => value || '-',
      },
      {
        title: '当前余额',
        dataIndex: 'latest_display_quota',
        key: 'latest_display_quota',
        width: 120,
        render: (value: number | null | undefined, record: Instance) =>
          record.billing_mode === 'postpaid' ? '-' : formatMoney(value),
      },
      {
        title: '周期已用额度',
        dataIndex: 'latest_display_used_quota',
        key: 'latest_display_used_quota',
        width: 130,
        render: (value?: number | null) => formatMoney(value),
      },
      {
        title: '今日请求数',
        dataIndex: 'today_request_count',
        key: 'today_request_count',
        width: 120,
        render: (value?: number | null) => formatNumber(value),
      },
      {
        title: '累计请求数',
        dataIndex: 'latest_request_count',
        key: 'latest_request_count',
        width: 120,
        render: (value?: number | null) => formatNumber(value),
      },
      {
        title: '兑换比',
        dataIndex: 'quota_per_unit',
        key: 'quota_per_unit',
        width: 110,
        render: (value?: number | null) => formatNumber(value),
      },
      {
        title: '远端用户 ID',
        dataIndex: 'remote_user_id',
        key: 'remote_user_id',
        width: 120,
        render: (value?: number | null) => value ?? '-',
      },
      {
        title: 'Session 过期',
        dataIndex: 'session_expires_at',
        key: 'session_expires_at',
        width: 180,
        render: (value?: string | null) => formatDateTime(value),
      },
      {
        title: '最近同步',
        dataIndex: 'last_sync_at',
        key: 'last_sync_at',
        width: 180,
        render: (value?: string | null) => formatDateTime(value),
      },
      {
        title: '错误信息',
        dataIndex: 'last_health_error',
        key: 'last_health_error',
        width: 220,
        render: (value?: string | null) => value || '-',
      },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right' as const,
        width: 220,
        render: (_: unknown, record: Instance) => (
          <Space size={6} className="instance-action-row">
            <Button size="small" icon={<EditOutlined />} onClick={() => setEditingInstance(record)}>
              编辑
            </Button>
            <Button
              size="small"
              icon={<SafetyCertificateOutlined />}
              loading={testMutation.isPending && testMutation.variables === record.id}
              onClick={() => testMutation.mutate(record.id)}
            >
              测试
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<SyncOutlined />}
              loading={syncMutation.isPending && syncMutation.variables === record.id}
              onClick={() => syncMutation.mutate(record.id)}
            >
              同步
            </Button>
          </Space>
        ),
      },
    ],
    [syncMutation, testMutation],
  );

  return (
    <div className="page-stack">
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={4}>
          <StatCard title="实例总数" value={formatNumber(summary.instanceCount)} />
        </Col>
        <Col xs={24} md={12} xl={4}>
          <StatCard title="启用实例" value={formatNumber(summary.enabledCount)} />
        </Col>
        <Col xs={24} md={12} xl={4}>
          <StatCard title="健康实例" value={formatNumber(summary.healthyCount)} />
        </Col>
        <Col xs={24} md={12} xl={4}>
          <StatCard title="后付费实例" value={formatNumber(summary.postpaidCount)} />
        </Col>
        <Col xs={24} md={12} xl={4}>
          <StatCard title="预付费余额" value={formatMoney(summary.totalBalance)} />
        </Col>
        <Col xs={24} md={12} xl={4}>
          <StatCard title="周期已用额度" value={formatMoney(summary.totalUsed)} />
        </Col>
        <Col xs={24} md={12} xl={4}>
          <StatCard title="今日请求数" value={formatNumber(summary.todayRequests)} />
        </Col>
      </Row>

      <Card className="section-card" title="实例列表">
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
            <Tag color={selectedInstances.length ? 'blue' : 'default'}>已选 {selectedInstances.length} 项</Tag>
            <Button icon={<ReloadOutlined />} onClick={() => refreshAllData()}>
              刷新
            </Button>
            <Button icon={<SyncOutlined />} loading={syncAllMutation.isPending} onClick={() => syncAllMutation.mutate()}>
              同步全部
            </Button>
            <Button onClick={clearFilters}>清空筛选</Button>
            <Button icon={<PlusOutlined />} onClick={() => setBatchCreateOpen(true)}>
              批量新增
            </Button>
            <Button icon={<EditOutlined />} disabled={!selectedInstances.length} onClick={() => setBatchEditOpen(true)}>
              批量编辑
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              disabled={!selectedInstances.length}
              loading={batchDeleteMutation.isPending}
              onClick={handleBatchDelete}
            >
              批量删除
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              新增实例
            </Button>
          </div>
        </div>

        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={data?.items ?? []}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys.map((item) => Number(item))),
          }}
          columns={columns}
          scroll={{ x: 2200 }}
          locale={{ emptyText: <Empty description="暂无实例配置" /> }}
          pagination={false}
        />
      </Card>

      <InstanceCreateModal
        open={createOpen}
        loading={createMutation.isPending}
        mode="create"
        tagOptions={tagOptions}
        onCancel={() => setCreateOpen(false)}
        onSubmit={(values) => createMutation.mutate(values as InstanceCreatePayload)}
      />

      <InstanceBatchModal
        open={batchCreateOpen}
        loading={batchCreateMutation.isPending}
        mode="create"
        tagOptions={tagOptions}
        onCancel={() => setBatchCreateOpen(false)}
        onSubmit={(items) => batchCreateMutation.mutate(items as InstanceCreatePayload[])}
      />

      <InstanceCreateModal
        open={Boolean(editingInstance)}
        loading={updateMutation.isPending}
        mode="edit"
        initialValues={editingInstance}
        tagOptions={tagOptions}
        onCancel={() => setEditingInstance(null)}
        onSubmit={(values) =>
          editingInstance
            ? updateMutation.mutate({
                instanceId: editingInstance.id,
                payload: values as InstanceUpdatePayload,
              })
            : undefined
        }
      />

      <InstanceBatchModal
        open={batchEditOpen}
        loading={batchUpdateMutation.isPending}
        mode="edit"
        initialItems={selectedInstances}
        tagOptions={tagOptions}
        onCancel={() => setBatchEditOpen(false)}
        onSubmit={(items) => batchUpdateMutation.mutate(items as BatchInstanceUpdatePayload[])}
      />

      <Modal
        title="测试结果"
        open={Boolean(testResult)}
        onCancel={() => setTestResult(null)}
        footer={null}
        destroyOnHidden
      >
        {testResult ? (
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="远端用户 ID">{testResult.remote_user_id}</Descriptions.Item>
            <Descriptions.Item label="远端用户名">{testResult.remote_username}</Descriptions.Item>
            <Descriptions.Item label="远端分组">{testResult.remote_group || '-'}</Descriptions.Item>
            <Descriptions.Item label="计费方式">{formatBillingMode(testResult.billing_mode)}</Descriptions.Item>
            {testResult.billing_mode === 'prepaid' ? (
              <Descriptions.Item label="内部额度">{formatNumber(testResult.quota)}</Descriptions.Item>
            ) : null}
            <Descriptions.Item label="内部已用额度">{formatNumber(testResult.used_quota)}</Descriptions.Item>
            {testResult.billing_mode === 'prepaid' ? (
              <Descriptions.Item label="显示余额">{formatMoney(testResult.display_quota)}</Descriptions.Item>
            ) : null}
            <Descriptions.Item label="周期已用额度">{formatMoney(testResult.display_used_quota)}</Descriptions.Item>
            <Descriptions.Item label="quota_per_unit">{formatNumber(testResult.quota_per_unit)}</Descriptions.Item>
            <Descriptions.Item label="请求数">{testResult.request_count}</Descriptions.Item>
            <Descriptions.Item label="分组数量">{testResult.group_count}</Descriptions.Item>
            <Descriptions.Item label="定价模型数量">{testResult.pricing_model_count}</Descriptions.Item>
          </Descriptions>
        ) : null}
      </Modal>
    </div>
  );
}
