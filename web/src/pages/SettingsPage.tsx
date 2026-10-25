import { Button, Card } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { changePassword } from '../api/auth';
import { getErrorMessage } from '../api/client';
import { fetchAppSettings, updateAppSettings } from '../api/settings';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { NumberInput, PageHeader, SelectInput, SwitchInput, TextInput } from '../components/ui';
import type { AppSettings } from '../types/api';
import { formatDateTime, setDisplayTimezone } from '../utils/format';
import { notify } from '../lib/toast';

type RuntimeSettingsFormValues = Pick<AppSettings,
  | 'sync_max_workers'
  | 'request_timeout'
  | 'sync_verify_ssl'
  | 'scheduler_timezone'
  | 'sync_history_lookback_days'
  | 'default_sync_interval_minutes'
  | 'shared_socks5_proxy_url'
  | 'default_instance_proxy_mode'
>;

const defaultRuntimeSettings: RuntimeSettingsFormValues = {
  sync_max_workers: 5,
  request_timeout: 20,
  sync_verify_ssl: true,
  scheduler_timezone: 'Asia/Shanghai',
  sync_history_lookback_days: 30,
  default_sync_interval_minutes: 120,
  shared_socks5_proxy_url: '',
  default_instance_proxy_mode: 'direct',
};

function normalizeRuntimeSettings(settings?: AppSettings): RuntimeSettingsFormValues {
  if (!settings) return defaultRuntimeSettings;
  return {
    sync_max_workers: settings.sync_max_workers,
    request_timeout: settings.request_timeout,
    sync_verify_ssl: settings.sync_verify_ssl,
    scheduler_timezone: settings.scheduler_timezone,
    sync_history_lookback_days: settings.sync_history_lookback_days,
    default_sync_interval_minutes: settings.default_sync_interval_minutes,
    shared_socks5_proxy_url: settings.shared_socks5_proxy_url ?? '',
    default_instance_proxy_mode: settings.default_instance_proxy_mode,
  };
}

function buildSettingsPayload(values: RuntimeSettingsFormValues, current?: AppSettings): AppSettings {
  return {
    ...values,
    notification_enabled: current?.notification_enabled ?? false,
    notification_check_interval_minutes: current?.notification_check_interval_minutes ?? 5,
    default_balance_alert_threshold: current?.default_balance_alert_threshold ?? 50,
    default_notification_channel_id: current?.default_notification_channel_id,
    notification_channels: current?.notification_channels ?? [],
    notification_rules: current?.notification_rules ?? { low_balance_rules: [], aggregate_balance_rules: [], connectivity_failure_rules: [] },
  };
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<RuntimeSettingsFormValues>({ defaultValues: defaultRuntimeSettings });
  const { data, isLoading } = useQuery({ queryKey: ['app-settings'], queryFn: fetchAppSettings });

  useEffect(() => { reset(normalizeRuntimeSettings(data)); }, [data, reset]);

  const updateMutation = useMutation({
    mutationFn: (payload: AppSettings) => updateAppSettings(payload),
    onSuccess: async (result) => {
      reset(normalizeRuntimeSettings(result));
      setDisplayTimezone(result.scheduler_timezone);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['app-settings'] }),
        queryClient.invalidateQueries({ queryKey: ['instances'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-trends'] }),
        queryClient.invalidateQueries({ queryKey: ['sync-runs'] }),
      ]);
      notify.success('系统设置已保存');
    },
    onError: (error) => notify.error(getErrorMessage(error)),
  });

  const changePasswordMutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => { setPasswordModalOpen(false); notify.success('登录密码修改成功'); },
    onError: (error) => notify.error(getErrorMessage(error)),
  });

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit((values) => updateMutation.mutate(buildSettingsPayload(values, data)))}>
      <Card><Card.Content className="flex flex-col gap-3 p-4">
        <PageHeader title="系统设置" subtitle="这里统一管理运行时配置，保存后新发起的同步和统计都会按新配置生效。" extra={<Button variant="secondary" onPress={() => setPasswordModalOpen(true)}>修改登录密码</Button>} />
        {data?.updated_at ? <p className="m-0 text-sm text-muted">最近更新：{formatDateTime(data.updated_at)}</p> : null}
      </Card.Content></Card>

      <Card><Card.Content className="flex flex-col gap-4 p-4">
        <h2 className="m-0 text-base font-semibold">运行参数</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Controller control={control} name="sync_max_workers" rules={{ required: '请输入批量同步并发数' }} render={({ field }) => <NumberInput label="批量同步并发数" description="“同步全部”时后端同时跑多少个实例，默认建议 5。" required value={field.value} onChange={field.onChange} min={1} max={32} step={1} error={errors.sync_max_workers?.message} />} />
          <Controller control={control} name="sync_history_lookback_days" rules={{ required: '请输入历史同步天数' }} render={({ field }) => <NumberInput label="历史同步天数" description="每次同步会回刷最近多少天的按日用量统计。" required value={field.value} onChange={field.onChange} min={1} max={365} step={1} error={errors.sync_history_lookback_days?.message} />} />
          <Controller control={control} name="request_timeout" rules={{ required: '请输入请求超时' }} render={({ field }) => <NumberInput label="上游请求超时（秒）" description="用于访问各个站点的接口请求。" required value={field.value} onChange={field.onChange} min={0.1} max={300} step={1} error={errors.request_timeout?.message} />} />
          <Controller control={control} name="default_sync_interval_minutes" rules={{ required: '请输入默认同步周期' }} render={({ field }) => <NumberInput label="默认实例同步周期（分钟）" description="新增实例时默认带上的自动同步周期。" required value={field.value} onChange={field.onChange} min={5} max={10080} step={1} error={errors.default_sync_interval_minutes?.message} />} />
          <TextInput label="公用 SOCKS5 代理" description="实例选择“公用 SOCKS5”时统一走这里；留空则仍按直连处理。支持 `用户名:密码@主机:端口`，会自动补 `socks5://`。" inputProps={{ placeholder: '例如：user:password@127.0.0.1:1080', ...register('shared_socks5_proxy_url') }} />
          <Controller control={control} name="default_instance_proxy_mode" rules={{ required: '请选择新增实例默认代理' }} render={({ field }) => <SelectInput label="新增实例默认代理" required value={field.value} onChange={(value) => field.onChange(value ?? 'direct')} options={[{ label: '本地直连', value: 'direct' }, { label: '公用 SOCKS5', value: 'global' }]} error={errors.default_instance_proxy_mode?.message} description="选择公用 SOCKS5 后，新建实例默认走上面的公用代理；仍可在实例表单里改回直连或自定义。" />} />
          <TextInput label="统计时区" required description="影响今日请求数和按日统计边界，请填写标准 IANA 时区名。" inputProps={{ placeholder: '例如 Asia/Shanghai', ...register('scheduler_timezone', { required: '请输入统计时区' }) }} error={errors.scheduler_timezone?.message} />
          <Controller control={control} name="sync_verify_ssl" render={({ field }) => <SwitchInput label="校验上游 SSL 证书" description="关闭后可连接自签名证书站点，但安全性会下降。" checked={field.value} onChange={field.onChange} />} />
        </div>
        <p className="m-0 text-sm text-muted">告警通知已移动到左侧单独页面，运行参数保存不会改动已配置的通知渠道和规则。</p>
      </Card.Content></Card>

      <div><Button type="submit" variant="primary" isPending={updateMutation.isPending} isDisabled={isLoading}>保存设置</Button></div>
      <ChangePasswordModal open={passwordModalOpen} loading={changePasswordMutation.isPending} onCancel={() => setPasswordModalOpen(false)} onSubmit={(values) => changePasswordMutation.mutate(values)} />
    </form>
  );
}
