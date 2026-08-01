import { BarChartOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { Alert, Card, Col, Empty, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
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
    queryFn: () => fetchInstances(tag ? { tags: [tag] } : undefined),
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

  const summary = useMemo(() => {
    const rows = data?.items ?? [];
    const ratios = rows.map((item) => item.ratio);
    return {
      total: rows.length,
      instanceCount: new Set(rows.map((item) => item.instance_id)).size,
      min: ratios.length ? Math.min(...ratios) : 0,
      max: ratios.length ? Math.max(...ratios) : 0,
    };
  }, [data?.items]);

  return (
    <div className="page-stack">
      <Card className="section-card ratio-hero-card">
        <Space direction="vertical" size={4}>
          <Typography.Title level={4} style={{ margin: 0 }}><BarChartOutlined /> 分组倍率</Typography.Title>
          <Typography.Text type="secondary">倍率越高，同一模型调用消耗的额度越多；数据来自各实例最近一次同步。</Typography.Text>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}><Card><Statistic title="分组记录" value={summary.total} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="覆盖实例" value={summary.instanceCount} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="最低倍率" value={summary.min} suffix="x" precision={4} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="最高倍率" value={summary.max} suffix="x" precision={4} /></Card></Col>
      </Row>

      <Alert showIcon icon={<InfoCircleOutlined />} type="info" message="实际模型消耗通常为：模型基础价格/倍率 × 分组倍率。不同上游计费规则可能存在固定价格或特殊计费。" />
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
            title: '分组说明',
            dataIndex: 'group_desc',
            key: 'group_desc',
            render: (value?: string | null) => value || <Typography.Text type="secondary">未提供说明</Typography.Text>,
          },
          {
            title: '消费倍率',
            dataIndex: 'ratio',
            key: 'ratio',
            sorter: (left, right) => left.ratio - right.ratio,
            render: (value: number) => <Tag color={value > 1 ? 'orange' : value < 1 ? 'green' : 'blue'}>{value.toLocaleString('zh-CN', { maximumFractionDigits: 8 })}x</Tag>,
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
