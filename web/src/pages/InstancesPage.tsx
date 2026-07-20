import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Input,
  Rate,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableColumnsType, TablePaginationConfig } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SyncOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  createInstance,
  createInstancesBatch,
  deleteInstancesBatch,
  fetchInstances,
  syncInstance,
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

interface SyncTarget {
  id: number;
  name: string;
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

const PAGE_SIZE_OPTIONS = [30, 50, 100, 1000];

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

function buildInstanceUpdatePayload(
  instance: Instance,
  overrides: Partial<InstanceUpdatePayload> = {},
): InstanceUpdatePayload {
  return {
    name: instance.name,
    remark: instance.remark,
    base_url: instance.base_url,
    program_type: instance.program_type,
    username: instance.username,
    remote_user_id: instance.remote_user_id,
    access_token: '',
    proxy_mode: instance.proxy_mode,
    socks5_proxy_url: instance.socks5_proxy_url ?? '',
    enabled: instance.enabled,
    balance_alert_enabled: instance.balance_alert_enabled,
    balance_alert_threshold: instance.balance_alert_threshold,
    notification_channel_ids: instance.notification_channel_ids,
    billing_mode: instance.billing_mode,
    quota_per_unit: instance.quota_per_unit,
    priority: instance.priority,
    sync_interval_minutes: instance.sync_interval_minutes,
    tags: instance.tags,
    ...overrides,
  };
}


function buildChartPoints(values: number[], width: number, height: number, padding: number) {
  const maxValue = Math.max(...values, 0);
  const step = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;
  return values.map((value, index) => {
    const x = padding + index * step;
    const y = maxValue > 0 ? padding + (1 - value / maxValue) * (height - padding * 2) : height - padding;
    return { x, y, value };
  });
}

function buildLinePath(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
}

interface InstanceUsageLineChartProps {
  title: string;
  points: Instance['last_7d_usage'];
  valueKey: 'used_display_amount' | 'request_count';
  color: string;
  formatValue: (value: number) => string;
}

function InstanceUsageLineChart({ title, points, valueKey, color, formatValue }: InstanceUsageLineChartProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(520);
  const height = 150;
  const padding = 28;

  useLayoutEffect(() => {
    const node = plotRef.current;
    if (!node) {
      return;
    }
    const update = () => {
      const measured = node.clientWidth;
      if (measured > 0) {
        setWidth(measured);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const values = points.map((item) => item[valueKey]);
  const chartPoints = buildChartPoints(values, width, height, padding);
  const path = buildLinePath(chartPoints);
  const total = values.reduce((sum, value) => sum + value, 0);
  const peak = Math.max(...values, 0);
  const hasData = values.some((value) => value > 0);
  const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;

  return (
    <div className="instance-expanded-line-card">
      <div className="instance-expanded-line-card-header">
        <Text strong>{title}</Text>
        <span className="instance-expanded-line-stats">
          <span>合计 <strong style={{ color }}>{formatValue(total)}</strong></span>
          <span>峰值 <strong>{formatValue(peak)}</strong></span>
          <span>日均 <strong>{formatValue(total / Math.max(points.length, 1))}</strong></span>
        </span>
      </div>
      <div className="instance-expanded-line-plot" ref={plotRef}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="instance-expanded-chart-svg"
          role="img"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <line
              key={ratio}
              x1={padding}
              x2={width - padding}
              y1={padding + ratio * (height - padding * 2)}
              y2={padding + ratio * (height - padding * 2)}
              className="instance-expanded-chart-grid"
            />
          ))}
          <path d={path} className="instance-expanded-chart-line" style={{ stroke: color }} />
          {points.map((point, index) => {
            const chartPoint = chartPoints[index];
            const x = padding + index * step;
            return (
              <g key={`${point.date}-${index}`}>
                <line x1={x} x2={x} y1={padding} y2={height - padding} className="instance-expanded-chart-day-line" />
                <circle
                  cx={chartPoint.x}
                  cy={chartPoint.y}
                  r={4}
                  className="instance-expanded-chart-dot"
                  style={{ stroke: color }}
                  vectorEffect="non-scaling-stroke"
                />
                <text x={x} y={height - 8} textAnchor="middle" className="instance-expanded-chart-label">
                  {point.label}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="instance-expanded-chart-hover-layer">
          {points.map((point, index) => {
            const chartPoint = chartPoints[index];
            const targetWidth = points.length > 1 ? Math.max((step / width) * 100, 9) : 100;
            return (
              <Tooltip
                key={`${point.date}-${index}`}
                title={
                  <div className="instance-expanded-chart-tooltip">
                    <div className="instance-expanded-chart-tooltip-title">{point.date || point.label}</div>
                    <div>{title}：{formatValue(point[valueKey])}</div>
                  </div>
                }
              >
                <span
                  className="instance-expanded-chart-hover-target"
                  style={{
                    left: `${(chartPoint.x / width) * 100}%`,
                    width: `${targetWidth}%`,
                  }}
                />
              </Tooltip>
            );
          })}
        </div>
        {!hasData ? <div className="instance-expanded-chart-empty">暂无近 7 天数据</div> : null}
      </div>
    </div>
  );
}

function InstanceUsageSparkline({ points }: { points: Instance['last_7d_usage'] }) {
  const normalizedPoints = points.length
    ? points
    : Array.from({ length: 7 }, (_, index) => ({
        date: '',
        label: `D${index + 1}`,
        used_display_amount: 0,
        request_count: 0,
      }));
  const usedValues = normalizedPoints.map((item) => item.used_display_amount);
  const requestValues = normalizedPoints.map((item) => item.request_count);
  const totalUsed = usedValues.reduce((sum, value) => sum + value, 0);
  const totalRequests = requestValues.reduce((sum, value) => sum + value, 0);
  const avgUsed = totalUsed / Math.max(normalizedPoints.length, 1);

  return (
    <div className="instance-expanded-chart">
      <div className="instance-expanded-chart-header">
        <Text strong>近 7 天用量趋势</Text>
        <div className="instance-expanded-chart-metrics">
          <span>7 日消耗 <strong>{formatMoney(totalUsed)}</strong></span>
          <span>日均消耗 <strong>{formatMoney(avgUsed)}</strong></span>
          <span>7 日调用 <strong>{formatNumber(totalRequests)}</strong></span>
          <span>峰值调用 <strong>{formatNumber(Math.max(...requestValues, 0))}</strong></span>
        </div>
      </div>
      <div className="instance-expanded-chart-grid-layout">
        <InstanceUsageLineChart
          title="额度消耗"
          points={normalizedPoints}
          valueKey="used_display_amount"
          color="#16a34a"
          formatValue={formatMoney}
        />
        <InstanceUsageLineChart
          title="请求次数"
          points={normalizedPoints}
          valueKey="request_count"
          color="#2563eb"
          formatValue={formatNumber}
        />
      </div>
    </div>
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
  const [enabled, setEnabled] = useState<boolean | undefined>(true);
  const [healthStatus, setHealthStatus] = useState<string | undefined>(undefined);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [syncProgress, setSyncProgress] = useState<SyncProgressState>(INITIAL_SYNC_PROGRESS);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [expandedRowKeys, setExpandedRowKeys] = useState<number[]>([]);

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
    setEnabled(true);
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

  const notificationChannelOptions = useMemo(
    () =>
      (appSettingsData?.notification_channels ?? [])
        .filter((item) => item.enabled)
        .map((item) => ({ label: item.name, value: item.id })),
    [appSettingsData?.notification_channels],
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

  const runBatchSync = async (targets: SyncTarget[]) => {
    if (!targets.length) {
      message.info('当前筛选下没有可同步的启用实例');
      return;
    }

    setSyncProgress({
      open: true,
      running: true,
      total: targets.length,
      completed: 0,
      successCount: 0,
      failedCount: 0,
      activeNames: [],
      items: targets.map((item) => ({
        key: item.id,
        name: item.name,
        status: 'pending',
      })),
    });

    try {
      const result = await runBatchSyncWithConcurrency({
        targets,
        maxWorkers: appSettingsData?.sync_max_workers ?? 5,
        syncOne: syncInstance,
        onStateChange: ({ running, completed, successCount, failedCount, activeNames, items }) => {
          setSyncProgress({
            open: true,
            running,
            total: targets.length,
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

  const runSyncAll = async () => {
    await runBatchSync(syncTargets);
  };

  const retryFailedSyncItems = async (items: SyncProgressItem[]) => {
    await runBatchSync(
      items.map((item) => ({
        id: Number(item.key),
        name: item.name,
      })),
    );
  };

  const columns = useMemo<TableColumnsType<Instance>>(
    () => [
      {
        title: '优先级',
        dataIndex: 'priority',
        key: 'priority',
        width: 76,
        sorter: (left, right) => left.priority - right.priority,
        render: (value: number) => <Rate className="instance-priority-rate" disabled count={5} value={value} />,
      },
      {
        title: '实例',
        dataIndex: 'name',
        key: 'name',
        fixed: 'left',
        width: 210,
        sorter: (left, right) => left.name.localeCompare(right.name),
        render: (value: string, record) => (
          <Space direction="vertical" size={2} className="instance-name-cell">
            <Text strong ellipsis={{ tooltip: value }}>{value}</Text>
            <Space size={[4, 4]} wrap>
              <StatusTag value={record.last_health_status} />
              <Tag color={getBillingModeTagColor(record.billing_mode)}>{formatBillingMode(record.billing_mode)}</Tag>
              <Tag>{formatProgramType(record.program_type)}</Tag>
            </Space>
          </Space>
        ),
      },
      {
        title: '当前余额',
        dataIndex: 'latest_display_quota',
        key: 'latest_display_quota',
        width: 104,
        sorter: (left, right) => (left.latest_display_quota ?? -1) - (right.latest_display_quota ?? -1),
        render: (value: number | null | undefined, record) =>
          record.billing_mode === 'postpaid' ? (
            '-'
          ) : (
            <span className={`quota-badge ${getBalanceBadgeClass(value)}`}>{formatMoney(value)}</span>
          ),
      },
      {
        title: '总消耗额度',
        dataIndex: 'total_display_used_quota',
        key: 'total_display_used_quota',
        width: 112,
        sorter: (left, right) => left.total_display_used_quota - right.total_display_used_quota,
        render: (value: number) => <Text strong>{formatMoney(value)}</Text>,
      },
      {
        title: '余额告警',
        dataIndex: 'balance_alert_enabled',
        key: 'balance_alert_enabled',
        width: 116,
        render: (value: boolean, record) => (
          <Tooltip
            title={
              value
                ? `余额 ≤ ${formatMoney(record.effective_balance_alert_threshold)} 时通知${record.notification_channel_ids.length ? '指定渠道' : '默认渠道'}`
                : '开启后使用全局默认阈值；可在编辑实例中自定义阈值和渠道'
            }
          >
            <Space size={6}>
              <Switch
                size="small"
                checked={value}
                loading={updateMutation.isPending && updateMutation.variables?.instanceId === record.id}
                onClick={(checked, event) => {
                  event.stopPropagation();
                  updateMutation.mutate({
                    instanceId: record.id,
                    payload: buildInstanceUpdatePayload(record, {
                      balance_alert_enabled: checked,
                    }),
                  });
                }}
              />
              {value ? <Text type="secondary">≤ {formatMoney(record.effective_balance_alert_threshold)}</Text> : null}
            </Space>
          </Tooltip>
        ),
      },
      {
        title: '今日请求',
        dataIndex: 'today_request_count',
        key: 'today_request_count',
        width: 92,
        sorter: (left, right) => left.today_request_count - right.today_request_count,
        render: (value: number) => formatNumber(value),
      },
      {
        title: '7日消耗',
        dataIndex: 'last_7d_display_used_amount',
        key: 'last_7d_display_used_amount',
        width: 98,
        defaultSortOrder: 'descend',
        sorter: (left, right) => left.last_7d_display_used_amount - right.last_7d_display_used_amount,
        render: (value: number) => formatMoney(value),
      },
      {
        title: '7日请求',
        dataIndex: 'last_7d_request_count',
        key: 'last_7d_request_count',
        width: 92,
        sorter: (left, right) => left.last_7d_request_count - right.last_7d_request_count,
        render: (value: number) => formatNumber(value),
      },
      {
        title: '最近同步',
        dataIndex: 'last_sync_at',
        key: 'last_sync_at',
        width: 148,
        sorter: (left, right) => new Date(left.last_sync_at ?? 0).getTime() - new Date(right.last_sync_at ?? 0).getTime(),
        render: (value?: string | null) => formatDateTime(value),
      },
      {
        title: '备注',
        dataIndex: 'remark',
        key: 'remark',
        width: 120,
        render: (value?: string | null) => (
          value ? <Text ellipsis={{ tooltip: value }} style={{ maxWidth: 104 }}>{value}</Text> : <Text type="secondary">-</Text>
        ),
      },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        width: 178,
        render: (_: unknown, record: Instance) => (
          <Space size={4} className="instance-action-row">
            <Switch
              size="small"
              checked={record.enabled}
              loading={updateMutation.isPending && updateMutation.variables?.instanceId === record.id}
              onClick={(checked, event) => {
                event.stopPropagation();
                updateMutation.mutate({
                  instanceId: record.id,
                  payload: buildInstanceUpdatePayload(record, { enabled: checked }),
                });
              }}
            />
            <Button size="small" icon={<EditOutlined />} onClick={() => setEditingInstance(record)}>
              编辑
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
    [syncMutation, updateMutation],
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
          className="instances-compact-table"
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
            expandedRowKeys,
            onExpandedRowsChange: (keys) => setExpandedRowKeys(keys.map((item) => Number(item))),
            expandedRowRender: (record) => {
              const proxyMeta = formatProxyMode(record);
              const proxyDetail =
                record.proxy_mode === 'custom'
                  ? record.socks5_proxy_url || '-'
                  : record.proxy_mode === 'global'
                    ? appSettingsData?.shared_socks5_proxy_url || '未配置公用 SOCKS5，当前会直连'
                    : '本地直连';

              return (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
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
                        key: 'remark',
                        label: '备注',
                        children: record.remark || '-',
                      },
                      {
                        key: 'auth',
                        label: '认证信息',
                        children: record.username ? `用户：${record.username}` : `远端用户 ID：${record.remote_user_id ?? '-'}`,
                      },
                      {
                        key: 'program_type',
                        label: '程序类型',
                        children: formatProgramType(record.program_type),
                      },
                      {
                        key: 'session',
                        label: 'Session / Token',
                        children: record.has_access_token ? 'Access Token' : formatDateTime(record.session_expires_at),
                      },
                      {
                        key: 'enabled_source',
                        label: '启停来源',
                        children: record.enabled ? '已启用' : record.auto_disabled ? '系统自动禁用（定时同步会继续探测）' : '手动禁用',
                      },
                      {
                        key: 'balance_alert',
                        label: '余额告警',
                        children: record.balance_alert_enabled
                          ? `已开启 / 阈值 ${formatMoney(record.effective_balance_alert_threshold)} / ${record.notification_channel_ids.length ? '指定渠道' : '默认渠道'}`
                          : '未开启',
                      },
                      {
                        key: 'group',
                        label: '当前分组',
                        children: record.latest_group_name || '-',
                      },
                      {
                        key: 'tags',
                        label: '标签',
                        children: renderCompactTags(record.tags),
                      },
                      {
                        key: 'request_total',
                        label: '累计请求数',
                        children: formatNumber(record.latest_request_count),
                      },
                      {
                        key: 'quota_per_unit',
                        label: '兑换比',
                        children: formatNumber(record.quota_per_unit),
                      },
                      {
                        key: 'used_quota',
                        label: '周期已用',
                        children: formatMoney(record.latest_display_used_quota),
                      },
                      {
                        key: 'sync_interval',
                        label: '同步周期',
                        children: `${record.sync_interval_minutes} 分钟`,
                      },
                      {
                        key: 'proxy_mode',
                        label: '代理方式',
                        children: `${proxyMeta.label} / ${proxyDetail}`,
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
                  <InstanceUsageSparkline points={record.last_7d_usage ?? []} />
                  <div className="instance-expanded-actions">
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      onClick={(event) => {
                        event.stopPropagation();
                        setEditingInstance(record);
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      icon={<SyncOutlined />}
                      loading={syncMutation.isPending && syncMutation.variables === record.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        syncMutation.mutate(record.id);
                      }}
                    >
                      同步
                    </Button>
                    <Button
                      size="small"
                      icon={<UpOutlined />}
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedRowKeys((keys) => keys.filter((key) => key !== record.id));
                      }}
                    >
                      收起
                    </Button>
                  </div>
                </Space>
              );
            },
          }}
          scroll={{ x: 1120 }}
        />
      </Card>

      <InstanceCreateModal
        open={createOpen}
        loading={createMutation.isPending}
        mode="create"
        defaultSyncIntervalMinutes={appSettingsData?.default_sync_interval_minutes ?? 120}
        defaultProxyMode={appSettingsData?.default_instance_proxy_mode ?? 'direct'}
        tagOptions={tagOptions}
        notificationChannelOptions={notificationChannelOptions}
        onCancel={() => setCreateOpen(false)}
        onSubmit={(values) => createMutation.mutate(values as InstanceCreatePayload)}
      />

      <InstanceBatchModal
        open={batchCreateOpen}
        loading={batchCreateMutation.isPending}
        mode="create"
        defaultSyncIntervalMinutes={appSettingsData?.default_sync_interval_minutes ?? 120}
        defaultProxyMode={appSettingsData?.default_instance_proxy_mode ?? 'direct'}
        tagOptions={tagOptions}
        notificationChannelOptions={notificationChannelOptions}
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
        notificationChannelOptions={notificationChannelOptions}
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
        notificationChannelOptions={notificationChannelOptions}
        onCancel={() => setBatchEditOpen(false)}
        onSubmit={(items) => batchUpdateMutation.mutate(items as BatchInstanceUpdatePayload[])}
      />

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
        onRetryFailed={retryFailedSyncItems}
        onClose={() => setSyncProgress(INITIAL_SYNC_PROGRESS)}
      />
    </div>
  );
}
