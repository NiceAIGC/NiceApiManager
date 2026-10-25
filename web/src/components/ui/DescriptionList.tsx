import type { ReactNode } from 'react';

import { cx } from '../../lib/cx';

export interface DescriptionItem {
  label: ReactNode;
  value: ReactNode;
  /** 占满整行 */
  span?: boolean;
}

interface DescriptionListProps {
  items: DescriptionItem[];
  columns?: 1 | 2 | 3;
  className?: string;
}

/** antd Descriptions 的等价物 */
export function DescriptionList({ items, columns = 2, className }: DescriptionListProps) {
  const gridClass =
    columns === 1 ? 'grid-cols-1' : columns === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2';

  return (
    <dl className={cx('grid gap-x-6 gap-y-3', gridClass, className)}>
      {items.map((item, index) => (
        <div key={index} className={cx('flex flex-col gap-0.5', item.span && 'sm:col-span-full')}>
          <dt className="text-xs text-muted">{item.label}</dt>
          <dd className="text-sm break-words">{item.value ?? '-'}</dd>
        </div>
      ))}
    </dl>
  );
}
