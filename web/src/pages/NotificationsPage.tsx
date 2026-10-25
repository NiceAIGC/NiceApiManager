import { Accordion, Alert, Button, Card } from '@heroui/react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import type { Control, UseFormRegister } from 'react-hook-form';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleHelp, Plus, Trash2 } from 'lucide-react';

import { getErrorMessage } from '../api/client';
import { fetchInstances } from '../api/instances';
import { fetchAppSettings, sendTestNotification, updateAppSettings } from '../api/settings';
import { AppDrawer, NumberInput, PageHeader, SelectInput, SwitchInput, TextInput } from '../components/ui';
import type { AppSettings, AggregateBalanceNotificationRule, BalanceNotificationRule, ConnectivityFailureNotificationRule, NotificationChannelConfig } from '../types/api';
import { formatDateTime } from '../utils/format';
import { notify } from '../lib/toast';

type ChannelType = 'wecombot' | 'bark' | 'telegram' | 'dingtalk' | 'custom';
interface ChannelValue extends NotificationChannelConfig {
  channel_type: ChannelType;
  wecombot_key?: string;
  bark_host?: string;
  bark_targets?: string;
  bark_group?: string;
  bark_sound?: string;
  bark_use_https?: boolean;
  telegram_bot_token?: string;
  telegram_targets?: string;
  dingtalk_token?: string;
  dingtalk_secret?: string;
  dingtalk_targets?: string;
}
type NotificationValues = Pick<AppSettings, 'notification_enabled' | 'notification_check_interval_minutes' | 'default_balance_alert_threshold' | 'default_notification_channel_id' | 'notification_rules'> & { notification_channels: ChannelValue[] };

const channelTypes = [
  { label: '企业微信机器人', value: 'wecombot' }, { label: 'Bark', value: 'bark' },
  { label: 'Telegram Bot', value: 'telegram' }, { label: '钉钉机器人', value: 'dingtalk' }, { label: '自定义 Apprise URL', value: 'custom' },
];
const defaultBarkHost = 'api.day.app';
const newId = (prefix: string) => `${prefix}_${globalThis.crypto?.randomUUID?.().slice(0, 8) ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`}`;
const newChannel = (): ChannelValue => ({ id: newId('channel'), name: '', enabled: true, apprise_url: '', channel_type: 'wecombot', bark_host: defaultBarkHost, bark_use_https: true });
const newBalanceRule = (severity: 'warning' | 'critical'): BalanceNotificationRule => ({ id: newId('rule'), name: severity === 'critical' ? '实例余额严重不足' : '实例余额预警', enabled: true, severity, threshold: severity === 'critical' ? 10 : 50, resolve_threshold: severity === 'critical' ? 20 : 80, min_consecutive_checks: 1, instance_ids: [], tags: [], include_disabled: false, notify_on_recovery: true, channel_ids: [] });
const newAggregateRule = (): AggregateBalanceNotificationRule => ({ id: newId('rule'), name: '核心实例总余额', enabled: false, severity: 'warning', threshold: 100, resolve_threshold: 160, min_consecutive_checks: 1, instance_ids: [], tags: [], include_disabled: false, notify_on_recovery: true, channel_ids: [] });
const newConnectivityRule = (): ConnectivityFailureNotificationRule => ({ id: newId('rule'), name: '实例连续连接失败', enabled: true, consecutive_failures: 3, instance_ids: [], tags: [], include_disabled: false, repeat_interval_minutes: 180, notify_on_recovery: true, channel_ids: [] });
const defaultValues: NotificationValues = {
  notification_enabled: false,
  notification_check_interval_minutes: 5,
  default_balance_alert_threshold: 50,
  default_notification_channel_id: undefined,
  notification_channels: [],
  notification_rules: {
    low_balance_rules: [newBalanceRule('warning'), newBalanceRule('critical')],
    aggregate_balance_rules: [newAggregateRule()],
    connectivity_failure_rules: [newConnectivityRule()],
  },
};
const split = (value?: string) => (value ?? '').split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
const encode = (value: string) => encodeURIComponent(value);
function channelUrl(channel: ChannelValue): string {
  if (channel.channel_type === 'wecombot') return channel.wecombot_key?.trim() ? `wecombot://${encode(channel.wecombot_key.trim())}` : '';
  if (channel.channel_type === 'bark') {
    const targets = split(channel.bark_targets); const host = channel.bark_host?.trim();
    if (!host || !targets.length) return '';
    const params = new URLSearchParams(); if (channel.bark_group?.trim()) params.set('group', channel.bark_group.trim()); if (channel.bark_sound?.trim()) params.set('sound', channel.bark_sound.trim());
    const query = params.toString(); return `${channel.bark_use_https === false ? 'bark' : 'barks'}://${host}/${targets.map(encode).join('/')}${query ? `?${query}` : ''}`;
  }
  if (channel.channel_type === 'telegram') {
    const token = channel.telegram_bot_token?.trim(); const targets = split(channel.telegram_targets);
    return token && targets.length ? `tgram://${encode(token)}/${targets.map(encode).join('/')}` : '';
  }
  if (channel.channel_type === 'dingtalk') {
    const token = channel.dingtalk_token?.trim(); if (!token) return '';
    const secret = channel.dingtalk_secret?.trim(); const targets = split(channel.dingtalk_targets);
    return `dingtalk://${secret ? `${encode(secret)}@` : ''}${encode(token)}${targets.length ? `/${targets.map(encode).join('/')}` : ''}/`;
  }
  return channel.apprise_url.trim();
}
function decode(value: string) { try { return decodeURIComponent(value); } catch { return value; } }
function fromChannel(channel: NotificationChannelConfig): ChannelValue {
  const fallback: ChannelValue = { ...channel, channel_type: 'custom', bark_host: defaultBarkHost, bark_use_https: true };
  const url = channel.apprise_url.trim();
  if (/^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send/i.test(url)) {
    try { const key = new URL(url).searchParams.get('key')?.trim(); if (key) return { ...fallback, channel_type: 'wecombot', wecombot_key: key }; } catch { return fallback; }
  }
  if (/^wecombot:\/\//i.test(url)) { try { const parsed = new URL(url); const key = decode(parsed.hostname || parsed.pathname.replace(/^\/+/, '')); return key ? { ...fallback, channel_type: 'wecombot', wecombot_key: key } : fallback; } catch { return fallback; } }
  if (/^barks?:\/\//i.test(url)) {
    try { const parsed = new URL(url); const extra = [...parsed.searchParams.keys()].some((key) => !['group', 'sound'].includes(key)); if (parsed.username || parsed.password || extra) return fallback;
      const targets = parsed.pathname.split('/').filter(Boolean).map(decode); if (!parsed.host || !targets.length) return fallback;
      return { ...fallback, channel_type: 'bark', bark_host: parsed.host, bark_targets: targets.join(', '), bark_group: parsed.searchParams.get('group') ?? '', bark_sound: parsed.searchParams.get('sound') ?? '', bark_use_https: parsed.protocol.toLowerCase() === 'barks:' };
    } catch { return fallback; }
  }
  if (/^tgram:\/\//i.test(url)) { const part = url.replace(/^tgram:\/\//i, '').split(/[?#]/, 1)[0]?.replace(/\/+$/, '') ?? ''; const parts = part.split('/').filter(Boolean).map(decode); return parts.length >= 2 && !url.includes('?') ? { ...fallback, channel_type: 'telegram', telegram_bot_token: parts[0], telegram_targets: parts.slice(1).join(', ') } : fallback; }
  if (/^dingtalk:\/\//i.test(url)) { try { const parsed = new URL(url); if (parsed.search) return fallback; return { ...fallback, channel_type: 'dingtalk', dingtalk_token: decode(parsed.hostname), dingtalk_secret: decode(parsed.username), dingtalk_targets: parsed.pathname.split('/').filter(Boolean).map(decode).join(', ') }; } catch { return fallback; } }
  return fallback;
}
function normalize(settings?: AppSettings): NotificationValues {
  if (!settings) return defaultValues;
  return { notification_enabled: settings.notification_enabled, notification_check_interval_minutes: settings.notification_check_interval_minutes, default_balance_alert_threshold: settings.default_balance_alert_threshold, default_notification_channel_id: settings.default_notification_channel_id ?? undefined, notification_rules: settings.notification_rules, notification_channels: settings.notification_channels.map(fromChannel) };
}
function payload(values: NotificationValues, current?: AppSettings): AppSettings {
  return { sync_max_workers: current?.sync_max_workers ?? 5, request_timeout: current?.request_timeout ?? 20, sync_verify_ssl: current?.sync_verify_ssl ?? true, scheduler_timezone: current?.scheduler_timezone ?? 'Asia/Shanghai', sync_history_lookback_days: current?.sync_history_lookback_days ?? 30, default_sync_interval_minutes: current?.default_sync_interval_minutes ?? 120, shared_socks5_proxy_url: current?.shared_socks5_proxy_url ?? '', default_instance_proxy_mode: current?.default_instance_proxy_mode ?? 'direct', notification_enabled: values.notification_enabled, default_balance_alert_threshold: values.default_balance_alert_threshold, default_notification_channel_id: values.default_notification_channel_id, notification_check_interval_minutes: values.notification_check_interval_minutes, notification_rules: values.notification_rules, notification_channels: values.notification_channels.map((channel) => ({ id: channel.id, name: channel.name.trim(), enabled: channel.enabled, apprise_url: channelUrl(channel) })) };
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const [guideOpen, setGuideOpen] = useState(false);
  const { register, control, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<NotificationValues>({ defaultValues });
  const saveSettings = (values: NotificationValues) => {
    const invalidAggregate = values.notification_rules.aggregate_balance_rules.some((rule) => rule.instance_ids.length === 0 && rule.tags.length === 0);
    if (invalidAggregate) { notify.error('至少选择一个实例或标签'); return; }
    updateMutation.mutate(payload(values, data));
  };
  const { fields: channels, append: addChannel, remove: removeChannel } = useFieldArray({ control, name: 'notification_channels' });
  const { fields: balanceRules, append: addBalance, remove: removeBalance } = useFieldArray({ control, name: 'notification_rules.low_balance_rules' });
  const { fields: aggregateRules, append: addAggregate, remove: removeAggregate } = useFieldArray({ control, name: 'notification_rules.aggregate_balance_rules' });
  const { fields: connectivityRules, append: addConnectivity, remove: removeConnectivity } = useFieldArray({ control, name: 'notification_rules.connectivity_failure_rules' });
  const { data, isLoading } = useQuery({ queryKey: ['app-settings'], queryFn: fetchAppSettings });
  const { data: instancesData } = useQuery({ queryKey: ['instances'], queryFn: () => fetchInstances() });
  const channelValues = watch('notification_channels') ?? [];
  const instanceOptions = useMemo(() => (instancesData?.items ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)).map((item) => ({ label: item.name, value: String(item.id) })), [instancesData?.items]);
  const tagOptions = useMemo(() => Array.from(new Set((instancesData?.items ?? []).flatMap((item) => item.tags))).sort().map((tag) => ({ label: tag, value: tag })), [instancesData?.items]);
  const channelOptions = channelValues.filter((item) => Boolean(item?.id && item?.name)).map((item) => ({ label: `${item.name}${item.enabled ? '' : '（已停用）'}`, value: item.id }));
  useEffect(() => { reset(normalize(data)); }, [data, reset]);

  const updateMutation = useMutation({ mutationFn: (next: AppSettings) => updateAppSettings(next), onSuccess: async (result) => {
    reset(normalize(result)); await Promise.all(['app-settings', 'instances', 'dashboard-overview', 'dashboard-trends', 'sync-runs', 'notification-logs'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    notify.success('告警通知设置已保存');
  }, onError: (error) => notify.error(getErrorMessage(error)) });
  const testMutation = useMutation({ mutationFn: () => sendTestNotification({}), onSuccess: async (result) => {
    await queryClient.invalidateQueries({ queryKey: ['notification-logs'] });
    if (result.failed_count > 0) { const names = result.items.filter((item) => !item.success).map((item) => item.channel_name).join('、'); notify.warning(`测试消息已发出，成功 ${result.success_count} 个，失败 ${result.failed_count} 个：${names}`); return; }
    notify.success(`测试消息发送成功，共 ${result.success_count} 个通知渠道`);
  }, onError: (error) => notify.error(getErrorMessage(error)) });
  const selectList = (name: `notification_rules.${RuleArrayField}`, options: RuleOptions, numeric = false) => selectListField(control, name, options, numeric);


  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit(saveSettings)}>
      <Card><Card.Content className="flex flex-col gap-3 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><PageHeader title="告警通知" subtitle="配置通知渠道、余额告警和连接失败告警；规则保存后会由后台巡检定时执行。" /><Button variant="secondary" onPress={() => setGuideOpen(true)}><CircleHelp size={16} />使用说明</Button></div>{data?.updated_at ? <p className="m-0 text-sm text-muted">最近更新：{formatDateTime(data.updated_at)}</p> : null}</Card.Content></Card>
      <Card><Card.Content className="flex flex-col gap-5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="m-0 text-base font-semibold">通知设置</h2><Button variant="secondary" isPending={testMutation.isPending} onPress={() => testMutation.mutate()}>发送测试通知</Button></div>
        <Alert status="accent"><Alert.Indicator /><Alert.Content><Alert.Description>{data?.notification_enabled ? `通知巡检已开启，后台约每 ${data.notification_check_interval_minutes} 分钟检查一次。` : '高级规则巡检当前关闭；实例管理中的快捷余额告警仍会执行。'} 此开关控制下方高级规则；实例快捷余额告警独立生效。未指定渠道的规则、快捷告警和站点异常通知只发送到默认渠道。</Alert.Description></Alert.Content></Alert>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Controller control={control} name="notification_enabled" render={({ field }) => <SwitchInput label="启用通知巡检" description="只控制下方高级余额、聚合和连接失败规则；实例管理快捷告警不受影响。" checked={field.value} onChange={field.onChange} />} />
          <Controller control={control} name="notification_check_interval_minutes" rules={{ required: '请输入通知巡检间隔' }} render={({ field }) => <NumberInput label="通知巡检间隔（分钟）" required value={field.value} onChange={field.onChange} min={1} max={1440} step={1} error={errors.notification_check_interval_minutes?.message} />} />
          <Controller control={control} name="default_balance_alert_threshold" rules={{ required: '请输入默认余额阈值' }} render={({ field }) => <NumberInput label="快捷余额默认阈值" description="实例未单独填写时使用。" required value={field.value} onChange={field.onChange} min={0.01} error={errors.default_balance_alert_threshold?.message} />} />
          <Controller control={control} name="default_notification_channel_id" render={({ field }) => <SelectInput label="默认通知渠道" description="留空时自动使用第一个启用渠道。" options={channelOptions} value={field.value ?? ''} onChange={(value) => field.onChange(value || undefined)} placeholder="第一个启用渠道" />} />
        </div>

        <hr className="border-border" /><h3 className="m-0 text-sm font-semibold">通知渠道</h3>
        {channels.map((item, index) => {
          const base = `notification_channels.${index}` as const; const channel = channelValues[index] ?? item; const generated = channelUrl(channel);
          return <Card key={item.id}><Card.Content className="flex flex-col gap-4 p-4">
            <div className="flex items-center justify-between"><h4 className="m-0 text-sm font-semibold">渠道 {index + 1}</h4><Button isIconOnly aria-label="删除" variant="ghost" onPress={() => removeChannel(index)}><Trash2 size={16} /></Button></div>
            <input type="hidden" {...register(`${base}.id`)} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3"><TextInput label="渠道名称" required error={errors.notification_channels?.[index]?.name?.message} inputProps={{ placeholder: '例如：Telegram 管理群', ...register(`${base}.name`, { required: '请输入渠道名称' }) }} />
              <Controller control={control} name={`${base}.channel_type`} rules={{ required: '请选择渠道类型' }} render={({ field }) => <SelectInput label="渠道类型" required options={channelTypes} value={field.value} onChange={(value) => { field.onChange(value ?? 'custom'); if (value === 'custom') { const generatedUrl = channelUrl(channel); if (generatedUrl) setValue(`${base}.apprise_url`, generatedUrl); } }} />} />
              <Controller control={control} name={`${base}.enabled`} render={({ field }) => <SwitchInput label="启用" checked={field.value} onChange={field.onChange} />} />
            </div>
            {channel.channel_type === 'wecombot' ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><TextInput label="Webhook Key" required description="把企业微信群机器人地址里 `key=` 后面的值填进来即可。" error={errors.notification_channels?.[index]?.wecombot_key?.message} inputProps={{ placeholder: '例如：xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', ...register(`${base}.wecombot_key`, { required: '请输入企业微信机器人 key' }) }} /><TextInput label="生成的 Apprise URL" inputProps={{ readOnly: true, value: generated, placeholder: '填写完成后会自动生成' }} /></div> : null}
            {channel.channel_type === 'bark' ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><TextInput label="Bark 服务器" required description="默认官方云 `api.day.app`，自建 Bark Server 可改成自己的域名或 `主机:端口`。" error={errors.notification_channels?.[index]?.bark_host?.message} inputProps={{ placeholder: defaultBarkHost, ...register(`${base}.bark_host`, { required: '请输入 Bark 服务器地址' }) }} /><TextInput label="Device Key" required description="支持多个，使用逗号分隔。" error={errors.notification_channels?.[index]?.bark_targets?.message} inputProps={{ placeholder: '例如：abc123def456', ...register(`${base}.bark_targets`, { required: '请输入至少一个 Bark Device Key' }) }} /><Controller control={control} name={`${base}.bark_use_https`} render={({ field }) => <SwitchInput label="使用 HTTPS" description="官方云建议开启。" checked={field.value ?? true} onChange={field.onChange} />} /><TextInput label="分组" inputProps={{ placeholder: '可选', ...register(`${base}.bark_group`) }} /><TextInput label="提示音" inputProps={{ placeholder: '例如：minuet', ...register(`${base}.bark_sound`) }} /><TextInput label="生成的 Apprise URL" inputProps={{ readOnly: true, value: generated, placeholder: '填写完成后会自动生成' }} /></div> : null}
            {channel.channel_type === 'telegram' ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><TextInput label="Bot Token" required description="从 BotFather 创建机器人后获取。" error={errors.notification_channels?.[index]?.telegram_bot_token?.message} inputProps={{ placeholder: '例如：123456789:AA...', ...register(`${base}.telegram_bot_token`, { required: '请输入 Telegram Bot Token' }) }} /><TextInput label="Chat ID / 用户名" required description="支持多个，使用逗号分隔；可填 `-100...`、`@channel_name`。" error={errors.notification_channels?.[index]?.telegram_targets?.message} inputProps={{ placeholder: '例如：-1001234567890 或 @ops_channel', ...register(`${base}.telegram_targets`, { required: '请输入至少一个 Telegram Chat ID 或用户名' }) }} /><TextInput label="生成的 Apprise URL" inputProps={{ readOnly: true, value: generated, placeholder: '填写完成后会自动生成' }} /></div> : null}
            {channel.channel_type === 'dingtalk' ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><TextInput label="Access Token" required description="钉钉群机器人 Webhook 里的 access_token。" error={errors.notification_channels?.[index]?.dingtalk_token?.message} inputProps={{ placeholder: '例如：xxxxxxxxxxxxxxxx', ...register(`${base}.dingtalk_token`, { required: '请输入钉钉机器人 access token' }) }} /><TextInput label="加签 Secret" description="如果机器人开启了加签，这里填写 secret；未开启可留空。" inputProps={{ placeholder: '例如：SECxxxxxxxxxxxxxxxx', ...register(`${base}.dingtalk_secret`) }} /><TextInput label="@手机号" description="可选。支持多个，使用逗号分隔。" inputProps={{ placeholder: '例如：13800138000, 13900139000', ...register(`${base}.dingtalk_targets`) }} /><TextInput label="生成的 Apprise URL" inputProps={{ readOnly: true, value: generated }} /></div> : null}
            {channel.channel_type === 'custom' ? <TextInput label="Apprise URL" required description="高级参数、暂未内置的渠道类型，直接填写原始 Apprise URL。" error={errors.notification_channels?.[index]?.apprise_url?.message} inputProps={{ placeholder: '例如：apprise://...', ...register(`${base}.apprise_url`, { required: '请输入 Apprise URL' }) }} /> : null}
          </Card.Content></Card>;
        })}
        <Button variant="outline" onPress={() => addChannel(newChannel())}><Plus size={16} />新增通知渠道</Button>

        <hr className="border-border" /><h3 className="m-0 text-sm font-semibold">实例余额规则</h3><p className="m-0 text-sm text-muted">逐个实例判断：作用范围内任意一个预付费实例余额 ≤ 触发阈值就单独告警。想「某标签下任意一个余额过低就提醒」时，在下方展开「高级匹配与去重」里填标签筛选即可。</p>
        {balanceRules.map((item, index) => {
          const base = `notification_rules.low_balance_rules.${index}` as const;
          return (
            <Card key={item.id}>
              <Card.Content className="flex flex-col gap-4 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="m-0 text-sm font-semibold">余额规则 {index + 1}</h4>
                  <Button isIconOnly aria-label="删除" variant="ghost" onPress={() => removeBalance(index)}><Trash2 size={16} /></Button>
                </div>
                <input type="hidden" {...register(`${base}.id`)} />
                <RuleMainFields base={base} register={register} control={control} errors={errors.notification_rules?.low_balance_rules?.[index]} channelOptions={channelOptions} />
                <Accordion>
                  <Accordion.Item id={`balance-${index}`}>
                    <Accordion.Heading><Accordion.Trigger>高级匹配与去重<Accordion.Indicator /></Accordion.Trigger></Accordion.Heading>
                    <Accordion.Panel><Accordion.Body><RuleAdvancedFields base={base} register={register} control={control} instanceOptions={instanceOptions} tagOptions={tagOptions} channelOptions={channelOptions} includeThreshold /></Accordion.Body></Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              </Card.Content>
            </Card>
          );
        })}
        <Button variant="outline" onPress={() => addBalance(newBalanceRule('warning'))}><Plus size={16} />新增余额规则</Button>

        <hr className="border-border" /><h3 className="m-0 text-sm font-semibold">聚合余额规则</h3><p className="m-0 text-sm text-muted">合并统计：把作用范围内所有预付费实例余额加起来，总额 ≤ 总余额阈值才告警。适合「几个实例合计余额过低就提醒」，可按实例或标签圈定范围。</p>
        {aggregateRules.map((item, index) => { const base = `notification_rules.aggregate_balance_rules.${index}` as const; return <Card key={item.id}><Card.Content className="flex flex-col gap-4 p-4"><div className="flex items-center justify-between"><h4 className="m-0 text-sm font-semibold">聚合规则 {index + 1}</h4><Button isIconOnly aria-label="删除" variant="ghost" onPress={() => removeAggregate(index)}><Trash2 size={16} /></Button></div><input type="hidden" {...register(`${base}.id`)} /><RuleMainFields base={base} register={register} control={control} errors={errors.notification_rules?.aggregate_balance_rules?.[index]} channelOptions={channelOptions} aggregate /><RuleAdvancedFields base={base} register={register} control={control} instanceOptions={instanceOptions} tagOptions={tagOptions} channelOptions={channelOptions} aggregate /></Card.Content></Card>; })}
        <Button variant="outline" onPress={() => addAggregate(newAggregateRule())}><Plus size={16} />新增聚合余额规则</Button>

        <hr className="border-border" /><h3 className="m-0 text-sm font-semibold">连接失败规则</h3>
        {connectivityRules.map((item, index) => { const base = `notification_rules.connectivity_failure_rules.${index}` as const; return <Card key={item.id}><Card.Content className="flex flex-col gap-4 p-4"><div className="flex items-center justify-between"><h4 className="m-0 text-sm font-semibold">连接规则 {index + 1}</h4><Button isIconOnly aria-label="删除" variant="ghost" onPress={() => removeConnectivity(index)}><Trash2 size={16} /></Button></div><input type="hidden" {...register(`${base}.id`)} /><TextInput label="规则名称" required inputProps={{ placeholder: '例如：实例连续连接失败', ...register(`${base}.name`, { required: '请输入规则名称' }) }} /><div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Controller control={control} name={`${base}.consecutive_failures`} rules={{ required: '请输入连续失败次数' }} render={({ field }) => <NumberInput label="连续失败次数" required value={field.value} onChange={field.onChange} min={2} max={20} step={1} error={errors.notification_rules?.connectivity_failure_rules?.[index]?.consecutive_failures?.message} />} /><Controller control={control} name={`${base}.repeat_interval_minutes`} render={({ field }) => <NumberInput label="重复提醒间隔（分钟）" value={field.value} onChange={field.onChange} min={5} max={10080} step={1} />} /><Controller control={control} name={`${base}.enabled`} render={({ field }) => <SwitchInput label="启用" checked={field.value} onChange={field.onChange} />} /><Controller control={control} name={`${base}.notify_on_recovery`} render={({ field }) => <SwitchInput label="恢复通知" checked={field.value} onChange={field.onChange} />} />{selectList(`${base}.instance_ids`, instanceOptions, true)}{selectList(`${base}.tags`, tagOptions)}{selectList(`${base}.channel_ids`, channelOptions)}<Controller control={control} name={`${base}.include_disabled`} render={({ field }) => <SwitchInput label="包含停用实例" checked={field.value} onChange={field.onChange} />} /></div></Card.Content></Card>; })}
        <Button variant="outline" onPress={() => addConnectivity(newConnectivityRule())}><Plus size={16} />新增连接失败规则</Button>
        <p className="m-0 text-sm text-muted">默认规则会覆盖全量预付费实例和全量启用实例。若某条规则没有指定通知渠道，会自动发送到所有已启用渠道。</p>
      </Card.Content></Card>
      <div><Button type="submit" variant="primary" isPending={updateMutation.isPending} isDisabled={isLoading}>保存告警通知</Button></div>

      <AppDrawer open={guideOpen} onOpenChange={setGuideOpen} title="告警通知使用说明" placement="right" className="notification-guide-drawer">
        <div className="flex flex-col gap-3">
          <Alert status="success"><Alert.Indicator /><Alert.Content><Alert.Title>你想要的两种告警都已内置</Alert.Title><Alert.Description>「某标签下任意一个实例余额过低」用实例余额规则 + 标签筛选；「几个实例合计余额过低」用聚合余额规则。下面每一节都有对应配方。</Alert.Description></Alert.Content></Alert>
          <Accordion defaultExpandedKeys={new Set(['recipes'])}>
            <GuideItem id="recipes" title="① 常用配方（先看这里）">
              <div className="flex flex-col gap-4"><div><p className="mb-1.5 font-semibold">场景 A 某标签下「任意一个」实例余额过低就告警</p><ol className="list-decimal pl-5"><li>到「实例余额规则」，新增或编辑一条规则。</li><li>展开卡片里的「高级匹配与去重」，在「标签筛选」里选中目标标签（如 core）。</li><li>把「触发阈值」设为想要的余额下限，例如 50。</li><li>保存。此后该标签下任何一个预付费实例余额 ≤ 50 都会单独告警。</li></ol><p className="text-sm text-muted">要点：这类规则逐个实例判断，命中一个报一个，互不影响。</p></div>
              <div><p className="mb-1.5 font-semibold">场景 B 几个实例「合计」余额过低才告警</p><ol className="list-decimal pl-5"><li>到「聚合余额规则」，新增一条规则。</li><li>在「实例列表」里勾选要合并统计的实例，或用「标签筛选」按标签圈一批。</li><li>把「总余额阈值」设为合计下限，例如 100。</li><li>保存。此后这批实例余额相加 ≤ 100 才会告警（单个再低也不单独报）。</li></ol><p className="text-sm text-muted">要点：这类规则把范围内余额求和后整体判断，只发一条聚合告警。</p></div></div>
            </GuideItem>
            <GuideItem id="overview" title="② 系统总览：告警怎么触发的"><p>开启「启用通知巡检」后，后台按「通知巡检间隔」定时把每条启用的规则跑一遍：</p><ul className="list-disc pl-5"><li>命中阈值 → 视为「告警中」，向该规则的渠道推送一条告警（可要求连续命中多次才发，见去重）。</li><li>余额告警每轮低余额只发送一次，恢复到阈值以上后再次跌破才重新告警；连接失败规则仍按「重复提醒间隔」提醒。</li><li>恢复到「恢复阈值」以上 → 状态转为正常，若开了「恢复通知」会再发一条恢复消息。</li></ul><p className="text-sm text-muted">关闭巡检后不会自动检查，但仍可用右上角「发送测试通知」验证渠道连通性。</p></GuideItem>
            <GuideItem id="channels" title="③ 通知渠道"><p>内置企业微信机器人、Bark、Telegram Bot、钉钉机器人的友好表单，填好会自动生成 Apprise URL；更冷门的渠道选「自定义 Apprise URL」直接填原始地址。</p><ul className="list-disc pl-5"><li>设置一个默认渠道；未显式选择渠道的规则、快捷余额告警和站点异常通知只发送到它。</li><li>删除或停用默认渠道后，系统自动回退到列表中第一个已启用渠道。</li><li>先点「发送测试通知」确认默认渠道能收到，再配规则。</li></ul></GuideItem>
            <GuideItem id="scope" title="④ 作用范围与匹配逻辑"><p>每条规则用「指定实例 / 标签筛选」圈定作用范围：</p><ul className="list-disc pl-5"><li>都不填 → 匹配全部实例。</li><li>只填标签 → 命中带任一标签的实例。</li><li>只填实例 → 命中所选实例。</li><li>两者都填 → 取并集（满足其一即命中）。</li><li>「包含停用实例」默认关闭，即停用实例不参与判断。</li></ul><p className="text-sm text-muted">余额类规则只对「预付费」实例生效，后付费实例会自动跳过。</p></GuideItem>
            <GuideItem id="threshold" title="⑤ 阈值、去重与恢复"><ul className="list-disc pl-5"><li><strong>触发阈值</strong>：余额 ≤ 它就算命中（聚合规则是合计 ≤ 它）。</li><li><strong>恢复阈值</strong>：余额回到 ≥ 它才算恢复；必须大于触发阈值。留空默认取触发阈值的 1.2 倍，用这个「缓冲带」避免在阈值附近反复告警/恢复。</li><li><strong>连续命中次数</strong>：连续多少次巡检都低于阈值才首次告警，用来过滤抖动。</li><li><strong>余额告警</strong>：持续低于阈值不会重复发送，恢复后再次跌破才重新告警。</li><li><strong>级别</strong>：严重 / 预警，仅影响通知的类型标识与图标。</li><li><strong>恢复通知</strong>：开启后余额回升会补发一条恢复消息。</li></ul></GuideItem>
            <GuideItem id="connectivity" title="⑥ 连接失败规则"><p>当某实例连续同步失败达到设定次数时告警，用于发现掉线、令牌失效、代理不通等问题。范围与恢复逻辑同上，最近一次同步成功即视为恢复。</p></GuideItem>
            <GuideItem id="troubleshoot" title="⑦ 没收到告警？排查清单"><ul className="list-disc pl-5"><li>「启用通知巡检」是否已开启并保存。</li><li>渠道是否「启用」，测试通知能否收到。</li><li>规则是否「启用」，作用范围是否真的覆盖到目标实例。</li><li>余额类规则：目标是否为预付费实例、是否已同步出余额（余额为空会跳过）。</li><li>余额告警首次触发可能等待「连续命中次数」；告警中要等恢复后再次跌破才会重发。</li><li>连接失败规则刚触发过、仍在重复间隔内时不会重发；可到「通知日志」页核对投递记录。</li></ul></GuideItem>
          </Accordion>
          <p className="m-0 text-sm text-muted">配置改动保存后才生效；发送历史可在「通知日志」页查看每条告警的投递结果。</p>
        </div>
      </AppDrawer>
    </form>
  );
}

type GuideItemProps = { id: string; title: string; children: ReactNode };
function GuideItem({ id, title, children }: GuideItemProps) { return <Accordion.Item id={id}><Accordion.Heading><Accordion.Trigger>{title}<Accordion.Indicator /></Accordion.Trigger></Accordion.Heading><Accordion.Panel><Accordion.Body>{children}</Accordion.Body></Accordion.Panel></Accordion.Item>; }

type RuleBase = `notification_rules.${'low_balance_rules' | 'aggregate_balance_rules'}.${number}`;
type RuleFieldErrors = { name?: { message?: string }; severity?: { message?: string }; threshold?: { message?: string } };
type RuleOptions = Array<{ label: string; value: string }>;

function RuleMainFields({ base, register, control, errors, channelOptions, aggregate = false }: { base: RuleBase; register: UseFormRegister<NotificationValues>; control: Control<NotificationValues>; errors: RuleFieldErrors | undefined; channelOptions: RuleOptions; aggregate?: boolean }) {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
    <TextInput label="规则名称" required error={errors?.name?.message} inputProps={{ placeholder: aggregate ? '例如：核心实例总余额' : '例如：实例余额预警', ...register(`${base}.name`, { required: '请输入规则名称' }) }} />
    <Controller control={control} name={`${base}.severity`} rules={{ required: '请选择级别' }} render={({ field }) => <SelectInput label="级别" required options={[{ label: '预警', value: 'warning' }, { label: '严重', value: 'critical' }]} value={field.value} onChange={field.onChange} error={errors?.severity?.message} />} />
    <Controller control={control} name={`${base}.threshold`} rules={{ required: aggregate ? '请输入总余额阈值' : '请输入触发阈值' }} render={({ field }) => <NumberInput label={aggregate ? '总余额阈值' : '触发阈值'} required value={field.value} onChange={field.onChange} min={0.01} error={errors?.threshold?.message} />} />
    {aggregate ? <Controller control={control} name={`${base}.resolve_threshold`} render={({ field }) => <NumberInput label="恢复阈值" value={field.value ?? undefined} onChange={field.onChange} min={0.01} />} /> : null}
    <Controller control={control} name={`${base}.enabled`} render={({ field }) => <SwitchInput label="启用" checked={field.value} onChange={field.onChange} />} />
    <Controller control={control} name={`${base}.channel_ids`} render={({ field }) => <SelectInput label="通知渠道" multiple options={channelOptions} value={field.value ?? []} onChange={(value) => field.onChange(Array.isArray(value) ? value : [])} placeholder="不选表示发送到默认渠道" />} />
  </div>;
}

function RuleAdvancedFields({ base, control, instanceOptions, tagOptions, aggregate = false }: { base: RuleBase; control: Control<NotificationValues>; instanceOptions: RuleOptions; tagOptions: RuleOptions; aggregate?: boolean; register?: UseFormRegister<NotificationValues>; channelOptions?: RuleOptions; includeThreshold?: boolean }) {
  const instanceName = `${base}.instance_ids` as `${RuleBase}.instance_ids`;
  const tagName = `${base}.tags` as `${RuleBase}.tags`;
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
    <RuleSelect control={control} name={instanceName} options={instanceOptions} numeric />
    <RuleSelect control={control} name={tagName} options={tagOptions} />
    {!aggregate ? <Controller control={control} name={`${base}.resolve_threshold`} render={({ field }) => <NumberInput label="恢复阈值" value={field.value ?? undefined} onChange={field.onChange} min={0.01} />} /> : null}
    <Controller control={control} name={`${base}.min_consecutive_checks`} render={({ field }) => <NumberInput label="连续命中次数" description="同一实例连续多少次检查都低于阈值后才告警。" value={field.value} onChange={field.onChange} min={1} max={10} step={1} />} />
    <Controller control={control} name={`${base}.include_disabled`} render={({ field }) => <SwitchInput label="包含停用实例" checked={field.value} onChange={field.onChange} />} />
    <Controller control={control} name={`${base}.notify_on_recovery`} render={({ field }) => <SwitchInput label="恢复通知" checked={field.value} onChange={field.onChange} />} />
    {aggregate ? <p className="m-0 text-sm text-muted">至少选择一个实例或标签。</p> : null}
  </div>;
}

function RuleSelect({ control, name, options, numeric = false }: { control: Control<NotificationValues>; name: `${RuleBase}.${'instance_ids' | 'tags'}`; options: RuleOptions; numeric?: boolean }) {
  return <Controller control={control} name={name} render={({ field }) => <SelectInput label={name.endsWith('instance_ids') ? '指定实例' : '标签筛选'} multiple options={options} value={(field.value as (string | number)[]).map(String)} onChange={(value) => field.onChange(Array.isArray(value) ? (numeric ? value.map(Number) : value) : [])} placeholder={name.endsWith('instance_ids') ? '不选表示匹配全部实例' : '按标签匹配实例'} />} />;
}
type RuleArrayName = 'low_balance_rules' | 'aggregate_balance_rules' | 'connectivity_failure_rules';
type RuleArrayField = `${RuleArrayName}.${number}.${'instance_ids' | 'tags' | 'channel_ids'}`;
function selectListField(control: Control<NotificationValues>, name: `notification_rules.${RuleArrayField}`, options: RuleOptions, numeric = false) {
  return <Controller control={control} name={name} render={({ field }) => <SelectInput label={name.endsWith('instance_ids') ? '指定实例' : name.endsWith('tags') ? '标签筛选' : '通知渠道'} multiple options={options} value={(field.value as (string | number)[] | undefined)?.map(String) ?? []} onChange={(value) => field.onChange(Array.isArray(value) ? (numeric ? value.map(Number) : value) : [])} placeholder="请选择" />} />;
}
