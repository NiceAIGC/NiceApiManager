import { Button, Card } from '@heroui/react';
import { useFieldArray, useForm, Controller } from 'react-hook-form';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { getErrorMessage } from '../api/client';
import { testInstanceProxy } from '../api/instances';
import type { BatchInstanceUpdatePayload, Instance, InstanceCreatePayload, ProxyConnectivityTestResponse } from '../types/api';
import { AppModal, DescriptionList, NumberInput, SelectInput, StarRating, SwitchInput, TextInput } from './ui';
import { notify } from '../lib/toast';
import { formatNumber, formatProgramType } from '../utils/format';
import { normalizeBaseUrl, normalizeInstancePayload } from '../utils/instance';

type BatchItem = InstanceCreatePayload & { id?: number };
interface BatchFormValues { items: BatchItem[]; }
interface InstanceBatchModalProps {
  open: boolean; loading: boolean; mode: 'create' | 'edit'; initialItems?: Instance[]; defaultSyncIntervalMinutes?: number; defaultProxyMode?: InstanceCreatePayload['proxy_mode']; tagOptions?: Array<{ label: string; value: string }>; notificationChannelOptions?: Array<{ label: string; value: string }>; notificationChannelGroupOptions?: Array<{ label: string; value: string }>; onCancel: () => void; onSubmit: (items: Array<InstanceCreatePayload | BatchInstanceUpdatePayload>) => void;
}
function buildEmptyItem(defaultProxyMode: InstanceCreatePayload['proxy_mode'], syncInterval = 120): BatchItem {
  return { name: '', remark: '', base_url: 'https://', program_type: 'auto', username: '', password: '', remote_user_id: undefined, access_token: '', proxy_mode: defaultProxyMode, socks5_proxy_url: '', enabled: true, balance_alert_enabled: false, balance_alert_threshold: undefined, notification_channel_ids: [], notification_channel_group_ids: [], billing_mode: 'prepaid', quota_per_unit: undefined, priority: 3, sync_interval_minutes: syncInterval, tags: [] };
}
export function InstanceBatchModal({ open, loading, mode, initialItems, defaultSyncIntervalMinutes = 120, defaultProxyMode = 'direct', tagOptions, notificationChannelOptions = [], notificationChannelGroupOptions = [], onCancel, onSubmit }: InstanceBatchModalProps) {
  const { control, register, handleSubmit, reset, watch, setValue, trigger, getValues, formState: { errors } } = useForm<BatchFormValues>({ defaultValues: { items: [] } });
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'items' });
  const [testingField, setTestingField] = useState<string | null>(null);
  const [proxyResult, setProxyResult] = useState<ProxyConnectivityTestResponse | null>(null);
  const items = watch('items');
  useEffect(() => {
    if (!open) { reset({ items: [] }); return; }
    if (mode === 'edit') { replace((initialItems ?? []).map((item) => ({ id: item.id, name: item.name, remark: item.remark ?? '', base_url: item.base_url, program_type: item.program_type, username: item.username, password: '', remote_user_id: item.remote_user_id ?? undefined, access_token: '', proxy_mode: item.proxy_mode, socks5_proxy_url: item.socks5_proxy_url ?? '', enabled: item.enabled, balance_alert_enabled: item.balance_alert_enabled, balance_alert_threshold: item.balance_alert_threshold ?? undefined, notification_channel_ids: item.notification_channel_ids, notification_channel_group_ids: item.notification_channel_group_ids, billing_mode: item.billing_mode, quota_per_unit: item.quota_per_unit ?? undefined, priority: item.priority, sync_interval_minutes: item.sync_interval_minutes, tags: item.tags }))); return; }
    replace([buildEmptyItem(defaultProxyMode, defaultSyncIntervalMinutes)]);
  }, [defaultProxyMode, defaultSyncIntervalMinutes, initialItems, mode, open, replace, reset]);
  const testProxy = async (index: number, fieldId: string) => {
    const proxyMode = getValues(`items.${index}.proxy_mode`);
    const valid = await trigger(proxyMode === 'custom' ? [`items.${index}.base_url`, `items.${index}.proxy_mode`, `items.${index}.socks5_proxy_url`] : [`items.${index}.base_url`, `items.${index}.proxy_mode`]);
    if (!valid) return;
    try { setTestingField(fieldId); const item = getValues(`items.${index}`); const result = await testInstanceProxy({ base_url: normalizeBaseUrl(item.base_url), proxy_mode: item.proxy_mode, socks5_proxy_url: item.socks5_proxy_url }); setProxyResult(result); } catch (error) { notify.error(getErrorMessage(error)); } finally { setTestingField(null); }
  };
  const submit = ({ items: values }: BatchFormValues) => onSubmit(values.map((item) => normalizeInstancePayload(item)));
  const programOptions = [{ label: '自动识别', value: 'auto' }, { label: 'NewAPI', value: 'newapi' }, { label: 'RixAPI', value: 'rixapi' }, { label: 'ShellAPI', value: 'shellapi' }, { label: 'Sub2API', value: 'sub2api' }];
  const proxyOptions = [{ label: '本地直连', value: 'direct' }, { label: '公用 SOCKS5', value: 'global' }, { label: '自定义 SOCKS5', value: 'custom' }];
  return (<>
  <AppModal open={open} onOpenChange={(value) => { if (!value) onCancel(); }} title={mode === 'create' ? '批量新增实例' : '批量编辑实例'} size="full" footer={<div className="flex justify-end gap-2"><Button variant="secondary" onPress={onCancel}>取消</Button><Button variant="primary" isPending={loading} onPress={() => { void handleSubmit(submit)(); }} >{mode === 'create' ? '批量保存' : '批量更新'}</Button></div>}>
    <form className="flex max-h-[72vh] flex-col gap-4 overflow-y-auto pr-2" onSubmit={handleSubmit(submit)}>{fields.map((field, index) => { const item = items[index]; const itemErrors = errors.items?.[index]; const customProxy = item?.proxy_mode === 'custom'; const alertsEnabled = item?.balance_alert_enabled; return <Card key={field.id}><Card.Header><Card.Title>{mode === 'create' ? `实例 ${index + 1}` : `实例 ID ${item?.id ?? '-'}`}</Card.Title>{mode === 'create' ? <Button isIconOnly variant="ghost" aria-label="删除本行" isDisabled={fields.length === 1} onPress={() => remove(index)}><Trash2 size={16} /></Button> : null}</Card.Header><Card.Content className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
      <TextInput label="实例名称" required error={itemErrors?.name?.message} inputProps={{ placeholder: '例如：gac 主站', ...register(`items.${index}.name`, { required: '请输入实例名称' }) }} />
      <TextInput label="备注" inputProps={{ placeholder: '例如：主力 / 备用 / 仅 Claude Code', maxLength: 255, ...register(`items.${index}.remark`) }} />
      <TextInput label="Base URL" required error={itemErrors?.base_url?.message} inputProps={{ placeholder: 'https://example.com', ...register(`items.${index}.base_url`, { required: '请输入实例地址', pattern: { value: /^https?:\/\/.+/, message: '请输入合法的 URL' }, onBlur: (event) => setValue(`items.${index}.base_url`, normalizeBaseUrl(event.target.value)) }) }} />
      <Controller control={control} name={`items.${index}.program_type`} rules={{ required: '请选择程序类型' }} render={({ field: input }) => <SelectInput label="程序类型" required error={itemErrors?.program_type?.message} options={programOptions} value={input.value} onChange={input.onChange} />} />
      <Controller control={control} name={`items.${index}.billing_mode`} rules={{ required: '请选择计费方式' }} render={({ field: input }) => <SelectInput label="计费方式" required error={itemErrors?.billing_mode?.message} options={[{ label: '预付费', value: 'prepaid' }, { label: '后付费', value: 'postpaid' }]} value={input.value} onChange={input.onChange} />} />
      <TextInput label="用户名 / 邮箱" description="账密登录时填写。" inputProps={{ placeholder: '远端站点用户名或邮箱', ...register(`items.${index}.username`) }} />
      <TextInput label="密码" description={mode === 'create' ? '账密登录时填写。' : '留空则保持现有密码。'} inputProps={{ type: 'password', placeholder: mode === 'create' ? '远端站点密码' : '留空则保持现有密码', ...register(`items.${index}.password`) }} />
      <Controller control={control} name={`items.${index}.remote_user_id`} render={({ field: input }) => <NumberInput label="远端用户 ID" description="ID + 密钥模式时填写。" value={input.value} onChange={input.onChange} min={1} step={1} placeholder="例如：11766" />} />
      <TextInput label="访问密钥" description={mode === 'create' ? 'ID + 密钥模式时填写。' : '留空则保持现有访问密钥。'} inputProps={{ type: 'password', placeholder: mode === 'create' ? 'Access Token / 管理密钥' : '留空则保持现有访问密钥', ...register(`items.${index}.access_token`) }} />
      <Controller control={control} name={`items.${index}.quota_per_unit`} render={({ field: input }) => <NumberInput label="余额倍率" description="留空则使用远端识别值；Sub2API 未填写时默认 1.0。" value={input.value} onChange={input.onChange} min={0.000001} step={0.000001} placeholder="例如：1.0" />} />
      <Controller control={control} name={`items.${index}.priority`} rules={{ required: '请选择优先级' }} render={({ field: input }) => <div><label className="text-sm">常用优先级</label><StarRating value={input.value ?? 3} onChange={input.onChange} /></div>} />
      <Controller control={control} name={`items.${index}.proxy_mode`} rules={{ required: '请选择代理方式' }} render={({ field: input }) => <SelectInput label="代理方式" required error={itemErrors?.proxy_mode?.message} options={proxyOptions} value={input.value} onChange={input.onChange} />} />
      {customProxy ? <TextInput label="自定义 SOCKS5 代理" required description="支持 `用户名:密码@主机:端口`，会自动补 `socks5://`。" error={itemErrors?.socks5_proxy_url?.message} inputProps={{ placeholder: '例如：xxxmit3t:Sxxxxx@6xxx37.233:2xxx', ...register(`items.${index}.socks5_proxy_url`, { required: '请输入自定义 SOCKS5 代理' }) }} /> : null}
      {item?.proxy_mode !== 'direct' ? <div className="flex items-end gap-3"><Button variant="secondary" isPending={testingField === field.id} onPress={() => testProxy(index, field.id)}>测试当前代理</Button><span className="text-sm text-muted">会使用当前 Base URL 请求远端 `/api/status`。</span></div> : null}
      <Controller control={control} name={`items.${index}.sync_interval_minutes`} rules={{ required: '请输入同步周期' }} render={({ field: input }) => <NumberInput label="同步周期（分钟）" required error={itemErrors?.sync_interval_minutes?.message} value={input.value} onChange={input.onChange} min={5} max={10080} step={1} />} />
      <Controller control={control} name={`items.${index}.tags`} render={({ field: input }) => <SelectInput label="标签" options={tagOptions ?? []} value={input.value ?? []} onChange={input.onChange} multiple placeholder="可直接选择已有标签，也可输入新标签" />} />
      <Controller control={control} name={`items.${index}.enabled`} render={({ field: input }) => <SwitchInput label="启用状态" checked={input.value} onChange={input.onChange} />} />
      <Controller control={control} name={`items.${index}.balance_alert_enabled`} render={({ field: input }) => <SwitchInput label="余额告警" checked={input.value} onChange={input.onChange} />} />
      {alertsEnabled ? <><Controller control={control} name={`items.${index}.balance_alert_threshold`} render={({ field: input }) => <NumberInput label="余额告警阈值" description="留空使用全局默认值。" value={input.value} onChange={input.onChange} min={0.01} placeholder="全局默认" />} /><Controller control={control} name={`items.${index}.notification_channel_ids`} render={({ field: input }) => <SelectInput label="告警渠道" description="留空走默认渠道。" options={notificationChannelOptions} value={input.value ?? []} onChange={input.onChange} multiple placeholder="默认通知渠道" />} /><Controller control={control} name={`items.${index}.notification_channel_group_ids`} render={({ field: input }) => <SelectInput label="渠道分组" description="按分组批量投递；可与单独渠道叠加。" options={notificationChannelGroupOptions} value={input.value ?? []} onChange={input.onChange} multiple placeholder="不选分组" />} /></> : null}
    </Card.Content></Card>; })}{mode === 'create' ? <Button className="self-start" variant="secondary" onPress={() => append(buildEmptyItem(defaultProxyMode, defaultSyncIntervalMinutes))}><Plus size={16} />再添加一行</Button> : null}</form>
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
