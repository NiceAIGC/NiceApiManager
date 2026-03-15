import { Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { fetchAuthStatus } from '../api/auth';

export function RequireAuth() {
  const location = useLocation();
  const { data, isLoading } = useQuery({
    queryKey: ['auth-status'],
    queryFn: fetchAuthStatus,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="auth-screen">
        <Spin size="large" />
      </div>
    );
  }

  if (!data?.authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
