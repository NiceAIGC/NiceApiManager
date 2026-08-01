import { Button, Card, CardBody, CardHeader, Input, Spinner, addToast } from '@heroui/react';
import { LockKeyhole } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { fetchAuthStatus, login } from '../api/auth';
import { getErrorMessage } from '../api/client';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['auth-status'], queryFn: fetchAuthStatus, retry: false });
  const loginMutation = useMutation({ mutationFn: login, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['auth-status'] }); navigate((location.state as { from?: string } | null)?.from ?? '/dashboard', { replace: true }); }, onError: (error) => addToast({ title: '登录失败', description: getErrorMessage(error), color: 'danger' }) });
  if (!isLoading && data?.authenticated) return <Navigate replace to="/dashboard" />;
  return <main className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-100 via-blue-50 to-slate-200 p-4"><Card className="w-full max-w-md border border-white/80 shadow-2xl shadow-slate-300/50"><CardHeader className="flex-col gap-3 pt-8 text-center"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"><LockKeyhole size={26} /></div><div><h1 className="text-2xl font-semibold">NiceApiManager</h1><p className="mt-1 text-sm text-default-500">请输入访问密码以继续</p></div></CardHeader><CardBody className="p-8 pt-5">{isLoading ? <Spinner className="mx-auto" label="正在检查登录状态" /> : <form className="flex flex-col gap-5" onSubmit={(event) => { event.preventDefault(); password ? loginMutation.mutate(password) : addToast({ title: '请输入访问密码', color: 'warning' }); }}><Input autoFocus isRequired label="访问密码" placeholder="请输入系统访问密码" type="password" value={password} onValueChange={setPassword} /><Button color="primary" isLoading={loginMutation.isPending} size="lg" type="submit">进入系统</Button></form>}</CardBody></Card></main>;
}
