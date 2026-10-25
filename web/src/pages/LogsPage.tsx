import { Button, Tabs } from '@heroui/react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { fetchInstances } from '../api/instances';
import { fetchNotificationLogs, fetchSyncRuns } from '../api/logs';
import { DataTable, SelectInput, StatusChip } from '../components/ui';
import type { DataTableColumn } from '../components/ui';
import type { NotificationLogItem, NotificationTestChannelResult, SyncRun } from '../types/api';
import { formatDateTime } from '../utils/format';

function ExpandableText({ value, lines = 3 }: { value: string; lines?: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="max-w-[36rem]">
      <p className={expanded ? 'm-0 whitespace-pre-wrap break-words font-mono text-xs' : 'm-0 line-clamp-3 break-words font-mono text-xs'} style={{ WebkitLineClamp: lines }}>
        {value}
      </p>
      {value.length > 180 ? (
        <Button variant="tertiary" size="sm" className="mt-1 h-auto min-h-0 px-0 py-0 text-xs" onPress={() => setExpanded((current) => !current)}>
          {expanded ? '收起' : '展开'}
        </Button>
      ) : null}
    </div>
  );
}

function SyncLogsTab() {
  const [instanceId, setInstanceId] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data: instanceData } = useQuery({ queryKey: ['instances'], queryFn: () => fetchInstances() });
  const { data, isLoading } = useQuery({
    queryKey: ['sync-runs', instanceId, page, pageSize],
    queryFn: () => fetchSyncRuns({ instance_id: instanceId, offset: (page - 1) * pageSize, limit: pageSize }),
  });
  const instanceOptions = useMemo(() => (instanceData?.items ?? []).map((item) => ({ label: item.name, value: String(item.id) })), [instanceData]);
  const columns: DataTableColumn<SyncRun>[] = [
    { id: 'instance_name', title: '实例', width: 180, render: (row) => row.instance_name },
    { id: 'status', title: '状态', width: 120, render: (row) => <StatusChip status={row.status}>{row.status}</StatusChip> },
    { id: 'trigger_type', title: '触发方式', width: 120, render: (row) => <StatusChip>{row.trigger_type}</StatusChip> },
    { id: 'started_at', title: '开始时间', width: 180, render: (row) => formatDateTime(row.started_at) },
    { id: 'finished_at', title: '结束时间', width: 180, render: (row) => formatDateTime(row.finished_at) },
    { id: 'duration_ms', title: '耗时', width: 120, render: (row) => row.duration_ms ? `${row.duration_ms} ms` : '-' },
    { id: 'error_message', title: '错误信息', render: (row) => row.error_message || '-' },
    { id: 'summary_json', title: '摘要', render: (row) => row.summary_json ? <ExpandableText value={JSON.stringify(row.summary_json)} /> : '-' },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="w-full max-w-xs">
        <SelectInput
          label="按实例筛选"
          options={instanceOptions}
          value={instanceId === undefined ? '' : String(instanceId)}
          placeholder="按实例筛选"
          onChange={(value) => { setInstanceId(value ? Number(value) : undefined); setPage(1); }}
        />
      </div>
      <DataTable rows={data?.items ?? []} columns={columns} rowKey={(row) => row.id} loading={isLoading} ariaLabel="同步日志" emptyText="暂无同步日志" minWidth={1280} pagination={{ page, pageSize, total: data?.total ?? 0, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); } }} />
    </div>
  );
}

function renderNotificationChannels(channels?: NotificationTestChannelResult[] | null) {
  if (!channels?.length) return '-';
  return <div className="flex flex-wrap gap-1.5">{channels.map((item) => <StatusChip key={`${item.channel_id}-${item.channel_name}`} color={item.success ? 'success' : 'danger'}>{item.channel_name}</StatusChip>)}</div>;
}

function NotificationLogsTab() {
  const [instanceId, setInstanceId] = useState<number | undefined>();
  const [sourceType, setSourceType] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data: instanceData } = useQuery({ queryKey: ['instances'], queryFn: () => fetchInstances() });
  const { data, isLoading } = useQuery({
    queryKey: ['notification-logs', instanceId, sourceType, page, pageSize],
    queryFn: () => fetchNotificationLogs({ instance_id: instanceId, source_type: sourceType, offset: (page - 1) * pageSize, limit: pageSize }),
  });
  const instanceOptions = useMemo(() => (instanceData?.items ?? []).map((item) => ({ label: item.name, value: String(item.id) })), [instanceData]);
  const columns: DataTableColumn<NotificationLogItem>[] = [
    { id: 'created_at', title: '时间', width: 180, render: (row) => formatDateTime(row.created_at) },
    { id: 'instance_name', title: '实例', width: 180, render: (row) => row.instance_name || '-' },
    { id: 'source_type', title: '来源', width: 110, render: (row) => <StatusChip color={row.source_type === 'test' ? 'accent' : 'default'}>{row.source_type}</StatusChip> },
    { id: 'event_type', title: '事件', width: 110, render: (row) => <StatusChip>{row.event_type}</StatusChip> },
    { id: 'delivery_status', title: '投递状态', width: 120, render: (row) => <StatusChip status={row.delivery_status}>{row.delivery_status}</StatusChip> },
    { id: 'rule_name', title: '规则', width: 220, render: (row) => row.rule_name || '-' },
    { id: 'title', title: '标题', width: 260, render: (row) => row.title },
    { id: 'channels_json', title: '渠道', width: 220, render: (row) => renderNotificationChannels(row.channels_json) },
    { id: 'error_message', title: '错误信息', render: (row) => row.error_message || '-' },
    { id: 'body', title: '内容', render: (row) => row.body ? <ExpandableText value={row.body} /> : <span className="text-muted">-</span> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectInput label="按实例筛选" options={instanceOptions} value={instanceId === undefined ? '' : String(instanceId)} placeholder="按实例筛选" onChange={(value) => { setInstanceId(typeof value === 'string' && value ? Number(value) : undefined); setPage(1); }} />
        <SelectInput label="按来源筛选" options={[{ label: '规则通知', value: 'rule' }, { label: '测试通知', value: 'test' }]} value={sourceType ?? ''} placeholder="按来源筛选" onChange={(value) => { setSourceType(typeof value === 'string' && value ? value : undefined); setPage(1); }} />
      </div>
      <DataTable rows={data?.items ?? []} columns={columns} rowKey={(row) => row.id} loading={isLoading} ariaLabel="通知日志" emptyText="暂无通知日志" minWidth={1400} pagination={{ page, pageSize, total: data?.total ?? 0, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); } }} />
    </div>
  );
}

export function LogsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const activeTab = searchParams.get('tab') === 'notification' ? 'notification' : 'sync';
  return (
    <Tabs selectedKey={activeTab} onSelectionChange={(key) => { const next = new URLSearchParams(searchParams); next.set('tab', String(key)); navigate({ search: `?${next.toString()}` }, { replace: true }); }}>
      <Tabs.ListContainer><Tabs.List aria-label="日志类型">
        <Tabs.Tab id="sync">同步日志<Tabs.Indicator /></Tabs.Tab>
        <Tabs.Tab id="notification">通知日志<Tabs.Indicator /></Tabs.Tab>
      </Tabs.List></Tabs.ListContainer>
      <Tabs.Panel id="sync"><SyncLogsTab /></Tabs.Panel>
      <Tabs.Panel id="notification"><NotificationLogsTab /></Tabs.Panel>
    </Tabs>
  );
}
