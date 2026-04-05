import { Tag } from 'antd';

const colorMap: Record<string, string> = {
  healthy: 'success',
  unhealthy: 'error',
  degraded: 'warning',
  unknown: 'default',
  success: 'success',
  partial: 'warning',
  failed: 'error',
  running: 'processing',
};

const labelMap: Record<string, string> = {
  healthy: '健康',
  unhealthy: '异常',
  degraded: '降级',
  unknown: '未知',
  success: '成功',
  partial: '部分成功',
  failed: '失败',
  running: '执行中',
};

interface StatusTagProps {
  value?: string | null;
}

export function StatusTag({ value }: StatusTagProps) {
  const normalized = value || 'unknown';
  return <Tag color={colorMap[normalized] || 'default'}>{labelMap[normalized] || normalized}</Tag>;
}
