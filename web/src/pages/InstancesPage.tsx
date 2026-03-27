import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Input,
  Modal,
  Rate,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableColumnsType, TablePaginationConfig } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

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
import { fetchAppSettings } from '../api/settings';
import { InstanceBatchModal } from '../components/InstanceBatchModal';
import { InstanceCreateModal } from '../components/InstanceCreateModal';
import { StatCard } from '../components/StatCard';
import { StatusTag } from '../components/StatusTag';
import { SyncProgressModal, type SyncProgressItem } from '../components/SyncProgressModal';
import type {
  BatchInstanceUpdatePayload,
  Instance,
  InstanceCreatePayload,
  InstanceQuery,
  InstanceTestResponse,
  InstanceUpdatePayload,
} from '../types/api';
import { getErrorMessage } from '../api/client';
import { runBatchSyncWithConcurrency } from '../utils/batchSync';
import {
  formatBillingMode,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatProgramType,
  getBillingModeTagColor,
} from '../utils/format';

const { Text, Link } = Typography;

interface SyncProgressState {
  open: boolean;
  running: boolean;
  total: number;
  completed: number;
  successCount: number;
  failedCount: number;
  activeNames: string[];
  items: SyncProgressItem[];
}

const INITIAL_SYNC_PROGRESS: SyncProgressState = {
  open: false,
  running: false,
  total: 0,
  completed: 0,
  successCount: 0,
  failedCount: 0,
  activeNames: [],
  items: [],
};

const PAGE_SIZE_OPTIONS = [20, 50, 100, 1000];

function getBalanceBadgeClass(value?: number | null) {
  if (value == null) {
    return 'quota-badge-empty';
  }
  if (value < 20) {
    return 'quota-badge-negative';
  }
  if (value < 100) {
    return 'quota-badge-medium';
  }
  return 'quota-badge-high';
}

function formatProxyMode(instance: Instance) {
  if (instance.proxy_mode === 'custom') {
    return { label: '自定义 SOCKS5', color: 'purple' as const };
  }
  if (instance.proxy_mode === 'global') {
    return { label: '公用 SOCKS5', color: 'blue' as const };
  }
  return { label: '直连', color: 'default' as const };
}

function renderCompactTags(tags: string[]) {
  if (!tags.length) {
    return <Text type="secondary">-</Text>;
  }

  const visibleTags = tags.slice(0, 2);
  const hiddenCount = tags.length - visibleTags.length;

  return (
    <Space size={[4, 4]} wrap>
      {visibleTags.map((tag) => (
        <Tag key={tag}>{tag}</Tag>
      ))}
      {hiddenCount > 0 ? <Tag>{`+${hiddenCount}`}</Tag> : null}
    </Space>
  );
}

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
  const [syncProgress, setSyncProgress] = useState<SyncProgressState>(INITIAL_SYNC_PROGRESS);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

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

  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  const { data: allInstancesData } = useQuery({
    queryKey: ['instances'],
    queryFn: () => fetchInstances(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['instances', filters],
    queryFn: () => fetchInstances(filters),
  });

  const { data: appSettingsData } = useQuery({
    queryKey: ['app-settings'],
    queryFn: fetchAppSettings,
  });

  const refreshAllData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['instances'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-trends'] }),
      queryClient.invalidateQueries({ queryKey: ['groups'] }),
      queryClient.invalidateQueries({ queryKey: ['pricing-models'] }),
      queryClient.invalidateQueries({ queryKey: ['sync-runs'] }),
      queryClient.invalidateQueries({ queryKey: ['app-settings'] }),
    ]);
  };

  const clearFilters = () => {
    setSearch('');
    setSelectedTags([]);
    setBillingMode(undefined);
    setEnabled(undefined);
    setHealthStatus(undefined);
    setSelectedRowKeys([]);
    setCurrentPage(1);
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

  const syncTargets = useMemo(
    () =>
      (data?.items ?? [])
        .filter((item) => item.enabled)
        .map((item) => ({ id: item.id, name: item.name })),
    [data?.items],
  );

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
      activeNames: [],
      items: syncTargets.map((item) => ({
        key: item.id,
        name: item.name,
        status: 'pending',
      })),
    });

    try {
      const result = await runBatchSyncWithConcurrency({
        targets: syncTargets,
        maxWorkers: appSettingsData?.sync_max_workers ?? 5,
        syncOne: syncInstance,
        onStateChange: ({ running, completed, successCount, failedCount, activeNames, items }) => {
          setSyncProgress({
            open: true,
            running,
            total: syncTargets.length,
            completed,
            successCount,
            failedCount,
            activeNames,
            items,
          });
        },
      });

      await refreshAllData();

      if (result.failedCount) {
        message.warning(
          `同步完成：成功 ${result.successCount}，失败 ${result.failedCount}，并发 ${appSettingsData?.sync_max_workers ?? 5}`,
        );
        return;
      }

      message.success(`已完成 ${result.successCount} 个实例同步，并发 ${appSettingsData?.sync_max_workers ?? 5}`);
    } catch (error) {
      setSyncProgress((current) => ({
        ...current,
        running: false,
        activeNames: [],
      }));
      message.error(getErrorMessage(error));
    }
  };

  const columns = useMemo<TableColumnsType<Instance>>(
    () => [
      {
        title: '优先级',
        dataIndex: 'priority',
        key: 'priority',
        width: 150,
        defaultSortOrder: 'descend',
        sorter: (left, right) => left.priority - right.priority,
        render: (value: number) => <Rate disabled count={5} value={value} />,
      },
      {
        title: '实例',
        dataIndex: 'name',
        key: 'name',
        fixed: 'left',
        width: 240,
        sorter: (left, right) => left.name.localeCompare(right.name),
        render: (value: string, record) => (
          <Space direction="vertical" size={4}>
            <Text strong>{value}</Text>
            <Space size={[4, 4]} wrap>
              <StatusTag value={record.last_health_status} />
              <Tag color={getBillingModeTagColor(record.billing_mode)}>{formatBillingMode(record.billing_mode)}</Tag>
              <Tag>{formatProgramType(record.program_type)}</Tag>
            </Space>
          </Space>
        ),
      },
      {
        title: '标签',
        dataIndex: 'tags',
        key: 'tags',
        width: 170,
        render: (value: string[]) => renderCompactTags(value),
      },
      {
        title: '当前余额',
        dataIndex: 'latest_display_quota',
        key: 'latest_display_quota',
        width: 120,
        sorter: (left, right) => (left.latest_display_quota ?? -1) - (right.latest_display_quota ?? -1),
        render: (value: number | null | undefined, record) =>
          record.billing_mode === 'postpaid' ? (
            '-'
          ) : (
            <span className={`quota-badge ${getBalanceBadgeClass(value)}`}>{formatMoney(value)}</span>
          ),
      },
      {
        title: '周期已用',
        dataIndex: 'latest_display_used_quota',
        key: 'latest_display_used_quota',
        width: 120,
        sorter: (left, right) => (left.latest_display_used_quota ?? 0) - (right.latest_display_used_quota ?? 0),
        render: (value?: number | null) => formatMoney(value),
      },
      {
        title: '今日请求',
        dataIndex: 'today_request_count',
        key: 'today_request_count',
        width: 110,
        sorter: (left, right) => left.today_request_count - right.today_request_count,
        render: (value: number) => formatNumber(value),
      },
      {
        title: '同步周期',
        dataIndex: 'sync_interval_minutes',
        key: 'sync_interval_minutes',
        width: 120,
        sorter: (left, right) => left.sync_interval_minutes - right.sync_interval_minutes,
        render: (value: number) => `${value} 分钟`,
      },
      {
        title: '代理方式',
        dataIndex: 'proxy_mode',
        key: 'proxy_mode',
        width: 130,
        sorter: (left, right) => left.proxy_mode.localeCompare(right.proxy_mode),
        render: (_: string, record) => {
          const proxyMeta = formatProxyMode(record);
          return <Tag color={proxyMeta.color}>{proxyMeta.label}</Tag>;
        },
      },
      {
        title: '最近同步',
        dataIndex: 'last_sync_at',
        key: 'last_sync_at',
        width: 180,
        sorter: (left, right) => new Date(left.last_sync_at ?? 0).getTime() - new Date(right.last_sync_at ?? 0).getTime(),
        render: (value?: string | null) => formatDateTime(value),
      },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        width: 220,
        render: (_: unknown, record: Instance) => (
          <Space size={6}>
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

  const pagination: TablePaginationConfig = {
    current: currentPage,
    pageSize,
    total: data?.total ?? 0,
    showSizeChanger: true,
    pageSizeOptions: PAGE_SIZE_OPTIONS.map(String),
    showQuickJumper: (data?.total ?? 0) > 100,
    showTotal: (total, range) => `第 ${range[0]}-${range[1]} 项，共 ${total} 项`,
  };

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
              style={{ width: 240 }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Select
              mode="multiple"
              allowClear
              placeholder="按标签筛选"
              style={{ width: 220 }}
              options={tagOptions}
              value={selectedTags}
              onChange={(value) => setSelectedTags(value)}
            />
            <Select
              allowClear
              placeholder="按计费方式筛选"
              style={{ width: 150 }}
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
              style={{ width: 150 }}
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
              style={{ width: 150 }}
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
            <Button icon={<SyncOutlined />} loading={syncProgress.running} onClick={runSyncAll}>
              同步全部（{syncTargets.length}）
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
          size="small"
          sticky={{ offsetHeader: 80 }}
          loading={isLoading}
          dataSource={data?.items ?? []}
          columns={columns}
          locale={{ emptyText: <Empty description="暂无实例配置" /> }}
          showSorterTooltip={{ target: 'sorter-icon' }}
          pagination={pagination}
          onChange={(nextPagination) => {
            const nextPageSize = nextPagination.pageSize ?? pageSize;
            setPageSize(nextPageSize);
            setCurrentPage(nextPageSize !== pageSize ? 1 : (nextPagination.current ?? 1));
          }}
          rowSelection={{
            preserveSelectedRowKeys: true,
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys.map((item) => Number(item))),
          }}
          expandable={{
            expandRowByClick: true,
            expandedRowRender: (record) => {
              const proxyMeta = formatProxyMode(record);
              const proxyDetail =
                record.proxy_mode === 'custom'
                  ? record.socks5_proxy_url || '-'
                  : record.proxy_mode === 'global'
                    ? appSettingsData?.shared_socks5_proxy_url || '未配置公用 SOCKS5，当前会直连'
                    : '本地直连';

              return (
                <Descriptions
                  size="small"
                  bordered
                  column={2}
                  items={[
                    {
                      key: 'base_url',
                      label: '实例地址',
                      children: (
                        <Link href={record.base_url} target="_blank">
                          {record.base_url}
                        </Link>
                      ),
                    },
                    {
                      key: 'program_type',
                      label: '程序类型',
                      children: formatProgramType(record.program_type),
                    },
                    {
                      key: 'auth',
                      label: '认证信息',
                      children: record.username ? `用户：${record.username}` : `远端用户 ID：${record.remote_user_id ?? '-'}`,
                    },
                    {
                      key: 'proxy_mode',
                      label: '代理配置',
                      children: `${proxyMeta.label} / ${proxyDetail}`,
                    },
                    {
                      key: 'session',
                      label: 'Session / Token',
                      children: record.has_access_token ? 'Access Token' : formatDateTime(record.session_expires_at),
                    },
                    {
                      key: 'group',
                      label: '当前分组',
                      children: record.latest_group_name || '-',
                    },
                    {
                      key: 'quota_per_unit',
                      label: '兑换比',
                      children: formatNumber(record.quota_per_unit),
                    },
                    {
                      key: 'request_total',
                      label: '累计请求数',
                      children: formatNumber(record.latest_request_count),
                    },
                    {
                      key: 'updated_at',
                      label: '最后更新',
                      children: formatDateTime(record.updated_at),
                    },
                    {
                      key: 'error',
                      label: '最近错误',
                      children: record.last_health_error || '-',
                    },
                  ]}
                />
              );
            },
          }}
          scroll={{ x: 1600, y: 560 }}
        />
      </Card>

      <InstanceCreateModal
        open={createOpen}
        loading={createMutation.isPending}
        mode="create"
        defaultSyncIntervalMinutes={appSettingsData?.default_sync_interval_minutes ?? 120}
        tagOptions={tagOptions}
        onCancel={() => setCreateOpen(false)}
        onSubmit={(values) => createMutation.mutate(values as InstanceCreatePayload)}
      />

      <InstanceBatchModal
        open={batchCreateOpen}
        loading={batchCreateMutation.isPending}
        mode="create"
        defaultSyncIntervalMinutes={appSettingsData?.default_sync_interval_minutes ?? 120}
        tagOptions={tagOptions}
        onCancel={() => setBatchCreateOpen(false)}
        onSubmit={(items) => batchCreateMutation.mutate(items as InstanceCreatePayload[])}
      />

      <InstanceCreateModal
        open={Boolean(editingInstance)}
        loading={updateMutation.isPending}
        mode="edit"
        initialValues={editingInstance}
        defaultSyncIntervalMinutes={appSettingsData?.default_sync_interval_minutes ?? 120}
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
        defaultSyncIntervalMinutes={appSettingsData?.default_sync_interval_minutes ?? 120}
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
            <Descriptions.Item label="程序类型">{formatProgramType(testResult.program_type)}</Descriptions.Item>
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

      <SyncProgressModal
        open={syncProgress.open}
        title="实例批量同步进度"
        running={syncProgress.running}
        total={syncProgress.total}
        completed={syncProgress.completed}
        successCount={syncProgress.successCount}
        failedCount={syncProgress.failedCount}
        activeNames={syncProgress.activeNames}
        items={syncProgress.items}
        onClose={() => setSyncProgress(INITIAL_SYNC_PROGRESS)}
      />
    </div>
  );
}
