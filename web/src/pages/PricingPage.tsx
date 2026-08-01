import { Button, Card, CardBody, CardHeader, Input, Select, SelectItem, Tab, Tabs } from '@heroui/react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchInstances } from '../api/instances';
import { fetchPricingModels } from '../api/pricing';
import { DataTable } from '../components/DataTable';
import type { PricingModelItem } from '../types/api';
import { cacheUsdPerMillion, inputUsdPerMillion, outputUsdPerMillion } from '../utils/pricing';

type Mode = 'ratio' | 'usd';
const number = (value?: number | null) => value == null || !Number.isFinite(value) ? '-' : Number.parseFloat(value.toFixed(8)).toString();
export function PricingPage() {
  const [search, setSearch] = useState(''); const [tag, setTag] = useState(new Set<string>()); const [instance, setInstance] = useState(new Set<string>()); const [mode, setMode] = useState<Mode>('ratio'); const [page, setPage] = useState(1); const pageSize = 20;
  const instances = useQuery({ queryKey: ['instances'], queryFn: () => fetchInstances() }); const selectedTag = [...tag][0]; const selectedInstance = [...instance][0];
  const data = useQuery({ queryKey: ['pricing-models', search, selectedTag, selectedInstance, page], queryFn: () => fetchPricingModels({ search: search || undefined, tag: selectedTag, instance_id: selectedInstance ? Number(selectedInstance) : undefined, offset: (page - 1) * pageSize, limit: pageSize }) });
  const tags = useMemo(() => [...new Set((instances.data?.items ?? []).flatMap((item) => item.tags))].sort(), [instances.data]);
  const price = (item: PricingModelItem, key: 'model_ratio' | 'completion_ratio' | 'cache_ratio') => { const value = item[key]; if (mode === 'ratio') return `${number(value)}x`; const conversion = key === 'model_ratio' ? inputUsdPerMillion(value ?? 0) : key === 'completion_ratio' ? outputUsdPerMillion(item.model_ratio, value ?? 0) : cacheUsdPerMillion(item.model_ratio, value ?? 0); return conversion == null ? '-' : `$${number(conversion)} / 1M`; };
  return <div className="space-y-5"><Card className="border border-primary-100 bg-primary-50"><CardHeader><div><h2 className="text-lg font-semibold">定价模型</h2><p className="text-sm text-default-600">在倍率和美元价格间切换；固定价格模型保持其原始价格。</p></div></CardHeader></Card><Card><CardBody className="gap-4"><div className="grid gap-3 md:grid-cols-4"><Input label="搜索模型" value={search} onValueChange={(value) => { setSearch(value); setPage(1); }} /><Select label="标签" selectedKeys={tag} onSelectionChange={(keys) => { setTag(new Set(keys as Set<string>)); setPage(1); }}>{tags.map((item) => <SelectItem key={item}>{item}</SelectItem>)}</Select><Select label="实例" selectedKeys={instance} onSelectionChange={(keys) => { setInstance(new Set(keys as Set<string>)); setPage(1); }}>{(instances.data?.items ?? []).map((item) => <SelectItem key={String(item.id)}>{item.name}</SelectItem>)}</Select><Tabs aria-label="价格显示方式" selectedKey={mode} onSelectionChange={(key) => setMode(key as Mode)}><Tab key="ratio" title="倍率" /><Tab key="usd" title="美元 / 1M" /></Tabs></div><DataTable<PricingModelItem> empty="暂无定价模型" isLoading={data.isLoading} items={data.data?.items ?? []} page={page} pageSize={pageSize} total={data.data?.total ?? 0} onPageChange={setPage} columns={[{ key: 'model', label: '模型', render: (item) => <div><strong>{item.model_name}</strong><p className="text-xs text-default-500">{item.instance_name}</p></div> }, { key: 'input', label: '输入', render: (item) => price(item, 'model_ratio') }, { key: 'output', label: '输出', render: (item) => price(item, 'completion_ratio') }, { key: 'cache', label: '缓存读', render: (item) => price(item, 'cache_ratio') }, { key: 'groups', label: '启用分组', render: (item) => item.enable_groups.join('、') || '-' }]} /></CardBody></Card></div>;
}
