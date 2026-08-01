import { Chip } from '@heroui/react';

const labels: Record<string, string> = {
  healthy: '健康', success: '成功', running: '进行中', pending: '等待中',
  failed: '失败', error: '异常', unhealthy: '异常', degraded: '降级', unknown: '未知', skipped: '已跳过',
};
const colors: Record<string, 'success' | 'warning' | 'danger' | 'primary' | 'default'> = {
  healthy: 'success', success: 'success', running: 'primary', pending: 'default', failed: 'danger',
  error: 'danger', unhealthy: 'danger', degraded: 'warning', unknown: 'default', skipped: 'default',
};

export function StatusChip({ value }: { value?: string | null }) {
  const normalized = value ?? 'unknown';
  return <Chip color={colors[normalized] ?? 'default'} size="sm" variant="flat">{labels[normalized] ?? normalized}</Chip>;
}
