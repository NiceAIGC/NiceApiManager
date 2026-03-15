import { Empty, Select, Space, Table, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchInstances } from '../api/instances';
import { fetchSyncRuns } from '../api/sync';
import { StatusTag } from '../components/StatusTag';
import { formatDateTime } from '../utils/format';

const { Paragraph } = Typography;

export function SyncRunsPage() {
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

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items ?? []}
        locale={{ emptyText: <Empty description="暂无同步记录" /> }}
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
