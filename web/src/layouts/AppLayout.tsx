import { Button, useMediaQuery, useTheme } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Database,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Network,
  RefreshCw,
  Settings,
  Sun,
  TrendingUp,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { logout } from '../api/auth';
import { fetchAppSettings } from '../api/settings';
import { AppDrawer } from '../components/ui';
import { notify } from '../lib/toast';
import { setDisplayTimezone } from '../utils/format';
import { cx } from '../lib/cx';

interface NavItem {
  key: string;
  label: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
}

const navItems: NavItem[] = [
  { key: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
  { key: '/instances', label: '实例管理', icon: Database },
  { key: '/groups', label: '分组倍率', icon: Network },
  { key: '/pricing', label: '定价模型', icon: TrendingUp },
  { key: '/logs', label: '日志记录', icon: RefreshCw },
  { key: '/notifications', label: '告警通知', icon: Bell },
  { key: '/settings', label: '系统设置', icon: Settings },
];

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      isIconOnly
      variant="ghost"
      size="sm"
      aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
      onPress={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </Button>
  );
}

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: appSettingsData } = useQuery({
    queryKey: ['app-settings'],
    queryFn: fetchAppSettings,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    setDisplayTimezone(appSettingsData?.scheduler_timezone);
  }, [appSettingsData?.scheduler_timezone]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth-status'] });
      navigate('/login', { replace: true });
    },
    onError: () => {
      notify.error('退出登录失败，请稍后重试。');
    },
  });

  const pageTitle = useMemo(
    () => navItems.find((item) => item.key === location.pathname)?.label || 'NiceApiManager',
    [location.pathname],
  );

  const navigationMenu = (extra?: ReactNode) => (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-5 py-4">
        <div className="text-lg font-bold">NiceApiManager</div>
        <div className="mt-0.5 text-xs text-muted">中转站聚合管理后台</div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {navItems.map((item) => {
          const active = location.pathname === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.key)}
              className={cx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
                active ? 'bg-accent font-medium text-accent-foreground' : 'text-foreground hover:bg-surface-secondary',
              )}
            >
              <Icon size={17} />
              {item.label}
            </button>
          );
        })}
      </nav>
      {extra}
    </div>
  );

  return (
    <div className="flex min-h-screen items-start bg-background">
      {isDesktop ? (
        <aside className="sticky top-0 h-screen w-60 shrink-0 border-r border-border bg-surface">
          {navigationMenu()}
        </aside>
      ) : (
        <AppDrawer open={mobileMenuOpen} onOpenChange={setMobileMenuOpen} placement="left">
          {navigationMenu()}
        </AppDrawer>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            {!isDesktop ? (
              <Button isIconOnly variant="ghost" size="sm" aria-label="打开导航菜单" onPress={() => setMobileMenuOpen(true)}>
                <MenuIcon size={18} />
              </Button>
            ) : null}
            <h2 className="m-0 text-lg font-semibold">{pageTitle}</h2>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              variant="outline"
              size="sm"
              isPending={logoutMutation.isPending}
              onPress={() => logoutMutation.mutate()}
            >
              <LogOut size={15} />
              退出登录
            </Button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
