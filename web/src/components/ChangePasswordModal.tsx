import { Modal, Form, Input } from 'antd';

import type { ChangePasswordPayload } from '../types/api';

interface ChangePasswordModalProps {
  open: boolean;
  loading: boolean;
  onCancel: () => void;
  onSubmit: (values: ChangePasswordPayload) => void;
}

export function ChangePasswordModal({
  open,
  loading,
  onCancel,
  onSubmit,
}: ChangePasswordModalProps) {
  const [form] = Form.useForm<ChangePasswordPayload & { confirm_password: string }>();

  return (
    <Modal
      open={open}
      title="修改登录密码"
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      onOk={() => form.submit()}
      okText="保存密码"
      cancelText="取消"
      confirmLoading={loading}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => {
          onSubmit({
            current_password: values.current_password,
            new_password: values.new_password,
          });
          form.resetFields();
        }}
      >
        <Form.Item
          name="current_password"
          label="当前密码"
          rules={[{ required: true, message: '请输入当前密码' }]}
        >
          <Input.Password />
        </Form.Item>
        <Form.Item
          name="new_password"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '新密码至少 6 位' },
          ]}
        >
          <Input.Password />
        </Form.Item>
        <Form.Item
          name="confirm_password"
          label="确认新密码"
          dependencies={['new_password']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('new_password') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error('两次输入的新密码不一致'));
              },
            }),
          ]}
        >
          <Input.Password />
        </Form.Item>
      </Form>
    </Modal>
  );
}
