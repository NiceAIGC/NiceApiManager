import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface DescriptionItem {
  label: ReactNode;
  value: ReactNode;
  span?: boolean;
}

interface DescriptionListProps {
  items: DescriptionItem[];
  columns?: 1 | 2 | 3;
  className?: string;
}

export function DescriptionList({ items, columns = 2, className }: DescriptionListProps) {
  const gridClass = columns === 1 ? 'grid-cols-1' : columns === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2';
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', gridClass, className)}>
      {items.map((item, index) => (
        <div key={index} className={cn('flex min-w-0 flex-col gap-0.5', item.span && 'sm:col-span-full')}>
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="m-0 break-words text-sm">{item.value ?? '-'}</dd>
        </div>
      ))}
    </dl>
  );
}
