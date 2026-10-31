import { Alert, Button, Card, Dropdown, Tooltip } from '@heroui/react';
import type { Key } from '@heroui/react';
import { BarChart3, Check, Info, Pencil, Plus, Tags, Trash2, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppModal,
  ConfirmPopover,
  DataTable,
  EmptyState,
  PageHeader,
  SegmentedControl,
  SelectInput,
  StatCard,
  StatusChip,
  TextInput,
} from '../components/ui';
type GroupsViewMode = 'detail' | 'compare';

const LABEL_COLORS = ['accent', 'accent', 'warning', 'accent', 'success', 'warning', 'accent', 'warning'] as const;
import {
  assignGroupNamesToLabel,
  createGroupLabel,
  deleteGroupLabel,
  fetchGroupComparison,
  fetchGroupLabels,
  fetchGroupNames,
  fetchGroups,
  removeGroupNameFromLabel,
  updateGroupLabel,
} from '../api/groups';
import { fetchInstances } from '../api/instances';
import { notify } from '../lib/toast';
import type { GroupCompareRow, GroupLabelItem, GroupRatioItem } from '../types/api';
import { formatClock, formatRatio } from '../utils/pricing';
import { formatDateTime } from '../utils/format';


function labelColor(label: GroupLabelItem): (typeof LABEL_COLORS)[number] {
  return LABEL_COLORS[label.id % LABEL_COLORS.length] ?? 'accent';
}

function ratioTagColor(ratio: number): 'warning' | 'success' | 'accent' {
  return ratio > 1.05 ? 'warning' : ratio < 0.95 ? 'success' : 'accent';
}

function PeakTag({ start, end, ratio }: { start?: string | null; end?: string | null; ratio?: number | null }) {
  if (!start || !end) return null;
  const multiplier = Number.parseFloat((ratio ?? 1).toFixed(2));
  return (
    <Tooltip>
      <Tooltip.Trigger><span><StatusChip color="warning">{formatClock(start)}–{formatClock(end)}×{multiplier}</StatusChip></span></Tooltip.Trigger>
      <Tooltip.Content>高峰时段内整单消耗额外乘 {Number.parseFloat((ratio ?? 1).toFixed(4))} 倍</Tooltip.Content>
    </Tooltip>
  );
}

type LabelFormValues = { name: string; remark: string; group_names: string[] };

function LabelEditModal({ open, label, groupOptions, onClose }: { open: boolean; label: GroupLabelItem | null; groupOptions: string[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<LabelFormValues>({
    defaultValues: { name: '', remark: '', group_names: [] },
  });
  const saveMutation = useMutation({
    mutationFn: (values: LabelFormValues) => label
      ? updateGroupLabel(label.id, { name: values.name, remark: values.remark || null, group_names: values.group_names })
      : createGroupLabel({ name: values.name, remark: values.remark || null, group_names: values.group_names }),
    onSuccess: () => {
      notify.success(label ? '标签已更新' : '标签已创建');
      queryClient.invalidateQueries({ queryKey: ['group-labels'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['group-compare'] });
      onClose();
    },
    onError: (error) => notify.error(`保存失败：${error instanceof Error ? error.message : '未知错误'}`),
  });
  useEffect(() => {
    if (open) reset({ name: label?.name ?? '', remark: label?.remark ?? '', group_names: label?.group_names ?? [] });
  }, [open, label, reset]);

  return (
    <AppModal
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={label ? `编辑标签：${label.name}` : '新建分组标签'}
      footer={(close) => (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={close}>取消</Button>
          <Button variant="primary" type="submit" form="group-label-form" isPending={saveMutation.isPending}>保存</Button>
        </div>
      )}
    >
      <form id="group-label-form" className="flex flex-col gap-4" onSubmit={handleSubmit((values) => saveMutation.mutate(values))}>
        <TextInput label="标签名称" required error={errors.name?.message} inputProps={{ placeholder: '如：高倍率组 / Claude 专属 / 低价组', maxLength: 100, ...register('name', { required: '请输入标签名称' }) }} />
        <TextInput label="备注" inputProps={{ placeholder: '可选', maxLength: 255, ...register('remark') }} />
        <Controller
          control={control}
          name="group_names"
          rules={{ validate: (value) => value.length > 0 || '请选择至少一个分组' }}
          render={({ field, fieldState }) => (
            <SelectInput
              label="包含分组"
              required
              error={fieldState.error?.message}
              description="分组名在各实例间通用；对比视图会把同名分组的倍率放到同一行。"
              options={groupOptions.map((item) => ({ label: item, value: item }))}
              value={field.value}
              onChange={(value) => field.onChange(Array.isArray(value) ? value : [])}
              multiple
              placeholder="选择要打标签的分组"
            />
          )}
        />
      </form>
    </AppModal>
  );
}

function LabelActionMenu({ labelItems, assignedLabels, onAssign, onRemove, onCreate, children }: { labelItems: GroupLabelItem[]; assignedLabels: string[]; onAssign: (labelId: number) => void; onRemove: (labelId: number) => void; onCreate: () => void; children: ReactNode }) {
  return (
    <Dropdown>
      <Dropdown.Trigger>{children}</Dropdown.Trigger>
      <Dropdown.Popover>
        <Dropdown.Menu onAction={(key) => {
          const action = String(key);
          if (action === 'create') { onCreate(); return; }
          const id = Number(action.split('-')[1]);
          const label = labelItems.find((item) => item.id === id);
          if (!label) return;
          if (assignedLabels.includes(label.name)) onRemove(id); else onAssign(id);
        }}>
          {labelItems.map((label) => {
            const assigned = assignedLabels.includes(label.name);
            return <Dropdown.Item key={label.id} id={`label-${label.id}`} textValue={label.name}>{assigned ? <Check size={14} /> : null}<span>{label.name}</span>{assigned ? <span className="text-xs text-muted">（已包含，点击移除）</span> : null}</Dropdown.Item>;
          })}
          <Dropdown.Item id="create" textValue="新建标签"><Plus size={14} /><span>新建标签…</span></Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

export function GroupsPage() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<GroupsViewMode>('detail');
  const [tag, setTag] = useState<string | undefined>();
  const [instanceId, setInstanceId] = useState<number | undefined>();
  const [labelId, setLabelId] = useState<number | undefined>();
  const [compareLabelId, setCompareLabelId] = useState<number | undefined>();
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState<string | undefined>();
  const [labelModalOpen, setLabelModalOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<GroupLabelItem | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<Key>>(new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<Key>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const { data: instanceData } = useQuery({ queryKey: ['instances', tag], queryFn: () => fetchInstances(tag ? { tags: [tag] } : undefined) });
  const { data: labelData } = useQuery({ queryKey: ['group-labels'], queryFn: fetchGroupLabels });
  const { data: groupNamesData } = useQuery({ queryKey: ['group-names'], queryFn: fetchGroupNames });
  const { data, isLoading } = useQuery({
    queryKey: ['groups', tag, instanceId, labelId, search, platform],
    queryFn: () => fetchGroups({ instance_id: instanceId, tag, label_id: labelId, search: search || undefined, platform }),
    enabled: viewMode === 'detail',
  });
  const { data: compareData, isLoading: compareLoading } = useQuery({
    queryKey: ['group-compare', compareLabelId, tag], queryFn: () => fetchGroupComparison({ label_id: compareLabelId, tag }), enabled: viewMode === 'compare' && compareLabelId !== undefined,
  });
  const labelItems = labelData?.items ?? [];
  const assignMutation = useMutation({
    mutationFn: ({ labelId: id, groupNames }: { labelId: number; groupNames: string[] }) => assignGroupNamesToLabel(id, groupNames),
    onSuccess: () => { notify.success('已打标签'); queryClient.invalidateQueries({ queryKey: ['groups'] }); queryClient.invalidateQueries({ queryKey: ['group-labels'] }); queryClient.invalidateQueries({ queryKey: ['group-compare'] }); setSelectedKeys(new Set()); },
    onError: (error) => notify.error(`操作失败：${error instanceof Error ? error.message : '未知错误'}`),
  });
  const removeMutation = useMutation({
    mutationFn: ({ labelId: id, groupNames }: { labelId: number; groupNames: string[] }) => removeGroupNameFromLabel(id, groupNames),
    onSuccess: () => { notify.success('已移除标签'); queryClient.invalidateQueries({ queryKey: ['groups'] }); queryClient.invalidateQueries({ queryKey: ['group-labels'] }); queryClient.invalidateQueries({ queryKey: ['group-compare'] }); setSelectedKeys(new Set()); },
    onError: (error) => notify.error(`操作失败：${error instanceof Error ? error.message : '未知错误'}`),
  });
  const deleteLabelMutation = useMutation({
    mutationFn: (id: number) => deleteGroupLabel(id),
    onSuccess: () => { notify.success('标签已删除'); queryClient.invalidateQueries({ queryKey: ['group-labels'] }); queryClient.invalidateQueries({ queryKey: ['groups'] }); },
    onError: (error) => notify.error(`删除失败：${error instanceof Error ? error.message : '未知错误'}`),
  });
  const instanceOptions = useMemo(() => (instanceData?.items ?? []).map((item) => ({ label: item.name, value: String(item.id) })), [instanceData]);
  const tagOptions = useMemo(() => { const tags = new Set<string>(); for (const item of instanceData?.items ?? []) for (const value of item.tags) tags.add(value); return Array.from(tags).sort().map((value) => ({ label: value, value })); }, [instanceData]);
  const platformOptions = useMemo(() => { const platforms = new Set<string>(); for (const item of data?.items ?? []) if (item.platform) platforms.add(item.platform); return Array.from(platforms).sort().map((value) => ({ label: value, value })); }, [data?.items]);
  const labelOptions = labelItems.map((item) => ({ label: item.name, value: String(item.id) }));
  const rows = data?.items ?? [];
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const selectedRows = rows.filter((row) => selectedKeys.has(row.id));
  const selectedGroupNames = useMemo(() => Array.from(new Set(selectedRows.map((item) => item.group_name))), [selectedRows]);
  const batchAssigned = useMemo(() => labelItems.filter((label) => selectedGroupNames.length > 0 && selectedGroupNames.every((name) => label.group_names.includes(name))), [labelItems, selectedGroupNames]);
  const summary = useMemo(() => ({ total: rows.length, instanceCount: new Set(rows.map((item) => item.instance_id)).size, min: rows.length ? Math.min(...rows.map((item) => item.ratio)) : 0, max: rows.length ? Math.max(...rows.map((item) => item.ratio)) : 0 }), [rows]);
  const openLabelEditor = (label: GroupLabelItem | null) => { setEditingLabel(label); setLabelModalOpen(true); };
  const assign = (id: number, names: string[]) => assignMutation.mutate({ labelId: id, groupNames: names });
  const remove = (id: number, names: string[]) => removeMutation.mutate({ labelId: id, groupNames: names });

  const detailColumns = [
    { id: 'instance_name', title: '实例', width: 190, render: (row: GroupRatioItem) => <div className="flex items-center gap-1"><span>{row.instance_name}</span><StatusChip color="accent">{row.instance_program === 'sub2api' ? 'Sub2API' : 'NewAPI'}</StatusChip></div> },
    { id: 'group_name', title: '分组名', width: 220, render: (row: GroupRatioItem) => <div className="flex flex-col gap-1"><span className="font-semibold">{row.group_name}</span>{row.labels.length ? <div className="flex flex-wrap gap-1">{row.labels.map((name) => { const source = labelItems.find((item) => item.name === name); return <StatusChip key={name} color={source ? labelColor(source) : 'default'}>{name}</StatusChip>; })}</div> : null}</div> },
    { id: 'group_desc', title: '分组说明', render: (row: GroupRatioItem) => row.group_desc || <span className="text-muted">未提供说明</span> },
    { id: 'ratio', title: '消费倍率', width: 130, sortable: true, render: (row: GroupRatioItem) => <StatusChip color={ratioTagColor(row.ratio)}>{formatRatio(row.ratio)}</StatusChip> },
    { id: 'platform_user', title: '平台/个人', width: 150, render: (row: GroupRatioItem) => <div className="flex flex-wrap gap-1">{row.platform ? <StatusChip>{row.platform}</StatusChip> : null}{row.user_ratio != null ? <StatusChip color="accent">个人 {formatRatio(row.user_ratio)}</StatusChip> : null}{!row.platform && row.user_ratio == null ? '-' : null}</div> },
    { id: 'peak', title: '高峰时段', width: 190, render: (row: GroupRatioItem) => row.peak_start && row.peak_end ? <PeakTag start={row.peak_start} end={row.peak_end} ratio={row.peak_ratio} /> : '-' },
    { id: 'snapshot_at', title: '快照时间', width: 170, render: (row: GroupRatioItem) => formatDateTime(row.snapshot_at) },
    { id: 'action', title: '操作', width: 120, render: (row: GroupRatioItem) => <LabelActionMenu labelItems={labelItems} assignedLabels={row.labels} onAssign={(id) => assign(id, [row.group_name])} onRemove={(id) => remove(id, [row.group_name])} onCreate={() => openLabelEditor(null)}><Button size="sm" variant="ghost"><Tags size={15} />打标签</Button></LabelActionMenu> },
  ];
  const compareInstances = compareData?.instances ?? [];
  const compareRows = compareData?.rows ?? [];
  const pagedCompareRows = compareRows.slice((page - 1) * pageSize, page * pageSize);
  const compareColumns = [
    { id: 'group_name', title: '分组', width: 220, render: (row: GroupCompareRow) => <div className="flex flex-col gap-1"><span className="font-semibold">{row.group_name}</span>{compareData?.label ? <StatusChip color={labelColor(compareData.label)}>{compareData.label.name}</StatusChip> : null}</div> },
    ...compareInstances.map((instance) => ({ id: `instance-${instance.instance_id}`, title: <div className="flex items-center gap-1"><span>{instance.instance_name}</span><StatusChip color="accent">{instance.program === 'sub2api' ? 'Sub2API' : 'NewAPI'}</StatusChip></div>, width: 230, render: (row: GroupCompareRow) => { const entry = row.entries.find((item) => item.instance_id === instance.instance_id); if (!entry) return <span className="text-muted">未提供</span>; const best = row.best_instance_id === entry.instance_id; return <div className="flex flex-col gap-1"><div className="flex items-center gap-1"><StatusChip color={ratioTagColor(entry.ratio)}>{formatRatio(entry.ratio)}</StatusChip>{best ? <StatusChip color="success"><Zap size={13} />最低</StatusChip> : null}</div><div className="flex flex-wrap gap-1">{entry.user_ratio != null ? <StatusChip color="accent">个人 {formatRatio(entry.user_ratio)}</StatusChip> : null}{entry.peak_start && entry.peak_end ? <PeakTag start={entry.peak_start} end={entry.peak_end} ratio={entry.peak_ratio} /> : null}{entry.platform ? <StatusChip>{entry.platform}</StatusChip> : null}</div></div>; } })),
    { id: 'spread', title: '最低/最高', width: 170, render: (row: GroupCompareRow) => row.min_ratio == null || row.max_ratio == null ? '-' : `${formatRatio(row.min_ratio)} / ${formatRatio(row.max_ratio)}` },
    { id: 'spread_value', title: '差值', width: 100, sortable: true, render: (row: GroupCompareRow) => row.spread == null ? '-' : <StatusChip color={row.spread > 0.1 ? 'danger' : 'success'}>+{formatRatio(row.spread)}</StatusChip> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="分组倍率" subtitle="倍率越高，同一模型调用消耗的额度越多。可快速给分组打标签，并在同标签下跨实例对比倍率；Sub2API 分组额外展示个人倍率与高峰时段。" extra={<BarChart3 size={18} className="text-accent" />} />
      <Card><Card.Content className="flex flex-row flex-wrap items-center gap-2 p-4"><div className="flex items-center gap-2 font-semibold"><Tags size={17} />标签管理</div>{labelItems.map((item) => <Tooltip key={item.id}><Tooltip.Trigger><div className="flex items-center gap-1 rounded-lg border border-border px-2 py-1"><StatusChip color={labelColor(item)}>{item.name}</StatusChip><span className="text-xs text-muted">{item.group_names.length} 组</span><Button isIconOnly variant="ghost" size="sm" aria-label="编辑" onPress={() => openLabelEditor(item)}><Pencil size={14} /></Button><ConfirmPopover title={`删除标签「${item.name}」？`} onConfirm={() => deleteLabelMutation.mutate(item.id)}><Button isIconOnly variant="ghost" size="sm" aria-label="删除"><Trash2 size={14} /></Button></ConfirmPopover></div></Tooltip.Trigger><Tooltip.Content>分组：{item.group_names.join('、') || '未分配'}{item.remark ? `；${item.remark}` : ''}</Tooltip.Content></Tooltip>)}<Button size="sm" variant="outline" onPress={() => openLabelEditor(null)}><Plus size={15} />新建标签</Button></Card.Content></Card>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4"><StatCard label="分组记录" value={summary.total} /><StatCard label="覆盖实例" value={summary.instanceCount} /><StatCard label="最低倍率" value={`${summary.min.toFixed(4)}x`} /><StatCard label="最高倍率" value={`${summary.max.toFixed(4)}x`} /></div>
      <Alert status="accent"><Alert.Indicator><Info size={16} /></Alert.Indicator><Alert.Content><Alert.Description>实际模型消耗通常为：模型基础价格 × 分组倍率（Sub2API 取个人倍率优先，高峰时段再乘高峰倍率）。不同上游计费规则可能存在固定价格或阶梯计费。</Alert.Description></Alert.Content></Alert>
      <div className="flex flex-wrap items-end justify-between gap-3"><div className="flex flex-wrap items-end gap-3"><SelectInput placeholder="按标签筛选" options={tagOptions} value={tag} onChange={(value) => { setTag(typeof value === 'string' ? value : undefined); setInstanceId(undefined); setPage(1); }} className="w-40" />{viewMode === 'detail' ? <><SelectInput placeholder="按实例筛选" options={instanceOptions} value={instanceId == null ? undefined : String(instanceId)} onChange={(value) => setInstanceId(typeof value === 'string' ? Number(value) : undefined)} className="w-44" /><SelectInput placeholder="按分组标签筛选" options={labelOptions} value={labelId == null ? undefined : String(labelId)} onChange={(value) => setLabelId(typeof value === 'string' ? Number(value) : undefined)} className="w-44" /><TextInput inputProps={{ placeholder: '搜索分组名', value: search, onChange: (event) => { setSearch(event.target.value); setPage(1); } }} className="w-52" /><SelectInput placeholder="平台" options={platformOptions} value={platform} onChange={(value) => setPlatform(typeof value === 'string' ? value : undefined)} className="w-36" /></> : <SelectInput placeholder="选择对比标签" options={labelOptions} value={compareLabelId == null ? undefined : String(compareLabelId)} onChange={(value) => setCompareLabelId(typeof value === 'string' ? Number(value) : undefined)} className="w-52" />}</div><SegmentedControl options={[{ label: '全部分组', value: 'detail' }, { label: <><Zap size={14} />标签对比</>, value: 'compare' }]} value={viewMode} onChange={(value) => { setViewMode(value as GroupsViewMode); setPage(1); }} /></div>
      {viewMode === 'detail' && selectedRows.length > 0 ? <Card><Card.Content className="flex flex-row flex-wrap items-center gap-3 p-3"><span className="font-medium">已选 {selectedRows.length} 行（{selectedGroupNames.length} 个分组）</span><LabelActionMenu labelItems={labelItems} assignedLabels={batchAssigned.map((item) => item.name)} onAssign={(id) => assign(id, selectedGroupNames)} onRemove={(id) => remove(id, selectedGroupNames)} onCreate={() => openLabelEditor(null)}><Button variant="primary"><Tags size={15} />批量打标签</Button></LabelActionMenu><Button size="sm" variant="ghost" onPress={() => setSelectedKeys(new Set())}>取消选择</Button></Card.Content></Card> : null}
      {viewMode === 'detail' ? <DataTable rows={pagedRows} columns={detailColumns} rowKey={(row) => row.id} loading={isLoading} emptyText="暂无分组倍率数据" minWidth={1400} selection={{ selectedKeys, onChange: setSelectedKeys }} pagination={{ persistenceKey: 'groups', page, pageSize, total: data?.total ?? rows.length, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); }, pageSizeOptions: [50, 100] }} ariaLabel="分组倍率" /> : compareLabelId === undefined ? <Card><Card.Content className="p-8"><EmptyState title="请先选择一个标签开始对比" /></Card.Content></Card> : <DataTable rows={pagedCompareRows} columns={compareColumns} rowKey={(row) => row.group_name} loading={compareLoading} emptyText="该标签下暂无可对比的分组数据" minWidth={200 + compareInstances.length * 230} pagination={{ persistenceKey: 'groups', page, pageSize, total: compareRows.length, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); }, pageSizeOptions: [50, 100] }} ariaLabel="分组倍率对比" />}
      <LabelEditModal open={labelModalOpen} label={editingLabel} groupOptions={groupNamesData?.items ?? []} onClose={() => { setLabelModalOpen(false); setEditingLabel(null); }} />
    </div>
  );
}

