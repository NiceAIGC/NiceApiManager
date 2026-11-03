import { Check, ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { Label } from './label';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  label?: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  description?: string;
  error?: string;
  required?: boolean;
  className?: string;
  disabled?: boolean;
  emptyText?: string;
}

/** 多选下拉：复选框列表 + 已选摘要，适合渠道/分组/标签等选择 */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = '请选择',
  description,
  error,
  required,
  className,
  disabled,
  emptyText = '暂无可选项',
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => new Set(value), [value]);
  const labelMap = useMemo(() => new Map(options.map((option) => [option.value, option.label])), [options]);
  const summary = value.length ? value.map((item) => labelMap.get(item) ?? item).join('、') : '';

  const toggle = (optionValue: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(optionValue);
    else next.delete(optionValue);
    onChange([...next]);
  };

  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      {label ? (
        <Label>
          {label}
          {required ? <span className="text-destructive">*</span> : null}
        </Label>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn('h-auto min-h-9 w-full justify-between gap-2 px-3 py-1.5 font-normal', error && 'border-destructive')}
            disabled={disabled}
          >
            <span className={cn('min-w-0 flex-1 truncate text-left', !summary && 'text-muted-foreground')}>{summary || placeholder}</span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {value.length ? `已选 ${value.length}` : null}
              <ChevronDown className="size-4" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-56 p-1">
          {options.length ? (
            <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
              {options.map((option) => {
                const checked = selected.has(option.value);
                return (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <Checkbox checked={checked} onCheckedChange={(next) => toggle(option.value, next === true)} />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {checked ? <Check className="size-3.5 text-primary" /> : null}
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">{emptyText}</div>
          )}
        </PopoverContent>
      </Popover>
      {error ? (
        <p className="m-0 text-xs text-destructive">{error}</p>
      ) : description ? (
        <p className="m-0 text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
