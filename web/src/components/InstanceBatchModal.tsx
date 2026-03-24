import { Button, Card, Form, Input, Modal, Select, Space, Switch } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect } from 'react';

import type { BatchInstanceUpdatePayload, Instance, InstanceCreatePayload } from '../types/api';

interface BatchFormValues {
  items: Array<InstanceCreatePayload | BatchInstanceUpdatePayload>;
}

interface InstanceBatchModalProps {
  open: boolean;
  loading: boolean;
  mode: 'create' | 'edit';
  initialItems?: Instance[];
  onCancel: () => void;
  onSubmit: (items: Array<InstanceCreatePayload | BatchInstanceUpdatePayload>) => void;
}

function buildEmptyItem(): InstanceCreatePayload {
  return {
    name: '',
    base_url: 'https://',
    username: '',
    password: '',
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
          username: item.username,
          password: '',
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
      width={960}
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
        onFinish={(values) => onSubmit(values.items)}
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
                      <Input placeholder="https://example.com" />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'username']}
                      label="用户名"
                      rules={[{ required: true, message: '请输入用户名' }]}
                    >
                      <Input placeholder="远端 NewAPI 用户名" />
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
                      name={[field.name, 'password']}
                      label="密码"
                      rules={mode === 'create' ? [{ required: true, message: '请输入密码' }] : undefined}
                    >
                      <Input.Password placeholder={mode === 'create' ? '远端 NewAPI 密码' : '留空则保持现有密码'} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'tags']} label="标签">
                      <Select
                        mode="tags"
                        tokenSeparators={[',']}
                        placeholder="输入标签后回车"
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
