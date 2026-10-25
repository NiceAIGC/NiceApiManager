import { ToggleButton, ToggleButtonGroup } from '@heroui/react';

import { cx } from '../../lib/cx';

export interface SegmentedOption {
  value: string;
  label: React.ReactNode;
}

interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** antd Segmented 的等价物：单选分段切换 */
export function SegmentedControl({ options, value, onChange, size = 'md', className }: SegmentedControlProps) {
  return (
    <ToggleButtonGroup className={cx('shrink-0', className)} size={size}>
      {options.map((option) => (
        <ToggleButton
          key={option.value}
          isSelected={option.value === value}
          onChange={(selected) => {
            if (selected) onChange(option.value);
          }}
        >
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
