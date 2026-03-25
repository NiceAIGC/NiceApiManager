import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch } from 'antd';
import { useEffect } from 'react';

import type { BatchInstanceUpdatePayload, Instance, InstanceCreatePayload } from '../types/api';
import { normalizeBaseUrl, normalizeInstancePayload } from '../utils/instance';

interface BatchFormValues {
  items: Array<InstanceCreatePayload | BatchInstanceUpdatePayload>;
}

interface InstanceBatchModalProps {
  open: boolean;
  loading: boolean;
  mode: 'create' | 'edit';
  initialItems?: Instance[];
  tagOptions?: Array<{ label: string; value: string }>;
  onCancel: () => void;
  onSubmit: (items: Array<InstanceCreatePayload | BatchInstanceUpdatePayload>) => void;
}

function buildEmptyItem(): InstanceCreatePayload {
  return {
    name: '',
    base_url: 'https://',
    program_type: 'newapi',
    username: '',
    password: '',
    remote_user_id: undefined,
    access_token: '',
    enabled: true,
    billing_mode: 'prepaid',
    tags: [],
  };
}

export function InstanceBatchModal({
  open,
  loading,
  mode,
  initialItems,
  tagOptions,
  onCancel,
  onSubmit,
}: InstanceBatchModalProps) {
  const [form] = Form.useForm<BatchFormValues>();

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
          enabled: item.enabled,
          billing_mode: item.billing_mode,
          tags: item.tags,
        })),
      });
      return;
    }

    form.setFieldsValue({ items: [buildEmptyItem()] });
  }, [form, initialItems, mode, open]);

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
                    onClick={() => add(buildEmptyItem())}
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
