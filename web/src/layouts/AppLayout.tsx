import {
  DashboardOutlined,
  DatabaseOutlined,
  LineChartOutlined,
  LogoutOutlined,
  MenuOutlined,
  PartitionOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { App, Button, Drawer, Grid, Layout, Menu, Space, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { logout } from '../api/auth';
import { fetchAppSettings } from '../api/settings';
import { setDisplayTimezone } from '../utils/format';

const { Header, Content, Sider } = Layout;
const { Text } = Typography;
const { useBreakpoint } = Grid;

const menuItems = [
  {
    key: '/dashboard',
    icon: <DashboardOutlined />,
    label: '仪表盘',
  },
  {
    key: '/instances',
    icon: <DatabaseOutlined />,
    label: '实例管理',
  },
  {
    key: '/groups',
    icon: <PartitionOutlined />,
    label: '分组倍率',
  },
  {
    key: '/pricing',
    icon: <LineChartOutlined />,
    label: '定价模型',
  },
  {
    key: '/logs',
    icon: <ReloadOutlined />,
    label: '日志记录',
  },
  {
    key: '/settings',
    icon: <SettingOutlined />,
    label: '系统设置',
  },
];

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const screens = useBreakpoint();
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
      message.error('退出登录失败，请稍后重试。');
    },
  });

  const pageTitle = useMemo(
    () => menuItems.find((item) => item.key === location.pathname)?.label || 'NiceApiManager',
    [location.pathname],
  );

  const navigationMenu = (
    <>
      <div className="brand-block">
        <div className="brand-title">NiceApiManager</div>
        <div className="brand-subtitle">中转站聚合管理后台</div>
      </div>
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[location.pathname]}
        items={menuItems}
        onClick={({ key }) => navigate(key)}
        style={{ borderRight: 0, paddingTop: 12 }}
      />
    </>
  );

  return (
    <Layout className="app-shell">
      {screens.lg ? (
        <Sider width={240} className="app-sider">
          {navigationMenu}
        </Sider>
      ) : (
        <Drawer
          title={null}
          placement="left"
          open={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
          width={240}
          closable={false}
          className="app-mobile-drawer"
          styles={{
            body: { padding: 0, background: '#001529' },
            header: { display: 'none' },
          }}
        >
          {navigationMenu}
        </Drawer>
      )}
      <Layout>
        <Header className="app-header">
          <Space size={12} align="center">
            {!screens.lg ? (
              <Button
                type="text"
                className="app-mobile-menu-trigger"
                icon={<MenuOutlined />}
                onClick={() => setMobileMenuOpen(true)}
              />
            ) : null}
            <Space direction="vertical" size={0}>
              <Typography.Title level={4} className="app-header-title">
                {pageTitle}
              </Typography.Title>
              <Text type="secondary">前后端一体部署的中转站管理台</Text>
            </Space>
          </Space>
          <Space>
            <Button
              icon={<LogoutOutlined />}
              loading={logoutMutation.isPending}
              onClick={() => logoutMutation.mutate()}
            >
              退出登录
            </Button>
          </Space>
        </Header>
        <Content className="page-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
