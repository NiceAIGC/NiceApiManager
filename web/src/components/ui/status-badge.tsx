import type { ReactNode } from 'react';

import { Badge } from './badge';

type Tone = 'default' | 'success' | 'warning' | 'destructive' | 'muted' | 'secondary';

const statusTone: Record<string, Tone> = {
  healthy: 'success',
  enabled: 'success',
  success: 'success',
  ok: 'success',
  active: 'success',
  warning: 'warning',
  degraded: 'warning',
  pending: 'warning',
  partial: 'warning',
  running: 'default',
  unhealthy: 'destructive',
  error: 'destructive',
  failed: 'destructive',
  disabled: 'muted',
  unknown: 'muted',
  paused: 'muted',
};

const labels: Record<string, string> = {
  healthy: '健康',
  unhealthy: '异常',
  degraded: '降级',
  unknown: '未知',
  enabled: '启用',
  disabled: '停用',
  success: '成功',
  failed: '失败',
  partial: '部分成功',
  running: '运行中',
  pending: '等待中',
  paused: '已暂停',
  manual: '手动',
  scheduled: '定时',
};

export function StatusBadge({ status, children, tone, className }: { status?: string; children?: ReactNode; tone?: Tone; className?: string }) {
  const resolved = tone ?? (status ? statusTone[status] ?? 'secondary' : 'secondary');
  return (
    <Badge variant={resolved === 'default' ? 'secondary' : resolved} className={className}>
      {children ?? (status ? labels[status] ?? status : '')}
    </Badge>
  );
}
