import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
}

/** 页头：标题 + 副标题 + 右侧操作区 */
export function PageHeader({ title, subtitle, extra }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="m-0 text-2xl font-bold leading-snug">{title}</h1>
        {subtitle ? <p className="mt-1.5 mb-0 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {extra ? <div className="flex flex-wrap items-center gap-2">{extra}</div> : null}
    </div>
  );
}
