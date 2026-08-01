import { Card, CardBody } from '@heroui/react';
import type { ReactNode } from 'react';

export function MetricCard({ title, value, caption }: { title: string; value: ReactNode; caption?: ReactNode }) {
  return <Card className="border border-default-200 shadow-sm"><CardBody className="gap-2 p-5"><p className="text-sm text-default-500">{title}</p><div className="text-2xl font-semibold tracking-tight text-default-900">{value}</div>{caption ? <p className="text-xs text-default-500">{caption}</p> : null}</CardBody></Card>;
}
