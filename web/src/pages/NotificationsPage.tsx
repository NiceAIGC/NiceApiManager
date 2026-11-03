import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CircleHelp, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { getErrorMessage } from '../api/client';
import { fetchInstances } from '../api/instances';
import { fetchAppSettings, sendTestNotification, updateAppSettings } from '../api/settings';
import {
  AppModal,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmPopover,
  MultiSelect,
  NumberField,
  PageHeader,
  SegmentedControl,
  SelectField,
  StatusBadge,
  SwitchField,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextField,
} from '../components/ui';
import { notify } from '../lib/toast';
import { cn } from '../lib/utils';
import type {
  AggregateBalanceNotificationRule,
  AppSettings,
  BalanceNotificationRule,
  ConnectivityFailureNotificationRule,
  NotificationChannelConfig,
  NotificationChannelGroupConfig,
  NotificationRuleSet,
} from '../types/api';
import { formatDateTime } from '../utils/format';

type ChannelType = 'wecombot' | 'bark' | 'telegram' | 'dingtalk' | 'custom';

interface ChannelValue extends NotificationChannelConfig {
  channel_type?: ChannelType;
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

type RuleKind = 'balance' | 'aggregate' | 'connectivity';
type AnyRule = BalanceNotificationRule | AggregateBalanceNotificationRule | ConnectivityFailureNotificationRule;
interface RuleTarget { kind: RuleKind; index: number; rule: AnyRule }

const CHANNEL_TYPES = [
  { value: 'wecombot', label: '企业微信机器人' },
  { value: 'bark', label: 'Bark' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'dingtalk', label: '钉钉机器人' },
  { value: 'custom', label: '自定义 Apprise URL' },
];

const SEVERITY_OPTIONS = [
  { value: 'warning', label: '预警' },
  { value: 'critical', label: '严重' },
];

const encode = (value: string) => encodeURIComponent(value);
const split = (value?: string) => (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);

function newChannelId() {
  return `channel-${Math.random().toString(36).slice(2, 10)}`;
}
function newGroupId() {
  return `group-${Math.random().toString(36).slice(2, 10)}`;
}
function newRuleId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function channelUrl(channel: ChannelValue): string {
  if (channel.channel_type === 'custom') return channel.apprise_url ?? '';
  if (channel.channel_type === 'wecombot') return channel.wecombot_key?.trim() ? `wecombot://${encode(channel.wecombot_key.trim())}` : '';
  if (channel.channel_type === 'bark') {
    const targets = split(channel.bark_targets);
    if (!channel.bark_host?.trim() || !targets.length) return '';
    const params = new URLSearchParams();
    if (channel.bark_group?.trim()) params.set('group', channel.bark_group.trim());
    if (channel.bark_sound?.trim()) params.set('sound', channel.bark_sound.trim());
    const scheme = channel.bark_use_https === false ? 'bark' : 'barks';
    return `${scheme}://${channel.bark_host.trim()}/${targets.map(encode).join('/')}${params.size ? `?${params}` : ''}`;
  }
  if (channel.channel_type === 'telegram') {
    const targets = split(channel.telegram_targets);
    if (!channel.telegram_bot_token?.trim() || !targets.length) return '';
    return `tgram://${encode(channel.telegram_bot_token.trim())}/${targets.map(encode).join('/')}`;
  }
  if (channel.channel_type === 'dingtalk') {
    const token = channel.dingtalk_token?.trim();
    if (!token) return '';
    const targets = split(channel.dingtalk_targets);
    return `dingtalk://${channel.dingtalk_secret?.trim() ? `${encode(channel.dingtalk_secret.trim())}@` : ''}${encode(token)}${targets.length ? `/${targets.map(encode).join('/')}` : ''}`;
  }
  return '';
}

function detectChannelType(channel: NotificationChannelConfig): ChannelType {
  const url = channel.apprise_url ?? '';
  if (url.startsWith('wecombot://')) return 'wecombot';
  if (url.startsWith('bark://') || url.startsWith('barks://')) return 'bark';
  if (url.startsWith('tgram://')) return 'telegram';
  if (url.startsWith('dingtalk://')) return 'dingtalk';
  return 'custom';
}

function topChannelType(url: string): string {
  if (url.startsWith('wecombot://')) return '企业微信';
  if (url.startsWith('barks://') || url.startsWith('bark://')) return 'Bark';
  if (url.startsWith('tgram://')) return 'Telegram';
  if (url.startsWith('dingtalk://')) return '钉钉';
  return 'Apprise';
}

const newRuleBase = () => ({ enabled: true, instance_ids: [] as number[], tags: [] as string[], include_disabled: false, notify_on_recovery: true, channel_ids: [] as string[], channel_group_ids: [] as string[] });

function newBalanceRule(): BalanceNotificationRule {
  return { ...newRuleBase(), id: newRuleId('balance'), name: '实例余额预警', severity: 'warning', threshold: 50, resolve_threshold: null, min_consecutive_checks: 1 };
}
function newAggregateRule(): AggregateBalanceNotificationRule {
  return { ...newRuleBase(), id: newRuleId('aggregate'), name: '聚合余额预警', severity: 'warning', threshold: 100, resolve_threshold: null, min_consecutive_checks: 1 };
}
function newConnectivityRule(): ConnectivityFailureNotificationRule {
  return { ...newRuleBase(), id: newRuleId('connectivity'), name: '实例连接失败', consecutive_failures: 3, repeat_interval_minutes: 180 };
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('channels');
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [channelOpen, setChannelOpen] = useState(false);
  const [channelDraft, setChannelDraft] = useState<ChannelValue | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupDraft, setGroupDraft] = useState<NotificationChannelGroupConfig | null>(null);
  const [ruleTarget, setRuleTarget] = useState<RuleTarget | null>(null);
  const [ruleDraft, setRuleDraft] = useState<AnyRule | null>(null);
  const [testChannels, setTestChannels] = useState<string[]>([]);
  const [testGroups, setTestGroups] = useState<string[]>([]);

  const { data, isLoading } = useQuery({ queryKey: ['app-settings'], queryFn: fetchAppSettings });
  const { data: instanceData } = useQuery({ queryKey: ['instances'], queryFn: () => fetchInstances() });

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (payload: AppSettings) => updateAppSettings(payload),
    onSuccess: async (result) => {
      setDraft(result);
      await Promise.all(['app-settings', 'instances', 'dashboard-overview', 'sync-runs'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      notify.success('告警通知设置已保存');
    },
    onError: (error) => notify.error(getErrorMessage(error)),
  });

  const testMutation = useMutation({
    mutationFn: () => sendTestNotification({ channel_ids: testChannels, group_ids: testGroups }),
    onSuccess: (result) => {
      if (result.failed_count) {
        const failed = result.items.filter((item) => !item.success).map((item) => item.channel_name).join('、');
        notify.warning(`测试消息已发出，成功 ${result.success_count} 个，失败 ${result.failed_count} 个：${failed}`);
        return;
      }
      notify.success(`测试消息发送成功，共 ${result.success_count} 个通知渠道`);
    },
    onError: (error) => notify.error(getErrorMessage(error)),
  });

  const channels = draft?.notification_channels ?? [];
  const groups = draft?.notification_channel_groups ?? [];
  const rules: NotificationRuleSet = draft?.notification_rules ?? { low_balance_rules: [], aggregate_balance_rules: [], connectivity_failure_rules: [] };

  const channelOptions = useMemo(() => channels.map((item) => ({ label: `${item.name}${item.enabled ? '' : '（停用）'}`, value: item.id })), [channels]);
  const groupOptions = useMemo(() => groups.map((item) => ({ label: `${item.name}（${item.channel_ids.length} 渠道）`, value: item.id })), [groups]);
  const instanceOptions = useMemo(() => (instanceData?.items ?? []).map((item) => ({ label: item.name, value: String(item.id) })), [instanceData]);
  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const item of instanceData?.items ?? []) for (const tag of item.tags) tags.add(tag);
    return Array.from(tags).sort().map((tag) => ({ label: tag, value: tag }));
  }, [instanceData]);

  const patchDraft = (changes: Partial<AppSettings>) => setDraft((current) => (current ? { ...current, ...changes } : current));
  const patchRules = (next: Partial<NotificationRuleSet>) => setDraft((current) => (current ? { ...current, notification_rules: { ...current.notification_rules, ...next } } : current));

  const saveChannel = () => {
    if (!channelDraft || !draft) return;
    const url = channelUrl(channelDraft);
    if (!url) { notify.warning('请先补全渠道参数'); return; }
    const record: NotificationChannelConfig = { id: channelDraft.id, name: channelDraft.name.trim(), enabled: channelDraft.enabled, apprise_url: url };
    const exists = channels.some((item) => item.id === record.id);
    patchDraft({ notification_channels: exists ? channels.map((item) => (item.id === record.id ? record : item)) : [...channels, record] });
    setChannelOpen(false);
    setChannelDraft(null);
  };

  const saveGroup = () => {
    if (!groupDraft || !draft) return;
    if (!groupDraft.name.trim()) { notify.warning('请填写分组名称'); return; }
    const exists = groups.some((item) => item.id === groupDraft.id);
    patchDraft({ notification_channel_groups: exists ? groups.map((item) => (item.id === groupDraft.id ? groupDraft : item)) : [...groups, groupDraft] });
    setGroupOpen(false);
    setGroupDraft(null);
  };

  const saveRule = () => {
    if (!ruleDraft || !ruleTarget || !draft) return;
    if (!ruleDraft.name.trim()) { notify.warning('请填写规则名称'); return; }
    const listKey = ruleTarget.kind === 'balance' ? 'low_balance_rules' : ruleTarget.kind === 'aggregate' ? 'aggregate_balance_rules' : 'connectivity_failure_rules';
    const list = [...rules[listKey]];
    list[ruleTarget.index] = ruleDraft as never;
    patchRules({ [listKey]: list } as Partial<NotificationRuleSet>);
    setRuleTarget(null);
    setRuleDraft(null);
  };

  const removeRule = (kind: RuleKind, index: number) => {
    const listKey = kind === 'balance' ? 'low_balance_rules' : kind === 'aggregate' ? 'aggregate_balance_rules' : 'connectivity_failure_rules';
    patchRules({ [listKey]: rules[listKey].filter((_, i) => i !== index) } as Partial<NotificationRuleSet>);
  };

  const addRule = (kind: RuleKind) => {
    const rule = kind === 'balance' ? newBalanceRule() : kind === 'aggregate' ? newAggregateRule() : newConnectivityRule();
    const listKey = kind === 'balance' ? 'low_balance_rules' : kind === 'aggregate' ? 'aggregate_balance_rules' : 'connectivity_failure_rules';
    const list = [...rules[listKey], rule] as AnyRule[];
    patchRules({ [listKey]: list } as Partial<NotificationRuleSet>);
    setRuleTarget({ kind, index: list.length - 1, rule });
    setRuleDraft(rule);
  };

  const ruleSection = (kind: RuleKind, title: string, description: string, list: AnyRule[]) => (
    <Card key={kind}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => addRule(kind)}>
            <Plus className="size-4" />
            新增规则
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {list.length ? list.map((rule, index) => {
          const balance = rule as BalanceNotificationRule;
          const connectivity = rule as ConnectivityFailureNotificationRule;
          const targetCount = rule.channel_ids.length + rule.channel_group_ids.length;
          return (
            <div key={rule.id} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="truncate text-sm">{rule.name}</strong>
                  {'severity' in rule ? <StatusBadge tone={rule.severity === 'critical' ? 'destructive' : 'warning'}>{rule.severity === 'critical' ? '严重' : '预警'}</StatusBadge> : null}
                  <StatusBadge tone={rule.enabled ? 'success' : 'muted'}>{rule.enabled ? '启用' : '停用'}</StatusBadge>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                  {'threshold' in rule ? <span>阈值 {balance.threshold}{kind === 'aggregate' ? '（合计）' : ''}</span> : null}
                  {'consecutive_failures' in rule ? <span>连续失败 {connectivity.consecutive_failures} 次</span> : null}
                  <span>{rule.instance_ids.length ? `${rule.instance_ids.length} 个实例` : '全部实例'}{rule.tags.length ? ` · 标签 ${rule.tags.join('/')}` : ''}</span>
                  <span>{targetCount ? `${targetCount} 个通知目标` : '默认渠道'}</span>
                </div>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label="编辑规则" onClick={() => { setRuleTarget({ kind, index, rule }); setRuleDraft(rule); }}>
                <Pencil className="size-4" />
              </Button>
              <ConfirmPopover title={`删除规则「${rule.name}」？`} confirmText="删除" onConfirm={() => removeRule(kind, index)}>
                <Button variant="ghost" size="icon-sm" aria-label="删除规则" className="text-destructive">
                  <Trash2 className="size-4" />
                </Button>
              </ConfirmPopover>
            </div>
          );
        }) : <p className="m-0 text-sm text-muted-foreground">暂无规则</p>}
      </CardContent>
    </Card>
  );

  const ruleDraftBalance = ruleDraft && ruleTarget?.kind !== 'connectivity' ? (ruleDraft as BalanceNotificationRule) : null;
  const ruleDraftConnectivity = ruleDraft && ruleTarget?.kind === 'connectivity' ? (ruleDraft as ConnectivityFailureNotificationRule) : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="告警通知"
        subtitle={data?.updated_at ? `最近更新：${formatDateTime(data.updated_at)}` : '集中管理通知渠道、渠道分组与三类告警规则。'}
        extra={
          <>
            <Button variant="outline" onClick={() => setGuideOpen(true)}>
              <CircleHelp className="size-4" />
              使用说明
            </Button>
            <Button isPending={saveMutation.isPending} disabled={!draft || isLoading} onClick={() => draft && saveMutation.mutate(draft)}>
              保存告警通知
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="channels">通知渠道</TabsTrigger>
          <TabsTrigger value="groups">渠道分组</TabsTrigger>
          <TabsTrigger value="rules">告警规则</TabsTrigger>
          <TabsTrigger value="settings">全局设置</TabsTrigger>
        </TabsList>

        <TabsContent value="channels">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <CardTitle>通知渠道</CardTitle>
                  <CardDescription>每个渠道对应一个 Apprise 推送目标。</CardDescription>
                </div>
                <Button size="sm" onClick={() => { setChannelDraft({ id: newChannelId(), name: '', enabled: true, apprise_url: '', channel_type: 'wecombot', bark_host: 'api.day.app', bark_use_https: true }); setChannelOpen(true); }}>
                  <Plus className="size-4" />
                  新增渠道
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {channels.length ? channels.map((channel) => (
                <div key={channel.id} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Bell className="size-4 text-muted-foreground" />
                    <strong className="min-w-0 flex-1 truncate text-sm">{channel.name}</strong>
                    <StatusBadge tone="muted">{topChannelType(channel.apprise_url)}</StatusBadge>
                    <StatusBadge tone={channel.enabled ? 'success' : 'muted'}>{channel.enabled ? '启用' : '停用'}</StatusBadge>
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground" title={channel.apprise_url}>{channel.apprise_url}</div>
                  <div className="flex items-center justify-end gap-1">
                    <SwitchField checked={channel.enabled} onCheckedChange={(value) => patchDraft({ notification_channels: channels.map((item) => (item.id === channel.id ? { ...item, enabled: value } : item)) })} />
                    <Button variant="ghost" size="icon-sm" aria-label="编辑渠道" onClick={() => { setChannelDraft({ ...channel, channel_type: detectChannelType(channel) }); setChannelOpen(true); }}>
                      <Pencil className="size-4" />
                    </Button>
                    <ConfirmPopover title={`删除渠道「${channel.name}」？`} confirmText="删除" onConfirm={() => patchDraft({ notification_channels: channels.filter((item) => item.id !== channel.id) })}>
                      <Button variant="ghost" size="icon-sm" aria-label="删除渠道" className="text-destructive">
                        <Trash2 className="size-4" />
                      </Button>
                    </ConfirmPopover>
                  </div>
                </div>
              )) : <p className="m-0 text-sm text-muted-foreground">暂无通知渠道，先新增一个。</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="groups">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <CardTitle>渠道分组</CardTitle>
                  <CardDescription>把多个渠道打包成一个目标，规则和测试发送都可直接选分组。</CardDescription>
                </div>
                <Button size="sm" onClick={() => { setGroupDraft({ id: newGroupId(), name: '', channel_ids: [] }); setGroupOpen(true); }}>
                  <Plus className="size-4" />
                  新增分组
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {groups.length ? groups.map((group) => (
                <div key={group.id} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <strong className="min-w-0 flex-1 truncate text-sm">{group.name}</strong>
                    <StatusBadge tone="secondary">{group.channel_ids.length} 个渠道</StatusBadge>
                    <Button variant="ghost" size="icon-sm" aria-label="编辑分组" onClick={() => { setGroupDraft(group); setGroupOpen(true); }}>
                      <Pencil className="size-4" />
                    </Button>
                    <ConfirmPopover title={`删除分组「${group.name}」？`} confirmText="删除" onConfirm={() => patchDraft({ notification_channel_groups: groups.filter((item) => item.id !== group.id) })}>
                      <Button variant="ghost" size="icon-sm" aria-label="删除分组" className="text-destructive">
                        <Trash2 className="size-4" />
                      </Button>
                    </ConfirmPopover>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {group.channel_ids.map((id) => (
                      <StatusBadge key={id} tone="muted">{channels.find((item) => item.id === id)?.name ?? id}</StatusBadge>
                    ))}
                  </div>
                </div>
              )) : <p className="m-0 text-sm text-muted-foreground">暂无渠道分组。</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules">
          <div className="flex flex-col gap-4">
            {ruleSection('balance', '实例余额规则', '逐个实例判断余额阈值，低于阈值即告警。', rules.low_balance_rules as AnyRule[])}
            {ruleSection('aggregate', '聚合余额规则', '把作用范围内实例余额加总，总额低于阈值才告警。', rules.aggregate_balance_rules as AnyRule[])}
            {ruleSection('connectivity', '连接失败规则', '连续探测失败达到次数后告警，可设置重复提醒间隔。', rules.connectivity_failure_rules as AnyRule[])}
          </div>
        </TabsContent>

        <TabsContent value="settings">
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>全局设置</CardTitle>
                <CardDescription>巡检开关、默认阈值与默认渠道。</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <SwitchField label="启用通知巡检" description="控制余额、聚合与连接失败规则的定时巡检" checked={Boolean(draft?.notification_enabled)} onCheckedChange={(value) => patchDraft({ notification_enabled: value })} />
                <NumberField label="巡检间隔（分钟）" value={draft?.notification_check_interval_minutes ?? 5} onValueChange={(value) => patchDraft({ notification_check_interval_minutes: value })} min={1} max={1440} />
                <NumberField label="快捷余额默认阈值" description="实例未单独填写时使用" value={draft?.default_balance_alert_threshold ?? 50} onValueChange={(value) => patchDraft({ default_balance_alert_threshold: value })} min={0.01} />
                <SelectField label="默认通知渠道" value={draft?.default_notification_channel_id ?? '__none__'} onValueChange={(value) => patchDraft({ default_notification_channel_id: value === '__none__' ? null : value })} options={[{ label: '自动（第一个启用渠道）', value: '__none__' }, ...channelOptions]} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>测试发送</CardTitle>
                <CardDescription>选择渠道或分组发送一条测试消息；留空则按服务端默认行为发送。</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <MultiSelect label="通知渠道" options={channelOptions} value={testChannels} onChange={setTestChannels} placeholder="选择渠道" />
                  <MultiSelect label="渠道分组" options={groupOptions} value={testGroups} onChange={setTestGroups} placeholder="选择分组" />
                </div>
                <Button className="w-fit" isPending={testMutation.isPending} onClick={() => testMutation.mutate()}>
                  <Send className="size-4" />
                  发送测试通知
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <AppModal
        open={channelOpen}
        onOpenChange={(open) => { setChannelOpen(open); if (!open) setChannelDraft(null); }}
        title={channelDraft && channels.some((item) => item.id === channelDraft.id) ? '编辑通知渠道' : '新增通知渠道'}
        description="选择渠道类型后填写对应参数，系统会自动生成 Apprise URL。"
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { setChannelOpen(false); setChannelDraft(null); }}>取消</Button>
            <Button onClick={saveChannel}>保存渠道</Button>
          </>
        }
      >
        {channelDraft ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <TextField label="渠道名称" required inputProps={{ placeholder: '例如：运维群', value: channelDraft.name, onChange: (event) => setChannelDraft({ ...channelDraft, name: event.target.value }) }} />
              <SelectField label="渠道类型" value={channelDraft.channel_type ?? 'wecombot'} onValueChange={(value) => setChannelDraft({ ...channelDraft, channel_type: value as ChannelType })} options={CHANNEL_TYPES} />
            </div>
            {(channelDraft.channel_type ?? 'wecombot') === 'wecombot' ? (
              <TextField label="Webhook Key" required description="企业微信群机器人地址里 key= 后面的值" inputProps={{ placeholder: 'xxxxxxxx-xxxx-xxxx', value: channelDraft.wecombot_key ?? '', onChange: (event) => setChannelDraft({ ...channelDraft, wecombot_key: event.target.value }) }} />
            ) : null}
            {channelDraft.channel_type === 'bark' ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <TextField label="Bark 服务器" required description="默认官方云 api.day.app" inputProps={{ placeholder: 'api.day.app', value: channelDraft.bark_host ?? '', onChange: (event) => setChannelDraft({ ...channelDraft, bark_host: event.target.value }) }} />
                <TextField label="Device Key" required description="多个用逗号分隔" inputProps={{ placeholder: 'abc123def456', value: channelDraft.bark_targets ?? '', onChange: (event) => setChannelDraft({ ...channelDraft, bark_targets: event.target.value }) }} />
                <TextField label="分组" inputProps={{ placeholder: '可选', value: channelDraft.bark_group ?? '', onChange: (event) => setChannelDraft({ ...channelDraft, bark_group: event.target.value }) }} />
                <TextField label="提示音" inputProps={{ placeholder: '可选，如 alarm', value: channelDraft.bark_sound ?? '', onChange: (event) => setChannelDraft({ ...channelDraft, bark_sound: event.target.value }) }} />
                <SwitchField label="使用 HTTPS" checked={channelDraft.bark_use_https !== false} onCheckedChange={(value) => setChannelDraft({ ...channelDraft, bark_use_https: value })} />
              </div>
            ) : null}
            {channelDraft.channel_type === 'telegram' ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <TextField label="Bot Token" required inputProps={{ placeholder: '123456789:AA...', value: channelDraft.telegram_bot_token ?? '', onChange: (event) => setChannelDraft({ ...channelDraft, telegram_bot_token: event.target.value }) }} />
                <TextField label="Chat ID / 用户名" required description="多个用逗号分隔" inputProps={{ placeholder: '-1001234567890 或 @channel', value: channelDraft.telegram_targets ?? '', onChange: (event) => setChannelDraft({ ...channelDraft, telegram_targets: event.target.value }) }} />
              </div>
            ) : null}
            {channelDraft.channel_type === 'dingtalk' ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <TextField label="Access Token" required inputProps={{ placeholder: 'xxxxxxxx', value: channelDraft.dingtalk_token ?? '', onChange: (event) => setChannelDraft({ ...channelDraft, dingtalk_token: event.target.value }) }} />
                <TextField label="加签 Secret" description="开启加签时填写" inputProps={{ placeholder: 'SECxxxx', value: channelDraft.dingtalk_secret ?? '', onChange: (event) => setChannelDraft({ ...channelDraft, dingtalk_secret: event.target.value }) }} />
                <TextField label="@手机号" description="可选，多个用逗号分隔" inputProps={{ placeholder: '13800138000', value: channelDraft.dingtalk_targets ?? '', onChange: (event) => setChannelDraft({ ...channelDraft, dingtalk_targets: event.target.value }) }} />
              </div>
            ) : null}
            {channelDraft.channel_type === 'custom' ? (
              <TextField label="Apprise URL" required inputProps={{ placeholder: 'apprise://...', value: channelDraft.apprise_url, onChange: (event) => setChannelDraft({ ...channelDraft, apprise_url: event.target.value }) }} />
            ) : null}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium leading-none">生成的 Apprise URL</span>
              <input readOnly value={channelUrl(channelDraft)} className={cn('w-full rounded-md border bg-muted px-2 py-1.5 font-mono text-xs', !channelUrl(channelDraft) && 'text-muted-foreground')} placeholder="填写完成后自动生成" />
            </div>
            <SwitchField label="启用该渠道" checked={channelDraft.enabled} onCheckedChange={(value) => setChannelDraft({ ...channelDraft, enabled: value })} />
          </div>
        ) : null}
      </AppModal>

      <AppModal
        open={groupOpen}
        onOpenChange={(open) => { setGroupOpen(open); if (!open) setGroupDraft(null); }}
        title={groupDraft && groups.some((item) => item.id === groupDraft.id) ? '编辑渠道分组' : '新增渠道分组'}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => { setGroupOpen(false); setGroupDraft(null); }}>取消</Button>
            <Button onClick={saveGroup}>保存分组</Button>
          </>
        }
      >
        {groupDraft ? (
          <div className="flex flex-col gap-4">
            <TextField label="分组名称" required inputProps={{ placeholder: '例如：运维组', value: groupDraft.name, onChange: (event) => setGroupDraft({ ...groupDraft, name: event.target.value }) }} />
            <MultiSelect label="成员渠道" options={channelOptions} value={groupDraft.channel_ids} onChange={(value) => setGroupDraft({ ...groupDraft, channel_ids: value })} placeholder="选择渠道" emptyText="先创建通知渠道" />
          </div>
        ) : null}
      </AppModal>

      <AppModal
        open={Boolean(ruleDraft)}
        onOpenChange={(open) => { if (!open) { setRuleDraft(null); setRuleTarget(null); } }}
        title="编辑告警规则"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => { setRuleDraft(null); setRuleTarget(null); }}>取消</Button>
            <Button onClick={saveRule}>保存规则</Button>
          </>
        }
      >
        {ruleDraft ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <TextField label="规则名称" required inputProps={{ placeholder: '例如：主力站余额预警', value: ruleDraft.name, onChange: (event) => setRuleDraft({ ...ruleDraft, name: event.target.value }) }} />
              <SwitchField label="启用规则" checked={ruleDraft.enabled} onCheckedChange={(value) => setRuleDraft({ ...ruleDraft, enabled: value })} />
              {ruleDraftBalance ? (
                <>
                  <SelectField label="严重级别" value={ruleDraftBalance.severity} onValueChange={(value) => setRuleDraft({ ...ruleDraftBalance, severity: value as BalanceNotificationRule['severity'] })} options={SEVERITY_OPTIONS} />
                  <NumberField label={ruleTarget?.kind === 'aggregate' ? '合计余额阈值' : '触发阈值'} value={ruleDraftBalance.threshold} onValueChange={(value) => setRuleDraft({ ...ruleDraftBalance, threshold: value })} min={0.01} />
                  <NumberField label="恢复阈值" description="留空为触发阈值 1.2 倍" value={ruleDraftBalance.resolve_threshold ?? undefined} onValueChange={(value) => setRuleDraft({ ...ruleDraftBalance, resolve_threshold: value })} min={0} />
                  <NumberField label="连续命中次数" value={ruleDraftBalance.min_consecutive_checks} onValueChange={(value) => setRuleDraft({ ...ruleDraftBalance, min_consecutive_checks: Math.max(1, Math.round(value)) })} min={1} max={100} />
                </>
              ) : null}
              {ruleDraftConnectivity ? (
                <>
                  <NumberField label="连续失败次数" value={ruleDraftConnectivity.consecutive_failures} onValueChange={(value) => setRuleDraft({ ...ruleDraftConnectivity, consecutive_failures: Math.max(1, Math.round(value)) })} min={1} max={100} />
                  <NumberField label="重复提醒间隔（分钟）" value={ruleDraftConnectivity.repeat_interval_minutes} onValueChange={(value) => setRuleDraft({ ...ruleDraftConnectivity, repeat_interval_minutes: Math.max(1, Math.round(value)) })} min={1} max={10080} />
                </>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <MultiSelect label="作用实例" description="留空表示全部实例" options={instanceOptions} value={(ruleDraft.instance_ids ?? []).map(String)} onChange={(value) => setRuleDraft({ ...ruleDraft, instance_ids: value.map(Number) })} placeholder="全部实例" />
              <MultiSelect label="作用标签" description="与实例条件同时生效" options={tagOptions} value={ruleDraft.tags ?? []} onChange={(value) => setRuleDraft({ ...ruleDraft, tags: value })} placeholder="不限标签" />
              <MultiSelect label="通知渠道" options={channelOptions} value={ruleDraft.channel_ids ?? []} onChange={(value) => setRuleDraft({ ...ruleDraft, channel_ids: value })} placeholder="默认通知渠道" />
              <MultiSelect label="渠道分组" options={groupOptions} value={ruleDraft.channel_group_ids ?? []} onChange={(value) => setRuleDraft({ ...ruleDraft, channel_group_ids: value })} placeholder="不选分组" />
              <SwitchField label="包含已停用实例" checked={ruleDraft.include_disabled} onCheckedChange={(value) => setRuleDraft({ ...ruleDraft, include_disabled: value })} />
              <SwitchField label="恢复时通知" checked={ruleDraft.notify_on_recovery} onCheckedChange={(value) => setRuleDraft({ ...ruleDraft, notify_on_recovery: value })} />
            </div>
          </div>
        ) : null}
      </AppModal>

      <AppModal open={guideOpen} onOpenChange={setGuideOpen} title="使用说明" size="md">
        <div className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p className="m-0">1. 在「通知渠道」创建至少一个渠道（企业微信机器人 / Bark / Telegram / 钉钉 / 自定义 Apprise URL）。</p>
          <p className="m-0">2. 需要一次通知多处时，在「渠道分组」把多个渠道打包，规则里勾选分组即可。</p>
          <p className="m-0">3. 在「告警规则」配置三类规则：实例余额、聚合余额、连接失败。作用实例/标签留空表示全部。</p>
          <p className="m-0">4. 每个实例还可单独控制是否推送倍率变更与上游公告（实例编辑 → 高级设置）。</p>
          <p className="m-0">5. 保存后由后台巡检按间隔执行；测试发送可在「全局设置」页签验证渠道连通性。</p>
          <p className="m-0">6. 所有推送均写入「日志记录 → 通知日志」，可排查投递失败原因。</p>
        </div>
      </AppModal>
    </div>
  );
}
