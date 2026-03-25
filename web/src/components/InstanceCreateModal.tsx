import { Modal, Form, Input, InputNumber, Select, Switch } from 'antd';
import { useEffect } from 'react';

import type { Instance, InstanceCreatePayload, InstanceUpdatePayload } from '../types/api';
import { normalizeBaseUrl, normalizeInstancePayload } from '../utils/instance';

interface InstanceCreateModalProps {
  open: boolean;
  loading: boolean;
  mode: 'create' | 'edit';
  initialValues?: Instance | null;
  tagOptions?: Array<{ label: string; value: string }>;
  onCancel: () => void;
  onSubmit: (values: InstanceCreatePayload | InstanceUpdatePayload) => void;
}

export function InstanceCreateModal({
  open,
  loading,
  mode,
  initialValues,
  tagOptions,
  onCancel,
  onSubmit,
}: InstanceCreateModalProps) {
  const [form] = Form.useForm<InstanceCreatePayload | InstanceUpdatePayload>();

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        enabled: initialValues?.enabled ?? true,
        base_url: initialValues?.base_url ?? 'https://',
        name: initialValues?.name ?? '',
        program_type: initialValues?.program_type ?? 'newapi',
        username: initialValues?.username ?? '',
        password: '',
        remote_user_id: initialValues?.remote_user_id ?? undefined,
        access_token: '',
        billing_mode: initialValues?.billing_mode ?? 'prepaid',
        tags: initialValues?.tags ?? [],
      });
    } else {
      form.resetFields();
    }
  }, [form, initialValues, open]);

  const accessTokenExtra =
    mode === 'edit' && initialValues?.has_access_token
      ? '留空则保持现有访问密钥。'
      : '与远端用户 ID 配合使用；账密和 ID+密钥二选一即可。';

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
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => onSubmit(normalizeInstancePayload(values))}
      >
        <Form.Item
          name="name"
          label="实例名称"
          rules={[{ required: true, message: '请输入实例名称' }]}
        >
          <Input placeholder="例如：gac 主站" />
        </Form.Item>
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
        <Form.Item
          name="program_type"
          label="程序类型"
          rules={[{ required: true, message: '请选择程序类型' }]}
          extra="默认按 NewAPI 处理；如站点是二开程序，可切到对应类型。"
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
          name="username"
          label="用户名"
          extra="使用账密登录时填写。与远端用户 ID + 访问密钥二选一即可。"
        >
          <Input placeholder="远端站点用户名" />
        </Form.Item>
        <Form.Item
          name="password"
          label="密码"
          extra={mode === 'create' ? '使用账密登录时填写。' : '留空则保持现有密码。'}
        >
          <Input.Password placeholder={mode === 'create' ? '远端站点密码' : '留空则保持现有密码'} />
        </Form.Item>
        <Form.Item
          name="remote_user_id"
          label="远端用户 ID"
          extra="使用 Access Token / 管理密钥时填写。"
        >
          <InputNumber style={{ width: '100%' }} min={1} precision={0} placeholder="例如：11766" />
        </Form.Item>
        <Form.Item
          name="access_token"
          label="访问密钥"
          extra={accessTokenExtra}
        >
          <Input.Password placeholder={mode === 'create' ? 'Access Token / 管理密钥' : '留空则保持现有访问密钥'} />
        </Form.Item>
        <Form.Item
          name="billing_mode"
          label="计费方式"
          rules={[{ required: true, message: '请选择计费方式' }]}
          extra="默认预付费；后付费站点只统计周期内已用额度，不展示余额。"
        >
          <Select
            options={[
              { label: '预付费', value: 'prepaid' },
              { label: '后付费', value: 'postpaid' },
            ]}
          />
        </Form.Item>
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
        <Form.Item name="enabled" label="启用状态" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="停用" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
