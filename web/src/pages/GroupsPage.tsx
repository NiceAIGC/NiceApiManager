import { Empty, Select, Space, Table } from 'antd';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchGroups } from '../api/groups';
import { fetchInstances } from '../api/instances';
import { formatDateTime } from '../utils/format';

export function GroupsPage() {
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [instanceId, setInstanceId] = useState<number | undefined>(undefined);

  const { data: instanceData } = useQuery({
    queryKey: ['instances', tag],
    queryFn: () => fetchInstances(tag),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['groups', tag, instanceId],
    queryFn: () => fetchGroups(instanceId, tag),
  });

  const instanceOptions = useMemo(
    () =>
      (instanceData?.items ?? []).map((item) => ({
        label: item.name,
        value: item.id,
      })),
    [instanceData],
  );

  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const item of instanceData?.items ?? []) {
      for (const tagItem of item.tags) {
        tags.add(tagItem);
      }
    }

    return Array.from(tags)
      .sort()
      .map((tagItem) => ({ label: tagItem, value: tagItem }));
  }, [instanceData]);

  return (
    <div className="page-stack">
      <div className="table-toolbar">
        <div className="table-toolbar-left">
          <Select
            allowClear
            placeholder="按标签筛选"
            style={{ width: 220 }}
            options={tagOptions}
            value={tag}
            onChange={(value) => {
              setTag(value);
              setInstanceId(undefined);
            }}
          />
          <Select
            allowClear
            placeholder="按实例筛选"
            style={{ width: 240 }}
            options={instanceOptions}
            value={instanceId}
            onChange={(value) => setInstanceId(value)}
          />
        </div>
      </div>

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items ?? []}
        locale={{ emptyText: <Empty description="暂无分组倍率数据" /> }}
        pagination={false}
        columns={[
          {
            title: '实例',
            dataIndex: 'instance_name',
            key: 'instance_name',
          },
          {
            title: '分组名',
            dataIndex: 'group_name',
            key: 'group_name',
          },
          {
            title: '说明',
            dataIndex: 'group_desc',
            key: 'group_desc',
            render: (value?: string | null) => value || '-',
          },
          {
            title: '倍率',
            dataIndex: 'ratio',
            key: 'ratio',
          },
          {
            title: '快照时间',
            dataIndex: 'snapshot_at',
            key: 'snapshot_at',
            render: (value: string) => formatDateTime(value),
          },
        ]}
      />
    </div>
  );
}
