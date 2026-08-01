import { Alert, Card, CardBody, CardHeader, Select, SelectItem } from '@heroui/react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchGroups } from '../api/groups';
import { fetchInstances } from '../api/instances';
import { DataTable } from '../components/DataTable';
import { MetricCard } from '../components/MetricCard';
import type { GroupRatioItem } from '../types/api';
import { formatDateTime } from '../utils/format';

export function GroupsPage() {
  const [tag, setTag] = useState(new Set<string>());
  const [instance, setInstance] = useState(new Set<string>());
  const selectedTag = [...tag][0];
  const selectedInstance = [...instance][0];
  const instances = useQuery({ queryKey: ['instances', selectedTag], queryFn: () => fetchInstances(selectedTag ? { tags: [selectedTag] } : undefined) });
  const groups = useQuery({ queryKey: ['groups', selectedTag, selectedInstance], queryFn: () => fetchGroups(selectedInstance ? Number(selectedInstance) : undefined, selectedTag) });
  const tags = useMemo(() => [...new Set((instances.data?.items ?? []).flatMap((item) => item.tags))].sort(), [instances.data]);
  const summary = useMemo(() => { const values = (groups.data?.items ?? []).map((item) => item.ratio); return { total: values.length, instances: new Set((groups.data?.items ?? []).map((item) => item.instance_id)).size, min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 0 }; }, [groups.data]);
  return <div className="space-y-5"><Card className="border border-primary-100 bg-primary-50"><CardHeader><div><h2 className="text-lg font-semibold">分组倍率</h2><p className="text-sm text-default-600">倍率越高，同一模型调用消耗的额度越多；数据来自各实例最近一次同步。</p></div></CardHeader></Card><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard title="分组记录" value={summary.total} /><MetricCard title="覆盖实例" value={summary.instances} /><MetricCard title="最低倍率" value={`${summary.min.toFixed(4)}x`} /><MetricCard title="最高倍率" value={`${summary.max.toFixed(4)}x`} /></div><Alert color="primary" title="实际模型消耗通常为：模型基础价格 / 倍率 × 分组倍率。" /><Card><CardBody className="gap-4"><div className="grid gap-3 md:grid-cols-2"><Select label="按标签筛选" placeholder="全部标签" selectedKeys={tag} onSelectionChange={(keys) => setTag(new Set(keys as Set<string>))}>{tags.map((item) => <SelectItem key={item}>{item}</SelectItem>)}</Select><Select label="按实例筛选" placeholder="全部实例" selectedKeys={instance} onSelectionChange={(keys) => setInstance(new Set(keys as Set<string>))}>{(instances.data?.items ?? []).map((item) => <SelectItem key={String(item.id)}>{item.name}</SelectItem>)}</Select></div><DataTable<GroupRatioItem> empty="暂无分组倍率数据" isLoading={groups.isLoading} items={groups.data?.items ?? []} columns={[{ key: 'instance', label: '实例', render: (item) => item.instance_name }, { key: 'group', label: '分组', render: (item) => <div><strong>{item.group_name}</strong><p className="text-xs text-default-500">{item.group_desc ?? '-'}</p></div> }, { key: 'ratio', label: '倍率', render: (item) => `${item.ratio.toFixed(4)}x` }, { key: 'time', label: '同步时间', render: (item) => formatDateTime(item.snapshot_at) }]} /></CardBody></Card></div>;
}
