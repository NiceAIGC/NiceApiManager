import { Button, Tabs } from '@heroui/react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { fetchInstances } from '../api/instances';
import { fetchNotificationLogs, fetchSyncRuns } from '../api/logs';
import { fetchAnnouncements, fetchRateChanges } from '../api/ops';
import type { AnnouncementItem, RateChangeEventItem } from '../api/ops';
import { DataTable, SelectInput, StatusChip } from '../components/ui';
import type { DataTableColumn } from '../components/ui';
import type { NotificationLogItem, NotificationTestChannelResult, SyncRun } from '../types/api';
import { formatDateTime, formatShortDateTime } from '../utils/format';

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
      <DataTable rows={data?.items ?? []} columns={columns} rowKey={(row) => row.id} loading={isLoading} ariaLabel="同步日志" emptyText="暂无同步日志" minWidth={1280} pagination={{ persistenceKey: 'logs', page, pageSize, total: data?.total ?? 0, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); } }} />
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
      <DataTable rows={data?.items ?? []} columns={columns} rowKey={(row) => row.id} loading={isLoading} ariaLabel="通知日志" emptyText="暂无通知日志" minWidth={1400} pagination={{ persistenceKey: 'logs', page, pageSize, total: data?.total ?? 0, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); } }} />
    </div>
  );
}

const CHANGE_TYPE_META: Record<RateChangeEventItem['change_type'], { label: string; color: 'success' | 'danger' | 'warning' }> = {
  added: { label: '新增', color: 'success' },
  removed: { label: '删除', color: 'danger' },
  changed: { label: '变动', color: 'warning' },
};

function RateChangesTab() {
  const [instanceId, setInstanceId] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data: instanceData } = useQuery({ queryKey: ['instances'], queryFn: () => fetchInstances() });
  const { data, isLoading } = useQuery({
    queryKey: ['rate-changes', instanceId, page, pageSize],
    queryFn: () => fetchRateChanges({ instance_id: instanceId, page, page_size: pageSize }),
  });
  const instanceOptions = useMemo(() => (instanceData?.items ?? []).map((item) => ({ label: item.name, value: String(item.id) })), [instanceData]);
  const columns: DataTableColumn<RateChangeEventItem>[] = [
    { id: 'detected_at', title: '时间', width: 110, render: (row) => formatShortDateTime(row.detected_at) },
    { id: 'instance_name', title: '实例', width: 160, render: (row) => row.instance_name },
    { id: 'group_name', title: '分组', render: (row) => <span className="flex items-center gap-1.5">{row.group_name}{row.platform ? <StatusChip>{row.platform}</StatusChip> : null}</span> },
    { id: 'change_type', title: '类型', width: 80, render: (row) => <StatusChip color={CHANGE_TYPE_META[row.change_type].color}>{CHANGE_TYPE_META[row.change_type].label}</StatusChip> },
    { id: 'change', title: '变化', width: 220, align: 'right', render: (row) => {
      if (row.change_type === 'added') return <span>新倍率 {row.new_ratio}</span>;
      if (row.change_type === 'removed') return <span>原倍率 {row.old_ratio}</span>;
      const percent = row.change_percent === null || row.change_percent === undefined ? '' : `（${row.change_percent > 0 ? '+' : ''}${row.change_percent.toFixed(1)}%）`;
      return <span>{row.old_ratio} → {row.new_ratio}{percent}</span>;
    } },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="w-full max-w-xs">
        <SelectInput label="按实例筛选" options={instanceOptions} value={instanceId === undefined ? '' : String(instanceId)} placeholder="按实例筛选" onChange={(value) => { setInstanceId(typeof value === 'string' && value ? Number(value) : undefined); setPage(1); }} />
      </div>
      <DataTable rows={data?.items ?? []} columns={columns} rowKey={(row) => row.id} loading={isLoading} ariaLabel="倍率变更" emptyText="暂无倍率变更记录" minWidth={900} pagination={{ persistenceKey: 'logs', page, pageSize, total: data?.total ?? 0, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); } }} />
    </div>
  );
}

function AnnouncementsTab() {
  const [instanceId, setInstanceId] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data: instanceData } = useQuery({ queryKey: ['instances'], queryFn: () => fetchInstances() });
  const { data, isLoading } = useQuery({
    queryKey: ['announcements', instanceId, page, pageSize],
    queryFn: () => fetchAnnouncements({ instance_id: instanceId, page, page_size: pageSize }),
  });
  const instanceOptions = useMemo(() => (instanceData?.items ?? []).map((item) => ({ label: item.name, value: String(item.id) })), [instanceData]);
  const columns: DataTableColumn<AnnouncementItem>[] = [
    { id: 'published_at', title: '发布时间', width: 110, render: (row) => formatShortDateTime(row.published_at || row.synced_at) },
    { id: 'instance_name', title: '实例', width: 160, render: (row) => row.instance_name },
    { id: 'title', title: '标题', width: 240, render: (row) => row.title },
    { id: 'content', title: '内容', render: (row) => row.content ? <ExpandableText value={row.content} /> : <span className="text-muted">-</span> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="w-full max-w-xs">
        <SelectInput label="按实例筛选" options={instanceOptions} value={instanceId === undefined ? '' : String(instanceId)} placeholder="按实例筛选" onChange={(value) => { setInstanceId(typeof value === 'string' && value ? Number(value) : undefined); setPage(1); }} />
      </div>
      <DataTable rows={data?.items ?? []} columns={columns} rowKey={(row) => row.id} loading={isLoading} ariaLabel="上游公告" emptyText="暂无上游公告" minWidth={900} pagination={{ persistenceKey: 'logs', page, pageSize, total: data?.total ?? 0, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); } }} />
    </div>
  );
}

const LOG_TABS = ['sync', 'notification', 'rate-changes', 'announcements'] as const;

export function LogsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tabParam = searchParams.get('tab') ?? 'sync';
  const activeTab = (LOG_TABS as readonly string[]).includes(tabParam) ? tabParam : 'sync';
  return (
    <Tabs selectedKey={activeTab} onSelectionChange={(key) => { const next = new URLSearchParams(searchParams); next.set('tab', String(key)); navigate({ search: `?${next.toString()}` }, { replace: true }); }}>
      <Tabs.ListContainer><Tabs.List aria-label="日志类型">
        <Tabs.Tab id="sync">同步日志<Tabs.Indicator /></Tabs.Tab>
        <Tabs.Tab id="notification">通知日志<Tabs.Indicator /></Tabs.Tab>
        <Tabs.Tab id="rate-changes">倍率变更<Tabs.Indicator /></Tabs.Tab>
        <Tabs.Tab id="announcements">上游公告<Tabs.Indicator /></Tabs.Tab>
      </Tabs.List></Tabs.ListContainer>
      <Tabs.Panel id="sync"><SyncLogsTab /></Tabs.Panel>
      <Tabs.Panel id="notification"><NotificationLogsTab /></Tabs.Panel>
      <Tabs.Panel id="rate-changes"><RateChangesTab /></Tabs.Panel>
      <Tabs.Panel id="announcements"><AnnouncementsTab /></Tabs.Panel>
    </Tabs>
  );
}
