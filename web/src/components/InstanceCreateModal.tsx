import { Accordion, Button } from '@heroui/react';
import { Controller, useForm } from 'react-hook-form';
import { useEffect, useState } from 'react';

import { getErrorMessage } from '../api/client';
import { testInstanceProxy } from '../api/instances';
import { AppModal, DescriptionList, NumberInput, SelectInput, SegmentedControl, StarRating, SwitchInput, TextInput } from './ui';
import type { Instance, InstanceCreatePayload, InstanceUpdatePayload, ProxyConnectivityTestResponse } from '../types/api';
import { notify } from '../lib/toast';
import { formatNumber, formatProgramType } from '../utils/format';
import { normalizeBaseUrl, normalizeInstancePayload } from '../utils/instance';

interface InstanceCreateModalProps {
  open: boolean; loading: boolean; mode: 'create' | 'edit'; initialValues?: Instance | null;
  defaultSyncIntervalMinutes?: number; defaultProxyMode?: InstanceCreatePayload['proxy_mode'];
  tagOptions?: Array<{ label: string; value: string }>; notificationChannelOptions?: Array<{ label: string; value: string }>; notificationChannelGroupOptions?: Array<{ label: string; value: string }>;
  onCancel: () => void; onSubmit: (values: InstanceCreatePayload | InstanceUpdatePayload) => void;
}
type AuthMode = 'password' | 'token';
type FormValues = InstanceCreatePayload & { auth_mode: AuthMode };

export function InstanceCreateModal({ open, loading, mode, initialValues, defaultSyncIntervalMinutes = 120, defaultProxyMode = 'direct', tagOptions, notificationChannelOptions = [], notificationChannelGroupOptions = [], onCancel, onSubmit }: InstanceCreateModalProps) {
  const { register, control, handleSubmit, reset, watch, setValue, trigger, getValues, formState: { errors } } = useForm<FormValues>();
  const [testingProxy, setTestingProxy] = useState(false);
  const [proxyResult, setProxyResult] = useState<ProxyConnectivityTestResponse | null>(null);
  const proxyMode = watch('proxy_mode'); const authMode = watch('auth_mode'); const balanceAlertEnabled = watch('balance_alert_enabled');
  useEffect(() => {
    if (!open) { reset(); return; }
    reset({ enabled: initialValues?.enabled ?? true, base_url: initialValues?.base_url ?? 'https://', name: initialValues?.name ?? '', remark: initialValues?.remark ?? '', program_type: initialValues?.program_type ?? 'auto', auth_mode: inferAuthMode(initialValues), username: initialValues?.username ?? '', password: '', remote_user_id: initialValues?.remote_user_id ?? undefined, access_token: '', proxy_mode: initialValues?.proxy_mode ?? defaultProxyMode, socks5_proxy_url: initialValues?.socks5_proxy_url ?? '', billing_mode: initialValues?.billing_mode ?? 'prepaid', quota_per_unit: initialValues?.quota_per_unit ?? undefined, priority: initialValues?.priority ?? 3, sync_interval_minutes: initialValues?.sync_interval_minutes ?? defaultSyncIntervalMinutes, tags: initialValues?.tags ?? [], balance_alert_enabled: initialValues?.balance_alert_enabled ?? false, balance_alert_threshold: initialValues?.balance_alert_threshold ?? undefined, notification_channel_ids: initialValues?.notification_channel_ids ?? [], notification_channel_group_ids: initialValues?.notification_channel_group_ids ?? [] });
  }, [defaultProxyMode, defaultSyncIntervalMinutes, initialValues, open, reset]);
  const handleProxyTest = async () => {
    const valid = await trigger(proxyMode === 'custom' ? ['base_url', 'proxy_mode', 'socks5_proxy_url'] : ['base_url', 'proxy_mode']);
    if (!valid) return;
    try { setTestingProxy(true); const result = await testInstanceProxy({ base_url: normalizeBaseUrl(getValues('base_url')), proxy_mode: getValues('proxy_mode'), socks5_proxy_url: getValues('socks5_proxy_url') }); setProxyResult(result); } catch (error) { notify.error(getErrorMessage(error)); } finally { setTestingProxy(false); }
  };
  const submit = (values: FormValues) => { const normalized = normalizeInstancePayload(values); if (values.auth_mode === 'password') { normalized.remote_user_id = undefined; normalized.access_token = ''; } else { normalized.username = ''; normalized.password = ''; } onSubmit(normalized); };
  const selectOptions = { programs: [{ label: '自动识别', value: 'auto' }, { label: 'NewAPI', value: 'newapi' }, { label: 'RixAPI', value: 'rixapi' }, { label: 'ShellAPI', value: 'shellapi' }, { label: 'Sub2API', value: 'sub2api' }], proxy: [{ label: '本地直连', value: 'direct' }, { label: '公用 SOCKS5', value: 'global' }, { label: '自定义 SOCKS5', value: 'custom' }] };
  return (<>
  <AppModal open={open} onOpenChange={(value) => { if (!value) onCancel(); }} title={mode === 'create' ? '新增实例' : '编辑实例'} size="lg" footer={<div className="flex justify-end gap-2"><Button variant="secondary" onPress={onCancel}>取消</Button><Button variant="primary" isPending={loading} onPress={() => { void handleSubmit(submit)(); }} >{mode === 'create' ? '保存' : '更新'}</Button></div>}>
    <form className="flex max-h-[72vh] flex-col gap-4 overflow-y-auto pr-2" onSubmit={handleSubmit(submit)}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextInput label="实例名称" required error={errors.name?.message} inputProps={{ placeholder: '例如：gac 主站', ...register('name', { required: '请输入实例名称' }) }} />
        <TextInput label="备注" inputProps={{ placeholder: '例如：主力 / 备用 / 仅 Claude Code', maxLength: 255, ...register('remark') }} />
        <Controller control={control} name="program_type" rules={{ required: '请选择程序类型' }} render={({ field }) => <SelectInput label="程序类型" required description="默认自动识别；识别不到或新增前已知类型时可手动选择。" error={errors.program_type?.message} options={selectOptions.programs} value={field.value} onChange={field.onChange} />} />
        <TextInput label="Base URL" required error={errors.base_url?.message} inputProps={{ placeholder: 'https://example.com', ...register('base_url', { required: '请输入实例地址', pattern: { value: /^https?:\/\/.+/, message: '请输入合法的 URL' }, onBlur: (event) => setValue('base_url', normalizeBaseUrl(event.target.value)) }) }} />
      </div>
      <Controller control={control} name="auth_mode" rules={{ required: '请选择认证方式' }} render={({ field }) => <SegmentedControl options={[{ label: '账密登录', value: 'password' }, { label: '访问密钥', value: 'token' }]} value={field.value} onChange={field.onChange} />} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{authMode === 'password' ? <><TextInput label="用户名 / 邮箱" required error={errors.username?.message} inputProps={{ placeholder: '远端站点用户名或邮箱', ...register('username', { required: '请输入用户名或邮箱' }) }} /><TextInput label="密码" required={mode === 'create'} description={mode === 'edit' ? '留空则保持现有密码。' : undefined} error={errors.password?.message} inputProps={{ type: 'password', placeholder: mode === 'create' ? '远端站点密码' : '留空则保持现有密码', ...register('password', { required: mode === 'create' ? '请输入密码' : false }) }} /></> : <><Controller control={control} name="remote_user_id" render={({ field }) => <NumberInput label="远端用户 ID" description="NewAPI/RixAPI/ShellAPI 的 Access Token 模式通常需要填写。" value={field.value} onChange={field.onChange} min={1} step={1} placeholder="例如：11766" />} /><TextInput label="访问密钥" required={mode === 'create'} description={mode === 'edit' && initialValues?.has_access_token ? '留空则保持现有访问密钥。' : undefined} error={errors.access_token?.message} inputProps={{ type: 'password', placeholder: mode === 'create' ? 'Access Token / JWT' : '留空则保持现有访问密钥', ...register('access_token', { required: mode === 'create' ? '请输入访问密钥' : false }) }} /></>}</div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Controller control={control} name="priority" rules={{ required: '请选择优先级' }} render={({ field }) => <div><label className="text-sm">常用优先级</label><StarRating value={field.value ?? 3} onChange={field.onChange} /></div>} /><Controller control={control} name="sync_interval_minutes" rules={{ required: '请输入同步周期' }} render={({ field }) => <NumberInput label="同步周期（分钟）" required description="后台自动同步按这里的周期执行。" error={errors.sync_interval_minutes?.message} value={field.value} onChange={field.onChange} min={5} max={10080} step={1} />} /></div>
      <Controller control={control} name="balance_alert_enabled" render={({ field }) => <SwitchInput label="余额告警通知" description={mode === 'create' ? '新建默认关闭；开启后余额低于阈值时直接通知。' : '快捷规则；高级匹配请到“告警通知”统一管理。'} checked={field.value} onChange={field.onChange} />} />
      {balanceAlertEnabled ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Controller control={control} name="balance_alert_threshold" render={({ field }) => <NumberInput label="余额告警阈值" description="留空使用全局默认值。" value={field.value} onChange={field.onChange} min={0.01} placeholder="使用全局默认值" />} /><Controller control={control} name="notification_channel_ids" render={({ field }) => <SelectInput label="发送渠道" description="留空走默认通知渠道；可选择多个实例专属渠道。" options={notificationChannelOptions} value={field.value ?? []} onChange={field.onChange} multiple placeholder="默认通知渠道" />} /><Controller control={control} name="notification_channel_group_ids" render={({ field }) => <SelectInput label="渠道分组" description="按分组批量投递；可与单独渠道叠加。" options={notificationChannelGroupOptions} value={field.value ?? []} onChange={field.onChange} multiple placeholder="不选分组" />} /></div> : null}
      <Accordion><Accordion.Item id="advanced"><Accordion.Heading><Accordion.Trigger>高级设置<Accordion.Indicator /></Accordion.Trigger></Accordion.Heading><Accordion.Panel><Accordion.Body><div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Controller control={control} name="billing_mode" rules={{ required: '请选择计费方式' }} render={({ field }) => <SelectInput label="计费方式" required description="后付费站点只统计周期内已用额度，不展示余额。" error={errors.billing_mode?.message} options={[{ label: '预付费', value: 'prepaid' }, { label: '后付费', value: 'postpaid' }]} value={field.value} onChange={field.onChange} />} /><Controller control={control} name="quota_per_unit" render={({ field }) => <NumberInput label="余额倍率" description="留空则使用远端识别值；Sub2API 未填写时默认 1.0。" value={field.value} onChange={field.onChange} min={0.000001} step={0.000001} placeholder="例如：1.0" />} /></div></Accordion.Body></Accordion.Panel></Accordion.Item></Accordion>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Controller control={control} name="proxy_mode" rules={{ required: '请选择代理方式' }} render={({ field }) => <SelectInput label="代理方式" required description="默认直连；也可以走系统设置里的公用 SOCKS5，或为该实例单独指定自定义代理。" error={errors.proxy_mode?.message} options={selectOptions.proxy} value={field.value} onChange={field.onChange} />} />{proxyMode === 'custom' ? <TextInput label="自定义 SOCKS5 代理" required description="支持 `用户名:密码@主机:端口`，会自动补 `socks5://`。" error={errors.socks5_proxy_url?.message} inputProps={{ placeholder: '例如：xxxmit3t:Sxxxxx@6xxx37.233:2xxx', ...register('socks5_proxy_url', { required: '请输入自定义 SOCKS5 代理' }) }} /> : null}</div>
      {proxyMode !== 'direct' ? <div className="flex items-center gap-3"><Button variant="secondary" isPending={testingProxy} onPress={handleProxyTest}>测试当前代理</Button><span className="text-sm text-muted">会使用当前 Base URL 请求远端 `/api/status`。</span></div> : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Controller control={control} name="tags" render={({ field }) => <SelectInput label="标签" options={tagOptions ?? []} value={field.value ?? []} onChange={field.onChange} multiple placeholder="可直接选择已有标签，也可输入新标签" />} /><Controller control={control} name="enabled" render={({ field }) => <SwitchInput label="启用状态" checked={field.value} onChange={field.onChange} />} /></div>
    </form>
  </AppModal>
  <AppModal open={proxyResult !== null} onOpenChange={(value) => { if (!value) setProxyResult(null); }} title="代理测试成功" size="sm" footer={<Button variant="primary" onPress={() => setProxyResult(null)}>知道了</Button>}>
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
  </>);
}
function inferAuthMode(instance?: Instance | null): AuthMode { return instance?.has_access_token && !instance.username ? 'token' : 'password'; }
