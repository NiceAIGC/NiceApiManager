import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
}

export function PageHeader({ title, subtitle, extra }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="m-0 text-xl font-semibold leading-tight">{title}</h1>
        {subtitle ? <p className="mt-1 mb-0 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {extra ? <div className="flex flex-wrap items-center gap-2">{extra}</div> : null}
    </div>
  );
}
