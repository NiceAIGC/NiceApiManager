import { Card, Typography } from 'antd';
import type { ReactNode } from 'react';

const { Text } = Typography;

interface StatCardProps {
  title: string;
  value: ReactNode;
  caption?: string;
}

export function StatCard({ title, value, caption }: StatCardProps) {
  return (
    <Card className="stat-card">
      <Text type="secondary">{title}</Text>
      <div className="stat-value">{value}</div>
      {caption ? <div className="stat-caption">{caption}</div> : null}
    </Card>
  );
}

