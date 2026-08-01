import { LockOutlined } from '@ant-design/icons';
import { App, Button, Card, Form, Input, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { fetchAuthStatus, login } from '../api/auth';
import { getErrorMessage } from '../api/client';

const { Paragraph, Title } = Typography;

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<{ password: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['auth-status'],
    queryFn: fetchAuthStatus,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: (password: string) => login(password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth-status'] });
      navigate((location.state as { from?: string } | null)?.from || '/dashboard', { replace: true });
    },
    onError: (error) => {
      message.error(getErrorMessage(error));
    },
  });

  if (!isLoading && data?.authenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="auth-screen">
      <Card className="auth-card">
        <div className="auth-card-header">
          <div className="auth-icon-shell">
            <LockOutlined />
          </div>
          <Title level={2} className="auth-title">
            NiceApiManager
          </Title>
        </div>

        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => loginMutation.mutate(values.password)}
        >
          <Form.Item
            name="password"
            label="访问密码"
            rules={[{ required: true, message: '请输入访问密码' }]}
          >
            <Input.Password
              autoFocus
              placeholder="请输入系统访问密码"
              size="large"
            />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            block
            loading={loginMutation.isPending}
          >
            进入系统
          </Button>
        </Form>
      </Card>
    </div>
  );
}
