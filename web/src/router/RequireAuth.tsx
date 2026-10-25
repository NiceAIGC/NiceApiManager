import { Spinner } from '@heroui/react';
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
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!data?.authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
