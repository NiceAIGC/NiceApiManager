import { Alert, Tooltip } from '@heroui/react';
import type { Key } from '@heroui/react';
import { AppWindow, Clock3, DollarSign, Info, Layers3, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchInstances } from '../api/instances';
import { fetchPricingComparison, fetchPricingFacets, fetchPricingModels } from '../api/pricing';
import { DataTable, PageHeader, SegmentedControl, SelectInput, StatCard, StatusChip, TextInput } from '../components/ui';
import type { DataTableColumn } from '../components/ui';
import type { PricingCompareModelRow, PricingModelItem, PricingTier } from '../types/api';
import { formatDateTime } from '../utils/format';
import { formatClock, formatHourWindow, formatPricePerMillion, formatPricePerRequest, formatRatio, tierFixedPrice, tierPrice } from '../utils/pricing';

type PricingDisplayMode = 'price' | 'ratio';
type PricingViewMode = 'detail' | 'compare';

const BILLING_KIND_OPTIONS = [
  { label: '全部计费', value: '' },
  { label: '倍率计费', value: 'token' },
  { label: '固定/按次', value: 'fixed' },
  { label: '阶梯计费', value: 'tiered' },
  { label: '分时计价', value: 'time' },
];

function isTieredRow(record: PricingModelItem): boolean { return record.billing_mode === 'tiered_expr' || (record.tiers?.length ?? 0) > 1; }
function isFixedRow(record: PricingModelItem): boolean { return !isTieredRow(record) && (record.quota_type !== 0 || record.price_per_request != null); }

function programTag(program: string) {
  const label = program === 'sub2api' ? 'Sub2API' : program === 'rixapi' ? 'RixAPI' : program === 'shellapi' ? 'ShellAPI' : 'NewAPI';
  return <StatusChip color="accent">{label}</StatusChip>;
}

function tierConditionText(tier: PricingTier): string {
  const parts: string[] = [];
  for (const condition of tier.conditions ?? []) {
    if (condition.var && condition.op && condition.value !== undefined) {
      const varLabel = condition.var === 'len' ? '上下文' : condition.var === 'p' ? '输入' : condition.var === 'c' ? '输出' : condition.var;
      parts.push(`${varLabel} ${condition.op} ${condition.value.toLocaleString('zh-CN')}`);
    } else if (condition.raw) parts.push(condition.raw);
  }
  if (tier.min_tokens !== undefined || tier.max_tokens !== undefined) {
    const low = tier.min_tokens ?? 0;
    parts.push(tier.max_tokens == null ? `≥ ${low.toLocaleString('zh-CN')} tokens` : `${low.toLocaleString('zh-CN')}–${(tier.max_tokens ?? 0).toLocaleString('zh-CN')} tokens`);
  }
  return parts.join(' 且 ') || '无条件';
}

function tierTimeText(tier: PricingTier): string {
  const windows = (tier.time_windows ?? []).map((window) => formatHourWindow(window.from_hour, window.to_hour)).join(' / ');
  if (!windows) return tier.time_condition ?? '';
  const tz = tier.time_windows?.[0]?.timezone ? `（${tier.time_windows[0].timezone}）` : '';
  return `${windows}${tier.weekdays_only ? '，仅工作日' : ''}${tz}`;
}

function TierTable({ tiers }: { tiers: PricingTier[] }) {
  const columns: Array<DataTableColumn<PricingTier>> = [
    { id: 'label', title: '档位', width: 120, render: (tier) => <StatusChip color="accent">{tier.label || '-'}</StatusChip> },
    { id: 'condition', title: '条件', render: (tier) => tierConditionText(tier) },
    { id: 'time', title: '生效时段', render: (tier) => { const text = tierTimeText(tier); return text ? <StatusChip color="warning">{text}</StatusChip> : '-'; } },
    { id: 'input', title: '输入价格', align: 'right', render: (tier) => { const fixed = tierFixedPrice(tier); return fixed !== null ? formatPricePerRequest(fixed) : formatPricePerMillion(tierPrice(tier, 'input')); } },
    { id: 'output', title: '输出价格', align: 'right', render: (tier) => formatPricePerMillion(tierPrice(tier, 'output')) },
    { id: 'cache_read', title: '缓存读', align: 'right', render: (tier) => formatPricePerMillion(tierPrice(tier, 'cache_read')) },
    { id: 'cache_write', title: '缓存写', align: 'right', render: (tier) => { const write = tierPrice(tier, 'cache_write'); const write1h = tierPrice(tier, 'cache_write_1h'); if (write === null && write1h === null) return '-'; return <div className="flex items-center justify-end gap-1"><span>{formatPricePerMillion(write)}</span>{write1h !== null ? <Tooltip><Tooltip.Trigger><span><StatusChip>1h {formatPricePerMillion(write1h)}</StatusChip></span></Tooltip.Trigger><Tooltip.Content>1 小时 TTL 缓存写入价</Tooltip.Content></Tooltip> : null}</div>; } },
  ];
  return <DataTable rows={tiers} columns={columns} rowKey={(tier) => `${tier.label}-${tierConditionText(tier)}`} emptyText="暂无档位" minWidth={900} ariaLabel="阶梯计费档位" />;
}

function TimePricingTags({ record }: { record: PricingModelItem }) {
  if (!record.time_pricing?.periods?.length) return null;
  const title = record.time_pricing.periods.map((period) => `${formatClock(period.start_time)}–${formatClock(period.end_time)} ×${period.multiplier}`).join('；') + (record.time_pricing.weekdays_only ? '（仅工作日）' : '') + (record.time_pricing.timezone ? ` 时区 ${record.time_pricing.timezone}` : '');
  return <Tooltip><Tooltip.Trigger><span><StatusChip color="warning"><Clock3 size={13} />分时 ×{record.time_pricing.periods.length} 段</StatusChip></span></Tooltip.Trigger><Tooltip.Content>{title}</Tooltip.Content></Tooltip>;
}

export function PricingPage() {
  const [viewMode, setViewMode] = useState<PricingViewMode>('detail');
  const [displayMode, setDisplayMode] = useState<PricingDisplayMode>('price');
  const [tag, setTag] = useState<string | undefined>();
  const [instanceId, setInstanceId] = useState<number | undefined>();
  const [compareInstanceIds, setCompareInstanceIds] = useState<number[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState<string | undefined>();
  const [billingKind, setBillingKind] = useState('');
  const [vendor, setVendor] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [expandedKeys, setExpandedKeys] = useState<Set<number>>(new Set());

  useEffect(() => { const timer = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350); return () => clearTimeout(timer); }, [searchInput]);
  const { data: instanceData } = useQuery({ queryKey: ['instances', tag], queryFn: () => fetchInstances(tag ? { tags: [tag] } : undefined) });
  const { data: facetData } = useQuery({ queryKey: ['pricing-facets', instanceId, tag], queryFn: () => fetchPricingFacets({ instance_id: instanceId, tag }) });
  const { data, isLoading } = useQuery({ queryKey: ['pricing-models', tag, instanceId, search, groupName, billingKind, vendor, page, pageSize], queryFn: () => fetchPricingModels({ tag, instance_id: instanceId, search: search || undefined, group_name: groupName, vendor, billing_kind: billingKind || undefined, offset: (page - 1) * pageSize, limit: pageSize }), enabled: viewMode === 'detail' });
  const { data: compareData, isLoading: compareLoading } = useQuery({ queryKey: ['pricing-compare', tag, compareInstanceIds, search, groupName, vendor, page, pageSize], queryFn: () => fetchPricingComparison({ tag, instance_ids: compareInstanceIds, search: search || undefined, group_name: groupName, vendor, offset: (page - 1) * pageSize, limit: pageSize }), enabled: viewMode === 'compare' });
  const instanceOptions = useMemo(() => (instanceData?.items ?? []).map((item) => ({ label: item.name, value: String(item.id) })), [instanceData]);
  const tagOptions = useMemo(() => { const tags = new Set<string>(); for (const item of instanceData?.items ?? []) for (const value of item.tags) tags.add(value); return Array.from(tags).sort().map((value) => ({ label: value, value })); }, [instanceData]);
  const summary = useMemo(() => { const rows = data?.items ?? []; return { total: data?.total ?? 0, tokenModels: rows.filter((item) => !isTieredRow(item) && !isFixedRow(item)).length, fixedModels: rows.filter((item) => isFixedRow(item)).length, tieredModels: rows.filter((item) => isTieredRow(item)).length, timePriced: rows.filter((item) => item.time_pricing?.periods?.length).length }; }, [data]);
  const rows = data?.items ?? [];
  const compareInstances = compareData?.instances ?? [];
  const detailColumns: Array<DataTableColumn<PricingModelItem>> = [
    { id: 'instance_name', title: '实例', width: 190, render: (row) => <div className="flex items-center gap-1"><span>{row.instance_name}</span>{programTag(row.instance_program)}</div> },
    { id: 'model_name', title: '模型名', width: 250, render: (row) => <div className="flex flex-col"><span className="font-semibold">{row.model_name}</span>{row.vendor_name ? <span className="text-xs text-muted">{row.vendor_name}</span> : null}</div> },
    { id: 'billing', title: '计费方式', width: 190, render: (row) => <div className="flex flex-wrap gap-1">{isTieredRow(row) ? <Tooltip><Tooltip.Trigger><span><StatusChip color="accent"><Layers3 size={13} />阶梯 ×{row.tiers?.length ?? 0}</StatusChip></span></Tooltip.Trigger><Tooltip.Content>共 {row.tiers?.length ?? 0} 档</Tooltip.Content></Tooltip> : isFixedRow(row) ? <StatusChip color="warning">固定/按次</StatusChip> : <StatusChip color="accent">倍率计费</StatusChip>}<TimePricingTags record={row} /></div> },
    { id: 'input', title: displayMode === 'price' ? '输入价格' : '模型倍率', width: 200, align: 'right', render: (row) => { if (isFixedRow(row)) return <strong>{formatPricePerRequest(row.price_per_request ?? row.model_price)}</strong>; if (displayMode === 'ratio' && row.instance_program !== 'sub2api' && !isTieredRow(row)) return <strong>{formatRatio(row.model_ratio)}</strong>; return <div className="flex flex-col"><strong>{formatPricePerMillion(row.price_input)}</strong>{isTieredRow(row) ? <span className="text-xs text-muted">首档价，展开查看全部档位</span> : null}</div>; } },
    { id: 'output', title: displayMode === 'price' ? '输出价格' : '补全倍率', width: 180, align: 'right', render: (row) => { if (isFixedRow(row)) return '-'; if (displayMode === 'ratio' && row.instance_program !== 'sub2api' && !isTieredRow(row)) return formatRatio(row.completion_ratio); return formatPricePerMillion(row.price_output); } },
    { id: 'cache', title: '缓存价格', width: 220, align: 'right', render: (row) => { if (isFixedRow(row) || (row.price_cache_read == null && row.price_cache_write == null && row.price_cache_write_1h == null)) return '-'; return <div className="flex flex-col"><span>读 {formatPricePerMillion(row.price_cache_read)}</span><span className="text-xs text-muted">写 {formatPricePerMillion(row.price_cache_write)}{row.price_cache_write_1h != null ? ` / 1h ${formatPricePerMillion(row.price_cache_write_1h)}` : ''}</span></div>; } },
    { id: 'enable_groups', title: '可用分组', width: 220, render: (row) => row.enable_groups.length ? <Tooltip><Tooltip.Trigger><div className="flex flex-wrap gap-1"><span>{row.enable_groups.slice(0, 3).map((item) => <StatusChip key={item}>{item}</StatusChip>)}</span>{row.enable_groups.length > 3 ? <StatusChip>+{row.enable_groups.length - 3}</StatusChip> : null}</div></Tooltip.Trigger><Tooltip.Content>{row.enable_groups.join('、')}</Tooltip.Content></Tooltip> : '-' },
    { id: 'snapshot_at', title: '快照时间', width: 170, render: (row) => formatDateTime(row.snapshot_at) },
  ];
  const compareColumns: Array<DataTableColumn<PricingCompareModelRow>> = [
    { id: 'model_name', title: '模型', width: 250, render: (row) => <div className="flex flex-col"><span className="font-semibold">{row.model_name}</span>{row.vendor_name ? <span className="text-xs text-muted">{row.vendor_name}</span> : null}</div> },
    ...compareInstances.map((instance): DataTableColumn<PricingCompareModelRow> => ({ id: `instance-${instance.instance_id}`, title: <div className="flex items-center gap-1"><span>{instance.instance_name}</span>{programTag(instance.program)}</div>, width: 220, render: (row) => { const entry = row.entries.find((item) => item.instance_id === instance.instance_id); if (!entry) return <span className="text-muted">未上架</span>; const price = entry.effective_input ?? entry.price_input; const best = row.best_instance_id === entry.instance_id; const suffix = entry.min_group_ratio != null && entry.min_group_ratio !== 1 ? ` ×${Number.parseFloat(entry.min_group_ratio.toFixed(4))}` : ''; return <div className="flex flex-col gap-1">{entry.price_per_request != null ? <strong>{formatPricePerRequest(entry.price_per_request)}</strong> : <strong>{formatPricePerMillion(price)}<span className="font-normal text-muted">{suffix}</span></strong>}<div className="flex flex-wrap gap-1">{best ? <StatusChip color="success"><Zap size={13} />最低</StatusChip> : null}{entry.tier_count > 1 ? <StatusChip color="accent">阶梯 ×{entry.tier_count}</StatusChip> : null}{entry.has_time_pricing ? <StatusChip color="warning">分时</StatusChip> : null}</div></div>; } })),
  ];
  const expandable = { expandedKeys, onExpandedChange: (keys: Set<Key>) => setExpandedKeys(new Set([...keys].map(Number))), rowExpandable: (row: PricingModelItem) => Boolean(row.tiers?.length || row.billing_expr || row.time_pricing?.periods?.length || (row.extra && Object.values(row.extra).some((value) => value != null))), renderExpanded: (record: PricingModelItem) => <div className="flex flex-col gap-3 p-3">{record.tiers?.length ? <TierTable tiers={record.tiers} /> : null}{record.time_pricing?.periods?.length ? <div className="flex flex-wrap items-center gap-1"><span className="text-sm text-muted">分时段：</span>{record.time_pricing.periods.map((period) => <StatusChip key={`${period.start_time}-${period.end_time}`} color="warning">{formatClock(period.start_time)}–{formatClock(period.end_time)} ×{period.multiplier}</StatusChip>)}{record.time_pricing.weekdays_only ? <StatusChip>仅工作日</StatusChip> : null}{record.time_pricing.timezone ? <StatusChip>时区 {record.time_pricing.timezone}</StatusChip> : null}</div> : null}{(record.extra?.image_ratio != null || record.extra?.audio_ratio != null || record.extra?.audio_completion_ratio != null || record.extra?.image_input_price != null || record.extra?.image_output_price != null || record.extra?.official_price_input != null || record.extra?.long_context_basis) ? <div className="flex flex-wrap gap-1">{record.extra?.image_ratio != null ? <StatusChip color="accent">图片倍率 {formatRatio(record.extra.image_ratio)}</StatusChip> : null}{record.extra?.audio_ratio != null ? <StatusChip color="accent">音频倍率 {formatRatio(record.extra.audio_ratio)}</StatusChip> : null}{record.extra?.audio_completion_ratio != null ? <StatusChip color="accent">音频补全 {formatRatio(record.extra.audio_completion_ratio)}</StatusChip> : null}{record.extra?.image_input_price != null ? <StatusChip color="accent">图片输入 {formatPricePerMillion(record.extra.image_input_price)}</StatusChip> : null}{record.extra?.image_output_price != null ? <StatusChip color="accent">图片输出 {formatPricePerMillion(record.extra.image_output_price)}</StatusChip> : null}{record.extra?.official_price_input != null ? <Tooltip><Tooltip.Trigger><span><StatusChip>官方参考 {formatPricePerMillion(record.extra.official_price_input)}</StatusChip></span></Tooltip.Trigger><Tooltip.Content>官方参考价（未含分组倍率）</Tooltip.Content></Tooltip> : null}{record.extra?.long_context_basis ? <Tooltip><Tooltip.Trigger><span><StatusChip color="accent">{record.extra.long_context_basis === 'whole_request' ? '长上下文整单' : record.extra.long_context_basis}</StatusChip></span></Tooltip.Trigger><Tooltip.Content>长上下文阶梯计价基准：整单按所在档单价</Tooltip.Content></Tooltip> : null}</div> : null}{record.billing_expr ? <pre className="m-0 whitespace-pre-wrap rounded-lg border border-border bg-surface-secondary p-3 text-sm">{record.billing_expr}</pre> : null}</div> };
  const total = viewMode === 'detail' ? data?.total ?? 0 : compareData?.total ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="定价模型" subtitle="价格统一换算为美元/1M tokens：NewAPI 按模型倍率与站点 quota_per_unit 换算；Sub2API 直接读取模型广场单价（未含分组倍率）。阶梯与分时计价展开行查看明细；对比模式高亮同模型最低价。" extra={<DollarSign size={18} className="text-accent" />} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6"><StatCard label="模型总数" value={total} icon={<AppWindow size={16} />} /><StatCard label="当前页倍率计费" value={summary.tokenModels} /><StatCard label="当前页固定/按次" value={summary.fixedModels} /><StatCard label="当前页阶梯计费" value={summary.tieredModels} /><StatCard label="当前页分时计价" value={summary.timePriced} /><StatCard label="覆盖实例" value={facetData?.instance_count ?? 0} /></div>
      <Alert status="accent"><Alert.Indicator><Info size={16} /></Alert.Indicator><Alert.Content><Alert.Description>NewAPI 实际消耗 = 输入/输出/缓存价 × 分组倍率；Sub2API 实际消耗 = 广场单价 × 分组（或个人专属）倍率，高峰时段再乘高峰倍率。</Alert.Description></Alert.Content></Alert>
      <div className="flex flex-wrap items-end justify-between gap-3"><div className="flex flex-wrap items-end gap-3"><SelectInput placeholder="按标签筛选" options={tagOptions} value={tag} onChange={(value) => { setTag(typeof value === 'string' ? value : undefined); setInstanceId(undefined); setCompareInstanceIds([]); setPage(1); }} className="w-40" />{viewMode === 'detail' ? <SelectInput placeholder="按实例筛选" options={instanceOptions} value={instanceId == null ? undefined : String(instanceId)} onChange={(value) => { setInstanceId(typeof value === 'string' ? Number(value) : undefined); setPage(1); }} className="w-44" /> : <SelectInput placeholder="对比实例（默认全部）" options={instanceOptions} value={compareInstanceIds.map(String)} onChange={(value) => { setCompareInstanceIds(Array.isArray(value) ? value.map(Number) : []); setPage(1); }} multiple className="min-w-60" />}<TextInput inputProps={{ placeholder: '搜索模型/供应商', value: searchInput, onChange: (event) => setSearchInput(event.target.value) }} className="w-56" /><SelectInput placeholder="按分组筛选" options={(facetData?.groups ?? []).map((item) => ({ label: item, value: item }))} value={groupName} onChange={(value) => { setGroupName(typeof value === 'string' ? value : undefined); setPage(1); }} className="w-44" /><SelectInput placeholder="计费类型" options={BILLING_KIND_OPTIONS} value={billingKind} onChange={(value) => { setBillingKind(typeof value === 'string' ? value : ''); setPage(1); }} className="w-36" /><SelectInput placeholder="供应商" options={(facetData?.vendors ?? []).map((item) => ({ label: item, value: item }))} value={vendor} onChange={(value) => { setVendor(typeof value === 'string' ? value : undefined); setPage(1); }} className="w-40" /></div><div className="flex gap-2"><SegmentedControl options={[{ label: '美元价格', value: 'price' }, { label: '倍率', value: 'ratio' }]} value={displayMode} onChange={(value) => setDisplayMode(value as PricingDisplayMode)} /><SegmentedControl options={[{ label: '明细', value: 'detail' }, { label: '跨实例对比', value: 'compare' }]} value={viewMode} onChange={(value) => { setViewMode(value as PricingViewMode); setPage(1); }} /></div></div>
      {viewMode === 'detail' ? <DataTable rows={rows} columns={detailColumns} rowKey={(row) => row.id} loading={isLoading} emptyText="暂无定价模型数据" minWidth={1420} pagination={{ page, pageSize, total, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); }, pageSizeOptions: [50, 100, 200] }} expandable={expandable} ariaLabel="定价模型" /> : <DataTable rows={compareData?.models ?? []} columns={compareColumns} rowKey={(row) => row.model_name} loading={compareLoading} emptyText="暂无对比数据，请先同步多个实例" minWidth={240 + compareInstances.length * 220} pagination={{ page, pageSize, total, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); }, pageSizeOptions: [50, 100, 200] }} ariaLabel="定价模型对比" />}
    </div>
  );
}
