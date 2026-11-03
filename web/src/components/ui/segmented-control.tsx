import { cn } from '@/lib/utils';

export interface SegmentedOption {
  value: string;
  label: string;
}

interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  size?: 'sm' | 'md';
  className?: string;
}

/** 分段切换（分段控件），移动端自动换行 */
export function SegmentedControl({ options, value, onChange, size = 'md', className }: SegmentedControlProps) {
  return (
    <div
      role="radiogroup"
      className={cn('inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5', size === 'sm' && 'text-xs', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md px-2.5 font-medium transition-colors',
              size === 'sm' ? 'h-7' : 'h-8',
              active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
