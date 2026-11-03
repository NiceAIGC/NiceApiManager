import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { fetchInstances } from '../api/instances';
import { fetchNotificationLogs, fetchSyncRuns } from '../api/logs';
import { fetchAnnouncements, fetchRateChanges } from '../api/ops';
import type { AnnouncementItem, RateChangeEventItem } from '../api/ops';
import {
  Button,
  DataTable,
  SelectField,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui';
import type { DataTableColumn } from '../components/ui';
import type { NotificationLogItem, NotificationTestChannelResult, SyncRun } from '../types/api';
import { formatDateTime, formatShortDateTime } from '../utils/format';

const PAGE_SIZE_OPTIONS = [20, 50, 100];

function ExpandableText({ value, lines = 3 }: { value: string; lines?: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="max-w-[36rem]">
      <p
        className="m-0 whitespace-pre-wrap break-words font-mono text-xs"
        style={expanded ? undefined : { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
      >
        {value}
      </p>
      {value.length > 180 ? (
        <Button variant="link" size="sm" className="mt-1 h-auto px-0 py-0 text-xs" onClick={() => setExpanded((current) => !current)}>
          {expanded ? '收起' : '展开'}
        </Button>
      ) : null}
    </div>
  );
}

function useInstanceOptions() {
  const { data } = useQuery({ queryKey: ['instances'], queryFn: () => fetchInstances() });
  return (data?.items ?? []).map((item) => ({ label: item.name, value: String(item.id) }));
}

function SyncLogsTab() {
  const [instanceId, setInstanceId] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const instanceOptions = useInstanceOptions();
  const { data, isLoading } = useQuery({
    queryKey: ['sync-runs', instanceId, page, pageSize],
    queryFn: () => fetchSyncRuns({ instance_id: instanceId === 'all' ? undefined : Number(instanceId), offset: (page - 1) * pageSize, limit: pageSize }),
  });

  const columns: DataTableColumn<SyncRun>[] = [
    { id: 'instance_name', header: '实例', width: 160, cell: (row) => row.instance_name },
    { id: 'status', header: '状态', width: 96, cell: (row) => <StatusBadge status={row.status} /> },
    { id: 'trigger_type', header: '触发方式', width: 96, cell: (row) => <StatusBadge status={row.trigger_type} /> },
    { id: 'started_at', header: '开始时间', width: 168, cell: (row) => <span className="tabular text-muted-foreground">{formatDateTime(row.started_at)}</span> },
    { id: 'duration_ms', header: '耗时', width: 88, align: 'right', cell: (row) => <span className="tabular">{row.duration_ms ? `${row.duration_ms} ms` : '-'}</span> },
    { id: 'error_message', header: '错误信息', cell: (row) => row.error_message ? <span className="text-xs text-destructive">{row.error_message}</span> : '-' },
    { id: 'summary_json', header: '摘要', width: 220, cell: (row) => row.summary_json ? <ExpandableText value={JSON.stringify(row.summary_json)} /> : '-' },
  ];

  return (
    <div className="flex flex-col gap-3">
      <SelectField className="w-64" label="按实例筛选" value={instanceId} onValueChange={(value) => { setInstanceId(value); setPage(1); }} options={[{ label: '全部实例', value: 'all' }, ...instanceOptions]} />
      <DataTable
        rows={data?.items ?? []}
        columns={columns}
        rowKey={(row) => row.id}
        loading={isLoading}
        dense
        ariaLabel="同步日志"
        emptyText="暂无同步日志"
        minWidth={1200}
        pagination={{ page, pageSize, total: data?.total ?? 0, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); }, pageSizeOptions: PAGE_SIZE_OPTIONS, persistenceKey: 'logs' }}
      />
    </div>
  );
}

function renderChannels(channels?: NotificationTestChannelResult[] | null) {
  if (!channels?.length) return '-';
  return (
    <div className="flex flex-wrap gap-1">
      {channels.map((item) => (
        <StatusBadge key={`${item.channel_id}-${item.channel_name}`} tone={item.success ? 'success' : 'destructive'}>
          {item.channel_name}
        </StatusBadge>
      ))}
    </div>
  );
}

function NotificationLogsTab() {
  const [instanceId, setInstanceId] = useState('all');
  const [sourceType, setSourceType] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const instanceOptions = useInstanceOptions();
  const { data, isLoading } = useQuery({
    queryKey: ['notification-logs', instanceId, sourceType, page, pageSize],
    queryFn: () => fetchNotificationLogs({
      instance_id: instanceId === 'all' ? undefined : Number(instanceId),
      source_type: sourceType === 'all' ? undefined : sourceType,
      offset: (page - 1) * pageSize,
      limit: pageSize,
    }),
  });

  const columns: DataTableColumn<NotificationLogItem>[] = [
    { id: 'created_at', header: '时间', width: 168, cell: (row) => <span className="tabular text-muted-foreground">{formatDateTime(row.created_at)}</span> },
    { id: 'instance_name', header: '实例', width: 140, cell: (row) => row.instance_name || '-' },
    { id: 'source_type', header: '来源', width: 88, cell: (row) => <StatusBadge tone={row.source_type === 'test' ? 'secondary' : 'muted'}>{row.source_type === 'test' ? '测试' : '规则'}</StatusBadge> },
    { id: 'delivery_status', header: '投递', width: 96, cell: (row) => <StatusBadge status={row.delivery_status} /> },
    { id: 'title', header: '标题', width: 260, cell: (row) => <span className="line-clamp-2">{row.title}</span> },
    { id: 'channels_json', header: '渠道', width: 200, cell: (row) => renderChannels(row.channels_json) },
    { id: 'body', header: '内容', cell: (row) => row.body ? <ExpandableText value={row.body} /> : <span className="text-muted-foreground">-</span> },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <SelectField className="w-64" label="按实例筛选" value={instanceId} onValueChange={(value) => { setInstanceId(value); setPage(1); }} options={[{ label: '全部实例', value: 'all' }, ...instanceOptions]} />
        <SelectField className="w-40" label="按来源筛选" value={sourceType} onValueChange={(value) => { setSourceType(value); setPage(1); }} options={[{ label: '全部来源', value: 'all' }, { label: '规则通知', value: 'rule' }, { label: '测试通知', value: 'test' }]} />
      </div>
      <DataTable
        rows={data?.items ?? []}
        columns={columns}
        rowKey={(row) => row.id}
        loading={isLoading}
        dense
        ariaLabel="通知日志"
        emptyText="暂无通知日志"
        minWidth={1200}
        pagination={{ page, pageSize, total: data?.total ?? 0, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); }, pageSizeOptions: PAGE_SIZE_OPTIONS, persistenceKey: 'logs' }}
      />
    </div>
  );
}

const CHANGE_TYPE_META: Record<RateChangeEventItem['change_type'], { label: string; tone: 'success' | 'destructive' | 'warning' }> = {
  added: { label: '新增', tone: 'success' },
  removed: { label: '删除', tone: 'destructive' },
  changed: { label: '变动', tone: 'warning' },
};

function RateChangesTab() {
  const [instanceId, setInstanceId] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const instanceOptions = useInstanceOptions();
  const { data, isLoading } = useQuery({
    queryKey: ['rate-changes', instanceId, page, pageSize],
    queryFn: () => fetchRateChanges({ instance_id: instanceId === 'all' ? undefined : Number(instanceId), page, page_size: pageSize }),
  });

  const columns: DataTableColumn<RateChangeEventItem>[] = [
    { id: 'detected_at', header: '时间', width: 104, cell: (row) => <span className="tabular text-muted-foreground">{formatShortDateTime(row.detected_at)}</span> },
    { id: 'instance_name', header: '实例', width: 150, cell: (row) => row.instance_name },
    { id: 'group_name', header: '分组', cell: (row) => <span className="flex items-center gap-1.5">{row.group_name}{row.platform ? <StatusBadge tone="muted">{row.platform}</StatusBadge> : null}</span> },
    { id: 'change_type', header: '类型', width: 76, cell: (row) => <StatusBadge tone={CHANGE_TYPE_META[row.change_type].tone}>{CHANGE_TYPE_META[row.change_type].label}</StatusBadge> },
    {
      id: 'change',
      header: '变化',
      width: 220,
      align: 'right',
      cell: (row) => {
        if (row.change_type === 'added') return <span className="tabular">新倍率 {row.new_ratio}</span>;
        if (row.change_type === 'removed') return <span className="tabular">原倍率 {row.old_ratio}</span>;
        const percent = row.change_percent === null || row.change_percent === undefined ? '' : `（${row.change_percent > 0 ? '+' : ''}${row.change_percent.toFixed(1)}%）`;
        return <span className="tabular">{row.old_ratio} → {row.new_ratio}{percent}</span>;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <SelectField className="w-64" label="按实例筛选" value={instanceId} onValueChange={(value) => { setInstanceId(value); setPage(1); }} options={[{ label: '全部实例', value: 'all' }, ...instanceOptions]} />
      <DataTable
        rows={data?.items ?? []}
        columns={columns}
        rowKey={(row) => row.id}
        loading={isLoading}
        dense
        ariaLabel="倍率变更"
        emptyText="暂无倍率变更记录"
        minWidth={900}
        pagination={{ page, pageSize, total: data?.total ?? 0, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); }, pageSizeOptions: PAGE_SIZE_OPTIONS, persistenceKey: 'logs' }}
      />
    </div>
  );
}

function AnnouncementsTab() {
  const [instanceId, setInstanceId] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const instanceOptions = useInstanceOptions();
  const { data, isLoading } = useQuery({
    queryKey: ['announcements', instanceId, page, pageSize],
    queryFn: () => fetchAnnouncements({ instance_id: instanceId === 'all' ? undefined : Number(instanceId), page, page_size: pageSize }),
  });

  const columns: DataTableColumn<AnnouncementItem>[] = [
    { id: 'published_at', header: '时间', width: 104, cell: (row) => <span className="tabular text-muted-foreground">{formatShortDateTime(row.published_at || row.synced_at)}</span> },
    { id: 'instance_name', header: '实例', width: 150, cell: (row) => row.instance_name },
    { id: 'title', header: '标题', width: 240, cell: (row) => row.title },
    { id: 'content', header: '内容', cell: (row) => row.content ? <ExpandableText value={row.content} /> : <span className="text-muted-foreground">-</span> },
  ];

  return (
    <div className="flex flex-col gap-3">
      <SelectField className="w-64" label="按实例筛选" value={instanceId} onValueChange={(value) => { setInstanceId(value); setPage(1); }} options={[{ label: '全部实例', value: 'all' }, ...instanceOptions]} />
      <DataTable
        rows={data?.items ?? []}
        columns={columns}
        rowKey={(row) => row.id}
        loading={isLoading}
        dense
        ariaLabel="上游公告"
        emptyText="暂无上游公告"
        minWidth={900}
        pagination={{ page, pageSize, total: data?.total ?? 0, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); }, pageSizeOptions: PAGE_SIZE_OPTIONS, persistenceKey: 'logs' }}
      />
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
    <Tabs value={activeTab} onValueChange={(value) => { const next = new URLSearchParams(searchParams); next.set('tab', value); navigate({ search: `?${next.toString()}` }, { replace: true }); }}>
      <TabsList className="mb-4">
        <TabsTrigger value="sync">同步日志</TabsTrigger>
        <TabsTrigger value="notification">通知日志</TabsTrigger>
        <TabsTrigger value="rate-changes">倍率变更</TabsTrigger>
        <TabsTrigger value="announcements">上游公告</TabsTrigger>
      </TabsList>
      <TabsContent value="sync"><SyncLogsTab /></TabsContent>
      <TabsContent value="notification"><NotificationLogsTab /></TabsContent>
      <TabsContent value="rate-changes"><RateChangesTab /></TabsContent>
      <TabsContent value="announcements"><AnnouncementsTab /></TabsContent>
    </Tabs>
  );
}
