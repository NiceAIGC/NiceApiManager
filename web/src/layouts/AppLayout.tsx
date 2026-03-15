import {
  DashboardOutlined,
  DatabaseOutlined,
  LineChartOutlined,
  LogoutOutlined,
  PartitionOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { App, Button, Layout, Menu, Space, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { logout } from '../api/auth';

const { Header, Content, Sider } = Layout;
const { Text } = Typography;

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
    key: '/sync-runs',
    icon: <ReloadOutlined />,
    label: '同步记录',
  },
];

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();

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

  return (
    <Layout className="app-shell">
      <Sider width={240} className="app-sider" breakpoint="lg" collapsedWidth={0}>
        <div className="brand-block">
          <div className="brand-title">NiceApiManager</div>
          <div className="brand-subtitle">NewAPI 聚合管理后台</div>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0, paddingTop: 12 }}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <Space direction="vertical" size={0}>
            <Typography.Title level={4} className="app-header-title">
              {menuItems.find((item) => item.key === location.pathname)?.label || 'NiceApiManager'}
            </Typography.Title>
            <Text type="secondary">前后端一体部署的 NewAPI 管理台</Text>
          </Space>
          <Button
            icon={<LogoutOutlined />}
            loading={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
          >
            退出登录
          </Button>
        </Header>
        <Content className="page-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
