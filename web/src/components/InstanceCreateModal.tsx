import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { getErrorMessage } from '../api/client';
import { testInstanceProxy } from '../api/instances';
import {
  AppModal,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DescriptionList,
  MultiSelect,
  NumberField,
  SegmentedControl,
  SelectField,
  StarRating,
  SwitchField,
  TextField,
} from './ui';
import { notify } from '../lib/toast';
import type { Instance, InstanceCreatePayload, InstanceUpdatePayload, ProxyConnectivityTestResponse } from '../types/api';
import { formatNumber, formatProgramType } from '../utils/format';
import { normalizeBaseUrl, normalizeInstancePayload } from '../utils/instance';

type AuthMode = 'password' | 'token';
type FormValues = InstanceCreatePayload & { auth_mode: AuthMode };

interface InstanceCreateModalProps {
  open: boolean;
  loading: boolean;
  mode: 'create' | 'edit';
  initialValues?: Instance | null;
  defaultSyncIntervalMinutes?: number;
  defaultProxyMode?: InstanceCreatePayload['proxy_mode'];
  tagOptions?: Array<{ label: string; value: string }>;
  notificationChannelOptions?: Array<{ label: string; value: string }>;
  notificationChannelGroupOptions?: Array<{ label: string; value: string }>;
  onCancel: () => void;
  onSubmit: (values: InstanceCreatePayload | InstanceUpdatePayload) => void;
}

const PROGRAM_OPTIONS = [
  { value: 'auto', label: '自动识别' },
  { value: 'newapi', label: 'NewAPI' },
  { value: 'rixapi', label: 'RixAPI' },
  { value: 'shellapi', label: 'ShellAPI' },
  { value: 'sub2api', label: 'Sub2API' },
];
const PROXY_OPTIONS = [
  { value: 'direct', label: '本地直连' },
  { value: 'global', label: '公用 SOCKS5' },
  { value: 'custom', label: '自定义 SOCKS5' },
];
const BILLING_OPTIONS = [
  { value: 'prepaid', label: '预付费' },
  { value: 'postpaid', label: '后付费' },
];

function inferAuthMode(instance?: Instance | null): AuthMode {
  return instance?.has_access_token && !instance.username ? 'token' : 'password';
}

export function InstanceCreateModal({
  open,
  loading,
  mode,
  initialValues,
  defaultSyncIntervalMinutes = 120,
  defaultProxyMode = 'direct',
  tagOptions = [],
  notificationChannelOptions = [],
  notificationChannelGroupOptions = [],
  onCancel,
  onSubmit,
}: InstanceCreateModalProps) {
  const { register, control, handleSubmit, reset, watch, trigger, getValues, formState: { errors } } = useForm<FormValues>();
  const [testingProxy, setTestingProxy] = useState(false);
  const [proxyResult, setProxyResult] = useState<ProxyConnectivityTestResponse | null>(null);
  const authMode = watch('auth_mode');
  const proxyMode = watch('proxy_mode');
  const balanceAlertEnabled = watch('balance_alert_enabled');

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    reset({
      name: initialValues?.name ?? '',
      remark: initialValues?.remark ?? '',
      base_url: initialValues?.base_url ?? 'https://',
      program_type: initialValues?.program_type ?? 'auto',
      auth_mode: inferAuthMode(initialValues),
      username: initialValues?.username ?? '',
      password: '',
      remote_user_id: initialValues?.remote_user_id ?? undefined,
      access_token: '',
      proxy_mode: initialValues?.proxy_mode ?? defaultProxyMode,
      socks5_proxy_url: initialValues?.socks5_proxy_url ?? '',
      enabled: initialValues?.enabled ?? true,
      balance_alert_enabled: initialValues?.balance_alert_enabled ?? false,
      balance_alert_threshold: initialValues?.balance_alert_threshold ?? undefined,
      notification_channel_ids: initialValues?.notification_channel_ids ?? [],
      notification_channel_group_ids: initialValues?.notification_channel_group_ids ?? [],
      notify_rate_changes: initialValues?.notify_rate_changes ?? true,
      notify_announcements: initialValues?.notify_announcements ?? true,
      health_alert_enabled: initialValues?.health_alert_enabled ?? false,
      billing_mode: initialValues?.billing_mode ?? 'prepaid',
      quota_per_unit: initialValues?.quota_per_unit ?? undefined,
      priority: initialValues?.priority ?? 3,
      sync_interval_minutes: initialValues?.sync_interval_minutes ?? defaultSyncIntervalMinutes,
      tags: initialValues?.tags ?? [],
    });
  }, [defaultProxyMode, defaultSyncIntervalMinutes, initialValues, open, reset]);

  const handleProxyTest = async () => {
    const valid = await trigger(proxyMode === 'custom' ? ['base_url', 'proxy_mode', 'socks5_proxy_url'] : ['base_url', 'proxy_mode']);
    if (!valid) return;
    try {
      setTestingProxy(true);
      const result = await testInstanceProxy({
        base_url: normalizeBaseUrl(getValues('base_url')),
        proxy_mode: getValues('proxy_mode'),
        socks5_proxy_url: getValues('socks5_proxy_url'),
      });
      setProxyResult(result);
    } catch (error) {
      notify.error(getErrorMessage(error));
    } finally {
      setTestingProxy(false);
    }
  };

  const submit = (values: FormValues) => {
    const normalized = normalizeInstancePayload(values);
    if (values.auth_mode === 'password') {
      normalized.remote_user_id = undefined;
      normalized.access_token = '';
    } else {
      normalized.username = '';
      normalized.password = '';
    }
    onSubmit(normalized);
  };

  return (
    <>
      <AppModal
        open={open}
        onOpenChange={(value) => { if (!value) onCancel(); }}
        title={mode === 'create' ? '新增实例' : '编辑实例'}
        description="实例是一个被监控的上游站点，保存后会自动做首次同步。"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={onCancel}>取消</Button>
            <Button isPending={loading} onClick={() => void handleSubmit(submit)()}>
              {mode === 'create' ? '保存' : '更新'}
            </Button>
          </>
        }
      >
        <form className="flex flex-col gap-5" onSubmit={handleSubmit(submit)}>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextField label="实例名称" required error={errors.name?.message} inputProps={{ placeholder: '例如：主站', ...register('name', { required: '请输入实例名称' }) }} />
            <TextField label="备注" inputProps={{ placeholder: '例如：主力 / 备用 / 仅 Claude Code', maxLength: 255, ...register('remark') }} />
            <TextField label="Base URL" required error={errors.base_url?.message} inputProps={{ placeholder: 'https://example.com', ...register('base_url', { required: '请输入 Base URL' }) }} />
            <Controller
              control={control}
              name="program_type"
              render={({ field }) => <SelectField label="程序类型" value={field.value} onValueChange={field.onChange} options={PROGRAM_OPTIONS} description="自动识别会按站点 /api/status 判断" />}
            />
          </section>

          <section className="flex flex-col gap-4">
            <Controller
              control={control}
              name="auth_mode"
              render={({ field }) => (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium leading-none">认证方式</span>
                  <SegmentedControl
                    options={[
                      { value: 'password', label: '账密登录' },
                      { value: 'token', label: '访问密钥' },
                    ]}
                    value={field.value}
                    onChange={(value) => field.onChange(value as AuthMode)}
                  />
                </div>
              )}
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {authMode === 'token' ? (
                <>
                  <TextField label="远端用户 ID" required error={errors.remote_user_id?.message} inputProps={{ placeholder: '上游站点用户 ID', ...register('remote_user_id', { setValueAs: (value) => (value === '' ? undefined : Number(value)) }) }} />
                  <TextField label="访问密钥（Token）" required={mode === 'edit' ? undefined : undefined} error={errors.access_token?.message} inputProps={{ type: 'password', placeholder: mode === 'edit' ? '留空则保持现有密钥' : '上游访问密钥', ...register('access_token') }} />
                </>
              ) : (
                <>
                  <TextField label="用户名 / 邮箱" required error={errors.username?.message} inputProps={{ placeholder: '远端站点用户名或邮箱', ...register('username', { required: authMode === 'password' ? '请输入用户名' : false }) }} />
                  <TextField label="密码" error={errors.password?.message} description={mode === 'edit' ? '留空表示不修改现有密码' : undefined} inputProps={{ type: 'password', placeholder: mode === 'edit' ? '留空则保持现有密码' : '远端站点密码', ...register('password', { required: mode === 'create' && authMode === 'password' ? '请输入密码' : false }) }} />
                </>
              )}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Controller
              control={control}
              name="priority"
              render={({ field }) => (
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium leading-none">优先级</span>
                  <StarRating value={field.value ?? 3} onChange={(value) => field.onChange(value || 3)} />
                </div>
              )}
            />
            <Controller
              control={control}
              name="sync_interval_minutes"
              rules={{ required: '请输入同步周期' }}
              render={({ field }) => <NumberField label="同步周期（分钟）" required error={errors.sync_interval_minutes?.message} value={field.value} onValueChange={field.onChange} min={5} max={10080} />}
            />
            <Controller
              control={control}
              name="proxy_mode"
              rules={{ required: '请选择代理方式' }}
              render={({ field }) => <SelectField label="代理方式" required error={errors.proxy_mode?.message} value={field.value} onValueChange={field.onChange} options={PROXY_OPTIONS} />}
            />
            {proxyMode === 'custom' ? (
              <TextField label="自定义 SOCKS5" required error={errors.socks5_proxy_url?.message} description="支持 用户名:密码@主机:端口" inputProps={{ placeholder: '用户名:密码@主机:端口', ...register('socks5_proxy_url', { required: proxyMode === 'custom' ? '请输入自定义代理' : false }) }} />
            ) : null}
            <div className="flex items-end gap-2">
              <Button type="button" variant="secondary" size="sm" isPending={testingProxy} onClick={() => void handleProxyTest()}>
                测试当前代理
              </Button>
              <span className="text-xs text-muted-foreground">请求远端 /api/status 校验连通性</span>
            </div>
            <Controller control={control} name="enabled" render={({ field }) => <SwitchField label="启用监控" description="关闭后暂停定时同步" checked={field.value} onCheckedChange={field.onChange} />} />
          </section>

          <section className="flex flex-col gap-4 rounded-lg border p-3">
            <Controller control={control} name="balance_alert_enabled" render={({ field }) => <SwitchField label="余额告警" description="开启后余额低于阈值会按下方渠道推送" checked={field.value} onCheckedChange={field.onChange} />} />
            <Controller control={control} name="health_alert_enabled" render={({ field }) => <SwitchField label="连接失败告警" description="默认关闭；开启后连续探测失败会通知（与告警规则里的连接失败规则共同生效）" checked={field.value} onCheckedChange={field.onChange} />} />
            {balanceAlertEnabled ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Controller
                  control={control}
                  name="balance_alert_threshold"
                  render={({ field }) => <NumberField label="告警阈值" description="留空使用全局默认值" value={field.value ?? undefined} onValueChange={field.onChange} min={0.01} />}
                />
                <Controller
                  control={control}
                  name="notification_channel_ids"
                  render={({ field }) => <MultiSelect label="发送渠道" description="留空走默认渠道" options={notificationChannelOptions} value={field.value ?? []} onChange={field.onChange} placeholder="默认通知渠道" />}
                />
                <Controller
                  control={control}
                  name="notification_channel_group_ids"
                  render={({ field }) => <MultiSelect label="渠道分组" description="按分组批量投递" options={notificationChannelGroupOptions} value={field.value ?? []} onChange={field.onChange} placeholder="不选分组" />}
                />
              </div>
            ) : null}
          </section>

          <Collapsible className="flex flex-col gap-2 rounded-lg border p-3">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="w-fit">
                高级设置
                <ChevronDown className="size-4" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="grid grid-cols-1 gap-4 pt-1 md:grid-cols-2">
              <Controller
                control={control}
                name="billing_mode"
                render={({ field }) => <SelectField label="计费方式" value={field.value} onValueChange={field.onChange} options={BILLING_OPTIONS} description="后付费站点只统计周期已用额度" />}
              />
              <Controller
                control={control}
                name="quota_per_unit"
                render={({ field }) => <NumberField label="余额倍率" description="留空使用远端识别值" value={field.value ?? undefined} onValueChange={field.onChange} min={0.000001} step={0.000001} />}
              />
              <Controller
                control={control}
                name="notify_rate_changes"
                render={({ field }) => <SwitchField label="倍率变更推送" description="关闭后只记录不推送" checked={field.value} onCheckedChange={field.onChange} />}
              />
              <Controller
                control={control}
                name="notify_announcements"
                render={({ field }) => <SwitchField label="上游公告推送" description="关闭后只入库不推送" checked={field.value} onCheckedChange={field.onChange} />}
              />
              <Controller
                control={control}
                name="tags"
                render={({ field }) => <MultiSelect label="标签" options={tagOptions} value={field.value ?? []} onChange={field.onChange} placeholder="选择已有标签" description="标签可用于筛选与批量操作" />}
              />
            </CollapsibleContent>
          </Collapsible>
        </form>
      </AppModal>

      <AppModal
        open={proxyResult !== null}
        onOpenChange={(value) => { if (!value) setProxyResult(null); }}
        title="代理测试成功"
        size="sm"
        footer={<Button onClick={() => setProxyResult(null)}>知道了</Button>}
      >
        {proxyResult ? (
          <DescriptionList
            columns={1}
            items={[
              { label: '目标地址', value: proxyResult.base_url },
              { label: '代理方式', value: proxyResult.proxy_mode === 'custom' ? '自定义 SOCKS5' : proxyResult.proxy_mode === 'global' ? '公用 SOCKS5' : '本地直连' },
              { label: '实际代理', value: proxyResult.resolved_proxy_url || '本地直连' },
              { label: '识别程序', value: formatProgramType(proxyResult.detected_program_type) },
              { label: '兑换比', value: formatNumber(proxyResult.quota_per_unit) },
            ]}
          />
        ) : null}
      </AppModal>
    </>
  );
}
