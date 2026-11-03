import { useForm } from 'react-hook-form';

import { AppModal, Button, TextField } from './ui';

interface ChangePasswordFormValues {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

interface ChangePasswordModalProps {
  open: boolean;
  loading: boolean;
  onCancel: () => void;
  onSubmit: (values: ChangePasswordFormValues) => void;
}

export function ChangePasswordModal({ open, loading, onCancel, onSubmit }: ChangePasswordModalProps) {
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<ChangePasswordFormValues>();

  const close = () => {
    reset();
    onCancel();
  };

  return (
    <AppModal
      open={open}
      onOpenChange={(value) => { if (!value) close(); }}
      title="修改登录密码"
      description="修改后所有已登录会话仍保持有效，下次登录需使用新密码。"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={close}>取消</Button>
          <Button isPending={loading} onClick={() => void handleSubmit((values) => { onSubmit(values); reset(); })()}>
            保存
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit((values) => { onSubmit(values); reset(); })}>
        <TextField
          label="当前密码"
          required
          error={errors.current_password?.message}
          inputProps={{ type: 'password', autoFocus: true, ...register('current_password', { required: '请输入当前密码' }) }}
        />
        <TextField
          label="新密码"
          required
          error={errors.new_password?.message}
          inputProps={{ type: 'password', ...register('new_password', { required: '请输入新密码', minLength: { value: 6, message: '密码至少 6 位' } }) }}
        />
        <TextField
          label="确认新密码"
          required
          error={errors.confirm_password?.message}
          inputProps={{
            type: 'password',
            ...register('confirm_password', {
              required: '请再次输入新密码',
              validate: (value) => value === watch('new_password') || '两次输入的密码不一致',
            }),
          }}
        />
      </form>
    </AppModal>
  );
}
