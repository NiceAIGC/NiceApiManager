import {
  Button,
  Card,
  Empty,
  Space,
  Select,
  Table,
  Tag,
  Typography,
  App,
  Descriptions,
  Modal,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, SyncOutlined } from '@ant-design/icons';
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
import { StatusTag } from '../components/StatusTag';
import type {
  BatchInstanceUpdatePayload,
  Instance,
  InstanceCreatePayload,
  InstanceTestResponse,
  InstanceUpdatePayload,
} from '../types/api';
import { getErrorMessage } from '../api/client';
import { formatDateTime, formatMoney, formatNumber } from '../utils/format';

const { Text } = Typography;

export function InstancesPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [batchCreateOpen, setBatchCreateOpen] = useState(false);
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | undefined>(undefined);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [testResult, setTestResult] = useState<InstanceTestResponse | null>(null);

  const { data: allInstancesData } = useQuery({
    queryKey: ['instances'],
    queryFn: () => fetchInstances(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['instances', selectedTag],
    queryFn: () => fetchInstances(selectedTag),
  });

  const createMutation = useMutation({
    mutationFn: (payload: InstanceCreatePayload) => createInstance(payload),
    onSuccess: async () => {
      message.success('实例创建成功');
      setCreateOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['instances'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] }),
      ]);
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const batchCreateMutation = useMutation({
    mutationFn: (payloads: InstanceCreatePayload[]) => createInstancesBatch(payloads),
    onSuccess: async (result) => {
      message.success(`批量新增完成，共创建 ${result.count} 个实例`);
      setBatchCreateOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['instances'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] }),
      ]);
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ instanceId, payload }: { instanceId: number; payload: InstanceUpdatePayload }) =>
      updateInstance(instanceId, payload),
    onSuccess: async () => {
      message.success('实例更新成功');
      setEditingInstance(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['instances'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['pricing-models'] }),
      ]);
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const batchUpdateMutation = useMutation({
    mutationFn: (payloads: BatchInstanceUpdatePayload[]) => updateInstancesBatch(payloads),
    onSuccess: async (result) => {
      message.success(`批量更新完成，共更新 ${result.count} 个实例`);
      setBatchEditOpen(false);
      setSelectedRowKeys([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['instances'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['pricing-models'] }),
      ]);
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => deleteInstancesBatch(ids),
    onSuccess: async (result) => {
      message.success(`批量删除完成，共删除 ${result.count} 个实例`);
      setSelectedRowKeys([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['instances'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['pricing-models'] }),
        queryClient.invalidateQueries({ queryKey: ['sync-runs'] }),
      ]);
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const testMutation = useMutation({
    mutationFn: (instanceId: number) => testInstance(instanceId),
    onSuccess: async (result) => {
      setTestResult(result);
      message.success('实例连通性测试成功');
      await queryClient.invalidateQueries({ queryKey: ['instances'] });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const syncMutation = useMutation({
    mutationFn: (instanceId: number) => syncInstance(instanceId),
    onSuccess: async () => {
      message.success('实例同步完成');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['instances'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['pricing-models'] }),
        queryClient.invalidateQueries({ queryKey: ['sync-runs'] }),
      ]);
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const syncAllMutation = useMutation({
    mutationFn: syncAllInstances,
    onSuccess: async (result) => {
      message.success(`批量同步完成：成功 ${result.success_count}，失败 ${result.failed_count}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['instances'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['pricing-models'] }),
        queryClient.invalidateQueries({ queryKey: ['sync-runs'] }),
      ]);
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const columns = useMemo(
    () => [
      {
        title: '实例',
        dataIndex: 'name',
        key: 'name',
        render: (value: string, record: Instance) => (
          <Space direction="vertical" size={0}>
            <Text strong>{value}</Text>
            <Text type="secondary">{record.base_url}</Text>
          </Space>
        ),
      },
      {
        title: '用户名',
        dataIndex: 'username',
        key: 'username',
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
        title: '状态',
        dataIndex: 'last_health_status',
        key: 'last_health_status',
        render: (value: string) => <StatusTag value={value} />,
      },
      {
        title: '启用',
        dataIndex: 'enabled',
        key: 'enabled',
        render: (value: boolean) => (value ? '启用' : '停用'),
      },
      {
        title: '兑换比',
        dataIndex: 'quota_per_unit',
        key: 'quota_per_unit',
        render: (value?: number | null) => formatNumber(value),
      },
      {
        title: '远端用户 ID',
        dataIndex: 'remote_user_id',
        key: 'remote_user_id',
        render: (value?: number | null) => value ?? '-',
      },
      {
        title: 'Session 过期',
        dataIndex: 'session_expires_at',
        key: 'session_expires_at',
        render: (value?: string | null) => formatDateTime(value),
      },
      {
        title: '最近同步',
        dataIndex: 'last_sync_at',
        key: 'last_sync_at',
        render: (value?: string | null) => formatDateTime(value),
      },
      {
        title: '错误信息',
        dataIndex: 'last_health_error',
        key: 'last_health_error',
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
        </div>
      </div>

      <Card
        className="section-card"
        title="实例列表"
        extra={
          <Space wrap>
            <Tag color={selectedInstances.length ? 'blue' : 'default'}>
              已选 {selectedInstances.length} 项
            </Tag>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => queryClient.invalidateQueries({ queryKey: ['instances'] })}
            >
              刷新
            </Button>
            <Button
              icon={<SyncOutlined />}
              loading={syncAllMutation.isPending}
              onClick={() => syncAllMutation.mutate()}
            >
              同步全部
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => setBatchCreateOpen(true)}>
              批量新增
            </Button>
            <Button
              icon={<EditOutlined />}
              disabled={!selectedInstances.length}
              onClick={() => setBatchEditOpen(true)}
            >
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
          </Space>
        }
      >
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={data?.items ?? []}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys.map((item) => Number(item))),
          }}
          columns={columns}
          scroll={{ x: 1280 }}
          locale={{ emptyText: <Empty description="暂无实例配置" /> }}
          pagination={false}
        />
      </Card>

      <InstanceCreateModal
        open={createOpen}
        loading={createMutation.isPending}
        mode="create"
        onCancel={() => setCreateOpen(false)}
        onSubmit={(values) => createMutation.mutate(values as InstanceCreatePayload)}
      />

      <InstanceBatchModal
        open={batchCreateOpen}
        loading={batchCreateMutation.isPending}
        mode="create"
        onCancel={() => setBatchCreateOpen(false)}
        onSubmit={(items) => batchCreateMutation.mutate(items as InstanceCreatePayload[])}
      />

      <InstanceCreateModal
        open={Boolean(editingInstance)}
        loading={updateMutation.isPending}
        mode="edit"
        initialValues={editingInstance}
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
            <Descriptions.Item label="内部额度">{formatNumber(testResult.quota)}</Descriptions.Item>
            <Descriptions.Item label="内部已用额度">{formatNumber(testResult.used_quota)}</Descriptions.Item>
            <Descriptions.Item label="显示额度">{formatMoney(testResult.display_quota)}</Descriptions.Item>
            <Descriptions.Item label="已用显示额度">{formatMoney(testResult.display_used_quota)}</Descriptions.Item>
            <Descriptions.Item label="quota_per_unit">
              {formatNumber(testResult.quota_per_unit)}
            </Descriptions.Item>
            <Descriptions.Item label="请求数">{testResult.request_count}</Descriptions.Item>
            <Descriptions.Item label="分组数量">{testResult.group_count}</Descriptions.Item>
            <Descriptions.Item label="定价模型数量">{testResult.pricing_model_count}</Descriptions.Item>
          </Descriptions>
        ) : null}
      </Modal>
    </div>
  );
}
