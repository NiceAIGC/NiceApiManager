import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';

import { changePassword } from '../api/auth';
import { getErrorMessage } from '../api/client';
import { fetchInstances } from '../api/instances';
import { fetchAppSettings, sendTestNotification, updateAppSettings } from '../api/settings';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import type {
  AggregateBalanceNotificationRule,
  AppSettings,
  BalanceNotificationRule,
  ConnectivityFailureNotificationRule,
  NotificationChannelConfig,
} from '../types/api';
import { formatDateTime, setDisplayTimezone } from '../utils/format';

const { Paragraph, Text } = Typography;

function createId(prefix: string) {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}_${globalThis.crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createNotificationChannel(): NotificationChannelConfig {
  return {
    id: createId('channel'),
    name: '',
    enabled: true,
    apprise_url: '',
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

const defaultSettings: AppSettings = {
  sync_max_workers: 5,
  request_timeout: 20,
  sync_verify_ssl: true,
  scheduler_timezone: 'Asia/Shanghai',
  sync_history_lookback_days: 30,
  default_sync_interval_minutes: 120,
  shared_socks5_proxy_url: '',
  notification_enabled: false,
  notification_check_interval_minutes: 5,
  notification_channels: [],
  notification_rules: {
    low_balance_rules: [createBalanceRule('warning'), createBalanceRule('critical')],
    aggregate_balance_rules: [createAggregateBalanceRule()],
    connectivity_failure_rules: [createConnectivityRule()],
  },
};

export function SettingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<AppSettings>();
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

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
        .filter((item): item is NotificationChannelConfig => Boolean(item?.id && item?.name))
        .map((item) => ({
          label: `${item.name}${item.enabled ? '' : '（已停用）'}`,
          value: item.id,
        })),
    [notificationChannels],
  );

  useEffect(() => {
    if (data) {
      form.setFieldsValue(data);
    } else {
      form.setFieldsValue(defaultSettings);
    }
  }, [data, form]);

  const updateMutation = useMutation({
    mutationFn: (payload: AppSettings) => updateAppSettings(payload),
    onSuccess: async (result) => {
      form.setFieldsValue(result);
      setDisplayTimezone(result.scheduler_timezone);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['app-settings'] }),
        queryClient.invalidateQueries({ queryKey: ['instances'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-trends'] }),
        queryClient.invalidateQueries({ queryKey: ['sync-runs'] }),
      ]);
      message.success('系统设置已保存');
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

  const changePasswordMutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setPasswordModalOpen(false);
      message.success('登录密码修改成功');
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  return (
    <Form<AppSettings>
      form={form}
      layout="vertical"
      initialValues={defaultSettings}
      onFinish={(values) => updateMutation.mutate(values)}
    >
      <div className="page-stack">
        <Card
          className="section-card"
          loading={isLoading}
          extra={<Button onClick={() => setPasswordModalOpen(true)}>修改登录密码</Button>}
        >
          <Space direction="vertical" size={4}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              系统设置
            </Typography.Title>
            <Text type="secondary">这里统一管理运行时配置，保存后新发起的同步、统计和通知检查都会按新配置生效。</Text>
            {data?.updated_at ? <Text type="secondary">最近更新：{formatDateTime(data.updated_at)}</Text> : null}
          </Space>
        </Card>

        <Card className="section-card" title="运行参数">
          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}>
              <Form.Item
                name="sync_max_workers"
                label="批量同步并发数"
                extra="“同步全部”时后端同时跑多少个实例，默认建议 5。"
                rules={[{ required: true, message: '请输入批量同步并发数' }]}
              >
                <InputNumber style={{ width: '100%' }} min={1} max={32} precision={0} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="sync_history_lookback_days"
                label="历史同步天数"
                extra="每次同步会回刷最近多少天的按日用量统计。"
                rules={[{ required: true, message: '请输入历史同步天数' }]}
              >
                <InputNumber style={{ width: '100%' }} min={1} max={365} precision={0} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="request_timeout"
                label="上游请求超时（秒）"
                extra="用于访问各个站点的接口请求。"
                rules={[{ required: true, message: '请输入请求超时' }]}
              >
                <InputNumber style={{ width: '100%' }} min={0.1} max={300} step={1} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="default_sync_interval_minutes"
                label="默认实例同步周期（分钟）"
                extra="新增实例时默认带上的自动同步周期。"
                rules={[{ required: true, message: '请输入默认同步周期' }]}
              >
                <InputNumber style={{ width: '100%' }} min={5} max={10080} precision={0} addonAfter="分钟" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="shared_socks5_proxy_url"
                label="公用 SOCKS5 代理"
                extra="实例选择“公用 SOCKS5”时统一走这里；留空则仍按直连处理。支持 `用户名:密码@主机:端口`，会自动补 `socks5://`。"
              >
                <Input placeholder="例如：user:password@127.0.0.1:1080" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="scheduler_timezone"
                label="统计时区"
                extra="影响今日请求数和按日统计边界，请填写标准 IANA 时区名。"
                rules={[{ required: true, message: '请输入统计时区' }]}
              >
                <Input placeholder="例如 Asia/Shanghai" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="sync_verify_ssl"
                label="校验上游 SSL 证书"
                valuePropName="checked"
                extra="关闭后可连接自签名证书站点，但安全性会下降。"
              >
                <Switch checkedChildren="校验" unCheckedChildren="跳过" />
              </Form.Item>
            </Col>
          </Row>

          <Paragraph type="secondary" style={{ marginTop: 8 }}>
            当前所有同步、统计、代理和历史回刷参数都在这里统一配置。
          </Paragraph>
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
              message="通知由 Apprise 统一下发，支持 Telegram、Discord、飞书、邮件、Webhook 等多种目标。测试通知只会发送到已保存且处于启用状态的渠道。"
            />

            <Row gutter={[16, 0]}>
              <Col xs={24} md={12}>
                <Form.Item
                  name="notification_enabled"
                  label="启用通知巡检"
                  valuePropName="checked"
                  extra="关闭后不会执行余额和连接失败巡检，但测试通知仍可手动发送。"
                >
                  <Switch checkedChildren="已启用" unCheckedChildren="已关闭" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="notification_check_interval_minutes"
                  label="通知巡检间隔（分钟）"
                  extra="调度器按分钟触发，这里控制真正执行规则检查的间隔。"
                  rules={[{ required: true, message: '请输入通知巡检间隔' }]}
                >
                  <InputNumber style={{ width: '100%' }} min={1} max={1440} precision={0} addonAfter="分钟" />
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
                            name={[field.name, 'apprise_url']}
                            label="Apprise URL"
                            rules={[{ required: true, message: '请输入 Apprise URL' }]}
                          >
                            <Input placeholder="例如 apprise://..." />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item name={[field.name, 'enabled']} label="启用" valuePropName="checked">
                            <Switch checkedChildren="启用" unCheckedChildren="停用" />
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>
                  ))}

                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(createNotificationChannel())}>
                    新增通知渠道
                  </Button>
                </Space>
              )}
            </Form.List>

            <Divider orientation="left">实例余额规则</Divider>
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
                              placeholder="不选表示发到全部已启用渠道"
                              options={channelOptions}
                            />
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
                    </Card>
                  ))}

                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(createBalanceRule('warning'))}>
                    新增余额规则
                  </Button>
                </Space>
              )}
            </Form.List>

            <Divider orientation="left">聚合余额规则</Divider>
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
                              placeholder="不选表示发到全部已启用渠道"
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
                              placeholder="不选表示发到全部已启用渠道"
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
          保存设置
        </Button>

        <ChangePasswordModal
          open={passwordModalOpen}
          loading={changePasswordMutation.isPending}
          onCancel={() => setPasswordModalOpen(false)}
          onSubmit={(values) => changePasswordMutation.mutate(values)}
        />
      </div>
    </Form>
  );
}
