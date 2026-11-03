import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { createApiKey, deleteApiKey, fetchApiKeys, toggleApiKey, type ApiKeyItem } from '../api/apiKeys';
import { changePassword } from '../api/auth';
import { getErrorMessage } from '../api/client';
import { fetchAppSettings, updateAppSettings } from '../api/settings';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import {
  AppModal,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmPopover,
  NumberField,
  PageHeader,
  SelectField,
  StatusBadge,
  SwitchField,
  TextField,
} from '../components/ui';
import { notify } from '../lib/toast';
import type { AppSettings } from '../types/api';
import { formatDateTime, setDisplayTimezone } from '../utils/format';

type SettingsFormValues = Pick<
  AppSettings,
  | 'sync_max_workers'
  | 'request_timeout'
  | 'sync_verify_ssl'
  | 'scheduler_timezone'
  | 'sync_history_lookback_days'
  | 'default_sync_interval_minutes'
  | 'shared_socks5_proxy_url'
  | 'default_instance_proxy_mode'
  | 'rate_change_notify_enabled'
  | 'rate_change_min_percent'
  | 'rate_change_cooldown_minutes'
  | 'announcement_sync_enabled'
  | 'announcement_notify_enabled'
  | 'retention_sync_runs_days'
  | 'retention_notification_logs_days'
  | 'retention_daily_usage_days'
  | 'retention_rate_changes_days'
  | 'retention_announcements_days'
>;

const DEFAULTS: SettingsFormValues = {
  sync_max_workers: 5,
  request_timeout: 20,
  sync_verify_ssl: true,
  scheduler_timezone: 'Asia/Shanghai',
  sync_history_lookback_days: 30,
  default_sync_interval_minutes: 120,
  shared_socks5_proxy_url: '',
  default_instance_proxy_mode: 'direct',
  rate_change_notify_enabled: true,
  rate_change_min_percent: 0,
  rate_change_cooldown_minutes: 60,
  announcement_sync_enabled: true,
  announcement_notify_enabled: true,
  retention_sync_runs_days: 30,
  retention_notification_logs_days: 90,
  retention_daily_usage_days: 180,
  retention_rate_changes_days: 180,
  retention_announcements_days: 90,
};

function toFormValues(settings?: AppSettings): SettingsFormValues {
  if (!settings) return DEFAULTS;
  return {
    sync_max_workers: settings.sync_max_workers,
    request_timeout: settings.request_timeout,
    sync_verify_ssl: settings.sync_verify_ssl,
    scheduler_timezone: settings.scheduler_timezone,
    sync_history_lookback_days: settings.sync_history_lookback_days,
    default_sync_interval_minutes: settings.default_sync_interval_minutes,
    shared_socks5_proxy_url: settings.shared_socks5_proxy_url ?? '',
    default_instance_proxy_mode: settings.default_instance_proxy_mode,
    rate_change_notify_enabled: settings.rate_change_notify_enabled,
    rate_change_min_percent: settings.rate_change_min_percent,
    rate_change_cooldown_minutes: settings.rate_change_cooldown_minutes,
    announcement_sync_enabled: settings.announcement_sync_enabled,
    announcement_notify_enabled: settings.announcement_notify_enabled,
    retention_sync_runs_days: settings.retention_sync_runs_days,
    retention_notification_logs_days: settings.retention_notification_logs_days,
    retention_daily_usage_days: settings.retention_daily_usage_days,
    retention_rate_changes_days: settings.retention_rate_changes_days,
    retention_announcements_days: settings.retention_announcements_days,
  };
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const { register, control, handleSubmit, reset, formState: { errors, isDirty } } = useForm<SettingsFormValues>({ defaultValues: DEFAULTS });
  const { data, isLoading } = useQuery({ queryKey: ['app-settings'], queryFn: fetchAppSettings });
  const { data: apiKeys } = useQuery({ queryKey: ['api-keys'], queryFn: fetchApiKeys });

  useEffect(() => {
    reset(toFormValues(data));
    setDisplayTimezone(data?.scheduler_timezone);
  }, [data, reset]);

  const saveMutation = useMutation({
    mutationFn: (values: SettingsFormValues) =>
      updateAppSettings({
        ...(data as AppSettings),
        ...values,
      }),
    onSuccess: async (result) => {
      reset(toFormValues(result));
      await queryClient.invalidateQueries({ queryKey: ['app-settings'] });
      notify.success('系统设置已保存');
    },
    onError: (error) => notify.error(getErrorMessage(error)),
  });

  const passwordMutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => { setPasswordOpen(false); notify.success('登录密码修改成功'); },
    onError: (error) => notify.error(getErrorMessage(error)),
  });

  const createKeyMutation = useMutation({
    mutationFn: createApiKey,
    onSuccess: (result) => {
      setCreatedKey(result.key);
      setNewKeyName('');
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      notify.success('API 密钥已生成');
    },
    onError: (error) => notify.error(getErrorMessage(error)),
  });

  const toggleKeyMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => toggleApiKey(id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
    onError: (error) => notify.error(getErrorMessage(error)),
  });

  const deleteKeyMutation = useMutation({
    mutationFn: deleteApiKey,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['api-keys'] }); notify.success('API 密钥已吊销'); },
    onError: (error) => notify.error(getErrorMessage(error)),
  });

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify.success('已复制到剪贴板');
    } catch {
      notify.error('复制失败，请手动选择复制');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="系统设置"
        subtitle={data?.updated_at ? `最近更新：${formatDateTime(data.updated_at)}` : '运行时配置，保存后新发起的同步与统计按新配置执行。'}
        extra={
          <>
            <Button variant="outline" onClick={() => setPasswordOpen(true)}>
              <KeyRound className="size-4" />
              修改登录密码
            </Button>
            <Button isPending={saveMutation.isPending} disabled={isLoading} onClick={() => void handleSubmit((values) => saveMutation.mutate(values))()}>
              保存设置
            </Button>
          </>
        }
      />

      <form className="flex flex-col gap-5" onSubmit={handleSubmit((values) => saveMutation.mutate(values))}>
        <Card>
          <CardHeader>
            <CardTitle>运行参数</CardTitle>
            <CardDescription>同步并发、超时、时区与代理等基础配置。</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Controller control={control} name="sync_max_workers" rules={{ required: '请输入并发数' }} render={({ field }) => (
              <NumberField label="批量同步并发数" description="同步全部时的并行请求数" error={errors.sync_max_workers?.message} value={field.value} onValueChange={field.onChange} min={1} max={32} />
            )} />
            <Controller control={control} name="sync_history_lookback_days" rules={{ required: '请输入历史天数' }} render={({ field }) => (
              <NumberField label="历史同步天数" description="每次同步回补的每日用量天数" error={errors.sync_history_lookback_days?.message} value={field.value} onValueChange={field.onChange} min={1} max={365} />
            )} />
            <Controller control={control} name="request_timeout" rules={{ required: '请输入超时' }} render={({ field }) => (
              <NumberField label="上游请求超时（秒）" error={errors.request_timeout?.message} value={field.value} onValueChange={field.onChange} min={1} max={300} />
            )} />
            <Controller control={control} name="default_sync_interval_minutes" rules={{ required: '请输入默认周期' }} render={({ field }) => (
              <NumberField label="默认实例同步周期（分钟）" error={errors.default_sync_interval_minutes?.message} value={field.value} onValueChange={field.onChange} min={5} max={10080} />
            )} />
            <TextField label="公用 SOCKS5 代理" description="实例选择「公用 SOCKS5」时走这里；留空表示直连" inputProps={{ placeholder: '用户名:密码@主机:端口', ...register('shared_socks5_proxy_url') }} />
            <Controller control={control} name="default_instance_proxy_mode" render={({ field }) => (
              <SelectField label="新增实例默认代理" value={field.value} onValueChange={field.onChange} options={[{ value: 'direct', label: '本地直连' }, { value: 'global', label: '公用 SOCKS5' }]} />
            )} />
            <TextField label="统计时区" required description="影响今日请求数与按日统计边界（IANA 时区）" error={errors.scheduler_timezone?.message} inputProps={{ placeholder: 'Asia/Shanghai', ...register('scheduler_timezone', { required: '请输入时区' }) }} />
            <Controller control={control} name="sync_verify_ssl" render={({ field }) => (
              <SwitchField label="校验上游 SSL 证书" description="关闭后可连自签名站点，但安全性下降" checked={field.value} onCheckedChange={field.onChange} />
            )} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>监控与通知</CardTitle>
            <CardDescription>倍率变更与上游公告的检测和推送策略。</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Controller control={control} name="rate_change_notify_enabled" render={({ field }) => (
              <SwitchField label="倍率变更通知" description="检测到分组倍率新增/删除/变动时合并推送" checked={field.value} onCheckedChange={field.onChange} />
            )} />
            <Controller control={control} name="announcement_sync_enabled" render={({ field }) => (
              <SwitchField label="上游公告同步" description="同步时顺带抓取上游公告；首次只建基线" checked={field.value} onCheckedChange={field.onChange} />
            )} />
            <Controller control={control} name="rate_change_min_percent" render={({ field }) => (
              <NumberField label="倍率变动最小通知百分比" description="低于该百分比不记录不通知；0 表示全部记录" value={field.value} onValueChange={field.onChange} min={0} max={1000} step={0.1} />
            )} />
            <Controller control={control} name="rate_change_cooldown_minutes" render={({ field }) => (
              <NumberField label="倍率变更冷却（分钟）" description="同分组同向变动冷却期内不重复通知" value={field.value} onValueChange={field.onChange} min={0} max={10080} />
            )} />
            <Controller control={control} name="announcement_notify_enabled" render={({ field }) => (
              <SwitchField label="新公告推送" description="发现新公告时推送到默认渠道" checked={field.value} onCheckedChange={field.onChange} />
            )} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>数据保留</CardTitle>
            <CardDescription>超过保留天数的历史数据每小时自动清理，不影响当前快照。</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Controller control={control} name="retention_sync_runs_days" render={({ field }) => <NumberField label="同步日志（天）" value={field.value} onValueChange={field.onChange} min={1} max={3650} />} />
            <Controller control={control} name="retention_notification_logs_days" render={({ field }) => <NumberField label="通知日志（天）" value={field.value} onValueChange={field.onChange} min={1} max={3650} />} />
            <Controller control={control} name="retention_daily_usage_days" render={({ field }) => <NumberField label="每日用量统计（天）" value={field.value} onValueChange={field.onChange} min={7} max={3650} />} />
            <Controller control={control} name="retention_rate_changes_days" render={({ field }) => <NumberField label="倍率变更记录（天）" value={field.value} onValueChange={field.onChange} min={1} max={3650} />} />
            <Controller control={control} name="retention_announcements_days" render={({ field }) => <NumberField label="上游公告（天）" value={field.value} onValueChange={field.onChange} min={1} max={3650} />} />
          </CardContent>
        </Card>

        <div className="flex items-center gap-2">
          <Button type="submit" isPending={saveMutation.isPending} disabled={isLoading || !isDirty}>保存设置</Button>
          {isDirty ? <span className="text-xs text-muted-foreground">有未保存的改动</span> : null}
        </div>
      </form>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle>API 访问密钥</CardTitle>
              <CardDescription>
                外部程序用这些 key 调用全部 API：请求头 <code className="rounded bg-muted px-1">X-API-Key: nam-…</code> 或{' '}
                <code className="rounded bg-muted px-1">Authorization: Bearer nam-…</code>
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => window.open('/api/docs.md', '_blank', 'noopener,noreferrer')}>
                <BookOpen className="size-4" />
                API 文档
              </Button>
              <Button size="sm" onClick={() => { setCreatedKey(null); setNewKeyName(''); setKeyModalOpen(true); }}>
                <Plus className="size-4" />
                生成新密钥
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {apiKeys?.length ? (
            <div className="flex flex-col divide-y rounded-lg border">
              {apiKeys.map((row: ApiKeyItem) => (
                <div key={row.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <strong className="truncate text-sm">{row.name}</strong>
                      <StatusBadge tone={row.enabled ? 'success' : 'muted'}>{row.enabled ? '启用' : '停用'}</StatusBadge>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="font-mono">{row.key_prefix}…</span>
                      <span>创建 {formatDateTime(row.created_at)}</span>
                      <span>最近使用 {row.last_used_at ? formatDateTime(row.last_used_at) : '从未使用'}</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label="复制前缀" onClick={() => void copyText(row.key_prefix)}>
                    <Copy className="size-4" />
                  </Button>
                  <SwitchField checked={row.enabled} onCheckedChange={(value) => toggleKeyMutation.mutate({ id: row.id, enabled: value })} />
                  <ConfirmPopover title={`吊销「${row.name}」？`} description="使用该 key 的外部程序会立即失效。" confirmText="吊销" onConfirm={() => deleteKeyMutation.mutateAsync(row.id)}>
                    <Button variant="outline" size="sm" className="text-destructive">
                      <Trash2 className="size-4" />
                      吊销
                    </Button>
                  </ConfirmPopover>
                </div>
              ))}
            </div>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">还没有 API 密钥。生成后即可让脚本或 AI 调用全部接口。</p>
          )}
        </CardContent>
      </Card>

      <AppModal
        open={keyModalOpen}
        onOpenChange={(open) => { setKeyModalOpen(open); if (!open) { setCreatedKey(null); setNewKeyName(''); } }}
        title={createdKey ? '密钥已生成' : '生成 API 密钥'}
        description={createdKey ? '完整密钥只显示这一次，请立即复制保存。' : '用于区分调用方，例如：监控脚本、AI 助手。'}
        size="sm"
        footer={
          createdKey ? (
            <Button onClick={() => { setKeyModalOpen(false); setCreatedKey(null); }}>完成</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setKeyModalOpen(false)}>取消</Button>
              <Button isPending={createKeyMutation.isPending} disabled={!newKeyName.trim()} onClick={() => createKeyMutation.mutate(newKeyName.trim())}>
                生成
              </Button>
            </>
          )
        }
      >
        {createdKey ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <input readOnly value={createdKey} className="w-full rounded-md border bg-muted px-2 py-1.5 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
              <Button variant="outline" size="sm" onClick={() => void copyText(createdKey)}>
                <Copy className="size-4" />
                复制
              </Button>
            </div>
            <p className="m-0 text-xs text-muted-foreground">
              用法：<code>curl -H "X-API-Key: {createdKey.slice(0, 10)}…" /api/instances</code>
            </p>
          </div>
        ) : (
          <TextField label="密钥名称" required inputProps={{ placeholder: '例如：监控脚本', value: newKeyName, onChange: (event) => setNewKeyName(event.target.value) }} />
        )}
      </AppModal>

      <ChangePasswordModal
        open={passwordOpen}
        loading={passwordMutation.isPending}
        onCancel={() => setPasswordOpen(false)}
        onSubmit={(values) => passwordMutation.mutate(values)}
      />
      {saveMutation.isPending ? <Loader2 className="hidden" /> : null}
    </div>
  );
}
