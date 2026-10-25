import { Card } from '@heroui/react';
import type { ReactNode } from 'react';

import { cx } from '../../lib/cx';

interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  caption?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** KPI 统计卡，替代 antd Statistic */
export function StatCard({ label, value, caption, icon, className }: StatCardProps) {
  return (
    <Card className={cx('h-full', className)}>
      <Card.Content className="flex h-full flex-col gap-1.5 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">{label}</span>
          {icon ? <span className="text-muted">{icon}</span> : null}
        </div>
        <div className="text-2xl font-bold leading-tight tabular-nums">{value}</div>
        {caption ? <div className="text-xs text-muted">{caption}</div> : null}
      </Card.Content>
    </Card>
  );
}
