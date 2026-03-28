import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Rate, Select, Space, Switch, Typography } from 'antd';
import { useEffect, useState } from 'react';

import { getErrorMessage } from '../api/client';
import { testInstanceProxy } from '../api/instances';
import type { BatchInstanceUpdatePayload, Instance, InstanceCreatePayload } from '../types/api';
import { formatNumber, formatProgramType } from '../utils/format';
import { normalizeBaseUrl, normalizeInstancePayload } from '../utils/instance';

interface BatchFormValues {
  items: Array<InstanceCreatePayload | BatchInstanceUpdatePayload>;
}

interface InstanceBatchModalProps {
  open: boolean;
  loading: boolean;
  mode: 'create' | 'edit';
  initialItems?: Instance[];
  defaultSyncIntervalMinutes?: number;
  tagOptions?: Array<{ label: string; value: string }>;
  onCancel: () => void;
  onSubmit: (items: Array<InstanceCreatePayload | BatchInstanceUpdatePayload>) => void;
}

const { Text } = Typography;

function buildEmptyItem(): InstanceCreatePayload {
  return {
    name: '',
    base_url: 'https://',
    program_type: 'newapi',
    username: '',
    password: '',
    remote_user_id: undefined,
    access_token: '',
    proxy_mode: 'direct',
    socks5_proxy_url: '',
    enabled: true,
    billing_mode: 'prepaid',
    priority: 3,
    sync_interval_minutes: 120,
    tags: [],
  };
}

export function InstanceBatchModal({
  open,
  loading,
  mode,
  initialItems,
  defaultSyncIntervalMinutes = 120,
  tagOptions,
  onCancel,
  onSubmit,
}: InstanceBatchModalProps) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<BatchFormValues>();
  const [testingFieldKey, setTestingFieldKey] = useState<number | null>(null);

  useEffect(() => {
    if (!open) {
      form.resetFields();
      return;
    }

    if (mode === 'edit') {
      form.setFieldsValue({
        items: (initialItems ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          base_url: item.base_url,
          program_type: item.program_type,
          username: item.username,
          password: '',
          remote_user_id: item.remote_user_id ?? undefined,
          access_token: '',
          proxy_mode: item.proxy_mode,
          socks5_proxy_url: item.socks5_proxy_url ?? '',
          enabled: item.enabled,
          billing_mode: item.billing_mode,
          priority: item.priority,
          sync_interval_minutes: item.sync_interval_minutes,
          tags: item.tags,
        })),
      });
      return;
    }

    form.setFieldsValue({
      items: [
        {
          ...buildEmptyItem(),
          sync_interval_minutes: defaultSyncIntervalMinutes,
        },
      ],
    });
  }, [defaultSyncIntervalMinutes, form, initialItems, mode, open]);

  const handleProxyTest = async (fieldName: number, fieldKey: number) => {
    const proxyMode = form.getFieldValue(['items', fieldName, 'proxy_mode']) as InstanceCreatePayload['proxy_mode'];
    await form.validateFields(
      proxyMode === 'custom'
        ? [['items', fieldName, 'base_url'], ['items', fieldName, 'proxy_mode'], ['items', fieldName, 'socks5_proxy_url']]
        : [['items', fieldName, 'base_url'], ['items', fieldName, 'proxy_mode']],
    );

    try {
      const values = form.getFieldValue(['items', fieldName]) as InstanceCreatePayload;
      setTestingFieldKey(fieldKey);
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
      setTestingFieldKey(null);
    }
  };

  return (
    <Modal
      open={open}
      title={mode === 'create' ? '批量新增实例' : '批量编辑实例'}
      width={1100}
      destroyOnHidden
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText={mode === 'create' ? '批量保存' : '批量更新'}
      cancelText="取消"
      confirmLoading={loading}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => onSubmit(values.items.map((item) => normalizeInstancePayload(item)))}
      >
        <Form.List name="items">
          {(fields, { add, remove }) => (
            <div className="page-stack">
              {fields.map((field, index) => (
                <Card
                  key={field.key}
                  size="small"
                  title={mode === 'create' ? `实例 ${index + 1}` : `实例 ID ${(form.getFieldValue(['items', index, 'id']) as number) || '-'}`}
                  extra={
                    mode === 'create' ? (
                      <Button
                        danger
                        type="text"
                        icon={<DeleteOutlined />}
                        onClick={() => remove(field.name)}
                        disabled={fields.length === 1}
                      >
                        删除本行
                      </Button>
                    ) : null
                  }
                >
                  {mode === 'edit' ? (
                    <Form.Item name={[field.name, 'id']} hidden>
                      <Input />
                    </Form.Item>
                  ) : null}

                  <div className="instance-batch-grid">
                    <Form.Item
                      name={[field.name, 'name']}
                      label="实例名称"
                      rules={[{ required: true, message: '请输入实例名称' }]}
                    >
                      <Input placeholder="例如：gac 主站" />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'base_url']}
                      label="Base URL"
                      rules={[
                        { required: true, message: '请输入实例地址' },
                        { type: 'url', message: '请输入合法的 URL' },
                      ]}
                    >
                      <Input
                        placeholder="https://example.com"
                        onBlur={(event) => {
                          form.setFieldValue(
                            ['items', field.name, 'base_url'],
                            normalizeBaseUrl(event.target.value),
                          );
                        }}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'program_type']}
                      label="程序类型"
                      rules={[{ required: true, message: '请选择程序类型' }]}
                    >
                      <Select
                        options={[
                          { label: 'NewAPI', value: 'newapi' },
                          { label: 'RixAPI', value: 'rixapi' },
                          { label: 'ShellAPI', value: 'shellapi' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'billing_mode']}
                      label="计费方式"
                      rules={[{ required: true, message: '请选择计费方式' }]}
                    >
                      <Select
                        options={[
                          { label: '预付费', value: 'prepaid' },
                          { label: '后付费', value: 'postpaid' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'username']}
                      label="用户名"
                      extra="账密登录时填写。"
                    >
                      <Input placeholder="远端站点用户名" />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'password']}
                      label="密码"
                      extra={mode === 'create' ? '账密登录时填写。' : '留空则保持现有密码。'}
                    >
                      <Input.Password placeholder={mode === 'create' ? '远端站点密码' : '留空则保持现有密码'} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'remote_user_id']}
                      label="远端用户 ID"
                      extra="ID + 密钥模式时填写。"
                    >
                      <InputNumber style={{ width: '100%' }} min={1} precision={0} placeholder="例如：11766" />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'access_token']}
                      label="访问密钥"
                      extra={mode === 'create' ? 'ID + 密钥模式时填写。' : '留空则保持现有访问密钥。'}
                    >
                      <Input.Password placeholder={mode === 'create' ? 'Access Token / 管理密钥' : '留空则保持现有访问密钥'} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'priority']}
                      label="常用优先级"
                      rules={[{ required: true, message: '请选择优先级' }]}
                    >
                      <Rate count={5} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'proxy_mode']}
                      label="代理方式"
                      rules={[{ required: true, message: '请选择代理方式' }]}
                    >
                      <Select
                        options={[
                          { label: '本地直连', value: 'direct' },
                          { label: '公用 SOCKS5', value: 'global' },
                          { label: '自定义 SOCKS5', value: 'custom' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, next) =>
                        prev.items?.[field.name]?.proxy_mode !== next.items?.[field.name]?.proxy_mode
                      }
                    >
                      {() =>
                        form.getFieldValue(['items', field.name, 'proxy_mode']) === 'custom' ? (
                          <Form.Item
                            name={[field.name, 'socks5_proxy_url']}
                            label="自定义 SOCKS5 代理"
                            extra="支持 `用户名:密码@主机:端口`，会自动补 `socks5://`。"
                            rules={[{ required: true, message: '请输入自定义 SOCKS5 代理' }]}
                          >
                            <Input placeholder="例如：xxxmit3t:Sxxxxx@6xxx37.233:2xxx" />
                          </Form.Item>
                        ) : null
                      }
                    </Form.Item>
                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, next) =>
                        prev.items?.[field.name]?.proxy_mode !== next.items?.[field.name]?.proxy_mode
                      }
                    >
                      {() => {
                        const currentProxyMode = form.getFieldValue(['items', field.name, 'proxy_mode']) as InstanceCreatePayload['proxy_mode'];
                        if (currentProxyMode === 'direct') {
                          return null;
                        }

                        return (
                          <Form.Item label="代理测试">
                            <Space>
                              <Button
                                onClick={() => handleProxyTest(field.name, field.key)}
                                loading={testingFieldKey === field.key}
                              >
                                测试当前代理
                              </Button>
                              <Text type="secondary">会使用当前 Base URL 请求远端 `/api/status`。</Text>
                            </Space>
                          </Form.Item>
                        );
                      }}
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'sync_interval_minutes']}
                      label="同步周期（分钟）"
                      rules={[{ required: true, message: '请输入同步周期' }]}
                    >
                      <InputNumber style={{ width: '100%' }} min={5} max={10080} precision={0} addonAfter="分钟" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'tags']} label="标签">
                      <Select
                        mode="tags"
                        options={tagOptions}
                        tokenSeparators={[',']}
                        placeholder="可直接选择已有标签，也可输入新标签"
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, 'enabled']} label="启用状态" valuePropName="checked">
                      <Switch checkedChildren="启用" unCheckedChildren="停用" />
                    </Form.Item>
                  </div>
                </Card>
              ))}

              {mode === 'create' ? (
                <Space>
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() =>
                      add({
                        ...buildEmptyItem(),
                        sync_interval_minutes: defaultSyncIntervalMinutes,
                      })
                    }
                  >
                    再添加一行
                  </Button>
                </Space>
              ) : null}
            </div>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}
