import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Card } from './card';

interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  caption?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function StatCard({ label, value, caption, icon, className }: StatCardProps) {
  return (
    <Card className={cn('gap-1 py-3.5', className)}>
      <div className="flex items-center justify-between gap-2 px-4">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      </div>
      <div className="px-4 text-xl font-semibold leading-tight tabular">{value}</div>
      {caption ? <div className="px-4 text-xs text-muted-foreground">{caption}</div> : null}
    </Card>
  );
}
