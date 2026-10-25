import { EmptyState as HeroEmptyState } from '@heroui/react';
import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

import { cx } from '../../lib/cx';

interface EmptyStateProps {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** 空状态占位，替代 antd Empty */
export function EmptyState({ title = '暂无数据', description, icon, action, className }: EmptyStateProps) {
  return (
    <HeroEmptyState className={cx('flex flex-col items-center justify-center gap-2 py-12 text-center', className)}>
      <div className="text-muted">{icon ?? <Inbox size={36} strokeWidth={1.5} />}</div>
      <div className="text-sm font-medium">{title}</div>
      {description ? <div className="max-w-md text-xs text-muted">{description}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </HeroEmptyState>
  );
}
