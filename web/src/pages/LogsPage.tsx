import { Empty, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import type { TabsProps } from 'antd';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { fetchInstances } from '../api/instances';
import { fetchNotificationLogs, fetchSyncRuns } from '../api/logs';
import { StatusTag } from '../components/StatusTag';
import type { NotificationLogItem, NotificationTestChannelResult, SyncRun } from '../types/api';
import { formatDateTime } from '../utils/format';

const { Paragraph, Text } = Typography;

function SyncLogsTab() {
  const [instanceId, setInstanceId] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data: instanceData } = useQuery({
    queryKey: ['instances'],
    queryFn: () => fetchInstances(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['sync-runs', instanceId, page, pageSize],
    queryFn: () =>
      fetchSyncRuns({
        instance_id: instanceId,
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }),
  });

  const instanceOptions = useMemo(
    () =>
      (instanceData?.items ?? []).map((item: { name: string; id: number }) => ({
        label: item.name,
        value: item.id,
      })),
    [instanceData],
  );

  return (
    <div className="page-stack">
      <div className="table-toolbar">
        <div className="table-toolbar-left">
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
        </div>
      </div>

      <Table<SyncRun>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items ?? []}
        locale={{ emptyText: <Empty description="暂无同步日志" /> }}
        scroll={{ x: 1280 }}
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
            width: 180,
          },
          {
            title: '状态',
            dataIndex: 'status',
            key: 'status',
            width: 120,
            render: (value: string) => <StatusTag value={value} />,
          },
          {
            title: '触发方式',
            dataIndex: 'trigger_type',
            key: 'trigger_type',
            width: 120,
            render: (value: string) => <Tag>{value}</Tag>,
          },
          {
            title: '开始时间',
            dataIndex: 'started_at',
            key: 'started_at',
            width: 180,
            render: (value: string) => formatDateTime(value),
          },
          {
            title: '结束时间',
            dataIndex: 'finished_at',
            key: 'finished_at',
            width: 180,
            render: (value?: string | null) => formatDateTime(value),
          },
          {
            title: '耗时',
            dataIndex: 'duration_ms',
            key: 'duration_ms',
            width: 120,
            render: (value?: number | null) => (value ? `${value} ms` : '-'),
          },
          {
            title: '错误信息',
            dataIndex: 'error_message',
            key: 'error_message',
            render: (value?: string | null) => value || '-',
          },
          {
            title: '摘要',
            dataIndex: 'summary_json',
            key: 'summary_json',
            render: (value?: Record<string, unknown> | null) =>
              value ? (
                <Paragraph style={{ marginBottom: 0 }} code>
                  {JSON.stringify(value)}
                </Paragraph>
              ) : (
                '-'
              ),
          },
        ]}
      />
    </div>
  );
}

function renderNotificationChannels(channels?: NotificationTestChannelResult[] | null) {
  if (!channels?.length) {
    return '-';
  }

  return (
    <Space size={[6, 6]} wrap>
      {channels.map((item) => (
        <Tag key={`${item.channel_id}-${item.channel_name}`} color={item.success ? 'success' : 'error'}>
          {item.channel_name}
        </Tag>
      ))}
    </Space>
  );
}

function NotificationLogsTab() {
  const [instanceId, setInstanceId] = useState<number | undefined>(undefined);
  const [sourceType, setSourceType] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data: instanceData } = useQuery({
    queryKey: ['instances'],
    queryFn: () => fetchInstances(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['notification-logs', instanceId, sourceType, page, pageSize],
    queryFn: () =>
      fetchNotificationLogs({
        instance_id: instanceId,
        source_type: sourceType,
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }),
  });

  const instanceOptions = useMemo(
    () =>
      (instanceData?.items ?? []).map((item: { name: string; id: number }) => ({
        label: item.name,
        value: item.id,
      })),
    [instanceData],
  );

  return (
    <div className="page-stack">
      <div className="table-toolbar">
        <div className="table-toolbar-left">
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
          <Select
            allowClear
            placeholder="按来源筛选"
            style={{ width: 180 }}
            value={sourceType}
            options={[
              { label: '规则通知', value: 'rule' },
              { label: '测试通知', value: 'test' },
            ]}
            onChange={(value) => {
              setSourceType(value);
              setPage(1);
            }}
          />
        </div>
      </div>

      <Table<NotificationLogItem>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items ?? []}
        locale={{ emptyText: <Empty description="暂无通知日志" /> }}
        scroll={{ x: 1400 }}
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
            title: '时间',
            dataIndex: 'created_at',
            key: 'created_at',
            width: 180,
            render: (value: string) => formatDateTime(value),
          },
          {
            title: '实例',
            dataIndex: 'instance_name',
            key: 'instance_name',
            width: 180,
            render: (value?: string | null) => value || '-',
          },
          {
            title: '来源',
            dataIndex: 'source_type',
            key: 'source_type',
            width: 110,
            render: (value: string) => <Tag color={value === 'test' ? 'blue' : 'purple'}>{value}</Tag>,
          },
          {
            title: '事件',
            dataIndex: 'event_type',
            key: 'event_type',
            width: 110,
            render: (value: string) => <Tag>{value}</Tag>,
          },
          {
            title: '投递状态',
            dataIndex: 'delivery_status',
            key: 'delivery_status',
            width: 120,
            render: (value: string) => <StatusTag value={value} />,
          },
          {
            title: '规则',
            key: 'rule',
            width: 220,
            render: (_: unknown, record) => record.rule_name || '-',
          },
          {
            title: '标题',
            dataIndex: 'title',
            key: 'title',
            width: 260,
          },
          {
            title: '渠道',
            dataIndex: 'channels_json',
            key: 'channels_json',
            width: 220,
            render: (value?: NotificationTestChannelResult[] | null) => renderNotificationChannels(value),
          },
          {
            title: '错误信息',
            dataIndex: 'error_message',
            key: 'error_message',
            render: (value?: string | null) => value || '-',
          },
          {
            title: '内容',
            dataIndex: 'body',
            key: 'body',
            render: (value?: string | null) =>
              value ? (
                <Paragraph ellipsis={{ rows: 3, expandable: 'collapsible' }} style={{ marginBottom: 0 }}>
                  {value}
                </Paragraph>
              ) : (
                <Text type="secondary">-</Text>
              ),
          },
        ]}
      />
    </div>
  );
}

export function LogsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const activeTab = searchParams.get('tab') === 'notification' ? 'notification' : 'sync';

  const items: TabsProps['items'] = [
    {
      key: 'sync',
      label: '同步日志',
      children: <SyncLogsTab />,
    },
    {
      key: 'notification',
      label: '通知日志',
      children: <NotificationLogsTab />,
    },
  ];

  return (
    <Tabs
      items={items}
      activeKey={activeTab}
      onChange={(key) => {
        const next = new URLSearchParams(searchParams);
        next.set('tab', key);
        navigate({ search: `?${next.toString()}` }, { replace: true });
      }}
    />
  );
}
