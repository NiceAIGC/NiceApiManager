import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface EmptyStateProps {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title = '暂无数据', description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 py-12 text-center', className)}>
      <div className="text-muted-foreground/70">{icon ?? <Inbox className="size-8" strokeWidth={1.5} />}</div>
      <div className="text-sm font-medium">{title}</div>
      {description ? <div className="max-w-md text-xs text-muted-foreground">{description}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
