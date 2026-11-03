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
import type { ComponentType } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { logout } from '../api/auth';
import { fetchAppSettings } from '../api/settings';
import { AppSheet, Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui';
import { cn } from '../lib/utils';
import { notify } from '../lib/toast';
import { useThemeMode } from '../lib/theme';
import { useBodyScrollLockFix } from '../lib/use-body-lock-fix';
import { setDisplayTimezone } from '../utils/format';

interface NavItem {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { key: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
  { key: '/instances', label: '实例管理', icon: Database },
  { key: '/groups', label: '分组倍率', icon: Network },
  { key: '/pricing', label: '定价模型', icon: TrendingUp },
  { key: '/logs', label: '日志记录', icon: RefreshCw },
  { key: '/notifications', label: '告警通知', icon: Bell },
  { key: '/settings', label: '系统设置', icon: Settings },
];

function SidebarContent({ currentPath, onNavigate }: { currentPath: string; onNavigate: (path: string) => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b px-4 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">N</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">NiceApiManager</div>
          <div className="truncate text-xs text-muted-foreground">中转站聚合管理</div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => {
          const active = currentPath === item.key || (item.key === '/logs' && currentPath.startsWith('/logs'));
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate(item.key)}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
                active
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="p-2 text-[11px] text-muted-foreground">单密码管理后台 · 全部数据本地存储</div>
    </div>
  );
}

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { resolved, toggle } = useThemeMode();
  const [mobileOpen, setMobileOpen] = useState(false);
  useBodyScrollLockFix();

  const { data: appSettings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: fetchAppSettings,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    setDisplayTimezone(appSettings?.scheduler_timezone);
  }, [appSettings?.scheduler_timezone]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth-status'] });
      navigate('/login', { replace: true });
    },
    onError: () => notify.error('退出登录失败，请稍后重试'),
  });

  const pageTitle = useMemo(
    () => NAV_ITEMS.find((item) => item.key === location.pathname)?.label ?? 'NiceApiManager',
    [location.pathname],
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-screen bg-background">
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r bg-card lg:block">
          <SidebarContent currentPath={location.pathname} onNavigate={navigate} />
        </aside>

        <AppSheet open={mobileOpen} onOpenChange={setMobileOpen} side="left" className="w-64 p-0" >
          <SidebarContent currentPath={location.pathname} onNavigate={navigate} />
        </AppSheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="打开导航" onClick={() => setMobileOpen(true)}>
                <MenuIcon className="size-4" />
              </Button>
              <h2 className="m-0 truncate text-base font-semibold">{pageTitle}</h2>
            </div>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="切换主题" onClick={toggle}>
                    {resolved === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{resolved === 'dark' ? '切换到浅色' : '切换到深色'}</TooltipContent>
              </Tooltip>
              <Button variant="outline" size="sm" isPending={logoutMutation.isPending} onClick={() => logoutMutation.mutate()}>
                <LogOut className="size-4" />
                退出
              </Button>
            </div>
          </header>
          <main className="min-w-0 flex-1 p-4 sm:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
