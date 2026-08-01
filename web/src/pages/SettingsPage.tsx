import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App,
Button,
Card,
Col,
Form,
Input,
InputNumber,
Row,
Select,
Space,
Switch,
Typography, } from '../ui';
import { useEffect, useState } from 'react';

import { changePassword } from '../api/auth';
import { getErrorMessage } from '../api/client';
import { fetchAppSettings, updateAppSettings } from '../api/settings';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import type { AppSettings } from '../types/api';
import { formatDateTime, setDisplayTimezone } from '../utils/format';

const { Paragraph, Text } = Typography;

type RuntimeSettingsFormValues = Pick<
  AppSettings,
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
  if (!settings) {
    return defaultRuntimeSettings;
  }
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
    notification_rules: current?.notification_rules ?? {
      low_balance_rules: [],
      aggregate_balance_rules: [],
      connectivity_failure_rules: [],
    },
  };
}

export function SettingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<RuntimeSettingsFormValues>();
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['app-settings'],
    queryFn: fetchAppSettings,
  });

  useEffect(() => {
    form.setFieldsValue(normalizeRuntimeSettings(data));
  }, [data, form]);

  const updateMutation = useMutation({
    mutationFn: (payload: AppSettings) => updateAppSettings(payload),
    onSuccess: async (result) => {
      form.setFieldsValue(normalizeRuntimeSettings(result));
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
    <Form<RuntimeSettingsFormValues>
      form={form}
      layout="vertical"
      initialValues={defaultRuntimeSettings}
      onFinish={(values) => updateMutation.mutate(buildSettingsPayload(values, data))}
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
            <Text type="secondary">这里统一管理运行时配置，保存后新发起的同步和统计都会按新配置生效。</Text>
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
                name="default_instance_proxy_mode"
                label="新增实例默认代理"
                extra="选择公用 SOCKS5 后，新建实例默认走上面的公用代理；仍可在实例表单里改回直连或自定义。"
                rules={[{ required: true, message: '请选择新增实例默认代理' }]}
              >
                <Select
                  options={[
                    { label: '本地直连', value: 'direct' },
                    { label: '公用 SOCKS5', value: 'global' },
                  ]}
                />
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
            告警通知已移动到左侧单独页面，运行参数保存不会改动已配置的通知渠道和规则。
          </Paragraph>
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
