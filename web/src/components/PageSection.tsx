import { Card, Space, Typography } from 'antd';
import type { PropsWithChildren, ReactNode } from 'react';

const { Text, Title } = Typography;

interface PageSectionProps extends PropsWithChildren {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
}

export function PageSection({ title, subtitle, extra, children }: PageSectionProps) {
  return (
    <Card
      className="section-card"
      title={
        <Space direction="vertical" size={2}>
          <Title level={4} style={{ margin: 0 }}>
            {title}
          </Title>
          {subtitle ? <Text type="secondary">{subtitle}</Text> : null}
        </Space>
      }
      extra={extra}
    >
      {children}
    </Card>
  );
}

