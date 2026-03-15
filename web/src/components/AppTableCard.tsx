import { Card } from 'antd';
import type { PropsWithChildren, ReactNode } from 'react';

interface AppTableCardProps extends PropsWithChildren {
  title: string;
  extra?: ReactNode;
}

export function AppTableCard({ title, extra, children }: AppTableCardProps) {
  return (
    <Card className="section-card" title={title} extra={extra}>
      {children}
    </Card>
  );
}

