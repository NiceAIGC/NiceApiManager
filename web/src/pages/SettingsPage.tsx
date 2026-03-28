import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Col, Form, Input, InputNumber, Row, Space, Switch, Typography } from 'antd';
import { useEffect, useState } from 'react';

import { changePassword } from '../api/auth';
import { getErrorMessage } from '../api/client';
import { fetchAppSettings, updateAppSettings } from '../api/settings';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import type { AppSettings } from '../types/api';
import { formatDateTime, setDisplayTimezone } from '../utils/format';

const { Paragraph, Text } = Typography;

export function SettingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<AppSettings>();
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['app-settings'],
    queryFn: fetchAppSettings,
  });

  useEffect(() => {
    if (data) {
      form.setFieldsValue(data);
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
    <div className="page-stack">
      <Card
        className="section-card"
        loading={isLoading}
        extra={
          <Button onClick={() => setPasswordModalOpen(true)}>
            修改登录密码
          </Button>
        }
      >
        <Space direction="vertical" size={4}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            系统设置
          </Typography.Title>
          <Text type="secondary">这里统一管理运行时配置，保存后新发起的同步和统计请求会按新配置生效。</Text>
          {data?.updated_at ? <Text type="secondary">最近更新：{formatDateTime(data.updated_at)}</Text> : null}
        </Space>
      </Card>

      <Card className="section-card">
        <Form<AppSettings>
          form={form}
          layout="vertical"
          initialValues={{
            sync_max_workers: 5,
            request_timeout: 20,
            sync_verify_ssl: true,
            scheduler_timezone: 'Asia/Shanghai',
            sync_history_lookback_days: 30,
            default_sync_interval_minutes: 120,
            shared_socks5_proxy_url: '',
          }}
          onFinish={(values) => updateMutation.mutate(values)}
        >
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
            当前先把同步与统计相关参数接成可配置，后续其他运行参数也可以继续扩到这里。
          </Paragraph>

          <Button type="primary" htmlType="submit" loading={updateMutation.isPending}>
            保存设置
          </Button>
        </Form>
      </Card>

      <ChangePasswordModal
        open={passwordModalOpen}
        loading={changePasswordMutation.isPending}
        onCancel={() => setPasswordModalOpen(false)}
        onSubmit={(values) => changePasswordMutation.mutate(values)}
      />
    </div>
  );
}
