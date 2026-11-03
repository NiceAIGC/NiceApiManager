import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Check, Info, Pencil, Plus, Tags, Trash2, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

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
import {
  AppModal,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmPopover,
  DataTable,
  DescriptionList,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  EmptyState,
  MultiSelect,
  PageHeader,
  SegmentedControl,
  SelectField,
  StatCard,
  StatusBadge,
  TextField,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui';
import type { DataTableColumn } from '../components/ui';
import { notify } from '../lib/toast';
import type { GroupCompareRow, GroupLabelItem, GroupRatioItem } from '../types/api';
import { formatDateTime } from '../utils/format';
import { formatClock, formatRatio } from '../utils/pricing';

type ViewMode = 'detail' | 'compare';
type LabelTone = 'success' | 'warning' | 'secondary' | 'destructive';

interface LabelFormValues {
  name: string;
  remark: string;
  group_names: string[];
}

function labelTone(index: number): LabelTone {
  return (['secondary', 'warning', 'success', 'destructive'] as LabelTone[])[index % 4];
}

function ratioTone(ratio: number): 'warning' | 'success' | 'secondary' {
  return ratio > 1.05 ? 'warning' : ratio < 0.95 ? 'success' : 'secondary';
}

function PeakBadge({ start, end, ratio }: { start?: string | null; end?: string | null; ratio?: number | null }) {
  if (!start || !end) return null;
  const multiplier = Number.parseFloat((ratio ?? 1).toFixed(2));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <StatusBadge tone="warning">{formatClock(start)}–{formatClock(end)}×{multiplier}</StatusBadge>
        </span>
      </TooltipTrigger>
      <TooltipContent>高峰时段内整单消耗额外乘 {Number.parseFloat((ratio ?? 1).toFixed(4))} 倍</TooltipContent>
    </Tooltip>
  );
}

function LabelEditModal({
  open,
  label,
  groupOptions,
  onClose,
}: {
  open: boolean;
  label: GroupLabelItem | null;
  groupOptions: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<LabelFormValues>({
    defaultValues: { name: label?.name ?? '', remark: label?.remark ?? '', group_names: label?.group_names ?? [] },
  });
  const [values, setValues] = useState<LabelFormValues>({ name: label?.name ?? '', remark: label?.remark ?? '', group_names: label?.group_names ?? [] });

  const saveMutation = useMutation({
    mutationFn: async (payload: LabelFormValues) => {
      const body = { name: payload.name.trim(), remark: payload.remark.trim() || null, group_names: payload.group_names };
      if (label) return updateGroupLabel(label.id, body);
      return createGroupLabel(body);
    },
    onSuccess: async () => {
      notify.success(label ? '标签已更新' : '标签已创建');
      await Promise.all(['group-labels', 'groups', 'group-compare'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      reset();
      onClose();
    },
    onError: (error) => notify.error(error instanceof Error ? error.message : '保存失败'),
  });

  return (
    <AppModal
      open={open}
      onOpenChange={(value) => { if (!value) onClose(); }}
      title={label ? '编辑标签' : '新增标签'}
      description="标签用于把不同实例里的同名分组归为一类，便于跨实例对比。"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button isPending={saveMutation.isPending} onClick={() => void handleSubmit((form) => saveMutation.mutate(form))()}>
            保存
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit((form) => saveMutation.mutate(form))}>
        <TextField label="标签名称" required error={errors.name?.message} inputProps={{ placeholder: '例如：Claude 主力', ...register('name', { required: '请输入标签名称' }) }} />
        <TextField label="备注" inputProps={{ placeholder: '可选', ...register('remark') }} />
        <Controller
          control={control}
          name="group_names"
          render={({ field }) => (
            <MultiSelect
              label="包含的分组名"
              description="选择该标签覆盖的分组（同名分组会跨实例归类）"
              options={groupOptions.map((name) => ({ label: name, value: name }))}
              value={field.value ?? []}
              onChange={(next) => { field.onChange(next); setValues((current) => ({ ...current, group_names: next })); }}
              placeholder="选择分组"
              emptyText="先同步实例以获取分组"
            />
          )}
        />
        {values.group_names.length ? <p className="m-0 text-xs text-muted-foreground">已选 {values.group_names.length} 个分组</p> : null}
      </form>
    </AppModal>
  );
}

export function GroupsPage() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<ViewMode>('detail');
  const [tag, setTag] = useState('all');
  const [instanceId, setInstanceId] = useState('all');
  const [labelId, setLabelId] = useState('all');
  const [compareLabelId, setCompareLabelId] = useState('all');
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('all');
  const [labelModalOpen, setLabelModalOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<GroupLabelItem | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<number | string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const { data: instanceData } = useQuery({ queryKey: ['instances'], queryFn: () => fetchInstances() });
  const { data: labelData } = useQuery({ queryKey: ['group-labels'], queryFn: fetchGroupLabels });
  const { data: groupNamesData } = useQuery({ queryKey: ['group-names'], queryFn: fetchGroupNames });
  const { data, isLoading } = useQuery({
    queryKey: ['groups', tag, instanceId, labelId, search, platform],
    queryFn: () => fetchGroups({
      tag: tag === 'all' ? undefined : tag,
      instance_id: instanceId === 'all' ? undefined : Number(instanceId),
      label_id: labelId === 'all' ? undefined : Number(labelId),
      search: search.trim() || undefined,
      platform: platform === 'all' ? undefined : platform,
    }),
  });
  const { data: compareData, isLoading: compareLoading } = useQuery({
    queryKey: ['group-compare', compareLabelId],
    queryFn: () => fetchGroupComparison({ label_id: Number(compareLabelId) }),
    enabled: viewMode === 'compare' && compareLabelId !== 'all',
  });

  const invalidate = async () => {
    await Promise.all(['groups', 'group-labels', 'group-names', 'group-compare'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  };

  const assignMutation = useMutation({
    mutationFn: ({ labelId: id, groupNames }: { labelId: number; groupNames: string[] }) => assignGroupNamesToLabel(id, groupNames),
    onSuccess: async () => { notify.success('已打标签'); await invalidate(); },
    onError: (error) => notify.error(error instanceof Error ? error.message : '操作失败'),
  });
  const removeMutation = useMutation({
    mutationFn: ({ labelId: id, groupNames }: { labelId: number; groupNames: string[] }) => removeGroupNameFromLabel(id, groupNames),
    onSuccess: async () => { notify.success('已移除标签'); await invalidate(); },
    onError: (error) => notify.error(error instanceof Error ? error.message : '操作失败'),
  });
  const deleteLabelMutation = useMutation({
    mutationFn: (id: number) => deleteGroupLabel(id),
    onSuccess: async () => { notify.success('标签已删除'); await invalidate(); },
    onError: (error) => notify.error(error instanceof Error ? error.message : '删除失败'),
  });

  const labelItems = labelData?.items ?? [];
  const rows = data?.items ?? [];
  const instanceOptions = useMemo(() => (instanceData?.items ?? []).map((item) => ({ label: item.name, value: String(item.id) })), [instanceData]);
  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const item of instanceData?.items ?? []) for (const value of item.tags) tags.add(value);
    return Array.from(tags).sort().map((value) => ({ label: value, value }));
  }, [instanceData]);
  const labelOptions = useMemo(() => labelItems.map((item) => ({ label: `${item.name}（${item.group_names.length}）`, value: String(item.id) })), [labelItems]);
  const platformOptions = useMemo(() => {
    const platforms = new Set<string>();
    for (const item of rows) if (item.platform) platforms.add(item.platform);
    return Array.from(platforms).sort().map((value) => ({ label: value, value }));
  }, [rows]);

  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const selectedRows = useMemo(() => rows.filter((row) => selectedKeys.has(row.id)), [rows, selectedKeys]);
  const selectedGroupNames = useMemo(() => Array.from(new Set(selectedRows.map((row) => row.group_name))), [selectedRows]);
  const batchAssigned = useMemo(
    () => labelItems.filter((label) => selectedGroupNames.length > 0 && selectedGroupNames.every((name) => label.group_names.includes(name))),
    [labelItems, selectedGroupNames],
  );
  const summary = useMemo(() => ({
    total: rows.length,
    instanceCount: new Set(rows.map((item) => item.instance_id)).size,
    min: rows.length ? Math.min(...rows.map((item) => item.ratio)) : 0,
    max: rows.length ? Math.max(...rows.map((item) => item.ratio)) : 0,
  }), [rows]);

  const openLabelEditor = (label: GroupLabelItem | null) => {
    setEditingLabel(label);
    setLabelModalOpen(true);
  };

  const detailColumns: DataTableColumn<GroupRatioItem>[] = [
    {
      id: 'instance_name',
      header: '实例',
      width: 170,
      cell: (row) => (
        <div className="flex items-center gap-1">
          <span className="truncate">{row.instance_name}</span>
          <StatusBadge tone="secondary">{row.instance_program}</StatusBadge>
        </div>
      ),
    },
    {
      id: 'group_name',
      header: '分组名',
      width: 200,
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium">{row.group_name}</span>
          {row.labels.length ? (
            <span className="flex flex-wrap gap-1">
              {row.labels.map((name) => <StatusBadge key={name} tone="secondary">{name}</StatusBadge>)}
            </span>
          ) : null}
        </div>
      ),
    },
    { id: 'group_desc', header: '分组说明', cell: (row) => row.group_desc || <span className="text-muted-foreground">未提供说明</span> },
    { id: 'ratio', header: '消费倍率', width: 110, sortable: true, align: 'right', cell: (row) => <StatusBadge tone={ratioTone(row.ratio)}>{formatRatio(row.ratio)}</StatusBadge> },
    {
      id: 'platform_user',
      header: '平台/个人',
      width: 140,
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.platform ? <StatusBadge tone="muted">{row.platform}</StatusBadge> : null}
          {row.user_ratio != null ? <StatusBadge tone="warning">个人 ×{Number.parseFloat(row.user_ratio.toFixed(3))}</StatusBadge> : null}
        </div>
      ),
    },
    { id: 'peak', header: '高峰时段', width: 176, cell: (row) => (row.peak_start && row.peak_end ? <PeakBadge start={row.peak_start} end={row.peak_end} ratio={row.peak_ratio} /> : '-') },
    { id: 'snapshot_at', header: '快照时间', width: 150, cell: (row) => <span className="tabular text-muted-foreground">{formatDateTime(row.snapshot_at)}</span> },
    {
      id: 'action',
      header: '标签',
      width: 96,
      align: 'center',
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Tags className="size-4" />
              打标
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>加入标签</DropdownMenuLabel>
            {labelItems.length ? labelItems.map((label) => {
              const assigned = label.group_names.includes(row.group_name);
              return (
                <DropdownMenuItem
                  key={label.id}
                  onClick={() => (assigned ? removeMutation.mutate({ labelId: label.id, groupNames: [row.group_name] }) : assignMutation.mutate({ labelId: label.id, groupNames: [row.group_name] }))}
                >
                  {assigned ? <Check className="size-4 text-primary" /> : <span className="size-4" />}
                  <span className="min-w-0 flex-1 truncate">{label.name}</span>
                </DropdownMenuItem>
              );
            }) : <DropdownMenuItem disabled>暂无标签</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const compareInstances = compareData?.instances ?? [];
  const compareRows = compareData?.rows ?? [];
  const pagedCompareRows = compareRows.slice((page - 1) * pageSize, page * pageSize);
  const compareColumns: DataTableColumn<GroupCompareRow>[] = [
    { id: 'group_name', header: '分组', width: 200, cell: (row) => <span className="font-medium">{row.group_name}</span> },
    ...compareInstances.map((instance) => ({
      id: `instance-${instance.instance_id}`,
      header: instance.instance_name,
      width: 180,
      cell: (row: GroupCompareRow) => {
        const entry = row.entries.find((item) => item.instance_id === instance.instance_id);
        if (!entry) return <span className="text-muted-foreground">-</span>;
        return (
          <div className="flex flex-wrap items-center gap-1">
            <StatusBadge tone={ratioTone(entry.ratio)}>{formatRatio(entry.ratio)}</StatusBadge>
            {entry.peak_start && entry.peak_end ? <PeakBadge start={entry.peak_start} end={entry.peak_end} ratio={entry.peak_ratio} /> : null}
            {row.best_instance_id === instance.instance_id ? <StatusBadge tone="success"><Zap className="size-3" />最优</StatusBadge> : null}
          </div>
        );
      },
    })),
    { id: 'spread', header: '最低/最高', width: 140, align: 'right', cell: (row) => row.min_ratio == null || row.max_ratio == null ? '-' : <span className="tabular">{formatRatio(row.min_ratio)} / {formatRatio(row.max_ratio)}</span> },
    { id: 'spread_value', header: '差值', width: 96, sortable: true, align: 'right', cell: (row) => row.spread == null ? '-' : <StatusBadge tone={row.spread > 0.1 ? 'destructive' : 'success'}>{row.spread >= 0 ? '+' : ''}{Number.parseFloat(row.spread.toFixed(3))}</StatusBadge> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="分组倍率"
        subtitle="倍率越高，同一模型调用消耗额度越多。可给分组打标签，并在同标签下跨实例对比。"
        extra={
          <SegmentedControl
            options={[{ value: 'detail', label: '明细' }, { value: 'compare', label: '跨实例对比' }]}
            value={viewMode}
            onChange={(value) => { setViewMode(value as ViewMode); setPage(1); }}
          />
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 pt-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><Tags className="size-4" />标签管理</div>
          {labelItems.map((label) => (
            <span key={label.id} className="flex items-center gap-1 rounded-md border bg-muted/30 py-1 pl-2 pr-1">
              <StatusBadge tone={labelTone(label.id)}>{label.name}</StatusBadge>
              <span className="text-xs text-muted-foreground">{label.group_names.length}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`编辑 ${label.name}`} onClick={() => openLabelEditor(label)}>
                    <Pencil className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>编辑标签</TooltipContent>
              </Tooltip>
              <ConfirmPopover title={`删除标签「${label.name}」？`} confirmText="删除" onConfirm={() => deleteLabelMutation.mutateAsync(label.id)}>
                <Button variant="ghost" size="icon-sm" aria-label={`删除 ${label.name}`} className="text-destructive">
                  <Trash2 className="size-3.5" />
                </Button>
              </ConfirmPopover>
            </span>
          ))}
          <Button variant="outline" size="sm" onClick={() => openLabelEditor(null)}>
            <Plus className="size-4" />
            新增标签
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="分组记录" value={summary.total} />
        <StatCard label="覆盖实例" value={summary.instanceCount} />
        <StatCard label="最低倍率" value={`${summary.min.toFixed(4)}x`} />
        <StatCard label="最高倍率" value={`${summary.max.toFixed(4)}x`} />
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        实际模型消耗通常为：模型基础价格 × 分组倍率（Sub2API 取个人倍率，高峰时段再乘高峰系数）。
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <TextField className="w-56" inputProps={{ placeholder: '搜索分组名', value: search, onChange: (event) => { setSearch(event.target.value); setPage(1); } }} />
        <SelectField className="w-40" label="按标签筛选" value={tag} onValueChange={(value) => { setTag(value); setInstanceId('all'); setPage(1); }} options={[{ label: '全部标签', value: 'all' }, ...tagOptions]} />
        {viewMode === 'detail' ? (
          <>
            <SelectField className="w-44" label="按实例筛选" value={instanceId} onValueChange={(value) => { setInstanceId(value); setPage(1); }} options={[{ label: '全部实例', value: 'all' }, ...instanceOptions]} />
            <SelectField className="w-44" label="按分组标签筛选" value={labelId} onValueChange={(value) => { setLabelId(value); setPage(1); }} options={[{ label: '全部分组标签', value: 'all' }, ...labelOptions]} />
            <SelectField className="w-36" label="平台" value={platform} onValueChange={(value) => { setPlatform(value); setPage(1); }} options={[{ label: '全部平台', value: 'all' }, ...platformOptions]} />
          </>
        ) : (
          <SelectField className="w-56" label="对比标签" value={compareLabelId} onValueChange={(value) => { setCompareLabelId(value); setPage(1); }} options={[{ label: '选择标签开始对比', value: 'all' }, ...labelOptions]} />
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setSearch(''); setTag('all'); setInstanceId('all'); setLabelId('all'); setPlatform('all'); setPage(1); }}
        >
          清空筛选
        </Button>
      </div>

      {viewMode === 'detail' && selectedRows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
          <span className="text-sm font-medium">已选 {selectedRows.length} 行（{selectedGroupNames.length} 个分组）</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm"><Tags className="size-4" />批量打标签</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {labelItems.length ? labelItems.map((label) => {
                const assigned = batchAssigned.some((item) => item.id === label.id);
                return (
                  <DropdownMenuItem
                    key={label.id}
                    onClick={() => (assigned ? removeMutation.mutate({ labelId: label.id, groupNames: selectedGroupNames }) : assignMutation.mutate({ labelId: label.id, groupNames: selectedGroupNames }))}
                  >
                    {assigned ? <Check className="size-4 text-primary" /> : <span className="size-4" />}
                    <span className="min-w-0 flex-1 truncate">{label.name}</span>
                  </DropdownMenuItem>
                );
              }) : <DropdownMenuItem disabled>暂无标签</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="sm" onClick={() => setSelectedKeys(new Set())}>清空选择</Button>
        </div>
      ) : null}

      {viewMode === 'detail' ? (
        <DataTable
          rows={pagedRows}
          columns={detailColumns}
          rowKey={(row) => row.id}
          loading={isLoading}
          dense
          ariaLabel="分组倍率"
          emptyText="暂无分组倍率数据"
          minWidth={1240}
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          pagination={{ page, pageSize, total: rows.length, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); }, pageSizeOptions: [50, 100], persistenceKey: 'groups' }}
        />
      ) : compareLabelId === 'all' ? (
        <Card><CardContent className="pt-4"><EmptyState title="请先选择一个标签开始对比" description="标签把不同实例里的同名分组归为一类。" /></CardContent></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {compareData?.label ? (
            <DescriptionList
              columns={3}
              className="rounded-lg border bg-card p-3"
              items={[
                { label: '对比标签', value: compareData.label.name },
                { label: '分组数量', value: compareData.group_names.length },
                { label: '覆盖实例', value: compareInstances.length },
              ]}
            />
          ) : null}
          <DataTable
            rows={pagedCompareRows}
            columns={compareColumns}
            rowKey={(row) => row.group_name}
            loading={compareLoading}
            dense
            ariaLabel="分组倍率对比"
            emptyText="该标签下暂无可对比的分组"
            minWidth={720}
            pagination={{ page, pageSize, total: compareRows.length, onPageChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1); }, pageSizeOptions: [50, 100], persistenceKey: 'groups' }}
          />
        </div>
      )}

      <LabelEditModal
        key={`${editingLabel?.id ?? 'new'}-${labelModalOpen}`}
        open={labelModalOpen}
        label={editingLabel}
        groupOptions={groupNamesData?.items ?? []}
        onClose={() => { setLabelModalOpen(false); setEditingLabel(null); }}
      />
    </div>
  );
}
