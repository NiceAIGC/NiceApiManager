import {
  Description,
  FieldError,
  Input,
  Label,
  NumberField,
  Select,
  Switch,
  TextArea,
  TextField,
  ListBox,
} from '@heroui/react';
import type { ReactNode } from 'react';

import { cx } from '../../lib/cx';

interface BaseFieldProps {
  label?: ReactNode;
  required?: boolean;
  error?: ReactNode;
  description?: ReactNode;
  className?: string;
}

function FieldMessages({ error, description }: { error?: ReactNode; description?: ReactNode }) {
  if (error) return <FieldError>{error}</FieldError>;
  if (description) return <Description>{description}</Description>;
  return null;
}

interface TextInputProps extends BaseFieldProps {
  inputProps: React.ComponentProps<typeof Input>;
  textarea?: boolean;
}

/** 文本输入字段：Label + Input/TextArea + 错误/描述。inputProps 直接传 RHF 的 register() 返回值 */
export function TextInput({ label, required, error, description, className, inputProps, textarea }: TextInputProps) {
  return (
    <TextField className={cx('w-full', className)} isInvalid={Boolean(error)} isRequired={required}>
      {label ? <Label>{label}</Label> : null}
      {textarea ? (
        // input 与 textarea 的 props 结构一致，仅事件目标元素类型不同；RHF register 返回值两者通用
        <TextArea rows={3} {...(inputProps as unknown as React.ComponentProps<typeof TextArea>)} />
      ) : (
        <Input {...inputProps} />
      )}
      <FieldMessages error={error} description={description} />
    </TextField>
  );
}

interface NumberInputProps extends BaseFieldProps {
  value: number | null | undefined;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  isDisabled?: boolean;
}

/** 数字输入字段（受控，配合 RHF Controller） */
export function NumberInput({ label, required, error, description, className, value, onChange, min, max, step, placeholder, isDisabled }: NumberInputProps) {
  return (
    <NumberField
      className={cx('w-full', className)}
      isInvalid={Boolean(error)}
      isRequired={required}
      isDisabled={isDisabled}
      value={value ?? undefined}
      onChange={onChange}
      minValue={min}
      maxValue={max}
      step={step}
    >
      {label ? <Label>{label}</Label> : null}
      <NumberField.Group>
        <NumberField.Input placeholder={placeholder} />
      </NumberField.Group>
      <FieldMessages error={error} description={description} />
    </NumberField>
  );
}

export interface SelectOption {
  value: string;
  label: ReactNode;
}

interface SelectInputBaseProps extends BaseFieldProps {
  options: SelectOption[];
  placeholder?: string;
  isDisabled?: boolean;
}

export type SelectInputProps = SelectInputBaseProps &
  (
    | { multiple?: false; value: string | null | undefined; onChange: (value: string | null) => void }
    | { multiple: true; value: string[]; onChange: (value: string[]) => void }
  );

function useSelectParts(props: SelectInputBaseProps & { required?: boolean }) {
  const { label, required, options } = props;
  const labelNode = label ? (
    <Label>
      {label}
      {required ? <span className="text-danger"> *</span> : null}
    </Label>
  ) : null;
  const listBox = (
    <Select.Popover>
      <ListBox>
        {options.map((option) => (
          <ListBox.Item key={option.value} id={option.value} textValue={typeof option.label === 'string' ? option.label : option.value}>
            {option.label}
            <ListBox.ItemIndicator />
          </ListBox.Item>
        ))}
      </ListBox>
    </Select.Popover>
  );
  return { labelNode, listBox };
}

/** 下拉选择字段（受控，配合 RHF Controller；multiple 时 value 为 string[]） */
export function SelectInput(props: SelectInputProps) {
  const { error, description, className, placeholder, isDisabled } = props;
  const { labelNode, listBox } = useSelectParts(props);

  return (
    <div className={cx('flex w-full flex-col gap-1.5', className)}>
      {props.multiple ? (
        <Select
          selectionMode="multiple"
          value={props.value}
          onChange={(next) => props.onChange(next.map(String))}
          placeholder={placeholder}
          isDisabled={isDisabled}
          fullWidth
        >
          {labelNode}
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          {listBox}
        </Select>
      ) : (
        <Select
          value={props.value ?? null}
          onChange={(next) => props.onChange(next == null ? null : String(next))}
          placeholder={placeholder}
          isDisabled={isDisabled}
          fullWidth
        >
          {labelNode}
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          {listBox}
        </Select>
      )}
      <FieldMessages error={error} description={description} />
    </div>
  );
}

interface SwitchInputProps extends BaseFieldProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  isDisabled?: boolean;
}

/** 开关字段（受控，配合 RHF Controller） */
export function SwitchInput({ label, error, description, className, checked, onChange, isDisabled }: SwitchInputProps) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <Switch isSelected={checked} onChange={onChange} isDisabled={isDisabled}>
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          {label}
        </Switch.Content>
      </Switch>
      <FieldMessages error={error} description={description} />
    </div>
  );
}
