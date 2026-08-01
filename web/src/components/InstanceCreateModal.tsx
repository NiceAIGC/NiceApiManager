import { App, Button, Col, Collapse, Descriptions, Form, Input, InputNumber, Modal, Rate, Row, Segmented, Select, Space, Switch, Typography } from '../ui';
import { useEffect, useState } from 'react';

import { getErrorMessage } from '../api/client';
import { testInstanceProxy } from '../api/instances';
import type { Instance, InstanceCreatePayload, InstanceUpdatePayload } from '../types/api';
import { formatNumber, formatProgramType } from '../utils/format';
import { normalizeBaseUrl, normalizeInstancePayload } from '../utils/instance';

interface InstanceCreateModalProps {
  open: boolean;
  loading: boolean;
  mode: 'create' | 'edit';
  initialValues?: Instance | null;
  defaultSyncIntervalMinutes?: number;
  defaultProxyMode?: InstanceCreatePayload['proxy_mode'];
  tagOptions?: Array<{ label: string; value: string }>;
  notificationChannelOptions?: Array<{ label: string; value: string }>;
  onCancel: () => void;
  onSubmit: (values: InstanceCreatePayload | InstanceUpdatePayload) => void;
}

const { Text } = Typography;
type AuthMode = 'password' | 'token';

interface InstanceFormValues extends InstanceCreatePayload {
  auth_mode?: AuthMode;
}

export function InstanceCreateModal({
  open,
  loading,
  mode,
  initialValues,
  defaultSyncIntervalMinutes = 120,
  defaultProxyMode = 'direct',
  tagOptions,
  notificationChannelOptions = [],
  onCancel,
  onSubmit,
}: InstanceCreateModalProps) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<InstanceFormValues | (InstanceUpdatePayload & { auth_mode?: AuthMode })>();
  const [testingProxy, setTestingProxy] = useState(false);
  const proxyMode = Form.useWatch('proxy_mode', form) ?? initialValues?.proxy_mode ?? 'direct';
  const authMode = Form.useWatch('auth_mode', form) ?? inferAuthMode(initialValues);

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        enabled: initialValues?.enabled ?? true,
        base_url: initialValues?.base_url ?? 'https://',
        name: initialValues?.name ?? '',
        remark: initialValues?.remark ?? '',
        program_type: initialValues?.program_type ?? 'auto',
        auth_mode: inferAuthMode(initialValues),
        username: initialValues?.username ?? '',
        password: '',
        remote_user_id: initialValues?.remote_user_id ?? undefined,
        access_token: '',
        proxy_mode: initialValues?.proxy_mode ?? defaultProxyMode,
        socks5_proxy_url: initialValues?.socks5_proxy_url ?? '',
        billing_mode: initialValues?.billing_mode ?? 'prepaid',
        quota_per_unit: initialValues?.quota_per_unit ?? undefined,
        priority: initialValues?.priority ?? 3,
        sync_interval_minutes: initialValues?.sync_interval_minutes ?? defaultSyncIntervalMinutes,
        tags: initialValues?.tags ?? [],
        balance_alert_enabled: initialValues?.balance_alert_enabled ?? false,
        balance_alert_threshold: initialValues?.balance_alert_threshold ?? undefined,
        notification_channel_ids: initialValues?.notification_channel_ids ?? [],
      });
    } else {
      form.resetFields();
    }
  }, [defaultProxyMode, form, initialValues, open]);

  const handleProxyTest = async () => {
    await form.validateFields(proxyMode === 'custom' ? ['base_url', 'proxy_mode', 'socks5_proxy_url'] : ['base_url', 'proxy_mode']);
    const values = form.getFieldsValue(['base_url', 'proxy_mode', 'socks5_proxy_url']) as Pick<
      InstanceCreatePayload,
      'base_url' | 'proxy_mode' | 'socks5_proxy_url'
    >;

    try {
      setTestingProxy(true);
      const result = await testInstanceProxy({
        base_url: normalizeBaseUrl(values.base_url),
        proxy_mode: values.proxy_mode,
        socks5_proxy_url: values.socks5_proxy_url,
      });

      modal.success({
        title: '代理测试成功',
        content: (
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="目标地址">{result.base_url}</Descriptions.Item>
            <Descriptions.Item label="代理方式">
              {result.proxy_mode === 'custom'
                ? '自定义 SOCKS5'
                : result.proxy_mode === 'global'
                  ? '公用 SOCKS5'
                  : '本地直连'}
            </Descriptions.Item>
            <Descriptions.Item label="实际代理">{result.resolved_proxy_url || '本地直连'}</Descriptions.Item>
            <Descriptions.Item label="识别程序">{formatProgramType(result.detected_program_type)}</Descriptions.Item>
            <Descriptions.Item label="兑换比">{formatNumber(result.quota_per_unit)}</Descriptions.Item>
          </Descriptions>
        ),
      });
    } catch (error) {
      message.error(getErrorMessage(error));
    } finally {
      setTestingProxy(false);
    }
  };

  return (
    <Modal
      title={mode === 'create' ? '新增实例' : '编辑实例'}
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText={mode === 'create' ? '保存' : '更新'}
      cancelText="取消"
      confirmLoading={loading}
      destroyOnHidden
      width={960}
      styles={{ body: { maxHeight: '72vh', overflowY: 'auto', paddingRight: 8 } }}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => {
          const normalized = normalizeInstancePayload(values);
          if (values.auth_mode === 'password') {
            normalized.remote_user_id = undefined;
            normalized.access_token = '';
          } else {
            normalized.username = '';
            normalized.password = '';
          }
          onSubmit(normalized);
        }}
      >
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item
              name="name"
              label="实例名称"
              rules={[{ required: true, message: '请输入实例名称' }]}
            >
              <Input placeholder="例如：gac 主站" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="remark" label="备注">
              <Input placeholder="例如：主力 / 备用 / 仅 Claude Code" maxLength={255} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="program_type"
              label="程序类型"
              rules={[{ required: true, message: '请选择程序类型' }]}
              extra="默认自动识别；识别不到或新增前已知类型时可手动选择。"
            >
              <Select
                options={[
                  { label: '自动识别', value: 'auto' },
                  { label: 'NewAPI', value: 'newapi' },
                  { label: 'RixAPI', value: 'rixapi' },
                  { label: 'ShellAPI', value: 'shellapi' },
                  { label: 'Sub2API', value: 'sub2api' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="base_url"
              label="Base URL"
              rules={[
                { required: true, message: '请输入实例地址' },
                { type: 'url', message: '请输入合法的 URL' },
              ]}
            >
              <Input
                placeholder="https://example.com"
                onBlur={(event) => {
                  form.setFieldValue('base_url', normalizeBaseUrl(event.target.value));
                }}
              />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="auth_mode" label="认证方式" rules={[{ required: true, message: '请选择认证方式' }]}>
              <Segmented
                options={[
                  { label: '账密登录', value: 'password' },
                  { label: '访问密钥', value: 'token' },
                ]}
              />
            </Form.Item>
          </Col>
          {authMode === 'password' ? (
            <>
              <Col xs={24} md={12}>
                <Form.Item name="username" label="用户名 / 邮箱" rules={[{ required: true, message: '请输入用户名或邮箱' }]}>
                  <Input placeholder="远端站点用户名或邮箱" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="password"
                  label="密码"
                  rules={mode === 'create' ? [{ required: true, message: '请输入密码' }] : undefined}
                  extra={mode === 'edit' ? '留空则保持现有密码。' : undefined}
                >
                  <Input.Password placeholder={mode === 'create' ? '远端站点密码' : '留空则保持现有密码'} />
                </Form.Item>
              </Col>
            </>
          ) : (
            <>
              <Col xs={24} md={12}>
                <Form.Item name="remote_user_id" label="远端用户 ID" extra="NewAPI/RixAPI/ShellAPI 的 Access Token 模式通常需要填写。">
                  <InputNumber style={{ width: '100%' }} min={1} precision={0} placeholder="例如：11766" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="access_token"
                  label="访问密钥"
                  rules={mode === 'create' ? [{ required: true, message: '请输入访问密钥' }] : undefined}
                  extra={mode === 'edit' && initialValues?.has_access_token ? '留空则保持现有访问密钥。' : undefined}
                >
                  <Input.Password placeholder={mode === 'create' ? 'Access Token / JWT' : '留空则保持现有访问密钥'} />
                </Form.Item>
              </Col>
            </>
          )}
          <Col xs={24} md={12}>
            <Form.Item
              name="priority"
              label="常用优先级"
              extra="最低 1 星，最高 5 星，默认 3 星。"
              rules={[{ required: true, message: '请选择优先级' }]}
            >
              <Rate count={5} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="sync_interval_minutes"
              label="同步周期（分钟）"
              extra="后台自动同步按这里的周期执行。"
              rules={[{ required: true, message: '请输入同步周期' }]}
            >
              <InputNumber style={{ width: '100%' }} min={5} max={10080} precision={0} addonAfter="分钟" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="balance_alert_enabled"
              label="余额告警通知"
              valuePropName="checked"
              extra={mode === 'create' ? '新建默认关闭；开启后余额低于阈值时直接通知。' : '快捷规则；高级匹配请到“告警通知”统一管理。'}
            >
              <Switch checkedChildren="已开启" unCheckedChildren="未开启" />
            </Form.Item>
          </Col>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.balance_alert_enabled !== next.balance_alert_enabled}>
            {() =>
              form.getFieldValue('balance_alert_enabled') ? (
                <>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="balance_alert_threshold"
                      label="余额告警阈值"
                      extra="留空使用全局默认值。"
                    >
                      <InputNumber style={{ width: '100%' }} min={0.01} placeholder="使用全局默认值" />
                    </Form.Item>
                  </Col>
                  <Col xs={24}>
                    <Form.Item
                      name="notification_channel_ids"
                      label="发送渠道"
                      extra="留空走默认通知渠道；可选择多个实例专属渠道。"
                    >
                      <Select mode="multiple" allowClear options={notificationChannelOptions} placeholder="默认通知渠道" />
                    </Form.Item>
                  </Col>
                </>
              ) : null
            }
          </Form.Item>
          <Col xs={24}>
            <Collapse
              ghost
              items={[
                {
                  key: 'advanced',
                  label: '高级设置',
                  children: (
                    <Row gutter={16}>
                      <Col xs={24} md={12}>
                        <Form.Item
                          name="billing_mode"
                          label="计费方式"
                          rules={[{ required: true, message: '请选择计费方式' }]}
                          extra="后付费站点只统计周期内已用额度，不展示余额。"
                        >
                          <Select
                            options={[
                              { label: '预付费', value: 'prepaid' },
                              { label: '后付费', value: 'postpaid' },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item
                          name="quota_per_unit"
                          label="余额倍率"
                          extra="留空则使用远端识别值；Sub2API 未填写时默认 1.0。"
                        >
                          <InputNumber style={{ width: '100%' }} min={0.000001} precision={6} placeholder="例如：1.0" />
                        </Form.Item>
                      </Col>
                    </Row>
                  ),
                },
              ]}
            />
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="proxy_mode"
              label="代理方式"
              rules={[{ required: true, message: '请选择代理方式' }]}
              extra="默认直连；也可以走系统设置里的公用 SOCKS5，或为该实例单独指定自定义代理。"
            >
              <Select
                options={[
                  { label: '本地直连', value: 'direct' },
                  { label: '公用 SOCKS5', value: 'global' },
                  { label: '自定义 SOCKS5', value: 'custom' },
                ]}
              />
            </Form.Item>
          </Col>
          {proxyMode === 'custom' ? (
            <Col xs={24} md={12}>
              <Form.Item
                name="socks5_proxy_url"
                label="自定义 SOCKS5 代理"
                extra="支持 `用户名:密码@主机:端口`，会自动补 `socks5://`。"
                rules={[{ required: true, message: '请输入自定义 SOCKS5 代理' }]}
              >
                <Input placeholder="例如：xxxmit3t:Sxxxxx@6xxx37.233:2xxx" />
              </Form.Item>
            </Col>
          ) : null}
          {proxyMode !== 'direct' ? (
            <Col xs={24} md={proxyMode === 'custom' ? 12 : 24}>
              <Form.Item label="代理测试">
                <Space>
                  <Button onClick={handleProxyTest} loading={testingProxy}>
                    测试当前代理
                  </Button>
                  <Text type="secondary">会使用当前 Base URL 请求远端 `/api/status`。</Text>
                </Space>
              </Form.Item>
            </Col>
          ) : null}
          <Col xs={24} md={12}>
            <Form.Item
              name="tags"
              label="标签"
            >
              <Select
                mode="tags"
                options={tagOptions}
                tokenSeparators={[',']}
                placeholder="可直接选择已有标签，也可输入新标签"
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="enabled" label="启用状态" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}

function inferAuthMode(initialValues?: Instance | null): AuthMode {
  if (initialValues?.has_access_token && !initialValues.username) {
    return 'token';
  }
  return 'password';
}
