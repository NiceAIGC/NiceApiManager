import { Empty, Input, Select, Space, Table, Tag } from 'antd';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchInstances } from '../api/instances';
import { fetchPricingModels } from '../api/pricing';
import { formatDateTime } from '../utils/format';

export function PricingPage() {
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [instanceId, setInstanceId] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data: instanceData } = useQuery({
    queryKey: ['instances', tag],
    queryFn: () => fetchInstances(tag),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['pricing-models', tag, instanceId, search, groupName, page, pageSize],
    queryFn: () =>
      fetchPricingModels({
        tag,
        instance_id: instanceId,
        search: search || undefined,
        group_name: groupName,
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }),
  });

  const instanceOptions = useMemo(
    () =>
      (instanceData?.items ?? []).map((item) => ({
        label: item.name,
        value: item.id,
      })),
    [instanceData],
  );

  const groupOptions = useMemo(() => {
    const values = new Set<string>();
    for (const row of data?.items ?? []) {
      for (const group of row.enable_groups) {
        values.add(group);
      }
    }
    return Array.from(values)
      .sort()
      .map((group) => ({ label: group, value: group }));
  }, [data]);

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
              setPage(1);
            }}
          />
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
          <Input.Search
            allowClear
            placeholder="搜索模型名"
            style={{ width: 260 }}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="按分组筛选"
            style={{ width: 220 }}
            options={groupOptions}
            value={groupName}
            onChange={(value) => {
              setGroupName(value);
              setPage(1);
            }}
          />
        </div>
      </div>

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items ?? []}
        locale={{ emptyText: <Empty description="暂无定价模型数据" /> }}
        scroll={{ x: 1380 }}
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
            fixed: 'left',
            width: 160,
          },
          {
            title: '模型名',
            dataIndex: 'model_name',
            key: 'model_name',
            fixed: 'left',
            width: 260,
          },
          {
            title: '供应商',
            dataIndex: 'vendor_name',
            key: 'vendor_name',
            render: (value?: string | null) => value || '-',
          },
          {
            title: '计费类型',
            dataIndex: 'quota_type',
            key: 'quota_type',
          },
          {
            title: '模型倍率',
            dataIndex: 'model_ratio',
            key: 'model_ratio',
          },
          {
            title: '模型价格',
            dataIndex: 'model_price',
            key: 'model_price',
          },
          {
            title: '补全倍率',
            dataIndex: 'completion_ratio',
            key: 'completion_ratio',
          },
          {
            title: '可用分组',
            dataIndex: 'enable_groups',
            key: 'enable_groups',
            render: (value: string[]) => (
              <Space wrap>
                {value.length ? value.map((item) => <Tag key={item}>{item}</Tag>) : '-'}
              </Space>
            ),
          },
          {
            title: '支持端点',
            dataIndex: 'supported_endpoint_types',
            key: 'supported_endpoint_types',
            render: (value: string[]) => (
              <Space wrap>
                {value.length ? value.map((item) => <Tag color="blue" key={item}>{item}</Tag>) : '-'}
              </Space>
            ),
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
