import { Button, Drawer, DrawerBody, DrawerContent, DrawerHeader, Tooltip, addToast } from '@heroui/react';
import { Bell, ChartNoAxesCombined, Database, LayoutDashboard, LogOut, Menu, Network, RefreshCw, Settings } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { logout } from '../api/auth';
import { fetchAppSettings } from '../api/settings';
import { setDisplayTimezone } from '../utils/format';

const navigationItems = [
  { path: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
  { path: '/instances', label: '实例管理', icon: Database },
  { path: '/groups', label: '分组倍率', icon: Network },
  { path: '/pricing', label: '定价模型', icon: ChartNoAxesCombined },
  { path: '/logs', label: '日志记录', icon: RefreshCw },
  { path: '/notifications', label: '告警通知', icon: Bell },
  { path: '/settings', label: '系统设置', icon: Settings },
];

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  return <div className="flex h-full flex-col bg-slate-950 text-slate-100"><div className="border-b border-white/10 px-6 py-6"><p className="text-lg font-semibold">NiceApiManager</p><p className="mt-1 text-xs text-slate-400">中转站聚合管理后台</p></div><nav className="flex flex-1 flex-col gap-1 p-3">{navigationItems.map(({ path, label, icon: Icon }) => <Button key={path} className="justify-start" color={location.pathname === path ? 'primary' : 'default'} startContent={<Icon size={18} />} variant={location.pathname === path ? 'flat' : 'light'} onPress={() => { navigate(path); onNavigate?.(); }}>{label}</Button>)}</nav></div>;
}

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { data: settings } = useQuery({ queryKey: ['app-settings'], queryFn: fetchAppSettings, staleTime: 300_000 });
  useEffect(() => setDisplayTimezone(settings?.scheduler_timezone), [settings?.scheduler_timezone]);
  const logoutMutation = useMutation({ mutationFn: logout, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['auth-status'] }); navigate('/login', { replace: true }); }, onError: () => addToast({ title: '退出失败', description: '请稍后重试。', color: 'danger' }) });
  const title = useMemo(() => navigationItems.find((item) => item.path === location.pathname)?.label ?? 'NiceApiManager', [location.pathname]);
  return <div className="min-h-screen bg-slate-50 text-slate-900"><aside className="fixed inset-y-0 left-0 hidden w-60 lg:block"><Navigation /></aside><div className="min-h-screen lg:pl-60"><header className="sticky top-0 z-20 flex min-h-20 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-7"><div className="flex items-center gap-3"><Button isIconOnly className="lg:hidden" variant="light" onPress={() => setDrawerOpen(true)}><Menu size={20} /></Button><h1 className="text-xl font-semibold">{title}</h1></div><Tooltip content="退出当前登录"><Button isLoading={logoutMutation.isPending} startContent={<LogOut size={17} />} variant="flat" onPress={() => logoutMutation.mutate()}>退出登录</Button></Tooltip></header><main className="mx-auto w-full max-w-[1800px] p-4 lg:p-7"><Outlet /></main></div><Drawer isOpen={drawerOpen} placement="left" size="xs" onOpenChange={setDrawerOpen}><DrawerContent>{() => <><DrawerHeader className="sr-only">导航菜单</DrawerHeader><DrawerBody className="p-0"><Navigation onNavigate={() => setDrawerOpen(false)} /></DrawerBody></>}</DrawerContent></Drawer></div>;
}
