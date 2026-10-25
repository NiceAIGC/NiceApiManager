import { Chip } from '@heroui/react';
import type { ReactNode } from 'react';

type StatusColor = 'default' | 'accent' | 'success' | 'warning' | 'danger';

const statusColorMap: Record<string, StatusColor> = {
  healthy: 'success',
  enabled: 'success',
  success: 'success',
  warning: 'warning',
  pending: 'warning',
  running: 'accent',
  error: 'danger',
  failed: 'danger',
  disabled: 'default',
  unknown: 'default',
};

interface StatusChipProps {
  status?: string;
  children: ReactNode;
  color?: StatusColor;
  size?: 'sm' | 'md' | 'lg';
}

/** 状态标签，替代 antd Tag（原 StatusTag） */
export function StatusChip({ status, children, color, size = 'sm' }: StatusChipProps) {
  const resolved = color ?? (status ? statusColorMap[status] : undefined) ?? 'default';
  return (
    <Chip color={resolved} size={size} variant="soft">
      <Chip.Label>{children}</Chip.Label>
    </Chip>
  );
}
