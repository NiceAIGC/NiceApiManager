import { DeleteOutlined, PlusOutlined, QuestionCircleOutlined } from '../ui/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert,
App,
Button,
Card,
Col,
Collapse,
Divider,
Drawer,
Form,
Input,
InputNumber,
Row,
Select,
Space,
Switch,
Tag,
Typography, } from '../ui';
import { useEffect, useMemo, useState } from 'react';

import { getErrorMessage } from '../api/client';
import { fetchInstances } from '../api/instances';
import { fetchAppSettings, sendTestNotification, updateAppSettings } from '../api/settings';
import type {
  AggregateBalanceNotificationRule,
  AppSettings,
  BalanceNotificationRule,
  ConnectivityFailureNotificationRule,
  NotificationChannelConfig,
} from '../types/api';
import { formatDateTime } from '../utils/format';

const { Paragraph, Text } = Typography;

type NotificationChannelType = 'wecombot' | 'bark' | 'telegram' | 'dingtalk' | 'custom';

interface NotificationChannelFormValue extends NotificationChannelConfig {
  channel_type: NotificationChannelType;
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

type NotificationSettingsFormValues = Pick<
  AppSettings,
  'notification_enabled' | 'notification_check_interval_minutes' | 'default_balance_alert_threshold' | 'default_notification_channel_id' | 'notification_rules'
> & {
  notification_channels: NotificationChannelFormValue[];
};

const BARK_DEFAULT_HOST = 'api.day.app';

const notificationChannelTypeOptions: Array<{ label: string; value: NotificationChannelType }> = [
  { label: '企业微信机器人', value: 'wecombot' },
  { label: 'Bark', value: 'bark' },
  { label: 'Telegram Bot', value: 'telegram' },
  { label: '钉钉机器人', value: 'dingtalk' },
  { label: '自定义 Apprise URL', value: 'custom' },
];

function createId(prefix: string) {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}_${globalThis.crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createNotificationChannel(): NotificationChannelFormValue {
  return {
    id: createId('channel'),
    name: '',
    enabled: true,
    apprise_url: '',
    channel_type: 'wecombot',
    bark_host: BARK_DEFAULT_HOST,
    bark_use_https: true,
  };
}

function createBalanceRule(severity: 'warning' | 'critical'): BalanceNotificationRule {
  return {
    id: createId('rule'),
    name: severity === 'critical' ? '实例余额严重不足' : '实例余额预警',
    enabled: true,
    severity,
    threshold: severity === 'critical' ? 10 : 50,
    resolve_threshold: severity === 'critical' ? 20 : 80,
    min_consecutive_checks: 1,
    instance_ids: [],
    tags: [],
    include_disabled: false,
    repeat_interval_minutes: severity === 'critical' ? 120 : 360,
    notify_on_recovery: true,
    channel_ids: [],
  };
}

function createAggregateBalanceRule(): AggregateBalanceNotificationRule {
  return {
    id: createId('rule'),
    name: '核心实例总余额',
    enabled: false,
    severity: 'warning',
    threshold: 100,
    resolve_threshold: 160,
    min_consecutive_checks: 1,
    instance_ids: [],
    tags: [],
    include_disabled: false,
    repeat_interval_minutes: 180,
    notify_on_recovery: true,
    channel_ids: [],
  };
}

function createConnectivityRule(): ConnectivityFailureNotificationRule {
  return {
    id: createId('rule'),
    name: '实例连续连接失败',
    enabled: true,
    consecutive_failures: 3,
    instance_ids: [],
    tags: [],
    include_disabled: false,
    repeat_interval_minutes: 180,
    notify_on_recovery: true,
    channel_ids: [],
  };
}

const defaultNotificationSettings: NotificationSettingsFormValues = {
  notification_enabled: false,
  notification_check_interval_minutes: 5,
  default_balance_alert_threshold: 50,
  default_notification_channel_id: undefined,
  notification_channels: [],
  notification_rules: {
    low_balance_rules: [createBalanceRule('warning'), createBalanceRule('critical')],
    aggregate_balance_rules: [createAggregateBalanceRule()],
    connectivity_failure_rules: [createConnectivityRule()],
  },
};

function splitDelimitedValues(value?: string): string[] {
  return (value ?? '')
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function decodeUrlPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildNotificationChannelAppriseUrl(channel: NotificationChannelFormValue): string {
  switch (channel.channel_type) {
    case 'wecombot': {
      const key = channel.wecombot_key?.trim();
      return key ? `wecombot://${encodeURIComponent(key)}` : '';
    }
    case 'bark': {
      const host = channel.bark_host?.trim();
      const targets = splitDelimitedValues(channel.bark_targets);
      if (!host || targets.length === 0) {
        return '';
      }
      const params = new URLSearchParams();
      if (channel.bark_group?.trim()) {
        params.set('group', channel.bark_group.trim());
      }
      if (channel.bark_sound?.trim()) {
        params.set('sound', channel.bark_sound.trim());
      }
      const schema = channel.bark_use_https === false ? 'bark' : 'barks';
      const query = params.toString();
      return `${schema}://${host}/${targets.map((item) => encodeURIComponent(item)).join('/')}${query ? `?${query}` : ''}`;
    }
    case 'telegram': {
      const botToken = channel.telegram_bot_token?.trim();
      const targets = splitDelimitedValues(channel.telegram_targets);
      if (!botToken || targets.length === 0) {
        return '';
      }
      return `tgram://${encodeURIComponent(botToken)}/${targets.map((item) => encodeURIComponent(item)).join('/')}`;
    }
    case 'dingtalk': {
      const token = channel.dingtalk_token?.trim();
      if (!token) {
        return '';
      }
      const secret = channel.dingtalk_secret?.trim();
      const targets = splitDelimitedValues(channel.dingtalk_targets);
      const auth = secret ? `${encodeURIComponent(secret)}@` : '';
      const targetPath = targets.length > 0 ? `/${targets.map((item) => encodeURIComponent(item)).join('/')}` : '';
      return `dingtalk://${auth}${encodeURIComponent(token)}${targetPath}/`;
    }
    case 'custom':
    default:
      return channel.apprise_url.trim();
  }
}

function inferNotificationChannelFormValue(channel: NotificationChannelConfig): NotificationChannelFormValue {
  const fallback: NotificationChannelFormValue = {
    ...channel,
    channel_type: 'custom',
    bark_host: BARK_DEFAULT_HOST,
    bark_use_https: true,
  };
  const appriseUrl = channel.apprise_url.trim();
  if (!appriseUrl) {
    return fallback;
  }

  if (/^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send/i.test(appriseUrl)) {
    try {
      const parsed = new URL(appriseUrl);
      const key = parsed.searchParams.get('key')?.trim();
      if (key) {
        return {
          ...channel,
          channel_type: 'wecombot',
          wecombot_key: key,
          bark_host: BARK_DEFAULT_HOST,
          bark_use_https: true,
        };
      }
    } catch {
      return fallback;
    }
  }

  if (/^wecombot:\/\//i.test(appriseUrl)) {
    try {
      const parsed = new URL(appriseUrl);
      const key = decodeUrlPart(parsed.hostname || parsed.pathname.replace(/^\/+/, ''));
      if (!key) {
        return fallback;
      }
      return {
        ...channel,
        channel_type: 'wecombot',
        wecombot_key: key,
        bark_host: BARK_DEFAULT_HOST,
        bark_use_https: true,
      };
    } catch {
      return fallback;
    }
  }

  if (/^barks?:\/\//i.test(appriseUrl)) {
    try {
      const parsed = new URL(appriseUrl);
      const unsupportedParams = Array.from(parsed.searchParams.keys()).filter((key) => !['group', 'sound'].includes(key));
      if (parsed.username || parsed.password || unsupportedParams.length > 0) {
        return fallback;
      }
      const targets = parsed.pathname
        .split('/')
        .filter(Boolean)
        .map((item) => decodeUrlPart(item));
      if (!parsed.host || targets.length === 0) {
        return fallback;
      }
      return {
        ...channel,
        channel_type: 'bark',
        bark_host: parsed.host,
        bark_targets: targets.join(', '),
        bark_group: parsed.searchParams.get('group') ?? '',
        bark_sound: parsed.searchParams.get('sound') ?? '',
        bark_use_https: parsed.protocol.toLowerCase() === 'barks:',
      };
    } catch {
      return fallback;
    }
  }

  if (/^tgram:\/\//i.test(appriseUrl)) {
    const withoutSchema = appriseUrl.replace(/^tgram:\/\//i, '');
    const basePart = withoutSchema.split(/[?#]/, 1)[0]?.replace(/\/+$/, '') ?? '';
    const segments = basePart.split('/').filter(Boolean).map((item) => decodeUrlPart(item));
    if (segments.length >= 2 && !withoutSchema.includes('?')) {
      return {
        ...channel,
        channel_type: 'telegram',
        telegram_bot_token: segments[0],
        telegram_targets: segments.slice(1).join(', '),
        bark_host: BARK_DEFAULT_HOST,
        bark_use_https: true,
      };
    }
    return fallback;
  }

  if (/^dingtalk:\/\//i.test(appriseUrl)) {
    try {
      const parsed = new URL(appriseUrl);
      if (parsed.search) {
        return fallback;
      }
      return {
        ...channel,
        channel_type: 'dingtalk',
        dingtalk_token: decodeUrlPart(parsed.hostname),
        dingtalk_secret: decodeUrlPart(parsed.username),
        dingtalk_targets: parsed.pathname
          .split('/')
          .filter(Boolean)
          .map((item) => decodeUrlPart(item))
          .join(', '),
        bark_host: BARK_DEFAULT_HOST,
        bark_use_https: true,
      };
    } catch {
      return fallback;
    }
  }

  return fallback;
}

function normalizeSettingsForForm(settings?: AppSettings): NotificationSettingsFormValues {
  if (!settings) {
    return defaultNotificationSettings;
  }
  return {
    notification_enabled: settings.notification_enabled,
    notification_check_interval_minutes: settings.notification_check_interval_minutes,
    default_balance_alert_threshold: settings.default_balance_alert_threshold,
    default_notification_channel_id: settings.default_notification_channel_id ?? undefined,
    notification_rules: settings.notification_rules,
    notification_channels: settings.notification_channels.map((item) => inferNotificationChannelFormValue(item)),
  };
}

function buildSettingsPayload(values: NotificationSettingsFormValues, current?: AppSettings): AppSettings {
  return {
    sync_max_workers: current?.sync_max_workers ?? 5,
    request_timeout: current?.request_timeout ?? 20,
    sync_verify_ssl: current?.sync_verify_ssl ?? true,
    scheduler_timezone: current?.scheduler_timezone ?? 'Asia/Shanghai',
    sync_history_lookback_days: current?.sync_history_lookback_days ?? 30,
    default_sync_interval_minutes: current?.default_sync_interval_minutes ?? 120,
    shared_socks5_proxy_url: current?.shared_socks5_proxy_url ?? '',
    default_instance_proxy_mode: current?.default_instance_proxy_mode ?? 'direct',
    notification_enabled: values.notification_enabled,
    default_balance_alert_threshold: values.default_balance_alert_threshold,
    default_notification_channel_id: values.default_notification_channel_id,
    notification_check_interval_minutes: values.notification_check_interval_minutes,
    notification_rules: values.notification_rules,
    notification_channels: values.notification_channels.map((item) => ({
      id: item.id,
      name: item.name.trim(),
      enabled: item.enabled,
      apprise_url: buildNotificationChannelAppriseUrl(item),
    })),
  };
}

const guideStep = (text: string) => <li>{text}</li>;

const guideItems = [
  {
    key: 'recipes',
    label: '① 常用配方（先看这里）',
    children: (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Paragraph strong style={{ marginBottom: 6 }}>
            <Tag color="orange">场景 A</Tag>某标签下「任意一个」实例余额过低就告警
          </Paragraph>
          <ol className="guide-steps">
            {guideStep('到「实例余额规则」，新增或编辑一条规则。')}
            {guideStep('展开卡片里的「高级匹配与去重」，在「标签筛选」里选中目标标签（如 core）。')}
            {guideStep('把「触发阈值」设为想要的余额下限，例如 50。')}
            {guideStep('保存。此后该标签下任何一个预付费实例余额 ≤ 50 都会单独告警。')}
          </ol>
          <Text type="secondary">要点：这类规则逐个实例判断，命中一个报一个，互不影响。</Text>
        </div>
        <div>
          <Paragraph strong style={{ marginBottom: 6 }}>
            <Tag color="geekblue">场景 B</Tag>几个实例「合计」余额过低才告警
          </Paragraph>
          <ol className="guide-steps">
            {guideStep('到「聚合余额规则」，新增一条规则。')}
            {guideStep('在「实例列表」里勾选要合并统计的实例，或用「标签筛选」按标签圈一批。')}
            {guideStep('把「总余额阈值」设为合计下限，例如 100。')}
            {guideStep('保存。此后这批实例余额相加 ≤ 100 才会告警（单个再低也不单独报）。')}
          </ol>
          <Text type="secondary">要点：这类规则把范围内余额求和后整体判断，只发一条聚合告警。</Text>
        </div>
      </Space>
    ),
  },
  {
    key: 'overview',
    label: '② 系统总览：告警怎么触发的',
    children: (
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Paragraph style={{ marginBottom: 0 }}>
          开启「启用通知巡检」后，后台按「通知巡检间隔」定时把每条<Text strong>启用</Text>的规则跑一遍：
        </Paragraph>
        <ul className="guide-steps">
          <li>命中阈值 → 视为「告警中」，向该规则的渠道推送一条告警（可要求连续命中多次才发，见去重）。</li>
          <li>持续命中 → 按「重复提醒间隔」周期性再次提醒，不会每次巡检都刷屏。</li>
          <li>恢复到「恢复阈值」以上 → 状态转为正常，若开了「恢复通知」会再发一条恢复消息。</li>
        </ul>
        <Text type="secondary">关闭巡检后不会自动检查，但仍可用右上角「发送测试通知」验证渠道连通性。</Text>
      </Space>
    ),
  },
  {
    key: 'channels',
    label: '③ 通知渠道',
    children: (
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Paragraph style={{ marginBottom: 0 }}>
          内置企业微信机器人、Bark、Telegram Bot、钉钉机器人的友好表单，填好会自动生成 Apprise URL；更冷门的渠道选「自定义 Apprise URL」直接填原始地址。
        </Paragraph>
        <ul className="guide-steps">
          <li>设置一个默认渠道；未显式选择渠道的规则、快捷余额告警和站点异常通知只发送到它。</li>
          <li>删除或停用默认渠道后，系统自动回退到列表中第一个已启用渠道。</li>
          <li>先点「发送测试通知」确认默认渠道能收到，再配规则。</li>
        </ul>
      </Space>
    ),
  },
  {
    key: 'scope',
    label: '④ 作用范围与匹配逻辑',
    children: (
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Paragraph style={{ marginBottom: 0 }}>每条规则用「指定实例 / 标签筛选」圈定作用范围：</Paragraph>
        <ul className="guide-steps">
          <li>都不填 → 匹配<Text strong>全部</Text>实例。</li>
          <li>只填标签 → 命中带任一标签的实例。</li>
          <li>只填实例 → 命中所选实例。</li>
          <li>两者都填 → 取<Text strong>并集</Text>（满足其一即命中）。</li>
          <li>「包含停用实例」默认关闭，即停用实例不参与判断。</li>
        </ul>
        <Text type="secondary">余额类规则只对「预付费」实例生效，后付费实例会自动跳过。</Text>
      </Space>
    ),
  },
  {
    key: 'threshold',
    label: '⑤ 阈值、去重与恢复',
    children: (
      <ul className="guide-steps">
        <li>
          <Text strong>触发阈值</Text>：余额 ≤ 它就算命中（聚合规则是合计 ≤ 它）。
        </li>
        <li>
          <Text strong>恢复阈值</Text>：余额回到 ≥ 它才算恢复；必须大于触发阈值。留空默认取触发阈值的 1.2 倍，用这个「缓冲带」避免在阈值附近反复告警/恢复。
        </li>
        <li>
          <Text strong>连续命中次数</Text>：连续多少次巡检都低于阈值才首次告警，用来过滤抖动。
        </li>
        <li>
          <Text strong>重复提醒间隔</Text>：已告警且仍未恢复时，每隔多少分钟再提醒一次。
        </li>
        <li>
          <Text strong>级别</Text>：严重 / 预警，仅影响通知的类型标识与图标。
        </li>
        <li>
          <Text strong>恢复通知</Text>：开启后余额回升会补发一条恢复消息。
        </li>
      </ul>
    ),
  },
  {
    key: 'connectivity',
    label: '⑥ 连接失败规则',
    children: (
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Paragraph style={{ marginBottom: 0 }}>
          当某实例<Text strong>连续</Text>同步失败达到设定次数时告警，用于发现掉线、令牌失效、代理不通等问题。范围与恢复逻辑同上，最近一次同步成功即视为恢复。
        </Paragraph>
      </Space>
    ),
  },
  {
    key: 'troubleshoot',
    label: '⑦ 没收到告警？排查清单',
    children: (
      <ul className="guide-steps">
        <li>「启用通知巡检」是否已开启并保存。</li>
        <li>渠道是否「启用」，测试通知能否收到。</li>
        <li>规则是否「启用」，作用范围是否真的覆盖到目标实例。</li>
        <li>余额类规则：目标是否为预付费实例、是否已同步出余额（余额为空会跳过）。</li>
        <li>是否设了较大的「连续命中次数」或「重复提醒间隔」导致延迟。</li>
        <li>刚触发过、仍在重复间隔内，属正常抑制，可到「通知日志」页核对投递记录。</li>
      </ul>
    ),
  },
];

export function NotificationsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<NotificationSettingsFormValues>();
  const [guideOpen, setGuideOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['app-settings'],
    queryFn: fetchAppSettings,
  });

  const { data: instancesData } = useQuery({
    queryKey: ['instances'],
    queryFn: () => fetchInstances(),
  });

  const notificationChannels = Form.useWatch('notification_channels', form) ?? [];

  const instanceOptions = useMemo(
    () =>
      (instancesData?.items ?? [])
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((item) => ({ label: item.name, value: item.id })),
    [instancesData?.items],
  );

  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const item of instancesData?.items ?? []) {
      for (const tag of item.tags) {
        tags.add(tag);
      }
    }

    return Array.from(tags)
      .sort()
      .map((tag) => ({ label: tag, value: tag }));
  }, [instancesData?.items]);

  const channelOptions = useMemo(
    () =>
      notificationChannels
        .filter((item): item is NotificationChannelFormValue => Boolean(item?.id && item?.name))
        .map((item) => ({
          label: `${item.name}${item.enabled ? '' : '（已停用）'}`,
          value: item.id,
        })),
    [notificationChannels],
  );

  useEffect(() => {
    form.setFieldsValue(normalizeSettingsForForm(data));
  }, [data, form]);

  const updateMutation = useMutation({
    mutationFn: (payload: AppSettings) => updateAppSettings(payload),
    onSuccess: async (result) => {
      form.setFieldsValue(normalizeSettingsForForm(result));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['app-settings'] }),
        queryClient.invalidateQueries({ queryKey: ['instances'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-trends'] }),
        queryClient.invalidateQueries({ queryKey: ['sync-runs'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-logs'] }),
      ]);
      message.success('告警通知设置已保存');
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const testNotificationMutation = useMutation({
    mutationFn: () => sendTestNotification({}),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['notification-logs'] });
      if (result.failed_count > 0) {
        const failedNames = result.items
          .filter((item) => !item.success)
          .map((item) => item.channel_name)
          .join('、');
        message.warning(`测试消息已发出，成功 ${result.success_count} 个，失败 ${result.failed_count} 个：${failedNames}`);
        return;
      }
      message.success(`测试消息发送成功，共 ${result.success_count} 个通知渠道`);
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  const handleNotificationChannelTypeChange = (channelIndex: number, nextType: NotificationChannelType) => {
    const currentChannel = form.getFieldValue(['notification_channels', channelIndex]) as NotificationChannelFormValue | undefined;
    if (!currentChannel || nextType !== 'custom') {
      return;
    }
    const generatedUrl = buildNotificationChannelAppriseUrl(currentChannel);
    if (generatedUrl) {
      form.setFieldValue(['notification_channels', channelIndex, 'apprise_url'], generatedUrl);
    }
  };

  return (
    <Form<NotificationSettingsFormValues>
      form={form}
      layout="vertical"
      initialValues={defaultNotificationSettings}
      onFinish={(values) => updateMutation.mutate(buildSettingsPayload(values, data))}
    >
      <div className="page-stack">
        <Card className="section-card" loading={isLoading}>
          <div className="notification-header">
            <Space direction="vertical" size={4}>
              <Typography.Title level={4} style={{ margin: 0 }}>
                告警通知
              </Typography.Title>
              <Text type="secondary">配置通知渠道、余额告警和连接失败告警；规则保存后会由后台巡检定时执行。</Text>
              {data?.updated_at ? <Text type="secondary">最近更新：{formatDateTime(data.updated_at)}</Text> : null}
            </Space>
            <Button icon={<QuestionCircleOutlined />} onClick={() => setGuideOpen(true)}>
              使用说明
            </Button>
          </div>
        </Card>

        <Card
          className="section-card"
          title="通知设置"
          extra={
            <Button loading={testNotificationMutation.isPending} onClick={() => testNotificationMutation.mutate()}>
              发送测试通知
            </Button>
          }
        >
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              message={
                data?.notification_enabled
                  ? `通知巡检已开启，后台约每 ${data.notification_check_interval_minutes} 分钟检查一次。`
                  : '高级规则巡检当前关闭；实例管理中的快捷余额告警仍会执行。'
              }
              description="此开关控制下方高级规则；实例快捷余额告警独立生效。未指定渠道的规则、快捷告警和站点异常通知只发送到默认渠道。"
            />

            <Row gutter={[16, 0]}>
              <Col xs={24} md={6}>
                <Form.Item
                  name="notification_enabled"
                  label="启用通知巡检"
                  valuePropName="checked"
                  extra="只控制下方高级余额、聚合和连接失败规则；实例管理快捷告警不受影响。"
                >
                  <Switch checkedChildren="已启用" unCheckedChildren="已关闭" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item
                  name="notification_check_interval_minutes"
                  label="通知巡检间隔（分钟）"
                  rules={[{ required: true, message: '请输入通知巡检间隔' }]}
                >
                  <InputNumber style={{ width: '100%' }} min={1} max={1440} precision={0} addonAfter="分钟" />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item
                  name="default_balance_alert_threshold"
                  label="快捷余额默认阈值"
                  extra="实例未单独填写时使用。"
                  rules={[{ required: true, message: '请输入默认余额阈值' }]}
                >
                  <InputNumber style={{ width: '100%' }} min={0.01} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item
                  name="default_notification_channel_id"
                  label="默认通知渠道"
                  extra="留空时自动使用第一个启用渠道。"
                >
                  <Select allowClear placeholder="第一个启用渠道" options={channelOptions} />
                </Form.Item>
              </Col>
            </Row>

            <Divider orientation="left">通知渠道</Divider>
            <Form.List name="notification_channels">
              {(fields, { add, remove }) => (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {fields.map((field) => (
                    <Card
                      key={field.key}
                      size="small"
                      title={`渠道 ${field.name + 1}`}
                      extra={
                        <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)}>
                          删除
                        </Button>
                      }
                    >
                      <Form.Item name={[field.name, 'id']} hidden>
                        <Input />
                      </Form.Item>
                      <Row gutter={[16, 0]}>
                        <Col xs={24} md={10}>
                          <Form.Item
                            name={[field.name, 'name']}
                            label="渠道名称"
                            rules={[{ required: true, message: '请输入渠道名称' }]}
                          >
                            <Input placeholder="例如：Telegram 管理群" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={10}>
                          <Form.Item
                            name={[field.name, 'channel_type']}
                            label="渠道类型"
                            rules={[{ required: true, message: '请选择渠道类型' }]}
                          >
                            <Select
                              options={notificationChannelTypeOptions}
                              onChange={(value: NotificationChannelType) =>
                                handleNotificationChannelTypeChange(field.name, value)
                              }
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item name={[field.name, 'enabled']} label="启用" valuePropName="checked">
                            <Switch checkedChildren="启用" unCheckedChildren="停用" />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Form.Item noStyle shouldUpdate>
                        {() => {
                          const channel =
                            (form.getFieldValue(['notification_channels', field.name]) as NotificationChannelFormValue | undefined) ??
                            createNotificationChannel();
                          const generatedUrl = buildNotificationChannelAppriseUrl(channel);

                          if (channel.channel_type === 'wecombot') {
                            return (
                              <Row gutter={[16, 0]}>
                                <Col xs={24} md={12}>
                                  <Form.Item
                                    name={[field.name, 'wecombot_key']}
                                    label="Webhook Key"
                                    extra="把企业微信群机器人地址里 `key=` 后面的值填进来即可。"
                                    rules={[{ required: true, message: '请输入企业微信机器人 key' }]}
                                  >
                                    <Input placeholder="例如：xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                                  </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                  <Form.Item label="生成的 Apprise URL">
                                    <Input readOnly value={generatedUrl} placeholder="填写完成后会自动生成" />
                                  </Form.Item>
                                </Col>
                              </Row>
                            );
                          }

                          if (channel.channel_type === 'bark') {
                            return (
                              <Row gutter={[16, 0]}>
                                <Col xs={24} md={8}>
                                  <Form.Item
                                    name={[field.name, 'bark_host']}
                                    label="Bark 服务器"
                                    extra="默认官方云 `api.day.app`，自建 Bark Server 可改成自己的域名或 `主机:端口`。"
                                    rules={[{ required: true, message: '请输入 Bark 服务器地址' }]}
                                  >
                                    <Input placeholder={BARK_DEFAULT_HOST} />
                                  </Form.Item>
                                </Col>
                                <Col xs={24} md={8}>
                                  <Form.Item
                                    name={[field.name, 'bark_targets']}
                                    label="Device Key"
                                    extra="支持多个，使用逗号分隔。"
                                    rules={[{ required: true, message: '请输入至少一个 Bark Device Key' }]}
                                  >
                                    <Input placeholder="例如：abc123def456" />
                                  </Form.Item>
                                </Col>
                                <Col xs={24} md={4}>
                                  <Form.Item
                                    name={[field.name, 'bark_use_https']}
                                    label="使用 HTTPS"
                                    valuePropName="checked"
                                    extra="官方云建议开启。"
                                  >
                                    <Switch checkedChildren="HTTPS" unCheckedChildren="HTTP" />
                                  </Form.Item>
                                </Col>
                                <Col xs={24} md={4}>
                                  <Form.Item name={[field.name, 'bark_group']} label="分组">
                                    <Input placeholder="可选" />
                                  </Form.Item>
                                </Col>
                                <Col xs={24} md={8}>
                                  <Form.Item name={[field.name, 'bark_sound']} label="提示音">
                                    <Input placeholder="例如：minuet" />
                                  </Form.Item>
                                </Col>
                                <Col xs={24} md={16}>
                                  <Form.Item label="生成的 Apprise URL">
                                    <Input readOnly value={generatedUrl} placeholder="填写完成后会自动生成" />
                                  </Form.Item>
                                </Col>
                              </Row>
                            );
                          }

                          if (channel.channel_type === 'telegram') {
                            return (
                              <Row gutter={[16, 0]}>
                                <Col xs={24} md={8}>
                                  <Form.Item
                                    name={[field.name, 'telegram_bot_token']}
                                    label="Bot Token"
                                    extra="从 BotFather 创建机器人后获取。"
                                    rules={[{ required: true, message: '请输入 Telegram Bot Token' }]}
                                  >
                                    <Input placeholder="例如：123456789:AA..." />
                                  </Form.Item>
                                </Col>
                                <Col xs={24} md={8}>
                                  <Form.Item
                                    name={[field.name, 'telegram_targets']}
                                    label="Chat ID / 用户名"
                                    extra="支持多个，使用逗号分隔；可填 `-100...`、`@channel_name`。"
                                    rules={[{ required: true, message: '请输入至少一个 Telegram Chat ID 或用户名' }]}
                                  >
                                    <Input placeholder="例如：-1001234567890 或 @ops_channel" />
                                  </Form.Item>
                                </Col>
                                <Col xs={24} md={8}>
                                  <Form.Item label="生成的 Apprise URL">
                                    <Input readOnly value={generatedUrl} placeholder="填写完成后会自动生成" />
                                  </Form.Item>
                                </Col>
                              </Row>
                            );
                          }

                          if (channel.channel_type === 'dingtalk') {
                            return (
                              <Row gutter={[16, 0]}>
                                <Col xs={24} md={8}>
                                  <Form.Item
                                    name={[field.name, 'dingtalk_token']}
                                    label="Access Token"
                                    extra="钉钉群机器人 Webhook 里的 access_token。"
                                    rules={[{ required: true, message: '请输入钉钉机器人 access token' }]}
                                  >
                                    <Input placeholder="例如：xxxxxxxxxxxxxxxx" />
                                  </Form.Item>
                                </Col>
                                <Col xs={24} md={8}>
                                  <Form.Item
                                    name={[field.name, 'dingtalk_secret']}
                                    label="加签 Secret"
                                    extra="如果机器人开启了加签，这里填写 secret；未开启可留空。"
                                  >
                                    <Input placeholder="例如：SECxxxxxxxxxxxxxxxx" />
                                  </Form.Item>
                                </Col>
                                <Col xs={24} md={8}>
                                  <Form.Item
                                    name={[field.name, 'dingtalk_targets']}
                                    label="@手机号"
                                    extra="可选。支持多个，使用逗号分隔。"
                                  >
                                    <Input placeholder="例如：13800138000, 13900139000" />
                                  </Form.Item>
                                </Col>
                                <Col xs={24}>
                                  <Form.Item label="生成的 Apprise URL">
                                    <Input readOnly value={generatedUrl} placeholder="填写完成后会自动生成" />
                                  </Form.Item>
                                </Col>
                              </Row>
                            );
                          }

                          return (
                            <Row gutter={[16, 0]}>
                              <Col xs={24}>
                                <Form.Item
                                  name={[field.name, 'apprise_url']}
                                  label="Apprise URL"
                                  extra="高级参数、暂未内置的渠道类型，直接填写原始 Apprise URL。"
                                  rules={[{ required: true, message: '请输入 Apprise URL' }]}
                                >
                                  <Input placeholder="例如：apprise://..." />
                                </Form.Item>
                              </Col>
                            </Row>
                          );
                        }}
                      </Form.Item>
                    </Card>
                  ))}

                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(createNotificationChannel())}>
                    新增通知渠道
                  </Button>
                </Space>
              )}
            </Form.List>

            <Divider orientation="left">实例余额规则</Divider>
            <Text type="secondary" className="rule-scope-hint">
              逐个实例判断：作用范围内<Text strong>任意一个</Text>预付费实例余额 ≤ 触发阈值就单独告警。想「某标签下任意一个余额过低就提醒」时，在下方展开「高级匹配与去重」里填标签筛选即可。
            </Text>
            <Form.List name={['notification_rules', 'low_balance_rules']}>
              {(fields, { add, remove }) => (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {fields.map((field) => (
                    <Card
                      key={field.key}
                      size="small"
                      title={`余额规则 ${field.name + 1}`}
                      extra={
                        <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)}>
                          删除
                        </Button>
                      }
                    >
                      <Form.Item name={[field.name, 'id']} hidden>
                        <Input />
                      </Form.Item>
                      <Row gutter={[16, 0]}>
                        <Col xs={24} md={8}>
                          <Form.Item
                            name={[field.name, 'name']}
                            label="规则名称"
                            rules={[{ required: true, message: '请输入规则名称' }]}
                          >
                            <Input placeholder="例如：实例余额预警" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item
                            name={[field.name, 'severity']}
                            label="级别"
                            rules={[{ required: true, message: '请选择级别' }]}
                          >
                            <Select
                              options={[
                                { label: '预警', value: 'warning' },
                                { label: '严重', value: 'critical' },
                              ]}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item
                            name={[field.name, 'threshold']}
                            label="触发阈值"
                            rules={[{ required: true, message: '请输入触发阈值' }]}
                          >
                            <InputNumber style={{ width: '100%' }} min={0.01} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item name={[field.name, 'enabled']} label="启用" valuePropName="checked">
                            <Switch checkedChildren="启用" unCheckedChildren="停用" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                          <Form.Item name={[field.name, 'channel_ids']} label="通知渠道">
                            <Select
                              mode="multiple"
                              allowClear
                              placeholder="不选表示发送到默认渠道"
                              options={channelOptions}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24}>
                          <Collapse
                            ghost
                            items={[
                              {
                                key: 'advanced',
                                label: '高级匹配与去重',
                                children: (
                                  <Row gutter={[16, 0]}>
                                    <Col xs={24} md={8}>
                                      <Form.Item name={[field.name, 'resolve_threshold']} label="恢复阈值">
                                        <InputNumber style={{ width: '100%' }} min={0.01} />
                                      </Form.Item>
                                    </Col>
                                    <Col xs={24} md={8}>
                                      <Form.Item name={[field.name, 'instance_ids']} label="指定实例">
                                        <Select
                                          mode="multiple"
                                          allowClear
                                          placeholder="不选表示匹配全部实例"
                                          options={instanceOptions}
                                        />
                                      </Form.Item>
                                    </Col>
                                    <Col xs={24} md={8}>
                                      <Form.Item name={[field.name, 'tags']} label="标签筛选">
                                        <Select mode="multiple" allowClear placeholder="按标签匹配实例" options={tagOptions} />
                                      </Form.Item>
                                    </Col>
                                    <Col xs={24} md={8}>
                                      <Form.Item
                                        name={[field.name, 'min_consecutive_checks']}
                                        label="连续命中次数"
                                        extra="同一实例连续多少次检查都低于阈值后才告警。"
                                      >
                                        <InputNumber style={{ width: '100%' }} min={1} max={10} precision={0} />
                                      </Form.Item>
                                    </Col>
                                    <Col xs={24} md={8}>
                                      <Form.Item name={[field.name, 'repeat_interval_minutes']} label="重复提醒间隔（分钟）">
                                        <InputNumber style={{ width: '100%' }} min={5} max={10080} precision={0} />
                                      </Form.Item>
                                    </Col>
                                    <Col xs={24} md={4}>
                                      <Form.Item name={[field.name, 'include_disabled']} label="包含停用实例" valuePropName="checked">
                                        <Switch checkedChildren="包含" unCheckedChildren="排除" />
                                      </Form.Item>
                                    </Col>
                                    <Col xs={24} md={4}>
                                      <Form.Item name={[field.name, 'notify_on_recovery']} label="恢复通知" valuePropName="checked">
                                        <Switch checkedChildren="通知" unCheckedChildren="静默" />
                                      </Form.Item>
                                    </Col>
                                  </Row>
                                ),
                              },
                            ]}
                          />
                        </Col>
                      </Row>
                    </Card>
                  ))}

                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(createBalanceRule('warning'))}>
                    新增余额规则
                  </Button>
                </Space>
              )}
            </Form.List>

            <Divider orientation="left">聚合余额规则</Divider>
            <Text type="secondary" className="rule-scope-hint">
              合并统计：把作用范围内所有预付费实例余额<Text strong>加起来</Text>，总额 ≤ 总余额阈值才告警。适合「几个实例合计余额过低就提醒」，可按实例或标签圈定范围。
            </Text>
            <Form.List name={['notification_rules', 'aggregate_balance_rules']}>
              {(fields, { add, remove }) => (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {fields.map((field) => (
                    <Card
                      key={field.key}
                      size="small"
                      title={`聚合规则 ${field.name + 1}`}
                      extra={
                        <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)}>
                          删除
                        </Button>
                      }
                    >
                      <Form.Item name={[field.name, 'id']} hidden>
                        <Input />
                      </Form.Item>
                      <Row gutter={[16, 0]}>
                        <Col xs={24} md={8}>
                          <Form.Item
                            name={[field.name, 'name']}
                            label="规则名称"
                            rules={[{ required: true, message: '请输入规则名称' }]}
                          >
                            <Input placeholder="例如：核心实例总余额" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item
                            name={[field.name, 'severity']}
                            label="级别"
                            rules={[{ required: true, message: '请选择级别' }]}
                          >
                            <Select
                              options={[
                                { label: '预警', value: 'warning' },
                                { label: '严重', value: 'critical' },
                              ]}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item
                            name={[field.name, 'threshold']}
                            label="总余额阈值"
                            rules={[{ required: true, message: '请输入总余额阈值' }]}
                          >
                            <InputNumber style={{ width: '100%' }} min={0.01} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item name={[field.name, 'resolve_threshold']} label="恢复阈值">
                            <InputNumber style={{ width: '100%' }} min={0.01} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item name={[field.name, 'enabled']} label="启用" valuePropName="checked">
                            <Switch checkedChildren="启用" unCheckedChildren="停用" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                          <Form.Item
                            name={[field.name, 'instance_ids']}
                            label="实例列表"
                            rules={[
                              {
                                validator: async (_, value) => {
                                  const tags = form.getFieldValue([
                                    'notification_rules',
                                    'aggregate_balance_rules',
                                    field.name,
                                    'tags',
                                  ]);
                                  if ((value?.length ?? 0) > 0 || (tags?.length ?? 0) > 0) {
                                    return;
                                  }
                                  throw new Error('至少选择一个实例或标签');
                                },
                              },
                            ]}
                          >
                            <Select mode="multiple" allowClear placeholder="选择需要合并统计余额的实例" options={instanceOptions} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                          <Form.Item
                            name={[field.name, 'tags']}
                            label="标签筛选"
                            rules={[
                              {
                                validator: async (_, value) => {
                                  const instanceIds = form.getFieldValue([
                                    'notification_rules',
                                    'aggregate_balance_rules',
                                    field.name,
                                    'instance_ids',
                                  ]);
                                  if ((value?.length ?? 0) > 0 || (instanceIds?.length ?? 0) > 0) {
                                    return;
                                  }
                                  throw new Error('至少选择一个实例或标签');
                                },
                              },
                            ]}
                          >
                            <Select mode="multiple" allowClear placeholder="也可以按标签选择一批实例" options={tagOptions} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                          <Form.Item name={[field.name, 'channel_ids']} label="通知渠道">
                            <Select
                              mode="multiple"
                              allowClear
                              placeholder="不选表示发送到默认渠道"
                              options={channelOptions}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                          <Form.Item name={[field.name, 'min_consecutive_checks']} label="连续命中次数">
                            <InputNumber style={{ width: '100%' }} min={1} max={10} precision={0} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                          <Form.Item name={[field.name, 'repeat_interval_minutes']} label="重复提醒间隔（分钟）">
                            <InputNumber style={{ width: '100%' }} min={5} max={10080} precision={0} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item name={[field.name, 'include_disabled']} label="包含停用实例" valuePropName="checked">
                            <Switch checkedChildren="包含" unCheckedChildren="排除" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item name={[field.name, 'notify_on_recovery']} label="恢复通知" valuePropName="checked">
                            <Switch checkedChildren="通知" unCheckedChildren="静默" />
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>
                  ))}

                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(createAggregateBalanceRule())}>
                    新增聚合余额规则
                  </Button>
                </Space>
              )}
            </Form.List>

            <Divider orientation="left">连接失败规则</Divider>
            <Form.List name={['notification_rules', 'connectivity_failure_rules']}>
              {(fields, { add, remove }) => (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {fields.map((field) => (
                    <Card
                      key={field.key}
                      size="small"
                      title={`连接规则 ${field.name + 1}`}
                      extra={
                        <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)}>
                          删除
                        </Button>
                      }
                    >
                      <Form.Item name={[field.name, 'id']} hidden>
                        <Input />
                      </Form.Item>
                      <Row gutter={[16, 0]}>
                        <Col xs={24} md={8}>
                          <Form.Item
                            name={[field.name, 'name']}
                            label="规则名称"
                            rules={[{ required: true, message: '请输入规则名称' }]}
                          >
                            <Input placeholder="例如：实例连续连接失败" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item
                            name={[field.name, 'consecutive_failures']}
                            label="连续失败次数"
                            rules={[{ required: true, message: '请输入连续失败次数' }]}
                          >
                            <InputNumber style={{ width: '100%' }} min={2} max={20} precision={0} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item name={[field.name, 'repeat_interval_minutes']} label="重复提醒间隔（分钟）">
                            <InputNumber style={{ width: '100%' }} min={5} max={10080} precision={0} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item name={[field.name, 'enabled']} label="启用" valuePropName="checked">
                            <Switch checkedChildren="启用" unCheckedChildren="停用" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item name={[field.name, 'notify_on_recovery']} label="恢复通知" valuePropName="checked">
                            <Switch checkedChildren="通知" unCheckedChildren="静默" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                          <Form.Item name={[field.name, 'instance_ids']} label="指定实例">
                            <Select
                              mode="multiple"
                              allowClear
                              placeholder="不选表示匹配全部实例"
                              options={instanceOptions}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                          <Form.Item name={[field.name, 'tags']} label="标签筛选">
                            <Select mode="multiple" allowClear placeholder="按标签匹配实例" options={tagOptions} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                          <Form.Item name={[field.name, 'channel_ids']} label="通知渠道">
                            <Select
                              mode="multiple"
                              allowClear
                              placeholder="不选表示发送到默认渠道"
                              options={channelOptions}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item name={[field.name, 'include_disabled']} label="包含停用实例" valuePropName="checked">
                            <Switch checkedChildren="包含" unCheckedChildren="排除" />
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>
                  ))}

                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(createConnectivityRule())}>
                    新增连接失败规则
                  </Button>
                </Space>
              )}
            </Form.List>

            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              默认规则会覆盖全量预付费实例和全量启用实例。若某条规则没有指定通知渠道，会自动发送到所有已启用渠道。
            </Paragraph>
          </Space>
        </Card>

        <Button type="primary" htmlType="submit" loading={updateMutation.isPending}>
          保存告警通知
        </Button>
      </div>

      <Drawer
        title="告警通知使用说明"
        placement="right"
        width={Math.min(560, typeof window !== 'undefined' ? window.innerWidth : 560)}
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        className="notification-guide-drawer"
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="success"
            showIcon
            message="你想要的两种告警都已内置"
            description="「某标签下任意一个实例余额过低」用实例余额规则 + 标签筛选；「几个实例合计余额过低」用聚合余额规则。下面每一节都有对应配方。"
          />
          <Collapse accordion defaultActiveKey="recipes" items={guideItems} />
          <Text type="secondary">
            配置改动保存后才生效；发送历史可在「通知日志」页查看每条告警的投递结果。
          </Text>
        </Space>
      </Drawer>
    </Form>
  );
}
