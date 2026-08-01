import {
  Alert as HeroAlert,
  Button as HeroButton,
  Card as HeroCard,
  CardBody,
  CardHeader,
  Chip,
  Input as HeroInput,
  Modal as HeroModal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Progress as HeroProgress,
  Select as HeroSelect,
  SelectItem,
  Spinner,
  Switch as HeroSwitch,
  Tooltip as HeroTooltip,
  addToast,
} from '@heroui/react';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

type Path = string | number | Array<string | number>;
type Values = Record<string, unknown>;
type ChangeHandler = (value: unknown) => void;

function pathParts(path: Path): Array<string | number> {
  return Array.isArray(path) ? path : [path];
}

function getValue(values: Values, path: Path): unknown {
  return pathParts(path).reduce<unknown>((current, key) => (current as Values | undefined)?.[key], values);
}

function setValue(values: Values, path: Path, value: unknown): Values {
  const parts = pathParts(path);
  const next = structuredClone(values) as Values;
  let current: Values | unknown[] = next;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      (current as Values)[part] = value;
      return;
    }
    const child = (current as Values)[part];
    const following = parts[index + 1];
    (current as Values)[part] = child && typeof child === 'object' ? child : typeof following === 'number' ? [] : {};
    current = (current as Values)[part] as Values | unknown[];
  });
  return next;
}

export interface FormInstance<T extends Values = Values> {
  getFieldValue: (name: Path) => unknown;
  getFieldsValue: (names?: Path[]) => T;
  setFieldsValue: (values: Partial<T>) => void;
  resetFields: () => void;
  submit: () => void;
  validateFields: (names?: Path[]) => Promise<T>;
}

interface FormContextValue {
  values: Values;
  set: (path: Path, value: unknown) => void;
}
const FormContext = createContext<FormContextValue | null>(null);

function createForm<T extends Values>(): FormInstance<T> {
  let values: Values = {};
  let submit = () => undefined;
  const listeners = new Set<(next: Values) => void>();
  const update = (next: Values) => {
    values = next;
    listeners.forEach((listener) => listener(values));
  };
  return {
    getFieldValue: (name) => getValue(values, name),
    getFieldsValue: (names) => (names ? Object.fromEntries(names.map((name) => [String(name), getValue(values, name)])) : values) as T,
    setFieldsValue: (next) => update({ ...values, ...next }),
    resetFields: () => update({}),
    submit: () => submit(),
    validateFields: async () => values as T,
    _setSubmit: (handler: () => void) => { submit = handler; },
    _subscribe: (listener: (next: Values) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  } as FormInstance<T>;
}
function useForm<T extends Values = Values>(): [FormInstance<T>] {
  const form = useState(() => createForm<T>())[0];
  return [form];
}

function useWatch(name: Path, form: FormInstance): unknown {
  const [value, setCurrentValue] = useState(() => form.getFieldValue(name));
  useEffect(() => (form as FormInstance & { _subscribe: (listener: (values: Values) => void) => () => void })._subscribe((values) => setCurrentValue(getValue(values, name))), [form, name]);
  return value;
}

function FormRoot<T extends Values>({ form, initialValues, onFinish, children, className }: { form: FormInstance<T>; initialValues?: Partial<T>; onFinish: (values: T) => void; children: ReactNode; className?: string }) {
  const [values, setValues] = useState<Values>(() => ({ ...(initialValues ?? {}), ...form.getFieldsValue() }));
  useEffect(() => (form as FormInstance & { _subscribe: (listener: (values: Values) => void) => () => void })._subscribe(setValues), [form]);
  useEffect(() => { form.setFieldsValue(values as Partial<T>); }, []);
  (form as FormInstance & { _setSubmit: (handler: () => void) => void })._setSubmit(() => onFinish(form.getFieldsValue()));
  return <form className={className} onSubmit={(event) => { event.preventDefault(); onFinish(form.getFieldsValue()); }}><FormContext.Provider value={{ values, set: (path, value) => form.setFieldsValue(setValue(values, path, value) as Partial<T>) }}>{children}</FormContext.Provider></form>;
}

function FormItem({ name, label, children, valuePropName }: { name?: Path; label?: ReactNode; children: ReactElement; valuePropName?: string }) {
  const context = useContext(FormContext);
  const value = name === undefined ? undefined : context ? getValue(context.values, name) : undefined;
  const propName = valuePropName === 'checked' ? 'isSelected' : 'value';
  const child = name === undefined || !context ? children : React.cloneElement(children, {
    [propName]: value ?? (propName === 'value' ? '' : false),
    onChange: (eventOrValue: unknown) => {
      const next = typeof eventOrValue === 'object' && eventOrValue !== null && 'target' in eventOrValue
        ? ((eventOrValue as { target: { type?: string; checked?: boolean; value?: unknown } }).target.type === 'checkbox'
          ? (eventOrValue as { target: { checked: boolean } }).target.checked
          : (eventOrValue as { target: { value: unknown } }).target.value)
        : eventOrValue;
      context.set(name, next);
      (children.props as { onChange?: ChangeHandler }).onChange?.(eventOrValue);
    },
  });
  return <label className="ui-form-item">{label ? <span className="ui-form-label">{label}</span> : null}{child}</label>;
}

function FormList({ name, children }: { name: string; children: (fields: Array<{ name: number; key: number }>, actions: { add: (value?: unknown) => void; remove: (index: number) => void }) => ReactNode }) {
  const context = useContext(FormContext)!;
  const items = (getValue(context.values, name) as unknown[] | undefined) ?? [];
  return <>{children(items.map((_, index) => ({ name: index, key: index })), { add: (value = {}) => context.set(name, [...items, value]), remove: (index) => context.set(name, items.filter((_, current) => current !== index)) })}</>;
}

export const Form = Object.assign(FormRoot, { useForm, useWatch, Item: FormItem, List: FormList });

export function Button({ children, type, htmlType, block, icon, ...props }: ComponentProps<typeof HeroButton> & { type?: 'primary' | 'default' | 'text' | 'link'; htmlType?: 'submit' | 'button'; block?: boolean; icon?: ReactNode }) {
  return <HeroButton {...props} type={htmlType} color={type === 'primary' ? 'primary' : 'default'} variant={type === 'text' || type === 'link' ? 'light' : 'solid'} className={`${block ? 'w-full' : ''} ${props.className ?? ''}`}>{icon}{children}</HeroButton>;
}

export function Card({ children, title, extra, loading, className, ...props }: ComponentProps<typeof HeroCard> & { title?: ReactNode; extra?: ReactNode; loading?: boolean }) {
  return <HeroCard {...props} className={className}>{title || extra ? <CardHeader className="justify-between">{title}<span>{extra}</span></CardHeader> : null}<CardBody>{loading ? <Spinner /> : children}</CardBody></HeroCard>;
}

export function Input({ type, ...props }: ComponentProps<typeof HeroInput> & { type?: string }) { return <HeroInput {...props} type={type} />; }
Input.Password = (props: ComponentProps<typeof HeroInput>) => <HeroInput {...props} type="password" />;
Input.Search = (props: ComponentProps<typeof HeroInput>) => <HeroInput {...props} />;

export function InputNumber({ value, onChange, ...props }: Omit<ComponentProps<typeof HeroInput>, 'onChange'> & { value?: number; onChange?: (value: number | null) => void }) {
  return <HeroInput {...props} type="number" value={value?.toString() ?? ''} onChange={(event) => onChange?.(event.target.value === '' ? null : Number(event.target.value))} />;
}

export function Select({ options, children, value, onChange, mode, allowClear, ...props }: Omit<ComponentProps<typeof HeroSelect>, 'children' | 'onChange'> & { options?: Array<{ label: ReactNode; value: string | number }>; children?: ReactNode; value?: string | number | string[]; onChange?: (value: unknown) => void; mode?: 'multiple'; allowClear?: boolean }) {
  const selectedKeys = value == null ? [] : new Set((Array.isArray(value) ? value : [value]).map(String));
  return <HeroSelect {...props} selectionMode={mode === 'multiple' ? 'multiple' : 'single'} selectedKeys={selectedKeys} onSelectionChange={(keys) => { const selected = Array.from(keys).map(String); onChange?.(mode === 'multiple' ? selected : selected[0]); }}>{options?.map((item) => <SelectItem key={String(item.value)}>{item.label}</SelectItem>)}{children}</HeroSelect>;
}
Select.Option = ({ children }: { children: ReactNode }) => <>{children}</>;

export function Switch({ checked, onChange, children, ...props }: ComponentProps<typeof HeroSwitch> & { checked?: boolean; onChange?: (checked: boolean, event?: unknown) => void }) { return <HeroSwitch {...props} isSelected={checked} onValueChange={onChange}>{children}</HeroSwitch>; }
export function Tag({ children, color }: { children: ReactNode; color?: string }) { return <Chip color={color === 'success' || color === 'danger' || color === 'warning' || color === 'primary' ? color : 'default'} size="sm">{children}</Chip>; }
export function Alert({ message, description, type = 'info' }: { message: ReactNode; description?: ReactNode; type?: 'info' | 'success' | 'warning' | 'error'; [key: string]: unknown }) { return <HeroAlert color={type === 'error' ? 'danger' : type}>{message}{description ? <div>{description}</div> : null}</HeroAlert>; }
export function Tooltip({ children, title }: { children: ReactNode; title: ReactNode }) { return <HeroTooltip content={title}>{children}</HeroTooltip>; }
export function Progress({ percent, status }: { percent: number; status?: string }) { return <HeroProgress value={percent} color={status === 'exception' ? 'danger' : status === 'success' ? 'success' : 'primary'} />; }
export function Empty({ description = '暂无数据' }: { description?: ReactNode }) { return <div className="ui-empty">{description}</div>; }
export function Space({ children, direction, className }: { children: ReactNode; direction?: 'vertical' | 'horizontal'; className?: string; [key: string]: unknown }) { return <div className={`ui-space ${direction === 'vertical' ? 'ui-space-vertical' : ''} ${className ?? ''}`}>{children}</div>; }
export function Row({ children }: { children: ReactNode; [key: string]: unknown }) { return <div className="ui-row">{children}</div>; }
export function Col({ children, className }: { children: ReactNode; className?: string; [key: string]: unknown }) { return <div className={`ui-col ${className ?? ''}`}>{children}</div>; }
export function Divider() { return <hr className="ui-divider" />; }
export function Typography({ children }: { children: ReactNode }) { return <>{children}</>; }
Typography.Text = ({ children, type, strong }: { children: ReactNode; type?: string; strong?: boolean }) => <span className={type === 'secondary' ? 'ui-muted' : ''}>{strong ? <strong>{children}</strong> : children}</span>;
Typography.Title = ({ children, level = 3, className }: { children: ReactNode; level?: number; className?: string }) => React.createElement(`h${Math.min(6, Math.max(1, level))}`, { className }, children);
Typography.Paragraph = ({ children }: { children: ReactNode }) => <p>{children}</p>;
Typography.Link = ({ children, href }: { children: ReactNode; href?: string }) => <a href={href}>{children}</a>;
export function Statistic({ title, value, suffix, precision }: { title: ReactNode; value: number; suffix?: ReactNode; precision?: number }) { return <div><span className="ui-muted">{title}</span><div className="stat-value">{precision == null ? value : value.toFixed(precision)}{suffix}</div></div>; }
export function Rate({ value = 0, onChange }: { value?: number; onChange?: (value: number) => void; [key: string]: unknown }) { return <input type="range" min="0" max="5" step="1" value={value} onChange={(event) => onChange?.(Number(event.target.value))} />; }
export function Segmented({ options, value, onChange }: { options: Array<string | { label: ReactNode; value: string }>; value: string; onChange: (value: string) => void }) { return <div className="ui-segmented">{options.map((option) => { const current = typeof option === 'string' ? { label: option, value: option } : option; return <Button key={current.value} type={value === current.value ? 'primary' : 'default'} onClick={() => onChange(current.value)}>{current.label}</Button>; })}</div>; }
export function Tabs({ items, activeKey, onChange }: { items: Array<{ key: string; label: ReactNode; children: ReactNode }>; activeKey: string; onChange: (key: string) => void }) { const active = items.find((item) => item.key === activeKey) ?? items[0]; return <><div className="ui-tabs">{items.map((item) => <Button key={item.key} type={item.key === activeKey ? 'primary' : 'default'} onClick={() => onChange(item.key)}>{item.label}</Button>)}</div>{active?.children}</>; }
export function Spin() { return <Spinner />; }
export function Drawer({ open, children }: { open: boolean; children: ReactNode; [key: string]: unknown }) { return open ? <aside className="ui-drawer">{children}</aside> : null; }
export function Collapse({ items }: { items: Array<{ key: string; label: ReactNode; children: ReactNode }> }) { return <div>{items.map((item) => <details key={item.key}><summary>{item.label}</summary>{item.children}</details>)}</div>; }

export function Descriptions({ items, children }: { items?: Array<{ key?: string; label: ReactNode; children: ReactNode }>; children?: ReactNode; [key: string]: unknown }) { return <dl className="ui-descriptions">{items?.map((item, index) => <React.Fragment key={item.key ?? index}><dt>{item.label}</dt><dd>{item.children}</dd></React.Fragment>)}{children}</dl>; }
Descriptions.Item = ({ label, children }: { label: ReactNode; children: ReactNode }) => <><dt>{label}</dt><dd>{children}</dd></>;

export function Table<T extends Values>({ dataSource = [], columns = [], rowKey = 'id', loading, title, footer, rowSelection, expandable }: { dataSource?: T[]; columns?: Array<{ key?: string; title?: ReactNode; dataIndex?: keyof T; render?: (value: unknown, record: T, index: number) => ReactNode }>; rowKey?: keyof T | ((record: T) => React.Key); loading?: boolean; title?: () => ReactNode; footer?: () => ReactNode; rowSelection?: { selectedRowKeys?: React.Key[]; onChange?: (keys: React.Key[], records: T[]) => void }; expandable?: { expandedRowRender?: (record: T) => ReactNode }; [key: string]: unknown }) { const [expanded, setExpanded] = useState<React.Key | null>(null); const keyOf = (record: T) => typeof rowKey === 'function' ? rowKey(record) : record[rowKey] as React.Key; return <div className="ui-table-wrap">{title?.()}{loading ? <Spinner /> : <table className="ui-table"><thead><tr>{expandable ? <th /> : null}{rowSelection ? <th /> : null}{columns.map((column, index) => <th key={column.key ?? index}>{column.title}</th>)}</tr></thead><tbody>{dataSource.map((record, index) => { const key = keyOf(record); return <React.Fragment key={key}>{<tr>{expandable ? <td><Button type="text" onClick={() => setExpanded(expanded === key ? null : key)}>⌄</Button></td> : null}{rowSelection ? <td><input type="checkbox" checked={rowSelection.selectedRowKeys?.includes(key)} onChange={(event) => rowSelection.onChange?.(event.target.checked ? [...(rowSelection.selectedRowKeys ?? []), key] : (rowSelection.selectedRowKeys ?? []).filter((current) => current !== key), [record])} /></td> : null}{columns.map((column, cellIndex) => <td key={column.key ?? cellIndex}>{column.render ? column.render(column.dataIndex ? record[column.dataIndex] : undefined, record, index) : String(column.dataIndex ? record[column.dataIndex] ?? '' : '')}</td>)}</tr>}{expandable && expanded === key ? <tr><td colSpan={columns.length + 2}>{expandable.expandedRowRender?.(record)}</td></tr> : null}</React.Fragment>; })}</tbody></table>}{footer?.()}</div>; }

function Dialog({ title, content, onClose }: { title: ReactNode; content: ReactNode; onClose: () => void }) { return <Modal isOpen onOpenChange={onClose}><ModalContent><ModalHeader>{title}</ModalHeader><ModalBody>{content}</ModalBody><ModalFooter><Button onClick={onClose}>关闭</Button></ModalFooter></ModalContent></Modal>; }
export const App = { useApp: () => ({ message: { success: (description: ReactNode) => addToast({ title: '成功', description, color: 'success' }), error: (description: ReactNode) => addToast({ title: '错误', description, color: 'danger' }), warning: (description: ReactNode) => addToast({ title: '提示', description, color: 'warning' }), info: (description: ReactNode) => addToast({ title: '提示', description, color: 'primary' }) }, modal: { success: ({ title, content }: { title: ReactNode; content: ReactNode }) => addToast({ title, description: content, color: 'success' }), confirm: ({ title, content, onOk }: { title: ReactNode; content: ReactNode; onOk?: () => void }) => { if (globalThis.confirm(String(title))) onOk?.(); } } }) };

export function Modal({ open, title, children, onCancel, onOk, okText = '确认', cancelText = '取消', confirmLoading, footer, ...props }: { open: boolean; title?: ReactNode; children: ReactNode; onCancel?: () => void; onOk?: () => void; okText?: ReactNode; cancelText?: ReactNode; confirmLoading?: boolean; footer?: ReactNode | ((_: unknown, buttons: ReactNode[]) => ReactNode); [key: string]: unknown }) {
  const buttons = [
    <Button key="cancel" onClick={onCancel}>{cancelText}</Button>,
    <Button key="confirm" type="primary" isLoading={confirmLoading} onClick={onOk}>{okText}</Button>,
  ];
  const content = typeof footer === 'function' ? footer(undefined, buttons) : footer === undefined ? buttons : footer;
  return <HeroModal {...props} isOpen={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel?.(); }}><ModalContent><ModalHeader>{title}</ModalHeader><ModalBody>{children}</ModalBody><ModalFooter>{content}</ModalFooter></ModalContent></HeroModal>;
}
export { ModalBody, ModalContent, ModalFooter, ModalHeader };
export const Layout = Object.assign(({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>, {
  Header: ({ children, className }: { children: ReactNode; className?: string }) => <header className={className}>{children}</header>,
  Content: ({ children, className }: { children: ReactNode; className?: string }) => <main className={className}>{children}</main>,
  Sider: ({ children, className }: { children: ReactNode; className?: string }) => <aside className={className}>{children}</aside>,
});
export const Grid = { useBreakpoint: () => ({ lg: globalThis.innerWidth >= 992 }) };
export function Menu({ items, selectedKeys, onClick }: { items: Array<{ key: string; icon?: ReactNode; label: ReactNode }>; selectedKeys?: string[]; onClick?: ({ key }: { key: string }) => void; [key: string]: unknown }) { return <nav className="ui-menu">{items.map((item) => <Button key={item.key} type={selectedKeys?.includes(item.key) ? 'primary' : 'text'} icon={item.icon} onClick={() => onClick?.({ key: item.key })}>{item.label}</Button>)}</nav>; }
export function DatePicker({ value, onChange, ...props }: { value?: unknown; onChange?: (value: unknown) => void; [key: string]: unknown }) { return <HeroInput {...props} type="date" value={(value as { format?: (format: string) => string })?.format?.('YYYY-MM-DD') ?? ''} onChange={(event) => onChange?.(event.target.value)} />; }
DatePicker.RangePicker = ({ value, onChange, ...props }: { value?: unknown[]; onChange?: (value: unknown) => void; [key: string]: unknown }) => <div className="ui-date-range"><HeroInput {...props} type="date" value={(value?.[0] as { format?: (format: string) => string })?.format?.('YYYY-MM-DD') ?? ''} onChange={() => undefined} /><HeroInput {...props} type="date" value={(value?.[1] as { format?: (format: string) => string })?.format?.('YYYY-MM-DD') ?? ''} onChange={() => onChange?.(value)} /></div>;
export function List({ dataSource = [], renderItem }: { dataSource?: unknown[]; renderItem?: (item: unknown) => ReactNode; [key: string]: unknown }) { return <div className="ui-list">{dataSource.map((item, index) => <div key={index}>{renderItem?.(item)}</div>)}</div>; }
List.Item = ({ children }: { children: ReactNode }) => <div>{children}</div>;
export const Pagination = ({ current = 1, total = 0, pageSize = 10, onChange }: { current?: number; total?: number; pageSize?: number; onChange?: (page: number, pageSize: number) => void }) => <div className="ui-pagination"><Button disabled={current <= 1} onClick={() => onChange?.(current - 1, pageSize)}>上一页</Button><span>{current} / {Math.max(1, Math.ceil(total / pageSize))}</span><Button disabled={current >= Math.ceil(total / pageSize)} onClick={() => onChange?.(current + 1, pageSize)}>下一页</Button></div>;
