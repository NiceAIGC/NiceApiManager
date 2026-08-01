import { Button, Card, CardBody, CardHeader, Chip, Input, Select, SelectItem, Spinner, Tab, Tabs, addToast } from '@heroui/react';
import { RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchDashboardOverview, fetchDashboardTrends } from '../api/dashboard';
import { fetchInstances, syncInstance } from '../api/instances';
import { fetchAppSettings } from '../api/settings';
import { MetricCard } from '../components/MetricCard';
import { SyncProgressModal, type SyncProgressItem } from '../components/SyncProgressModal';
import type { DashboardTrendQuery, InstanceQuery } from '../types/api';
import { runBatchSyncWithConcurrency } from '../utils/batchSync';
import { formatMoney, formatNumber } from '../utils/format';

type TrendMode = '7d' | '15d' | '30d';
const initialProgress = { open: false, running: false, total: 0, completed: 0, successCount: 0, failedCount: 0, activeNames: [] as string[], items: [] as SyncProgressItem[] };

export function DashboardPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [tagKeys, setTagKeys] = useState(new Set<string>());
  const [mode, setMode] = useState<TrendMode>('7d');
  const [progress, setProgress] = useState(initialProgress);
  const filters = useMemo<InstanceQuery>(() => ({ search: search.trim() || undefined, tags: tagKeys.size ? [...tagKeys] : undefined }), [search, tagKeys]);
  const days = mode === '15d' ? 15 : mode === '30d' ? 30 : 7;
  const trendQuery = useMemo<DashboardTrendQuery>(() => ({ ...filters, days, breakdown_limit: 8 }), [filters, days]);
  const { data: instances } = useQuery({ queryKey: ['instances'], queryFn: () => fetchInstances() });
  const { data: settings } = useQuery({ queryKey: ['app-settings'], queryFn: fetchAppSettings });
  const overview = useQuery({ queryKey: ['dashboard-overview', filters], queryFn: () => fetchDashboardOverview(filters) });
  const trends = useQuery({ queryKey: ['dashboard-trends', trendQuery], queryFn: () => fetchDashboardTrends(trendQuery) });
  const tags = useMemo(() => [...new Set((instances?.items ?? []).flatMap((item) => item.tags))].sort(), [instances]);
  const totalUsed = useMemo(() => (trends.data?.points ?? []).reduce((sum, point) => sum + point.used_display_amount, 0), [trends.data]);
  const maxUsage = useMemo(() => Math.max(1, ...(trends.data?.points ?? []).map((point) => point.used_display_amount)), [trends.data]);
  const refresh = async () => { await Promise.all(['instances', 'dashboard-overview', 'dashboard-trends', 'sync-runs', 'groups', 'pricing-models'].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))); };
  const syncAll = async () => {
    const targets = (overview.data?.items ?? []).filter((item) => item.enabled).map((item) => ({ id: item.instance_id, name: item.instance_name }));
    if (!targets.length) { addToast({ title: '当前筛选下没有可同步的启用实例', color: 'warning' }); return; }
    setProgress({ ...initialProgress, open: true, running: true, total: targets.length, items: targets.map((item) => ({ key: item.id, name: item.name, status: 'pending' })) });
    try {
      const result = await runBatchSyncWithConcurrency({ targets, maxWorkers: settings?.sync_max_workers ?? 5, syncOne: syncInstance, onStateChange: (state) => setProgress({ open: true, total: targets.length, ...state }) });
      await refresh();
      addToast({ title: `同步完成：成功 ${result.successCount}，失败 ${result.failedCount}`, color: result.failedCount ? 'warning' : 'success' });
    } catch { setProgress((current) => ({ ...current, running: false })); addToast({ title: '同步失败', color: 'danger' }); }
  };
  return <div className="space-y-5"><Card><CardHeader className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-semibold">筛选与分析维度</h2><p className="text-sm text-default-500">按实例范围查看用量概览与趋势</p></div><div className="flex gap-2"><Button variant="flat" onPress={() => { setSearch(''); setTagKeys(new Set()); }}>清空筛选</Button><Button color="primary" isLoading={progress.running} startContent={<RefreshCw size={16} />} onPress={syncAll}>同步全部</Button></div></CardHeader><CardBody className="grid gap-3 md:grid-cols-3"><Input label="搜索实例" placeholder="实例名、地址或用户名" value={search} onValueChange={setSearch} /><Select label="标签筛选" selectedKeys={tagKeys} selectionMode="multiple" onSelectionChange={(keys) => setTagKeys(new Set(keys as Set<string>))}>{tags.map((tag) => <SelectItem key={tag}>{tag}</SelectItem>)}</Select><Tabs aria-label="趋势范围" selectedKey={mode} onSelectionChange={(key) => setMode(key as TrendMode)}><Tab key="7d" title="近 7 天" /><Tab key="15d" title="近 15 天" /><Tab key="30d" title="近 30 天" /></Tabs></CardBody></Card><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6"><MetricCard title="实例总数" value={formatNumber(overview.data?.instance_count ?? 0)} /><MetricCard title="启用实例" value={formatNumber(overview.data?.enabled_instance_count ?? 0)} /><MetricCard title="健康实例" value={formatNumber(overview.data?.healthy_instance_count ?? 0)} /><MetricCard title="预付费总余额" value={formatMoney(overview.data?.total_display_quota ?? 0)} /><MetricCard title="区间已用额度" value={formatMoney(totalUsed)} /><MetricCard title="今日请求" value={formatNumber(overview.data?.today_request_count ?? 0)} /></div><Card><CardHeader><div><h2 className="text-lg font-semibold">每日消耗额度</h2><p className="text-sm text-default-500">{trends.data ? `${trends.data.start_date} 至 ${trends.data.end_date}` : '正在加载趋势数据'}</p></div></CardHeader><CardBody>{trends.isLoading ? <Spinner className="mx-auto" /> : <div className="flex h-64 items-end gap-2 overflow-x-auto px-2">{(trends.data?.points ?? []).map((point) => <div key={point.date} className="group flex min-w-10 flex-1 flex-col justify-end"><div className="mb-2 text-center text-xs text-default-500 opacity-0 transition group-hover:opacity-100">{formatMoney(point.used_display_amount)}</div><div className="rounded-t bg-primary" style={{ height: `${Math.max(3, point.used_display_amount / maxUsage * 100)}%` }} title={`${point.label}: ${formatMoney(point.used_display_amount)}`} /><div className="mt-2 text-center text-[10px] text-default-500">{point.label}</div></div>)}</div>}</CardBody></Card><Card><CardHeader><h2 className="text-lg font-semibold">实例概览</h2></CardHeader><CardBody>{overview.isLoading ? <Spinner className="mx-auto" /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{(overview.data?.items ?? []).map((item) => <div key={item.instance_id} className="rounded-xl border border-default-200 p-4"><div className="flex items-center justify-between gap-2"><strong className="truncate">{item.instance_name}</strong><Chip color={item.health_status === 'healthy' ? 'success' : 'danger'} size="sm" variant="flat">{item.health_status}</Chip></div><p className="mt-2 text-sm text-default-500">余额 {formatMoney(item.latest_display_quota)} · 今日请求 {formatNumber(item.today_request_count)}</p></div>)}</div>}</CardBody></Card><SyncProgressModal {...progress} title="批量同步进度" onClose={() => setProgress(initialProgress)} onRetryFailed={(items) => void syncAll()} /></div>;
}
