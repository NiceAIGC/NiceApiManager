import { Spinner } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { fetchAuthStatus } from '../api/auth';

export function RequireAuth() {
  const location = useLocation();
  const { data, isLoading } = useQuery({ queryKey: ['auth-status'], queryFn: fetchAuthStatus, retry: false });
  if (isLoading) return <div className="grid min-h-screen place-items-center"><Spinner label="正在验证登录状态" /></div>;
  if (!data?.authenticated) return <Navigate replace state={{ from: location.pathname }} to="/login" />;
  return <Outlet />;
}
