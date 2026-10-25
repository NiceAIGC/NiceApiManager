import { Button, Card } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { fetchAuthStatus, login } from '../api/auth';
import { getErrorMessage } from '../api/client';
import { TextInput } from '../components/ui';
import { notify } from '../lib/toast';

interface LoginFormValues {
  password: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>();

  const { data, isLoading } = useQuery({
    queryKey: ['auth-status'],
    queryFn: fetchAuthStatus,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: (password: string) => login(password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth-status'] });
      navigate((location.state as { from?: string } | null)?.from || '/dashboard', { replace: true });
    },
    onError: (error) => {
      notify.error(getErrorMessage(error));
    },
  });

  if (!isLoading && data?.authenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <Card.Content className="flex flex-col gap-6 p-8">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
              <Lock size={22} />
            </div>
            <h1 className="m-0 text-xl font-bold">NiceApiManager</h1>
            <p className="m-0 text-sm text-muted">中转站聚合管理后台</p>
          </div>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit((values) => loginMutation.mutate(values.password))}>
            <TextInput
              label="访问密码"
              required
              error={errors.password?.message}
              inputProps={{
                type: 'password',
                autoFocus: true,
                placeholder: '请输入系统访问密码',
                ...register('password', { required: '请输入访问密码' }),
              }}
            />
            <Button type="submit" variant="primary" fullWidth isPending={loginMutation.isPending}>
              进入系统
            </Button>
          </form>
        </Card.Content>
      </Card>
    </div>
  );
}
