import { useQuery } from '@tanstack/react-query';
import { AppWindow, Clock3, Info, Layers3, Search, X, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { fetchInstances } from '../api/instances';
import { fetchPricingComparison, fetchPricingFacets, fetchPricingModels } from '../api/pricing';
import {
  Button,
  Card,
  CardContent,
  DataTable,
  Input,
  MultiSelect,
  PageHeader,
  SegmentedControl,
  SelectField,
  StatCard,
  StatusBadge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui';
import type { DataTableColumn } from '../components/ui';
import { cn } from '../lib/utils';
import type { PricingCompareModelRow, PricingModelItem, PricingTier } from '../types/api';
import { formatDateTime } from '../utils/format';
import { formatClock, formatHourWindow, formatPricePerMillion, formatPricePerRequest, formatRatio, tierFixedPrice, tierPrice } from '../utils/pricing';

type DisplayMode = 'price' | 'ratio';
type ViewMode = 'detail' | 'compare';

const BILLING_KIND_OPTIONS = [
  { label: '全部计费', value: 'all' },
  { label: '倍率计费', value: 'token' },
  { label: '固定/按次', value: 'fixed' },
  { label: '阶梯计费', value: 'tiered' },
  { label: '分时计价', value: 'time' },
];

const isTieredRow = (record: PricingModelItem) => record.billing_mode === 'tiered_expr' || (record.tiers?.length ?? 0) > 1;
const isFixedRow = (record: PricingModelItem) => !isTieredRow(record) && (record.quota_type !== 0 || record.price_per_request != null);

function programLabel(program: string) {
  if (program === 'sub2api') return 'Sub2API';
  if (program === 'rixapi') return 'RixAPI';
  if (program === 'shellapi') return 'ShellAPI';
  return 'NewAPI';
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
  const timezone = tier.time_windows?.[0]?.timezone ? `（${tier.time_windows[0].timezone}）` : '';
  return `${windows}${tier.weekdays_only ? '，仅工作日' : ''}${timezone}`;
}

function TierTable({ tiers }: { tiers: PricingTier[] }) {
  const columns: Array<DataTableColumn<PricingTier>> = [
    { id: 'label', header: '档位', width: 110, cell: (tier) => <StatusBadge tone="secondary">{tier.label || '-'}</StatusBadge> },
    { id: 'condition', header: '条件', cell: (tier) => <span className="text-xs">{tierConditionText(tier)}</span> },
    { id: 'time', header: '生效时段', cell: (tier) => { const text = tierTimeText(tier); return text ? <StatusBadge tone="warning">{text}</StatusBadge> : '-'; } },
    { id: 'input', header: '输入价格', align: 'right', cell: (tier) => { const fixed = tierFixedPrice(tier); return <span className="tabular">{fixed !== null ? formatPricePerRequest(fixed) : formatPricePerMillion(tierPrice(tier, 'input'))}</span>; } },
    { id: 'output', header: '输出价格', align: 'right', cell: (tier) => <span className="tabular">{formatPricePerMillion(tierPrice(tier, 'output'))}</span> },
    { id: 'cache_read', header: '缓存读', align: 'right', cell: (tier) => <span className="tabular">{formatPricePerMillion(tierPrice(tier, 'cache_read'))}</span> },
    { id: 'cache_write', header: '缓存写', align: 'right', cell: (tier) => { const write = tierPrice(tier, 'cache_write'); const write1h = tierPrice(tier, 'cache_write_1h'); return <span className="tabular">{write === null && write1h === null ? '-' : `${formatPricePerMillion(write)}${write1h !== null ? ` / 1h ${formatPricePerMillion(write1h)}` : ''}`}</span>; } },
  ];
  return <DataTable rows={tiers} columns={columns} rowKey={(tier) => `${tier.label}-${tierConditionText(tier)}`} emptyText="暂无档位" dense className="text-xs" />;
}

function TimePricingBadge({ record }: { record: PricingModelItem }) {
  if (!record.time_pricing?.periods?.length) return null;
  const text = record.time_pricing.periods.map((period) => `${formatClock(period.start_time)}–${formatClock(period.end_time)} ×${period.multiplier}`).join('；')
    + (record.time_pricing.weekdays_only ? '，仅工作日' : '');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <StatusBadge tone="warning"><Clock3 className="size-3" />分时 ×{record.time_pricing.periods.length} 段</StatusBadge>
        </span>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

export function PricingPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('detail');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('price');
  const [tag, setTag] = useState('all');
  const [instanceId, setInstanceId] = useState('all');
  const [compareInstanceIds, setCompareInstanceIds] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState('all');
  const [billingKind, setBillingKind] = useState('all');
  const [vendor, setVendor] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [expandedKeys, setExpandedKeys] = useState<Set<number | string>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data: instanceData } = useQuery({ queryKey: ['instances'], queryFn: () => fetchInstances() });
  const { data: facetData } = useQuery({
    queryKey: ['pricing-facets', instanceId, tag],
    queryFn: () => fetchPricingFacets({ instance_id: instanceId === 'all' ? undefined : Number(instanceId), tag: tag === 'all' ? undefined : tag }),
  });
  const { data, isLoading } = useQuery({
    queryKey: ['pricing-models', tag, instanceId, search, groupName, billingKind, vendor, page, pageSize],
    queryFn: () => fetchPricingModels({
      tag: tag === 'all' ? undefined : tag,
      instance_id: instanceId === 'all' ? undefined : Number(instanceId),
      search: search || undefined,
      group_name: groupName === 'all' ? undefined : groupName,
      vendor: vendor === 'all' ? undefined : vendor,
      billing_kind: billingKind === 'all' ? undefined : billingKind,
      offset: (page - 1) * pageSize,
      limit: pageSize,
    }),
  });
  const { data: compareData, isLoading: compareLoading } = useQuery({
    queryKey: ['pricing-compare', tag, compareInstanceIds, search, groupName, vendor, page, pageSize],
    queryFn: () => fetchPricingComparison({
      tag: tag === 'all' ? undefined : tag,
      instance_ids: compareInstanceIds.length ? compareInstanceIds.map(Number) : undefined,
      search: search || undefined,
      group_name: groupName === 'all' ? undefined : groupName,
      vendor: vendor === 'all' ? undefined : vendor,
      offset: (page - 1) * pageSize,
      limit: pageSize,
    }),
    enabled: viewMode === 'compare',
  });

  const instanceOptions = useMemo(() => (instanceData?.items ?? []).map((item) => ({ label: item.name, value: String(item.id) })), [instanceData]);
  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const item of instanceData?.items ?? []) for (const value of item.tags) tags.add(value);
    return Array.from(tags).sort().map((value) => ({ label: value, value }));
  }, [instanceData]);
  const rows = data?.items ?? [];
  const summary = useMemo(() => ({
    total: data?.total ?? 0,
    tokenModels: rows.filter((item) => !isTieredRow(item) && !isFixedRow(item)).length,
    fixedModels: rows.filter((item) => isFixedRow(item)).length,
    tieredModels: rows.filter((item) => isTieredRow(item)).length,
    timePriced: rows.filter((item) => (item.time_pricing?.periods?.length ?? 0) > 0).length,
  }), [data?.total, rows]);

  const detailColumns: Array<DataTableColumn<PricingModelItem>> = [
    {
      id: 'instance_name',
      header: '实例',
      width: 165,
      cell: (row) => (
        <div className="flex items-center gap-1">
          <span className="truncate">{row.instance_name}</span>
          <StatusBadge tone="secondary">{programLabel(row.instance_program)}</StatusBadge>
        </div>
      ),
    },
    {
      id: 'model_name',
      header: '模型名',
      width: 220,
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.model_name}</span>
          {row.vendor_name ? <span className="text-xs text-muted-foreground">{row.vendor_name}</span> : null}
        </div>
      ),
    },
    {
      id: 'billing',
      header: '计费方式',
      width: 190,
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {isTieredRow(row) ? <StatusBadge tone="secondary"><Layers3 className="size-3" />阶梯 {row.tiers?.length ?? 1} 档</StatusBadge> : null}
          {isFixedRow(row) ? <StatusBadge tone="secondary">按次</StatusBadge> : null}
          {!isTieredRow(row) && !isFixedRow(row) ? <StatusBadge tone="secondary">倍率</StatusBadge> : null}
          <TimePricingBadge record={row} />
          {row.billing_expr ? (
            <Tooltip>
              <TooltipTrigger asChild><span><StatusBadge tone="warning">表达式</StatusBadge></span></TooltipTrigger>
              <TooltipContent><span className="break-all font-mono text-[11px]">{row.billing_expr}</span></TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ),
    },
    {
      id: 'input',
      header: displayMode === 'price' ? '输入价格' : '模型倍率',
      width: 180,
      align: 'right',
      cell: (row) => {
        if (isFixedRow(row)) return <strong className="tabular">{formatPricePerRequest(row.price_per_request)}</strong>;
        if (isTieredRow(row)) return <span className="text-muted-foreground">见档位</span>;
        return <span className="tabular">{displayMode === 'price' ? formatPricePerMillion(row.price_input) : `${formatRatio(row.model_ratio)}x`}</span>;
      },
    },
    {
      id: 'output',
      header: displayMode === 'price' ? '输出价格' : '补全倍率',
      width: 170,
      align: 'right',
      cell: (row) => {
        if (isFixedRow(row)) return '-';
        if (isTieredRow(row)) return <span className="text-muted-foreground">见档位</span>;
        return <span className="tabular">{displayMode === 'price' ? formatPricePerMillion(row.price_output) : `${formatRatio(row.completion_ratio)}x`}</span>;
      },
    },
    {
      id: 'cache',
      header: '缓存价格',
      width: 200,
      align: 'right',
      cell: (row) => {
        if (isFixedRow(row) || (row.price_cache_read == null && row.price_cache_write == null && row.price_cache_write_1h == null)) return '-';
        return (
          <span className="tabular text-xs">
            读 {formatPricePerMillion(row.price_cache_read)} · 写 {formatPricePerMillion(row.price_cache_write)}
            {row.price_cache_write_1h != null ? ` / 1h ${formatPricePerMillion(row.price_cache_write_1h)}` : ''}
          </span>
        );
      },
    },
    {
      id: 'enable_groups',
      header: '可用分组',
      width: 200,
      cell: (row) => (row.enable_groups.length ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex flex-wrap gap-1">
              {row.enable_groups.slice(0, 3).map((group) => <StatusBadge key={group} tone="muted">{group}</StatusBadge>)}
              {row.enable_groups.length > 3 ? <StatusBadge tone="muted">+{row.enable_groups.length - 3}</StatusBadge> : null}
            </span>
          </TooltipTrigger>
          <TooltipContent>{row.enable_groups.join('、')}</TooltipContent>
        </Tooltip>
      ) : <span className="text-muted-foreground">-</span>),
    },
    { id: 'snapshot_at', header: '快照时间', width: 150, cell: (row) => <span className="tabular text-muted-foreground">{formatDateTime(row.snapshot_at)}</span> },
  ];

  const compareInstances = compareData?.instances ?? [];
  const compareColumns: Array<DataTableColumn<PricingCompareModelRow>> = [
    {
      id: 'model_name',
      header: '模型',
      width: 220,
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.model_name}</span>
          {row.vendor_name ? <span className="text-xs text-muted-foreground">{row.vendor_name}</span> : null}
        </div>
      ),
    },
    ...compareInstances.map((instance): DataTableColumn<PricingCompareModelRow> => ({
      id: `instance-${instance.instance_id}`,
      header: instance.instance_name,
      width: 190,
      align: 'right',
      cell: (row) => {
        const entry = row.entries.find((item) => item.instance_id === instance.instance_id);
        if (!entry) return <span className="text-muted-foreground">-</span>;
        return (
          <div className="flex flex-col items-end gap-0.5">
            <span className="tabular text-sm">{formatPricePerMillion(entry.price_input)}</span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {entry.price_output != null ? `出 ${formatPricePerMillion(entry.price_output)}` : ''}
              {row.best_instance_id === instance.instance_id ? <StatusBadge tone="success"><Zap className="size-3" />最优</StatusBadge> : null}
            </span>
          </div>
        );
      },
    })),
  ];

  const total = viewMode === 'detail' ? data?.total ?? 0 : compareData?.total ?? 0;
  const resetFilters = () => {
    setSearchInput('');
    setTag('all');
    setInstanceId('all');
    setGroupName('all');
    setBillingKind('all');
    setVendor('all');
    setCompareInstanceIds([]);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="定价模型"
        subtitle="价格统一换算为美元 / 1M tokens；Sub2API 直接读取模型广场单价（未含分组倍率）。"
        extra={
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl options={[{ value: 'detail', label: '明细' }, { value: 'compare', label: '跨实例对比' }]} value={viewMode} onChange={(value) => { setViewMode(value as ViewMode); setPage(1); }} size="sm" />
            <SegmentedControl options={[{ value: 'price', label: '美元价格' }, { value: 'ratio', label: '倍率' }]} value={displayMode} onChange={(value) => setDisplayMode(value as DisplayMode)} size="sm" />
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard label="模型总数" value={total} icon={<AppWindow className="size-4" />} />
        <StatCard label="当前页倍率计费" value={summary.tokenModels} />
        <StatCard label="当前页固定/按次" value={summary.fixedModels} />
        <StatCard label="当前页阶梯计费" value={summary.tieredModels} />
        <StatCard label="当前页分时计价" value={summary.timePriced} />
        <StatCard label="覆盖实例" value={facetData?.instance_count ?? 0} />
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        NewAPI 实际消耗 = 输入/输出/缓存价 × 分组倍率；Sub2API 实际消耗 = 广场单价 × 个人倍率。阶梯与分时计费以展开档位为准。
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="搜索模型 / 供应商" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
        </div>
        <SelectField className="w-36" value={tag} onValueChange={(value) => { setTag(value); setPage(1); }} options={[{ label: '全部标签', value: 'all' }, ...tagOptions]} />
        {viewMode === 'detail' ? (
          <SelectField className="w-40" value={instanceId} onValueChange={(value) => { setInstanceId(value); setPage(1); }} options={[{ label: '全部实例', value: 'all' }, ...instanceOptions]} />
        ) : (
          <MultiSelect className="w-56" options={instanceOptions} value={compareInstanceIds} onChange={(value) => { setCompareInstanceIds(value); setPage(1); }} placeholder="对比实例（默认全部）" />
        )}
        <SelectField className="w-40" value={groupName} onValueChange={(value) => { setGroupName(value); setPage(1); }} options={[{ label: '全部分组', value: 'all' }, ...(facetData?.groups ?? []).map((group) => ({ label: group, value: group }))]} />
        <SelectField className="w-36" value={vendor} onValueChange={(value) => { setVendor(value); setPage(1); }} options={[{ label: '全部供应商', value: 'all' }, ...(facetData?.vendors ?? []).map((item) => ({ label: item, value: item }))]} />
        <SelectField className="w-36" value={billingKind} onValueChange={(value) => { setBillingKind(value); setPage(1); }} options={BILLING_KIND_OPTIONS} />
        <Button variant="ghost" size="sm" onClick={resetFilters}>
          <X className="size-4" />
          清空筛选
        </Button>
      </div>

      {viewMode === 'detail' ? (
        <DataTable
          rows={rows}
          columns={detailColumns}
          rowKey={(row) => row.id}
          loading={isLoading}
          dense
          ariaLabel="定价模型"
          emptyText="暂无定价模型数据"
          minWidth={1300}
          expandable={{
            expandedKeys,
            onToggle: (key) => setExpandedKeys((keys) => { const next = new Set(keys); if (next.has(key)) next.delete(key); else next.add(key); return next; }),
            isExpandable: (row) => Boolean(row.tiers?.length || row.billing_expr || row.time_pricing?.periods?.length || (row.extra && Object.values(row.extra).some((value) => value != null))),
            render: (row) => (
              <div className="flex flex-col gap-3">
                {row.tiers?.length ? <TierTable tiers={row.tiers} /> : null}
                {row.billing_expr ? (
                  <div className="rounded-md border bg-muted/30 px-3 py-2">
                    <div className="text-xs text-muted-foreground">计费表达式</div>
                    <code className="break-all font-mono text-xs">{row.billing_expr}</code>
                  </div>
                ) : null}
                {row.time_pricing?.periods?.length ? (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {row.time_pricing.periods.map((period, index) => (
                      <StatusBadge key={index} tone="warning">{formatClock(period.start_time)}–{formatClock(period.end_time)} ×{period.multiplier}</StatusBadge>
                    ))}
                    {row.time_pricing.weekdays_only ? <StatusBadge tone="muted">仅工作日</StatusBadge> : null}
                  </div>
                ) : null}
                {row.extra && Object.values(row.extra).some((value) => value != null) ? (
                  <pre className="m-0 overflow-x-auto rounded-md border bg-muted/30 p-2 text-[11px]">{JSON.stringify(row.extra, null, 2)}</pre>
                ) : null}
              </div>
            ),
          }}
          pagination={{ page, pageSize, total, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); }, pageSizeOptions: [50, 100], persistenceKey: 'pricing' }}
        />
      ) : (
        <DataTable
          rows={compareData?.models ?? []}
          columns={compareColumns}
          rowKey={(row) => row.model_name}
          loading={compareLoading}
          dense
          ariaLabel="定价对比"
          emptyText="暂无可对比数据"
          minWidth={Math.max(520, 200 + compareInstances.length * 190)}
          pagination={{ page, pageSize, total, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); }, pageSizeOptions: [50, 100], persistenceKey: 'pricing' }}
        />
      )}
    </div>
  );
}
