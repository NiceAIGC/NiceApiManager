import { Button } from '@heroui/react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';

import { AppModal, TextInput } from './ui';
import type { ChangePasswordPayload } from '../types/api';

interface ChangePasswordModalProps {
  open: boolean;
  loading: boolean;
  onCancel: () => void;
  onSubmit: (values: ChangePasswordPayload) => void;
}

interface ChangePasswordFormValues extends ChangePasswordPayload {
  confirm_password: string;
}

const defaultValues: ChangePasswordFormValues = { current_password: '', new_password: '', confirm_password: '' };

export function ChangePasswordModal({ open, loading, onCancel, onSubmit }: ChangePasswordModalProps) {
  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<ChangePasswordFormValues>({ defaultValues });
  const newPassword = watch('new_password');

  useEffect(() => { if (open) reset(defaultValues); }, [open, reset]);

  const close = () => {
    reset(defaultValues);
    onCancel();
  };

  const submit = handleSubmit((values) => {
    onSubmit({ current_password: values.current_password, new_password: values.new_password });
    reset(defaultValues);
  });

  return (
    <AppModal
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen) close(); }}
      title="修改登录密码"
      footer={<><Button variant="secondary" onPress={close}>取消</Button><Button variant="primary" isPending={loading} onPress={() => { void submit(); }}>保存密码</Button></>}
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <TextInput label="当前密码" required error={errors.current_password?.message} inputProps={{ type: 'password', ...register('current_password', { required: '请输入当前密码' }) }} />
        <TextInput label="新密码" required error={errors.new_password?.message} inputProps={{ type: 'password', ...register('new_password', { required: '请输入新密码', minLength: { value: 6, message: '新密码至少 6 位' } }) }} />
        <TextInput label="确认新密码" required error={errors.confirm_password?.message} inputProps={{ type: 'password', ...register('confirm_password', { required: '请再次输入新密码', validate: (value) => value === newPassword || '两次输入的新密码不一致' }) }} />
      </form>
    </AppModal>
  );
}
