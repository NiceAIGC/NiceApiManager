import * as React from 'react';

import { cn } from '@/lib/utils';
import { Input } from './input';
import { Label } from './label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { Switch } from './switch';
import { Textarea } from './textarea';

interface FieldShellProps {
  label?: React.ReactNode;
  required?: boolean;
  error?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  htmlFor?: string;
}

/** 统一的「标签 + 控件 + 错误/说明」布局 */
export function Field({ label, required, error, description, className, children, htmlFor }: FieldShellProps) {
  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      {label ? (
        <Label htmlFor={htmlFor}>
          {label}
          {required ? <span className="text-destructive">*</span> : null}
        </Label>
      ) : null}
      {children}
      {error ? (
        <p className="m-0 text-xs text-destructive">{error}</p>
      ) : description ? (
        <p className="m-0 text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

interface TextFieldProps extends Omit<FieldShellProps, 'children'> {
  inputProps?: React.ComponentProps<typeof Input>;
  textarea?: boolean;
  textareaProps?: React.ComponentProps<typeof Textarea>;
}

export function TextField({ label, required, error, description, className, inputProps, textarea, textareaProps, htmlFor }: TextFieldProps) {
  return (
    <Field label={label} required={required} error={error} description={description} className={className} htmlFor={htmlFor}>
      {textarea ? <Textarea aria-invalid={Boolean(error) || undefined} {...textareaProps} /> : <Input aria-invalid={Boolean(error) || undefined} {...inputProps} />}
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps extends Omit<FieldShellProps, 'children'> {
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  triggerClassName?: string;
}

export function SelectField({ label, required, error, description, className, options, value, onValueChange, placeholder, disabled, triggerClassName }: SelectFieldProps) {
  return (
    <Field label={label} required={required} error={error} description={description} className={className}>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger aria-invalid={Boolean(error) || undefined} className={triggerClassName}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

interface SwitchFieldProps {
  label?: React.ReactNode;
  description?: React.ReactNode;
  ariaLabel?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function SwitchField({ label, description, checked, onCheckedChange, disabled, className, ariaLabel }: SwitchFieldProps) {
  const accessibleName = ariaLabel ?? (typeof label === 'string' ? label : undefined);
  return (
    <div className={cn('flex items-start justify-between gap-3 rounded-lg border border-transparent p-0.5', className)}>
      <div className="flex flex-col gap-0.5">
        {label ? <span className="text-sm font-medium leading-5">{label}</span> : null}
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="mt-0.5" aria-label={accessibleName} />
    </div>
  );
}

interface NumberFieldProps extends Omit<FieldShellProps, 'children'> {
  value: number | null | undefined;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
}

export function NumberField({ label, required, error, description, className, value, onValueChange, min, max, step, placeholder, disabled }: NumberFieldProps) {
  return (
    <Field label={label} required={required} error={error} description={description} className={className}>
      <Input
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={Boolean(error) || undefined}
        onChange={(event) => {
          const next = event.target.value === '' ? Number.NaN : Number(event.target.value);
          if (Number.isNaN(next)) {
            onValueChange(min ?? 0);
            return;
          }
          onValueChange(next);
        }}
      />
    </Field>
  );
}
