import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { fetchAuthStatus, login } from '../api/auth';
import { getErrorMessage } from '../api/client';
import { Button, Card, CardContent, TextField } from '../components/ui';
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

  const { data, isLoading } = useQuery({ queryKey: ['auth-status'], queryFn: fetchAuthStatus, retry: false });

  const loginMutation = useMutation({
    mutationFn: (password: string) => login(password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth-status'] });
      navigate((location.state as { from?: string } | null)?.from || '/dashboard', { replace: true });
    },
    onError: (error) => notify.error(getErrorMessage(error)),
  });

  if (!isLoading && data?.authenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col gap-6 p-6 pt-2">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Lock className="size-5" />
            </div>
            <div>
              <h1 className="m-0 text-lg font-semibold">NiceApiManager</h1>
              <p className="m-0 mt-1 text-sm text-muted-foreground">中转站聚合管理后台</p>
            </div>
          </div>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit((values) => loginMutation.mutate(values.password))}>
            <TextField
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
            <Button type="submit" className="w-full" isPending={loginMutation.isPending}>
              进入系统
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
