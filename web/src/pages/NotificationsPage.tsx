import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Bell,
  FileText,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Send,
  Smartphone,
  Trash2,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  createNotificationChannel,
  createNotificationChannelGroup,
  createNotificationContact,
  createNotificationContactGroup,
  createNotificationRule,
  createNotificationTemplate,
  deleteNotificationChannel,
  deleteNotificationChannelGroup,
  deleteNotificationContact,
  deleteNotificationContactGroup,
  deleteNotificationRule,
  deleteNotificationTemplate,
  dispatchNotificationEvent,
  fetchNotificationChannelGroups,
  fetchNotificationChannels,
  fetchNotificationContactGroups,
  fetchNotificationContacts,
  fetchNotificationDeliveries,
  fetchNotificationOverview,
  fetchNotificationRules,
  fetchNotificationTemplates,
  testNotification,
  updateNotificationChannel,
  updateNotificationChannelGroup,
  updateNotificationContact,
  updateNotificationContactGroup,
  updateNotificationRule,
  updateNotificationTemplate,
  type NotificationRulePayload,
  type NotificationTemplatePayload,
} from '../api/notifications';
import { getErrorMessage } from '../api/client';
import { fetchInstances } from '../api/instances';
import { fetchAppSettings, updateAppSettings } from '../api/settings';
import {
  AppModal,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmPopover,
  DataTable,
  EmptyState,
  Field,
  Input,
  MultiSelect,
  NumberField,
  PageHeader,
  SegmentedControl,
  SelectField,
  Skeleton,
  StatCard,
  StatusBadge,
  SwitchField,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextField,
} from '../components/ui';
import type { DataTableColumn } from '../components/ui';
import { notify } from '../lib/toast';
import { cn } from '../lib/utils';
import type {
  NotificationChannelItem,
  NotificationChannelPayload,
  NotificationChannelType,
  NotificationContactItem,
  NotificationDeliveryItem,
  NotificationEventType,
  NotificationRuleItem,
  NotificationSeverity,
  NotificationTemplateItem,
} from '../types/api';
import type { AppSettings } from '../types/api';
import { formatDateTime } from '../utils/format';

const CHANNEL_TYPES: Array<{ value: NotificationChannelType; label: string; description: string }> = [
  { value: 'apprise', label: 'Apprise', description: '企业微信、Bark、Telegram、钉钉及自定义 Apprise URL' },
  { value: 'smtp', label: 'SMTP 邮件', description: '通用 SMTP，支持 SSL / STARTTLS' },
  { value: 'aliyun_sms', label: '阿里云短信', description: '阿里云短信模板 + 签名，适合严重告警' },
  { value: 'aliyun_voice', label: '阿里云语音', description: '阿里云 TTS 语音通知，适合紧急升级' },
  { value: 'aliyun_directmail', label: '阿里云邮件推送', description: 'DirectMail 发信，适合域名已验证场景' },
  { value: 'webhook', label: 'Webhook', description: 'POST JSON 到任意自动化平台' },
];

const EVENT_META: Record<NotificationEventType, { label: string; description: string }> = {
  balance: { label: '实例余额不足', description: '单个实例余额低于阈值' },
  aggregate_balance: { label: '聚合余额不足', description: '选中实例余额合计低于阈值' },
  connectivity: { label: '连接失败', description: '实例连续同步失败达到次数' },
  instance_disabled: { label: '实例自动禁用', description: '连续失败后系统自动禁用实例' },
  instance_recovered: { label: '实例恢复', description: '自动禁用实例恢复同步' },
  rate_change: { label: '倍率变更', description: '上游分组倍率新增、删除或变动' },
  announcement: { label: '上游公告', description: '发现新的上游公告' },
  sync_failure: { label: '同步失败', description: '单次同步失败事件' },
  custom: { label: '自定义事件', description: '由外部系统通过 API 投递' },
  test: { label: '测试', description: '手动测试消息' },
};

const SEVERITY_OPTIONS: Array<{ value: NotificationSeverity; label: string }> = [
  { value: 'info', label: '提示' },
  { value: 'warning', label: '预警' },
  { value: 'critical', label: '严重' },
];

const QUIET_DEFAULT = { enabled: false, start: '22:00', end: '08:00', timezone: 'Asia/Shanghai', allow_critical: true };

function newRulePayload(eventType: NotificationEventType = 'balance'): NotificationRulePayload {
  return {
    name: EVENT_META[eventType].label,
    enabled: true,
    event_type: eventType,
    severity: eventType === 'balance' || eventType === 'aggregate_balance' ? 'warning' : 'critical',
    scope: { instance_ids: [], tags: [], include_disabled: false },
    condition: {
      threshold: eventType === 'balance' ? 50 : eventType === 'aggregate_balance' ? 100 : null,
      resolve_threshold: null,
      min_consecutive_checks: 1,
      consecutive_failures: 3,
      repeat_interval_minutes: 180,
      cooldown_minutes: 0,
      change_percent: null,
      max_per_day: null,
      quiet_hours: { ...QUIET_DEFAULT },
    },
    delivery: {
      channel_ids: [],
      channel_group_ids: [],
      contact_group_ids: [],
      template_id: null,
      notify_on_recovery: true,
    },
  };
}

interface RuleFormState {
  id?: string;
  payload: NotificationRulePayload;
}

interface ChannelFormState {
  id?: string;
  name: string;
  type: NotificationChannelType;
  enabled: boolean;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  secretFields: string[];
  recipientsText: string;
  paramMapText: string;
  headersText: string;
}

function emptyChannelForm(): ChannelFormState {
  return {
    name: '',
    type: 'apprise',
    enabled: true,
    config: {},
    secrets: {},
    secretFields: [],
    recipientsText: '',
    paramMapText: '',
    headersText: '',
  };
}

function channelFormFromItem(item: NotificationChannelItem): ChannelFormState {
  const config = { ...(item.config ?? {}) };
  const recipients = Array.isArray(config.recipients) ? (config.recipients as string[]) : [];
  const paramMap = (config.param_map ?? {}) as Record<string, string>;
  const headers = (config.headers ?? {}) as Record<string, string>;
  delete config.recipients;
  delete config.param_map;
  delete config.headers;
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    enabled: item.enabled,
    config,
    secrets: {},
    secretFields: item.secret_fields,
    recipientsText: recipients.join(', '),
    paramMapText: Object.entries(paramMap).map(([key, value]) => `${key}=${value}`).join('\n'),
    headersText: Object.keys(headers).length ? JSON.stringify(headers, null, 2) : '',
  };
}

function parseLines(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of value.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return result;
}

function parseRecipients(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function channelTypeLabel(type: string): string {
  return CHANNEL_TYPES.find((item) => item.value === type)?.label ?? type;
}

function eventLabel(eventType: string): string {
  return EVENT_META[eventType as NotificationEventType]?.label ?? eventType;
}

function severityTone(severity: string): 'success' | 'warning' | 'destructive' | 'muted' {
  if (severity === 'critical') return 'destructive';
  if (severity === 'warning') return 'warning';
  return 'muted';
}

function formatScope(rule: NotificationRuleItem, instanceName: (id: number) => string): string {
  if (rule.scope.instance_ids.length) {
    return `${rule.scope.instance_ids.length} 个实例：${rule.scope.instance_ids.slice(0, 3).map(instanceName).join('、')}${rule.scope.instance_ids.length > 3 ? '…' : ''}`;
  }
  if (rule.scope.tags.length) return `标签：${rule.scope.tags.join(' / ')}`;
  return '全部实例';
}

function formatCondition(rule: NotificationRuleItem): string {
  if (rule.event_type === 'balance' || rule.event_type === 'aggregate_balance') {
    return `阈值 ${rule.condition.threshold ?? '-'}${rule.condition.resolve_threshold != null ? ` · 恢复 ${rule.condition.resolve_threshold}` : ''} · 连续 ${rule.condition.min_consecutive_checks} 次`;
  }
  if (rule.event_type === 'connectivity') {
    return `连续失败 ${rule.condition.consecutive_failures} 次 · 重复 ${rule.condition.repeat_interval_minutes} 分钟`;
  }
  return `${EVENT_META[rule.event_type]?.description ?? '自定义事件'}`;
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('overview');
  const [ruleForm, setRuleForm] = useState<RuleFormState | null>(null);
  const [channelForm, setChannelForm] = useState<ChannelFormState | null>(null);
  const [channelGroupForm, setChannelGroupForm] = useState<{ id?: string; name: string; channel_ids: string[] } | null>(null);
  const [contactForm, setContactForm] = useState<{ id?: string; name: string; type: 'email' | 'phone' | 'chat'; value: string; enabled: boolean; labelsText: string } | null>(null);
  const [contactGroupForm, setContactGroupForm] = useState<{ id?: string; name: string; contact_ids: string[] } | null>(null);
  const [templateForm, setTemplateForm] = useState<{ id?: string; payload: NotificationTemplatePayload; paramMapText: string } | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testForm, setTestForm] = useState({ channel_ids: [] as string[], channel_group_ids: [] as string[], contact_group_ids: [] as string[], template_id: '__none__', title: '', body: '' });
  const [eventOpen, setEventOpen] = useState(false);
  const [eventForm, setEventForm] = useState({ event_type: 'custom', severity: 'warning' as NotificationSeverity, title: '', body: '', instance_id: '__none__', dedupe_key: '', fieldsText: '' });
  const [globalForm, setGlobalForm] = useState<Pick<AppSettings, 'notification_enabled' | 'notification_check_interval_minutes' | 'default_balance_alert_threshold' | 'default_notification_channel_id' | 'rate_change_notify_enabled' | 'rate_change_min_percent' | 'rate_change_cooldown_minutes' | 'announcement_sync_enabled' | 'announcement_notify_enabled'>>({
    notification_enabled: false,
    notification_check_interval_minutes: 5,
    default_balance_alert_threshold: 50,
    default_notification_channel_id: null,
    rate_change_notify_enabled: false,
    rate_change_min_percent: 0,
    rate_change_cooldown_minutes: 60,
    announcement_sync_enabled: true,
    announcement_notify_enabled: false,
  });

  const overviewQuery = useQuery({ queryKey: ['notification-center', 'overview'], queryFn: fetchNotificationOverview, staleTime: 30_000 });
  const channelsQuery = useQuery({ queryKey: ['notification-center', 'channels'], queryFn: fetchNotificationChannels });
  const channelGroupsQuery = useQuery({ queryKey: ['notification-center', 'channel-groups'], queryFn: fetchNotificationChannelGroups });
  const contactsQuery = useQuery({ queryKey: ['notification-center', 'contacts'], queryFn: fetchNotificationContacts });
  const contactGroupsQuery = useQuery({ queryKey: ['notification-center', 'contact-groups'], queryFn: fetchNotificationContactGroups });
  const templatesQuery = useQuery({ queryKey: ['notification-center', 'templates'], queryFn: fetchNotificationTemplates });
  const rulesQuery = useQuery({ queryKey: ['notification-center', 'rules'], queryFn: fetchNotificationRules });
  const settingsQuery = useQuery({ queryKey: ['app-settings'], queryFn: fetchAppSettings });
  const instancesQuery = useQuery({ queryKey: ['instances'], queryFn: () => fetchInstances() });
  const deliveriesQuery = useQuery({ queryKey: ['notification-center', 'deliveries'], queryFn: () => fetchNotificationDeliveries({ limit: 100 }) });

  const channels = channelsQuery.data ?? [];
  const channelGroups = channelGroupsQuery.data ?? [];
  const contacts = contactsQuery.data ?? [];
  const contactGroups = contactGroupsQuery.data ?? [];
  const templates = templatesQuery.data ?? [];
  const rules = rulesQuery.data ?? [];
  const instances = instancesQuery.data?.items ?? [];
  const overview = overviewQuery.data;

  const instanceName = useMemo(() => {
    const map = new Map(instances.map((item) => [item.id, item.name]));
    return (id: number) => map.get(id) ?? `#${id}`;
  }, [instances]);

  const channelOptions = useMemo(() => channels.map((item) => ({ label: `${item.name} · ${channelTypeLabel(item.type)}`, value: item.id })), [channels]);
  const channelGroupOptions = useMemo(() => channelGroups.map((item) => ({ label: `${item.name}（${item.channel_ids.length} 个渠道）`, value: item.id })), [channelGroups]);
  const contactGroupOptions = useMemo(() => contactGroups.map((item) => ({ label: `${item.name}（${item.contact_ids.length} 人）`, value: item.id })), [contactGroups]);
  const templateOptions = useMemo(() => templates.map((item) => ({ label: item.name, value: item.id })), [templates]);
  const instanceOptions = useMemo(() => instances.map((item) => ({ label: item.name, value: String(item.id) })), [instances]);
  const tagOptions = useMemo(() => Array.from(new Set(instances.flatMap((item) => item.tags))).sort().map((tag) => ({ label: tag, value: tag })), [instances]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['notification-center'] });
    await queryClient.invalidateQueries({ queryKey: ['app-settings'] });
  };

  const run = (mutation: { mutate: (value: never) => void }, value: never) => mutation.mutate(value);

  const channelMutation = useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: NotificationChannelPayload }) => (id ? updateNotificationChannel(id, payload) : createNotificationChannel(payload)),
    onSuccess: async () => { setChannelForm(null); await invalidate(); notify.success('通知渠道已保存'); },
    onError: (error) => notify.error(getErrorMessage(error)),
  });
  const channelGroupMutation = useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: { name: string; channel_ids: string[] } }) => (id ? updateNotificationChannelGroup(id, payload) : createNotificationChannelGroup(payload)),
    onSuccess: async () => { setChannelGroupForm(null); await invalidate(); notify.success('渠道分组已保存'); },
    onError: (error) => notify.error(getErrorMessage(error)),
  });
  const contactMutation = useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: Omit<NotificationContactItem, 'id' | 'created_at' | 'updated_at'> }) => (id ? updateNotificationContact(id, payload) : createNotificationContact(payload)),
    onSuccess: async () => { setContactForm(null); await invalidate(); notify.success('联系人已保存'); },
    onError: (error) => notify.error(getErrorMessage(error)),
  });
  const contactGroupMutation = useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: { name: string; contact_ids: string[] } }) => (id ? updateNotificationContactGroup(id, payload) : createNotificationContactGroup(payload)),
    onSuccess: async () => { setContactGroupForm(null); await invalidate(); notify.success('联系人分组已保存'); },
    onError: (error) => notify.error(getErrorMessage(error)),
  });
  const templateMutation = useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: NotificationTemplatePayload }) => (id ? updateNotificationTemplate(id, payload) : createNotificationTemplate(payload)),
    onSuccess: async () => { setTemplateForm(null); await invalidate(); notify.success('通知模板已保存'); },
    onError: (error) => notify.error(getErrorMessage(error)),
  });
  const ruleMutation = useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: NotificationRulePayload }) => (id ? updateNotificationRule(id, payload) : createNotificationRule(payload)),
    onSuccess: async () => { setRuleForm(null); await invalidate(); notify.success('告警规则已保存'); },
    onError: (error) => notify.error(getErrorMessage(error)),
  });
  const testMutation = useMutation({
    mutationFn: () => testNotification({
      channel_ids: testForm.channel_ids,
      channel_group_ids: testForm.channel_group_ids,
      contact_group_ids: testForm.contact_group_ids,
      template_id: testForm.template_id === '__none__' ? null : testForm.template_id,
      title: testForm.title.trim() || undefined,
      body: testForm.body.trim() || undefined,
      context: { source: '通知中心测试' },
    }),
    onSuccess: (result) => {
      if (result.failed_count) {
        const failed = result.items.filter((item) => !item.success).map((item) => `${item.channel_name}：${item.error_message ?? '失败'}`).join('；');
        notify.warning(`测试完成，成功 ${result.success_count}，失败 ${result.failed_count}。${failed}`);
      } else {
        notify.success(`测试发送成功，共 ${result.success_count} 个渠道`);
      }
      void invalidate();
    },
    onError: (error) => notify.error(getErrorMessage(error)),
  });
  const eventMutation = useMutation({
    mutationFn: () => {
      let fields: Record<string, unknown> = {};
      if (eventForm.fieldsText.trim()) {
        try {
          fields = JSON.parse(eventForm.fieldsText) as Record<string, unknown>;
        } catch {
          throw new Error('自定义字段必须是合法 JSON');
        }
      }
      return dispatchNotificationEvent({
        event_type: eventForm.event_type.trim() || 'custom',
        severity: eventForm.severity,
        title: eventForm.title.trim(),
        body: eventForm.body.trim() || undefined,
        instance_id: eventForm.instance_id === '__none__' ? null : Number(eventForm.instance_id),
        dedupe_key: eventForm.dedupe_key.trim() || null,
        fields,
      });
    },
    onSuccess: async (result) => {
      if (result.total === 0) notify.warning('事件已接收，但没有匹配到启用的规则或渠道');
      else notify.success(`事件已投递到 ${result.total} 个渠道，成功 ${result.success_count} 个`);
      setEventOpen(false);
      await invalidate();
    },
    onError: (error) => notify.error(getErrorMessage(error)),
  });
  const settingsMutation = useMutation({
    mutationFn: (values: typeof globalForm) => {
      if (!settingsQuery.data) throw new Error('设置尚未加载');
      return updateAppSettings({ ...settingsQuery.data, ...values });
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(['app-settings'], result);
      await invalidate();
      notify.success('全局告警设置已保存');
    },
    onError: (error) => notify.error(getErrorMessage(error)),
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    setGlobalForm({
      notification_enabled: settingsQuery.data.notification_enabled,
      notification_check_interval_minutes: settingsQuery.data.notification_check_interval_minutes,
      default_balance_alert_threshold: settingsQuery.data.default_balance_alert_threshold,
      default_notification_channel_id: settingsQuery.data.default_notification_channel_id ?? null,
      rate_change_notify_enabled: settingsQuery.data.rate_change_notify_enabled,
      rate_change_min_percent: settingsQuery.data.rate_change_min_percent,
      rate_change_cooldown_minutes: settingsQuery.data.rate_change_cooldown_minutes,
      announcement_sync_enabled: settingsQuery.data.announcement_sync_enabled,
      announcement_notify_enabled: settingsQuery.data.announcement_notify_enabled,
    });
  }, [settingsQuery.data]);

  const saveChannel = () => {
    if (!channelForm) return;
    if (!channelForm.name.trim()) { notify.warning('请填写渠道名称'); return; }
    const config: Record<string, unknown> = { ...channelForm.config };
    const recipients = parseRecipients(channelForm.recipientsText);
    if (recipients.length) config.recipients = recipients;
    else delete config.recipients;
    if (channelForm.type === 'aliyun_sms' || channelForm.type === 'aliyun_voice') {
      const paramMap = parseLines(channelForm.paramMapText);
      if (Object.keys(paramMap).length) config.param_map = paramMap;
      else delete config.param_map;
    }
    if (channelForm.type === 'webhook' && channelForm.headersText.trim()) {
      try {
        config.headers = JSON.parse(channelForm.headersText);
      } catch {
        notify.warning('Webhook 请求头必须是合法 JSON');
        return;
      }
    } else {
      delete config.headers;
    }
    const secrets: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(channelForm.secrets)) {
      if (String(value).trim()) secrets[key] = value;
    }
    channelMutation.mutate({
      id: channelForm.id,
      payload: { name: channelForm.name.trim(), type: channelForm.type, enabled: channelForm.enabled, config, secrets },
    });
  };

  const saveRule = () => {
    if (!ruleForm) return;
    const payload = ruleForm.payload;
    if (!payload.name.trim()) { notify.warning('请填写规则名称'); return; }
    if ((payload.event_type === 'balance' || payload.event_type === 'aggregate_balance') && !payload.condition.threshold) {
      notify.warning('请填写余额阈值');
      return;
    }
    if (payload.event_type === 'aggregate_balance' && !payload.scope.instance_ids.length && !payload.scope.tags.length) {
      notify.warning('聚合余额规则至少需要选择一个实例或标签');
      return;
    }
    if (!payload.delivery.channel_ids.length && !payload.delivery.channel_group_ids.length) {
      notify.warning('请至少选择一个通知渠道或渠道分组');
      return;
    }
    ruleMutation.mutate({ id: ruleForm.id, payload });
  };

  const patchRule = (updater: (payload: NotificationRulePayload) => NotificationRulePayload) => {
    setRuleForm((current) => (current ? { ...current, payload: updater(current.payload) } : current));
  };

  const setChannelField = (key: string, value: unknown) => {
    setChannelForm((current) => (current ? { ...current, config: { ...current.config, [key]: value } } : current));
  };

  const setChannelSecret = (key: string, value: string) => {
    setChannelForm((current) => (current ? { ...current, secrets: { ...current.secrets, [key]: value } } : current));
  };

  const channelFormField = (key: string) => String(channelForm?.config[key] ?? '');

  const ruleCards = (eventType: NotificationEventType) => {
    const list = rules.filter((rule) => rule.event_type === eventType);
    if (!list.length) {
      return <EmptyState title="暂无规则" description={`还没有配置「${EVENT_META[eventType].label}」规则。`} action={<Button size="sm" variant="outline" onClick={() => setRuleForm({ payload: newRulePayload(eventType) })}><Plus className="size-4" />新建规则</Button>} />;
    }
    return (
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {list.map((rule) => (
          <Card key={rule.id} className="gap-3 py-3">
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-sm">{rule.name}</CardTitle>
                  <StatusBadge tone={severityTone(rule.severity)}>{rule.severity === 'critical' ? '严重' : rule.severity === 'warning' ? '预警' : '提示'}</StatusBadge>
                  <StatusBadge status={rule.enabled ? 'enabled' : 'disabled'} />
                </div>
                <CardDescription className="text-xs">{formatScope(rule, instanceName)} · {formatCondition(rule)}</CardDescription>
              </div>
              <div className="flex items-center gap-0.5">
                <SwitchField checked={rule.enabled} ariaLabel="启用规则" onCheckedChange={(value) => ruleMutation.mutate({ id: rule.id, payload: { ...rule, enabled: value } })} />
                <Button variant="ghost" size="icon-sm" aria-label="编辑规则" onClick={() => setRuleForm({ id: rule.id, payload: { ...rule } })}><Pencil className="size-4" /></Button>
                <ConfirmPopover title={`删除规则「${rule.name}」？`} confirmText="删除" onConfirm={() => deleteNotificationRule(rule.id).then(invalidate)}>
                  <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label="删除规则"><Trash2 className="size-4" /></Button>
                </ConfirmPopover>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>渠道 {rule.delivery.channel_ids.length || rule.delivery.channel_group_ids.length || '-'}</span>
              <span>联系人组 {rule.delivery.contact_group_ids.length || '-'}</span>
              {rule.delivery.template_id ? <span>模板 {templates.find((item) => item.id === rule.delivery.template_id)?.name ?? rule.delivery.template_id}</span> : null}
              {rule.condition.quiet_hours.enabled ? <span>静默 {rule.condition.quiet_hours.start}–{rule.condition.quiet_hours.end}</span> : null}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  const deliveryColumns: DataTableColumn<NotificationDeliveryItem>[] = [
    { id: 'created_at', header: '时间', width: 170, cell: (row) => <span className="tabular text-muted-foreground">{formatDateTime(row.created_at)}</span> },
    { id: 'instance', header: '实例', width: 130, cell: (row) => row.instance_name ?? '-' },
    { id: 'event', header: '事件', width: 130, cell: (row) => eventLabel(row.event_type) },
    { id: 'status', header: '投递', width: 96, cell: (row) => <StatusBadge status={row.delivery_status} /> },
    { id: 'title', header: '标题', width: 240, cell: (row) => <span className="line-clamp-2">{row.title}</span> },
    { id: 'channels', header: '渠道', width: 220, cell: (row) => <span className="flex flex-wrap gap-1">{(row.channels ?? []).map((item) => <StatusBadge key={`${item.channel_id}-${item.channel_name}`} tone={item.success ? 'success' : 'destructive'}>{item.channel_name}</StatusBadge>)}</span> },
    { id: 'error', header: '错误', cell: (row) => row.error_message ? <span className="text-xs text-destructive">{row.error_message}</span> : '-' },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="告警中心"
        subtitle="统一管理规则、渠道、联系人、模板和投递记录。严重告警可走短信与语音。"
        extra={
          <>
            <Button variant="outline" onClick={() => setEventOpen(true)}><Activity className="size-4" />投递事件</Button>
            <Button variant="outline" onClick={() => setTestOpen(true)}><Send className="size-4" />测试发送</Button>
            <Button variant="outline" isPending={overviewQuery.isFetching} onClick={() => void invalidate()}><RefreshCw className="size-4" />刷新</Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="rules">规则</TabsTrigger>
          <TabsTrigger value="channels">渠道</TabsTrigger>
          <TabsTrigger value="contacts">联系人</TabsTrigger>
          <TabsTrigger value="templates">模板</TabsTrigger>
          <TabsTrigger value="global">全局</TabsTrigger>
          <TabsTrigger value="deliveries">投递记录</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="当前告警" value={overview?.active_alerts ?? 0} icon={<AlertTriangle className="size-4" />} />
              <StatCard label="启用规则" value={overview?.enabled_rules ?? 0} icon={<Bell className="size-4" />} />
              <StatCard label="启用渠道" value={overview?.enabled_channels ?? 0} icon={<Send className="size-4" />} />
              <StatCard label="24h 投递" value={`${overview?.success_24h ?? 0} / ${overview?.failed_24h ?? 0}`} caption="成功 / 失败" icon={<Activity className="size-4" />} />
            </div>
            <Card>
              <CardHeader>
                <CardTitle>巡检与渠道健康</CardTitle>
                <CardDescription>
                  最近巡检 {overview?.last_scan_at ? formatDateTime(overview.last_scan_at) : '尚未执行'} · 下次巡检 {overview?.next_scan_at ? formatDateTime(overview.next_scan_at) : '-'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col divide-y rounded-lg border">
                {(overview?.channels ?? []).length ? overview?.channels.map((channel) => (
                  <div key={channel.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <StatusBadge tone={channel.last_status ? (channel.last_status === 'success' ? 'success' : 'destructive') : 'muted'}>
                      {channel.last_status === 'success' ? '正常' : channel.last_status === 'failed' ? '异常' : '未发送'}
                    </StatusBadge>
                    <strong className="min-w-0 flex-1 truncate text-sm">{channel.name}</strong>
                    <span className="text-xs text-muted-foreground">{channelTypeLabel(channel.type)}</span>
                    <span className="text-xs text-muted-foreground">{channel.last_sent_at ? formatDateTime(channel.last_sent_at) : '从未发送'}</span>
                    {channel.last_error ? <span className="w-full text-xs text-destructive">{channel.last_error}</span> : null}
                  </div>
                )) : <EmptyState title="暂无渠道" description="先创建 Apprise、SMTP 或阿里云渠道。" action={<Button size="sm" onClick={() => setChannelForm(emptyChannelForm())}><Plus className="size-4" />新增渠道</Button>} />}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="rules">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setRuleForm({ payload: newRulePayload('balance') })}><Plus className="size-4" />余额规则</Button>
              <Button size="sm" variant="outline" onClick={() => setRuleForm({ payload: newRulePayload('connectivity') })}><Plus className="size-4" />连接失败规则</Button>
              <Button size="sm" variant="outline" onClick={() => setRuleForm({ payload: newRulePayload('custom') })}><Plus className="size-4" />自定义事件规则</Button>
              <span className="text-xs text-muted-foreground">规则按事件类型分组；作用域、条件、静默、渠道和模板都可独立配置。</span>
            </div>
            {(['balance', 'aggregate_balance', 'connectivity', 'custom'] as NotificationEventType[]).map((eventType) => (
              <section key={eventType} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="m-0 text-sm font-semibold">{EVENT_META[eventType].label}</h3>
                  <span className="text-xs text-muted-foreground">{EVENT_META[eventType].description}</span>
                </div>
                {ruleCards(eventType)}
              </section>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="channels">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-sm text-muted-foreground">渠道负责“怎么发”；联系人负责“发给谁”。密钥只写入不返回。</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setChannelGroupForm({ name: '', channel_ids: [] })}><Users className="size-4" />新建渠道分组</Button>
                <Button size="sm" onClick={() => setChannelForm(emptyChannelForm())}><Plus className="size-4" />新增渠道</Button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {channels.length ? channels.map((channel) => (
                <Card key={channel.id} className="gap-3 py-3">
                  <CardHeader className="flex-row items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-sm">{channel.name}</CardTitle>
                        <StatusBadge tone="secondary">{channelTypeLabel(channel.type)}</StatusBadge>
                        <StatusBadge status={channel.enabled ? 'enabled' : 'disabled'} />
                      </div>
                      <CardDescription className="text-xs">
                        {channel.type === 'aliyun_sms' ? `签名 ${String(channel.config.sign_name ?? '-')} · 模板 ${String(channel.config.template_code ?? '-')}` : null}
                        {channel.type === 'smtp' ? `${String(channel.config.host ?? '-')} · ${String(channel.config.from_address ?? '-')}` : null}
                        {channel.type === 'aliyun_voice' ? `TTS ${String(channel.config.tts_code ?? '-')}` : null}
                        {channel.type === 'webhook' ? String(channel.config.url ?? '已配置') : null}
                        {channel.type === 'apprise' ? 'Apprise 目标已加密保存' : null}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <SwitchField checked={channel.enabled} ariaLabel="启用渠道" onCheckedChange={(value) => channelMutation.mutate({ id: channel.id, payload: { name: channel.name, type: channel.type, enabled: value, config: channel.config, secrets: {} } })} />
                      <Button variant="ghost" size="icon-sm" aria-label="编辑渠道" onClick={() => setChannelForm(channelFormFromItem(channel))}><Pencil className="size-4" /></Button>
                      <ConfirmPopover title={`删除渠道「${channel.name}」？`} confirmText="删除" onConfirm={() => deleteNotificationChannel(channel.id).then(invalidate)}>
                        <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label="删除渠道"><Trash2 className="size-4" /></Button>
                      </ConfirmPopover>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                    {channel.has_secrets ? <StatusBadge tone="muted">已配置密钥：{channel.secret_fields.join('、')}</StatusBadge> : <StatusBadge tone="warning">未配置密钥</StatusBadge>}
                  </CardContent>
                </Card>
              )) : <EmptyState title="暂无通知渠道" description="先添加 Apprise、SMTP、阿里云短信/语音或 Webhook。" action={<Button size="sm" onClick={() => setChannelForm(emptyChannelForm())}><Plus className="size-4" />新增渠道</Button>} />}
            </div>
            <Card>
              <CardHeader><CardTitle className="text-sm">渠道分组</CardTitle><CardDescription>把多个渠道打包，规则可一键投递。</CardDescription></CardHeader>
              <CardContent className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {channelGroups.length ? channelGroups.map((group) => (
                  <div key={group.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    <strong className="min-w-0 flex-1 truncate text-sm">{group.name}</strong>
                    <span className="text-xs text-muted-foreground">{group.channel_ids.length} 个渠道</span>
                    <Button variant="ghost" size="icon-sm" aria-label="编辑渠道分组" onClick={() => setChannelGroupForm({ id: group.id, name: group.name, channel_ids: group.channel_ids })}><Pencil className="size-4" /></Button>
                    <ConfirmPopover title={`删除分组「${group.name}」？`} confirmText="删除" onConfirm={() => deleteNotificationChannelGroup(group.id).then(invalidate)}>
                      <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label="删除渠道分组"><Trash2 className="size-4" /></Button>
                    </ConfirmPopover>
                  </div>
                )) : <p className="m-0 text-sm text-muted-foreground">暂无渠道分组。</p>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="contacts">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-sm text-muted-foreground">联系人可被短信、语音、邮件渠道引用，也可组成值班组。</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setContactGroupForm({ name: '', contact_ids: [] })}><Users className="size-4" />新建联系人组</Button>
                <Button size="sm" onClick={() => setContactForm({ name: '', type: 'email', value: '', enabled: true, labelsText: '' })}><Plus className="size-4" />新增联系人</Button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {contacts.length ? contacts.map((contact) => (
                <div key={contact.id} className="flex items-center gap-2 rounded-lg border px-3 py-2.5">
                  {contact.type === 'email' ? <Mail className="size-4 text-muted-foreground" /> : contact.type === 'phone' ? <Smartphone className="size-4 text-muted-foreground" /> : <MessageSquare className="size-4 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><strong className="truncate text-sm">{contact.name}</strong><StatusBadge status={contact.enabled ? 'enabled' : 'disabled'} /></div>
                    <div className="truncate text-xs text-muted-foreground">{contact.value}{contact.labels.length ? ` · ${contact.labels.join('/')}` : ''}</div>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label="编辑联系人" onClick={() => setContactForm({ id: contact.id, name: contact.name, type: contact.type, value: contact.value, enabled: contact.enabled, labelsText: contact.labels.join(', ') })}><Pencil className="size-4" /></Button>
                  <ConfirmPopover title={`删除联系人「${contact.name}」？`} confirmText="删除" onConfirm={() => deleteNotificationContact(contact.id).then(invalidate)}>
                    <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label="删除联系人"><Trash2 className="size-4" /></Button>
                  </ConfirmPopover>
                </div>
              )) : <EmptyState title="暂无联系人" description="添加邮箱或手机号，供短信、语音和邮件使用。" />}
            </div>
            <Card>
              <CardHeader><CardTitle className="text-sm">联系人分组</CardTitle><CardDescription>规则可选择一个或多个联系人组。</CardDescription></CardHeader>
              <CardContent className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {contactGroups.length ? contactGroups.map((group) => (
                  <div key={group.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    <strong className="min-w-0 flex-1 truncate text-sm">{group.name}</strong>
                    <span className="text-xs text-muted-foreground">{group.contact_ids.length} 人</span>
                    <Button variant="ghost" size="icon-sm" aria-label="编辑联系人组" onClick={() => setContactGroupForm({ id: group.id, name: group.name, contact_ids: group.contact_ids })}><Pencil className="size-4" /></Button>
                    <ConfirmPopover title={`删除联系人组「${group.name}」？`} confirmText="删除" onConfirm={() => deleteNotificationContactGroup(group.id).then(invalidate)}>
                      <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label="删除联系人组"><Trash2 className="size-4" /></Button>
                    </ConfirmPopover>
                  </div>
                )) : <p className="m-0 text-sm text-muted-foreground">暂无联系人分组。</p>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="templates">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 text-sm text-muted-foreground">模板支持变量替换，短信/语音还需要服务商模板 Code。</p>
              <Button size="sm" onClick={() => setTemplateForm({ payload: { name: '', channel_type: 'generic', subject_template: '', body_template: '', provider_template_code: '', param_map: {} }, paramMapText: '' })}><Plus className="size-4" />新增模板</Button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {templates.length ? templates.map((template) => (
                <Card key={template.id} className="gap-2 py-3">
                  <CardHeader className="flex-row items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-sm">{template.name}</CardTitle>
                      <CardDescription className="text-xs">{template.channel_type}{template.provider_template_code ? ` · ${template.provider_template_code}` : ''}</CardDescription>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <Button variant="ghost" size="icon-sm" aria-label="编辑模板" onClick={() => setTemplateForm({ id: template.id, payload: { name: template.name, channel_type: template.channel_type, subject_template: template.subject_template, body_template: template.body_template, provider_template_code: template.provider_template_code, param_map: template.param_map }, paramMapText: Object.entries(template.param_map).map(([key, value]) => `${key}=${value}`).join('\n') })}><Pencil className="size-4" /></Button>
                      <ConfirmPopover title={`删除模板「${template.name}」？`} confirmText="删除" onConfirm={() => deleteNotificationTemplate(template.id).then(invalidate)}>
                        <Button variant="ghost" size="icon-sm" className="text-destructive" aria-label="删除模板"><Trash2 className="size-4" /></Button>
                      </ConfirmPopover>
                    </div>
                  </CardHeader>
                  <CardContent><pre className="m-0 line-clamp-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">{template.body_template}</pre></CardContent>
                </Card>
              )) : <EmptyState title="暂无模板" description="可以先用系统默认标题和正文。" />}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="global">
          <Card>
            <CardHeader>
              <CardTitle>全局告警设置</CardTitle>
              <CardDescription>控制高级巡检、默认阈值与倍率/公告推送行为。</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <SwitchField label="启用高级通知巡检" description="余额、聚合与连接失败规则按间隔执行" checked={globalForm.notification_enabled} onCheckedChange={(value) => setGlobalForm({ ...globalForm, notification_enabled: value })} />
              <NumberField label="巡检间隔（分钟）" value={globalForm.notification_check_interval_minutes} onValueChange={(value) => setGlobalForm({ ...globalForm, notification_check_interval_minutes: Math.max(1, Math.round(value)) })} min={1} max={1440} />
              <NumberField label="快捷余额默认阈值" description="实例未单独填写时使用" value={globalForm.default_balance_alert_threshold} onValueChange={(value) => setGlobalForm({ ...globalForm, default_balance_alert_threshold: value })} min={0.01} />
              <SelectField label="默认通知渠道" value={globalForm.default_notification_channel_id ?? '__none__'} onValueChange={(value) => setGlobalForm({ ...globalForm, default_notification_channel_id: value === '__none__' ? null : value })} options={[{ value: '__none__', label: '自动（第一个启用渠道）' }, ...channelOptions]} />
              <SwitchField label="倍率变更通知" description="检测到分组倍率变化时合并推送" checked={globalForm.rate_change_notify_enabled} onCheckedChange={(value) => setGlobalForm({ ...globalForm, rate_change_notify_enabled: value })} />
              <NumberField label="倍率变动最小百分比" description="低于该百分比不记录不通知" value={globalForm.rate_change_min_percent} onValueChange={(value) => setGlobalForm({ ...globalForm, rate_change_min_percent: value })} min={0} max={1000} step={0.1} />
              <NumberField label="倍率变更冷却（分钟）" value={globalForm.rate_change_cooldown_minutes} onValueChange={(value) => setGlobalForm({ ...globalForm, rate_change_cooldown_minutes: Math.max(0, Math.round(value)) })} min={0} max={10080} />
              <SwitchField label="上游公告同步" description="同步时抓取公告；首次只建基线" checked={globalForm.announcement_sync_enabled} onCheckedChange={(value) => setGlobalForm({ ...globalForm, announcement_sync_enabled: value })} />
              <SwitchField label="新公告推送" description="发现新公告时推送到默认渠道" checked={globalForm.announcement_notify_enabled} onCheckedChange={(value) => setGlobalForm({ ...globalForm, announcement_notify_enabled: value })} />
              <div className="flex items-end">
                <Button isPending={settingsMutation.isPending} onClick={() => settingsMutation.mutate(globalForm)}>保存全局设置</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deliveries">
          {deliveriesQuery.isLoading ? <Skeleton className="h-64 w-full" /> : (
            <DataTable
              rows={deliveriesQuery.data?.items ?? []}
              columns={deliveryColumns}
              rowKey={(row) => row.id}
              loading={deliveriesQuery.isLoading}
              dense
              ariaLabel="通知投递记录"
              emptyText="暂无投递记录"
              minWidth={1200}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Rule editor */}
      <AppModal
        open={Boolean(ruleForm)}
        onOpenChange={(open) => { if (!open) setRuleForm(null); }}
        title={ruleForm?.id ? '编辑告警规则' : '新建告警规则'}
        description="先选择事件，再配置作用域、条件、静默时段和投递目标。"
        size="lg"
        footer={<><Button variant="outline" onClick={() => setRuleForm(null)}>取消</Button><Button isPending={ruleMutation.isPending} onClick={saveRule}>保存规则</Button></>}
      >
        {ruleForm ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <TextField label="规则名称" required inputProps={{ value: ruleForm.payload.name, onChange: (event) => patchRule((payload) => ({ ...payload, name: event.target.value })) }} />
              <SelectField label="事件类型" value={ruleForm.payload.event_type} onValueChange={(value) => patchRule((payload) => ({ ...newRulePayload(value as NotificationEventType), name: payload.name, delivery: payload.delivery }))} options={Object.entries(EVENT_META).filter(([value]) => value !== 'test').map(([value, meta]) => ({ value, label: meta.label }))} />
              <SelectField label="严重级别" value={ruleForm.payload.severity} onValueChange={(value) => patchRule((payload) => ({ ...payload, severity: value as NotificationSeverity }))} options={SEVERITY_OPTIONS} />
              <SwitchField label="启用规则" checked={ruleForm.payload.enabled} onCheckedChange={(value) => patchRule((payload) => ({ ...payload, enabled: value }))} />
              <MultiSelect label="作用实例" description="留空表示全部实例" options={instanceOptions} value={ruleForm.payload.scope.instance_ids.map(String)} onChange={(value) => patchRule((payload) => ({ ...payload, scope: { ...payload.scope, instance_ids: value.map(Number) } }))} placeholder="全部实例" />
              <MultiSelect label="作用标签" description="与实例条件同时生效" options={tagOptions} value={ruleForm.payload.scope.tags} onChange={(value) => patchRule((payload) => ({ ...payload, scope: { ...payload.scope, tags: value } }))} placeholder="不限标签" />
            </div>
            {ruleForm.payload.event_type === 'balance' || ruleForm.payload.event_type === 'aggregate_balance' ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <NumberField label="触发阈值" required value={ruleForm.payload.condition.threshold ?? 0} onValueChange={(value) => patchRule((payload) => ({ ...payload, condition: { ...payload.condition, threshold: value } }))} min={0.01} />
                <NumberField label="恢复阈值" description="留空按 1.2 倍计算" value={ruleForm.payload.condition.resolve_threshold ?? undefined} onValueChange={(value) => patchRule((payload) => ({ ...payload, condition: { ...payload.condition, resolve_threshold: value || null } }))} min={0} />
                <NumberField label="连续命中次数" value={ruleForm.payload.condition.min_consecutive_checks} onValueChange={(value) => patchRule((payload) => ({ ...payload, condition: { ...payload.condition, min_consecutive_checks: Math.max(1, Math.round(value)) } }))} min={1} max={100} />
              </div>
            ) : null}
            {ruleForm.payload.event_type === 'connectivity' ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <NumberField label="连续失败次数" value={ruleForm.payload.condition.consecutive_failures} onValueChange={(value) => patchRule((payload) => ({ ...payload, condition: { ...payload.condition, consecutive_failures: Math.max(1, Math.round(value)) } }))} min={1} max={100} />
                <NumberField label="重复提醒间隔（分钟）" value={ruleForm.payload.condition.repeat_interval_minutes} onValueChange={(value) => patchRule((payload) => ({ ...payload, condition: { ...payload.condition, repeat_interval_minutes: Math.max(0, Math.round(value)) } }))} min={0} max={10080} />
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <MultiSelect label="通知渠道" options={channelOptions} value={ruleForm.payload.delivery.channel_ids} onChange={(value) => patchRule((payload) => ({ ...payload, delivery: { ...payload.delivery, channel_ids: value } }))} placeholder="选择渠道" />
              <MultiSelect label="渠道分组" options={channelGroupOptions} value={ruleForm.payload.delivery.channel_group_ids} onChange={(value) => patchRule((payload) => ({ ...payload, delivery: { ...payload.delivery, channel_group_ids: value } }))} placeholder="选择分组" />
              <MultiSelect label="联系人分组" options={contactGroupOptions} value={ruleForm.payload.delivery.contact_group_ids} onChange={(value) => patchRule((payload) => ({ ...payload, delivery: { ...payload.delivery, contact_group_ids: value } }))} placeholder="选择联系人组" />
              <SelectField label="消息模板" value={ruleForm.payload.delivery.template_id ?? '__none__'} onValueChange={(value) => patchRule((payload) => ({ ...payload, delivery: { ...payload.delivery, template_id: value === '__none__' ? null : value } }))} options={[{ value: '__none__', label: '默认标题与正文' }, ...templateOptions]} />
              <SwitchField label="恢复时通知" checked={ruleForm.payload.delivery.notify_on_recovery} onCheckedChange={(value) => patchRule((payload) => ({ ...payload, delivery: { ...payload.delivery, notify_on_recovery: value } }))} />
              <SwitchField label="包含已停用实例" checked={ruleForm.payload.scope.include_disabled} onCheckedChange={(value) => patchRule((payload) => ({ ...payload, scope: { ...payload.scope, include_disabled: value } }))} />
            </div>
            <Field label="静默时段" description="静默期内严重告警仍可发送，其他级别延后。">
              <div className="flex flex-wrap items-end gap-3">
                <SwitchField label="启用静默" checked={ruleForm.payload.condition.quiet_hours.enabled} onCheckedChange={(value) => patchRule((payload) => ({ ...payload, condition: { ...payload.condition, quiet_hours: { ...payload.condition.quiet_hours, enabled: value } } }))} />
                <Input className="w-28" type="time" value={ruleForm.payload.condition.quiet_hours.start} onChange={(event) => patchRule((payload) => ({ ...payload, condition: { ...payload.condition, quiet_hours: { ...payload.condition.quiet_hours, start: event.target.value } } }))} />
                <Input className="w-28" type="time" value={ruleForm.payload.condition.quiet_hours.end} onChange={(event) => patchRule((payload) => ({ ...payload, condition: { ...payload.condition, quiet_hours: { ...payload.condition.quiet_hours, end: event.target.value } } }))} />
                <SwitchField label="严重告警不受静默限制" checked={ruleForm.payload.condition.quiet_hours.allow_critical} onCheckedChange={(value) => patchRule((payload) => ({ ...payload, condition: { ...payload.condition, quiet_hours: { ...payload.condition.quiet_hours, allow_critical: value } } }))} />
              </div>
            </Field>
          </div>
        ) : null}
      </AppModal>

      {/* Channel editor */}
      <AppModal
        open={Boolean(channelForm)}
        onOpenChange={(open) => { if (!open) setChannelForm(null); }}
        title={channelForm?.id ? '编辑通知渠道' : '新增通知渠道'}
        description="密钥只写入不返回；编辑时留空表示保持不变。"
        size="lg"
        footer={<><Button variant="outline" onClick={() => setChannelForm(null)}>取消</Button><Button isPending={channelMutation.isPending} onClick={saveChannel}>保存渠道</Button></>}
      >
        {channelForm ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <TextField label="渠道名称" required inputProps={{ value: channelForm.name, onChange: (event) => setChannelForm({ ...channelForm, name: event.target.value }) }} />
              <SelectField label="渠道类型" value={channelForm.type} onValueChange={(value) => setChannelForm({ ...channelForm, type: value as NotificationChannelType, config: {}, secrets: {}, secretFields: [], recipientsText: '', paramMapText: '', headersText: '' })} options={CHANNEL_TYPES.map((item) => ({ value: item.value, label: item.label }))} />
            </div>
            <p className="m-0 text-xs text-muted-foreground">{CHANNEL_TYPES.find((item) => item.value === channelForm.type)?.description}</p>
            {channelForm.type === 'apprise' ? (
              <TextField label={channelForm.id ? '替换 Apprise URL（留空不变）' : 'Apprise URL'} required inputProps={{ placeholder: 'wecombot://... / barks://... / tgram://...', value: channelForm.secrets.apprise_url ?? '', onChange: (event) => setChannelSecret('apprise_url', event.target.value) }} />
            ) : null}
            {channelForm.type === 'smtp' ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <TextField label="SMTP 主机" required inputProps={{ placeholder: 'smtp.example.com', value: channelFormField('host'), onChange: (event) => setChannelField('host', event.target.value) }} />
                <NumberField label="端口" value={Number(channelForm.config.port ?? 465)} onValueChange={(value) => setChannelField('port', value)} min={1} max={65535} />
                <SelectField label="安全方式" value={String(channelForm.config.security ?? 'ssl')} onValueChange={(value) => setChannelField('security', value)} options={[{ value: 'ssl', label: 'SSL' }, { value: 'starttls', label: 'STARTTLS' }, { value: 'none', label: '不加密' }]} />
                <TextField label="发件地址" required inputProps={{ placeholder: 'ops@example.com', value: channelFormField('from_address'), onChange: (event) => setChannelField('from_address', event.target.value) }} />
                <TextField label="发件名称" inputProps={{ value: channelFormField('from_name'), onChange: (event) => setChannelField('from_name', event.target.value) }} />
                <TextField label="登录用户名" description="通常与发件地址相同" inputProps={{ value: channelFormField('username'), onChange: (event) => setChannelField('username', event.target.value) }} />
                <TextField label={channelForm.id ? 'SMTP 密码（留空不变）' : 'SMTP 密码'} inputProps={{ type: 'password', value: channelForm.secrets.password ?? '', onChange: (event) => setChannelSecret('password', event.target.value) }} />
                <TextField label="收件邮箱" description="逗号分隔；也可在规则里选择联系人组" inputProps={{ value: channelForm.recipientsText, onChange: (event) => setChannelForm({ ...channelForm, recipientsText: event.target.value }) }} />
              </div>
            ) : null}
            {channelForm.type === 'aliyun_sms' || channelForm.type === 'aliyun_voice' || channelForm.type === 'aliyun_directmail' ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <TextField label="AccessKey ID" required inputProps={{ placeholder: channelForm.id ? '已保存，留空不变' : 'LTAI...', value: channelForm.secrets.access_key_id ?? '', onChange: (event) => setChannelSecret('access_key_id', event.target.value) }} />
                <TextField label="AccessKey Secret" required inputProps={{ type: 'password', placeholder: channelForm.id ? '已保存，留空不变' : '••••••', value: channelForm.secrets.access_key_secret ?? '', onChange: (event) => setChannelSecret('access_key_secret', event.target.value) }} />
                {channelForm.type === 'aliyun_sms' ? (
                  <>
                    <TextField label="短信签名" required inputProps={{ value: channelFormField('sign_name'), onChange: (event) => setChannelField('sign_name', event.target.value) }} />
                    <TextField label="短信模板 Code" required inputProps={{ placeholder: 'SMS_123456789', value: channelFormField('template_code'), onChange: (event) => setChannelField('template_code', event.target.value) }} />
                    <TextField label="接收手机号" description="逗号分隔；也可在规则里选择联系人组" inputProps={{ value: channelForm.recipientsText, onChange: (event) => setChannelForm({ ...channelForm, recipientsText: event.target.value }) }} />
                  </>
                ) : null}
                {channelForm.type === 'aliyun_voice' ? (
                  <>
                    <TextField label="TTS 模板 Code" required inputProps={{ placeholder: 'TTS_123456789', value: channelFormField('tts_code'), onChange: (event) => setChannelField('tts_code', event.target.value) }} />
                    <TextField label="接收手机号" description="逗号分隔；也可在规则里选择联系人组" inputProps={{ value: channelForm.recipientsText, onChange: (event) => setChannelForm({ ...channelForm, recipientsText: event.target.value }) }} />
                    <NumberField label="播放次数" value={Number(channelForm.config.play_times ?? 2)} onValueChange={(value) => setChannelField('play_times', value)} min={1} max={5} />
                    <NumberField label="音量" value={Number(channelForm.config.volume ?? 100)} onValueChange={(value) => setChannelField('volume', value)} min={0} max={100} />
                  </>
                ) : null}
                {channelForm.type === 'aliyun_directmail' ? (
                  <>
                    <TextField label="发信地址" required inputProps={{ value: channelFormField('account_name'), onChange: (event) => setChannelField('account_name', event.target.value) }} />
                    <TextField label="发件名称" required inputProps={{ value: channelFormField('from_alias'), onChange: (event) => setChannelField('from_alias', event.target.value) }} />
                    <TextField label="收件邮箱" description="逗号分隔；也可在规则里选择联系人组" inputProps={{ value: channelForm.recipientsText, onChange: (event) => setChannelForm({ ...channelForm, recipientsText: event.target.value }) }} />
                  </>
                ) : null}
                {channelForm.type === 'aliyun_sms' || channelForm.type === 'aliyun_voice' ? (
                  <TextField className="md:col-span-2" label="模板参数映射" description="每行一个，例如：instance={{instance}}" inputProps={{ placeholder: 'instance={{instance}}\nbalance={{balance}}', value: channelForm.paramMapText, onChange: (event) => setChannelForm({ ...channelForm, paramMapText: event.target.value }) }} />
                ) : null}
              </div>
            ) : null}
            {channelForm.type === 'webhook' ? (
              <div className="flex flex-col gap-4">
                <TextField label="Webhook URL" required inputProps={{ placeholder: 'https://example.com/hook', value: channelFormField('url'), onChange: (event) => setChannelField('url', event.target.value) }} />
                <TextField label="请求方法" inputProps={{ value: channelFormField('method') || 'POST', onChange: (event) => setChannelField('method', event.target.value) }} />
                <TextField label="请求头 JSON" textarea textareaProps={{ rows: 4, placeholder: '{"Authorization":"Bearer ..."}', value: channelForm.headersText, onChange: (event) => setChannelForm({ ...channelForm, headersText: event.target.value }) }} />
              </div>
            ) : null}
            <SwitchField label="启用该渠道" checked={channelForm.enabled} onCheckedChange={(value) => setChannelForm({ ...channelForm, enabled: value })} />
            {channelForm.id && channelForm.secretFields.length ? <p className="m-0 text-xs text-muted-foreground">已保存的密钥：{channelForm.secretFields.join('、')}。留空保持不变。</p> : null}
          </div>
        ) : null}
      </AppModal>

      {/* Channel group editor */}
      <AppModal
        open={Boolean(channelGroupForm)}
        onOpenChange={(open) => { if (!open) setChannelGroupForm(null); }}
        title={channelGroupForm?.id ? '编辑渠道分组' : '新建渠道分组'}
        size="sm"
        footer={<><Button variant="outline" onClick={() => setChannelGroupForm(null)}>取消</Button><Button isPending={channelGroupMutation.isPending} onClick={() => { if (!channelGroupForm?.name.trim()) { notify.warning('请填写分组名称'); return; } channelGroupMutation.mutate({ id: channelGroupForm.id, payload: { name: channelGroupForm.name.trim(), channel_ids: channelGroupForm.channel_ids } }); }}>保存</Button></>}
      >
        {channelGroupForm ? (
          <div className="flex flex-col gap-4">
            <TextField label="分组名称" required inputProps={{ value: channelGroupForm.name, onChange: (event) => setChannelGroupForm({ ...channelGroupForm, name: event.target.value }) }} />
            <MultiSelect label="成员渠道" options={channelOptions} value={channelGroupForm.channel_ids} onChange={(value) => setChannelGroupForm({ ...channelGroupForm, channel_ids: value })} placeholder="选择渠道" emptyText="先创建渠道" />
          </div>
        ) : null}
      </AppModal>

      {/* Contact editor */}
      <AppModal
        open={Boolean(contactForm)}
        onOpenChange={(open) => { if (!open) setContactForm(null); }}
        title={contactForm?.id ? '编辑联系人' : '新增联系人'}
        size="sm"
        footer={<><Button variant="outline" onClick={() => setContactForm(null)}>取消</Button><Button isPending={contactMutation.isPending} onClick={() => { if (!contactForm?.name.trim() || !contactForm.value.trim()) { notify.warning('请填写姓名和联系方式'); return; } contactMutation.mutate({ id: contactForm.id, payload: { name: contactForm.name.trim(), type: contactForm.type, value: contactForm.value.trim(), enabled: contactForm.enabled, labels: contactForm.labelsText.split(',').map((item) => item.trim()).filter(Boolean) } }); }}>保存</Button></>}
      >
        {contactForm ? (
          <div className="flex flex-col gap-4">
            <TextField label="姓名 / 名称" required inputProps={{ value: contactForm.name, onChange: (event) => setContactForm({ ...contactForm, name: event.target.value }) }} />
            <SelectField label="类型" value={contactForm.type} onValueChange={(value) => setContactForm({ ...contactForm, type: value as 'email' | 'phone' | 'chat' })} options={[{ value: 'email', label: '邮箱' }, { value: 'phone', label: '手机号' }, { value: 'chat', label: '聊天账号' }]} />
            <TextField label="联系方式" required inputProps={{ value: contactForm.value, onChange: (event) => setContactForm({ ...contactForm, value: event.target.value }) }} />
            <TextField label="标签" description="逗号分隔" inputProps={{ value: contactForm.labelsText, onChange: (event) => setContactForm({ ...contactForm, labelsText: event.target.value }) }} />
            <SwitchField label="启用" checked={contactForm.enabled} onCheckedChange={(value) => setContactForm({ ...contactForm, enabled: value })} />
          </div>
        ) : null}
      </AppModal>

      {/* Contact group editor */}
      <AppModal
        open={Boolean(contactGroupForm)}
        onOpenChange={(open) => { if (!open) setContactGroupForm(null); }}
        title={contactGroupForm?.id ? '编辑联系人组' : '新建联系人组'}
        size="sm"
        footer={<><Button variant="outline" onClick={() => setContactGroupForm(null)}>取消</Button><Button isPending={contactGroupMutation.isPending} onClick={() => { if (!contactGroupForm?.name.trim()) { notify.warning('请填写联系人组名称'); return; } contactGroupMutation.mutate({ id: contactGroupForm.id, payload: { name: contactGroupForm.name.trim(), contact_ids: contactGroupForm.contact_ids } }); }}>保存</Button></>}
      >
        {contactGroupForm ? (
          <div className="flex flex-col gap-4">
            <TextField label="联系人组名称" required inputProps={{ value: contactGroupForm.name, onChange: (event) => setContactGroupForm({ ...contactGroupForm, name: event.target.value }) }} />
            <MultiSelect label="成员联系人" options={contacts.map((contact) => ({ label: `${contact.name} · ${contact.value}`, value: contact.id }))} value={contactGroupForm.contact_ids} onChange={(value) => setContactGroupForm({ ...contactGroupForm, contact_ids: value })} placeholder="选择联系人" emptyText="先创建联系人" />
          </div>
        ) : null}
      </AppModal>

      {/* Template editor */}
      <AppModal
        open={Boolean(templateForm)}
        onOpenChange={(open) => { if (!open) setTemplateForm(null); }}
        title={templateForm?.id ? '编辑通知模板' : '新增通知模板'}
        description="变量示例：{{instance}}、{{balance}}、{{threshold}}、{{time}}。"
        size="lg"
        footer={<><Button variant="outline" onClick={() => setTemplateForm(null)}>取消</Button><Button isPending={templateMutation.isPending} onClick={() => { if (!templateForm?.payload.name.trim() || !templateForm.payload.body_template.trim()) { notify.warning('请填写模板名称和正文'); return; } templateMutation.mutate({ id: templateForm.id, payload: { ...templateForm.payload, name: templateForm.payload.name.trim(), param_map: parseLines(templateForm.paramMapText) } }); }}>保存</Button></>}
      >
        {templateForm ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <TextField label="模板名称" required inputProps={{ value: templateForm.payload.name, onChange: (event) => setTemplateForm({ ...templateForm, payload: { ...templateForm.payload, name: event.target.value } }) }} />
              <SelectField label="适用渠道" value={templateForm.payload.channel_type} onValueChange={(value) => setTemplateForm({ ...templateForm, payload: { ...templateForm.payload, channel_type: value } })} options={[{ value: 'generic', label: '通用' }, ...CHANNEL_TYPES.map((item) => ({ value: item.value, label: item.label }))]} />
              <TextField label="邮件主题" inputProps={{ value: templateForm.payload.subject_template ?? '', onChange: (event) => setTemplateForm({ ...templateForm, payload: { ...templateForm.payload, subject_template: event.target.value } }) }} />
              <TextField label="服务商模板 Code" description="短信/语音必填" inputProps={{ value: templateForm.payload.provider_template_code ?? '', onChange: (event) => setTemplateForm({ ...templateForm, payload: { ...templateForm.payload, provider_template_code: event.target.value } }) }} />
            </div>
            <TextField label="正文模板" required textarea textareaProps={{ rows: 7, value: templateForm.payload.body_template, onChange: (event) => setTemplateForm({ ...templateForm, payload: { ...templateForm.payload, body_template: event.target.value } }) }} />
            <TextField label="参数映射" description="每行一个，例如：instance={{instance}}" textarea textareaProps={{ rows: 4, value: templateForm.paramMapText, onChange: (event) => setTemplateForm({ ...templateForm, paramMapText: event.target.value }) }} />
          </div>
        ) : null}
      </AppModal>

      {/* Test send */}
      <AppModal
        open={testOpen}
        onOpenChange={setTestOpen}
        title="测试发送"
        description="选择渠道或联系人组发送一条测试消息；短信/语音会产生实际费用。"
        size="md"
        footer={<><Button variant="outline" onClick={() => setTestOpen(false)}>取消</Button><Button isPending={testMutation.isPending} onClick={() => testMutation.mutate()}>发送测试</Button></>}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <MultiSelect label="通知渠道" options={channelOptions} value={testForm.channel_ids} onChange={(value) => setTestForm({ ...testForm, channel_ids: value })} placeholder="选择渠道" />
            <MultiSelect label="渠道分组" options={channelGroupOptions} value={testForm.channel_group_ids} onChange={(value) => setTestForm({ ...testForm, channel_group_ids: value })} placeholder="选择分组" />
            <MultiSelect label="联系人分组" options={contactGroupOptions} value={testForm.contact_group_ids} onChange={(value) => setTestForm({ ...testForm, contact_group_ids: value })} placeholder="选择联系人组" />
            <SelectField label="消息模板" value={testForm.template_id} onValueChange={(value) => setTestForm({ ...testForm, template_id: value })} options={[{ value: '__none__', label: '默认测试消息' }, ...templateOptions]} />
          </div>
          <TextField label="标题" inputProps={{ value: testForm.title, onChange: (event) => setTestForm({ ...testForm, title: event.target.value }) }} />
          <TextField label="正文" textarea textareaProps={{ rows: 4, value: testForm.body, onChange: (event) => setTestForm({ ...testForm, body: event.target.value }) }} />
        </div>
      </AppModal>

      {/* Custom event */}
      <AppModal
        open={eventOpen}
        onOpenChange={setEventOpen}
        title="投递自定义事件"
        description="外部系统也可直接调用 POST /api/notifications/events。"
        size="md"
        footer={<><Button variant="outline" onClick={() => setEventOpen(false)}>取消</Button><Button isPending={eventMutation.isPending} onClick={() => { if (!eventForm.title.trim()) { notify.warning('请填写事件标题'); return; } eventMutation.mutate(); }}>投递</Button></>}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextField label="事件类型" required inputProps={{ value: eventForm.event_type, onChange: (event) => setEventForm({ ...eventForm, event_type: event.target.value }) }} />
            <SelectField label="严重级别" value={eventForm.severity} onValueChange={(value) => setEventForm({ ...eventForm, severity: value as NotificationSeverity })} options={SEVERITY_OPTIONS} />
            <SelectField label="关联实例" value={eventForm.instance_id} onValueChange={(value) => setEventForm({ ...eventForm, instance_id: value })} options={[{ value: '__none__', label: '不关联实例' }, ...instanceOptions]} />
            <TextField label="去重 Key" description="相同 key 1 分钟内不重复投递" inputProps={{ value: eventForm.dedupe_key, onChange: (event) => setEventForm({ ...eventForm, dedupe_key: event.target.value }) }} />
          </div>
          <TextField label="标题" required inputProps={{ value: eventForm.title, onChange: (event) => setEventForm({ ...eventForm, title: event.target.value }) }} />
          <TextField label="正文" textarea textareaProps={{ rows: 4, value: eventForm.body, onChange: (event) => setEventForm({ ...eventForm, body: event.target.value }) }} />
          <TextField label="自定义字段 JSON" textarea textareaProps={{ rows: 4, placeholder: '{"env":"prod","version":"1.2.3"}', value: eventForm.fieldsText, onChange: (event) => setEventForm({ ...eventForm, fieldsText: event.target.value }) }} />
        </div>
      </AppModal>
    </div>
  );
}
