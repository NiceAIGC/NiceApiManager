import { Button, Pagination, Spinner, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@heroui/react';
import type { ReactNode } from 'react';

export interface DataColumn<T> { key: string; label: ReactNode; render: (item: T) => ReactNode; }

export function DataTable<T extends { id: number | string }>({ items, columns, isLoading, empty = '暂无数据', page, pageSize, total, onPageChange }: { items: T[]; columns: DataColumn<T>[]; isLoading?: boolean; empty?: string; page?: number; pageSize?: number; total?: number; onPageChange?: (page: number) => void }) {
  const pages = pageSize && total != null ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  return <div className="space-y-4 overflow-x-auto"><Table aria-label="数据列表" removeWrapper><TableHeader columns={columns}>{(column) => <TableColumn key={column.key}>{column.label}</TableColumn>}</TableHeader><TableBody emptyContent={isLoading ? <Spinner label="正在加载" /> : empty} items={items}>{(item) => <TableRow key={item.id}>{(key) => <TableCell>{columns.find((column) => column.key === key)?.render(item)}</TableCell>}</TableRow>}</TableBody></Table>{onPageChange && pages > 1 ? <div className="flex justify-end"><Pagination page={page ?? 1} total={pages} onChange={onPageChange} /></div> : null}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) { return <div className="py-10 text-center text-sm text-default-500">{children}</div>; }
export function SmallButton({ children, onPress }: { children: ReactNode; onPress: () => void }) { return <Button size="sm" variant="flat" onPress={onPress}>{children}</Button>; }
