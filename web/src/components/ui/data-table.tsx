import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, RefreshCw } from 'lucide-react';
import { Fragment, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  width?: string | number;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
}

export interface DataTableSort {
  column: string;
  direction: 'ascending' | 'descending';
}

interface DataTableExpandable<T> {
  expandedKeys: Set<number | string>;
  onToggle: (key: number | string) => void;
  render: (row: T) => ReactNode;
  isExpandable?: (row: T) => boolean;
}

interface DataTablePagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  /** 每页条数记忆到 localStorage */
  persistenceKey?: string;
}

interface DataTableProps<T> {
  rows: T[];
  columns: DataTableColumn<T>[];
  rowKey: (row: T) => number | string;
  loading?: boolean;
  emptyText?: ReactNode;
  ariaLabel?: string;
  minWidth?: number;
  dense?: boolean;
  className?: string;
  selectedKeys?: Set<number | string>;
  onSelectionChange?: (keys: Set<number | string>) => void;
  sort?: DataTableSort;
  onSortChange?: (sort: DataTableSort) => void;
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  expandable?: DataTableExpandable<T>;
  pagination?: DataTablePagination;
  rowClassName?: (row: T) => string | undefined;
}

const alignClass = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading,
  emptyText = '暂无数据',
  ariaLabel,
  minWidth,
  dense,
  className,
  selectedKeys,
  onSelectionChange,
  sort,
  onSortChange,
  onRowClick,
  onRowDoubleClick,
  expandable,
  pagination,
  rowClassName,
}: DataTableProps<T>) {
  const selectable = Boolean(onSelectionChange);
  const keys = useMemo(() => rows.map(rowKey), [rows, rowKey]);
  const allSelected = selectable && keys.length > 0 && keys.every((key) => selectedKeys?.has(key));
  const someSelected = selectable && keys.some((key) => selectedKeys?.has(key));

  const toggleAll = (checked: boolean) => {
    if (!onSelectionChange) return;
    const next = new Set(selectedKeys ?? []);
    for (const key of keys) {
      if (checked) next.add(key);
      else next.delete(key);
    }
    onSelectionChange(next);
  };

  const toggleRow = (key: number | string, checked: boolean) => {
    if (!onSelectionChange) return;
    const next = new Set(selectedKeys ?? []);
    if (checked) next.add(key);
    else next.delete(key);
    onSelectionChange(next);
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {pagination ? <PageSizeRestorer pagination={pagination} /> : null}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="w-full overflow-x-auto">
          <Table aria-label={ariaLabel} style={minWidth ? { minWidth } : undefined} className={dense ? 'text-[13px]' : undefined}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {selectable ? (
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="全选本页"
                      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                      onCheckedChange={(value) => toggleAll(value === true)}
                    />
                  </TableHead>
                ) : null}
                {expandable ? <TableHead className="w-10" /> : null}
                {columns.map((column) => {
                  const active = sort?.column === column.id;
                  return (
                    <TableHead
                      key={column.id}
                      style={{ width: column.width, textAlign: column.align }}
                      className={cn(alignClass[column.align ?? 'left'])}
                    >
                      {column.sortable && onSortChange ? (
                        <button
                          type="button"
                          className={cn('inline-flex items-center gap-1 transition-colors hover:text-foreground', active && 'text-foreground')}
                          onClick={() =>
                            onSortChange({
                              column: column.id,
                              direction: active && sort?.direction === 'ascending' ? 'descending' : 'ascending',
                            })
                          }
                        >
                          {column.header}
                          {active ? (
                            <ChevronDown className={cn('size-3.5 transition-transform', sort?.direction === 'ascending' && 'rotate-180')} />
                          ) : (
                            <ChevronsUpDown className="size-3.5 opacity-40" />
                          )}
                        </button>
                      ) : (
                        column.header
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !rows.length ? (
                <TableRow>
                  <TableCell colSpan={columns.length + (selectable ? 1 : 0) + (expandable ? 1 : 0)} className="py-10 text-center text-sm text-muted-foreground">
                    <RefreshCw className="mx-auto mb-2 size-4 animate-spin" />
                    加载中…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length + (selectable ? 1 : 0) + (expandable ? 1 : 0)} className="py-10 text-center text-sm text-muted-foreground">
                    {emptyText}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const key = rowKey(row);
                  const expanded = expandable?.expandedKeys.has(key) ?? false;
                  const expandableRow = expandable ? expandable.isExpandable?.(row) ?? true : false;
                  return (
                    <Fragment key={key}>
                      <TableRow
                        data-state={selectedKeys?.has(key) ? 'selected' : undefined}
                        className={cn(
                          (onRowClick || onRowDoubleClick) && 'cursor-pointer',
                          dense && '[&>td]:py-2',
                          rowClassName?.(row),
                        )}
                        onClick={() => {
                          if (!(onRowClick || expandable)) return;
                          onRowClick?.(row);
                          if (expandable && expandableRow) expandable.onToggle(key);
                        }}
                        onDoubleClick={() => onRowDoubleClick?.(row)}
                      >
                        {selectable ? (
                          <TableCell onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                            <Checkbox aria-label="选择本行" checked={selectedKeys?.has(key) ?? false} onCheckedChange={(value) => toggleRow(key, value === true)} />
                          </TableCell>
                        ) : null}
                        {expandable ? (
                          <TableCell onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                            {expandableRow ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={expanded ? '收起详情' : '展开详情'}
                                onClick={() => expandable.onToggle(key)}
                              >
                                <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} />
                              </Button>
                            ) : null}
                          </TableCell>
                        ) : null}
                        {columns.map((column) => (
                          <TableCell key={column.id} className={alignClass[column.align ?? 'left']}>
                            {column.cell(row)}
                          </TableCell>
                        ))}
                      </TableRow>
                      {expanded && expandableRow ? (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={columns.length + (selectable ? 1 : 0) + (expandable ? 1 : 0)} className="p-4">
                            {expandable?.render(row)}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      {pagination ? <PaginationBar pagination={pagination} /> : null}
    </div>
  );
}

function PageSizeRestorer({ pagination }: { pagination: DataTablePagination }) {
  const { persistenceKey, pageSize, onPageSizeChange } = pagination;
  useEffect(() => {
    if (!persistenceKey || !onPageSizeChange) return;
    const stored = Number(localStorage.getItem(`nam-pagesize-${persistenceKey}`));
    if (stored > 0 && stored !== pageSize) onPageSizeChange(stored);
    // 仅在挂载时恢复一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistenceKey]);
  return null;
}

function PaginationBar({ pagination }: { pagination: DataTablePagination }) {
  const { page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions, persistenceKey } = pagination;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pages = buildPageWindow(page, pageCount);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-sm text-muted-foreground">
        共 {total} 项
        {pageCount > 1 ? ` · 第 ${page}/${pageCount} 页` : ''}
      </div>
      <div className="flex items-center gap-2">
        {onPageSizeChange ? (
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              if (persistenceKey) localStorage.setItem(`nam-pagesize-${persistenceKey}`, value);
              onPageSizeChange(Number(value));
            }}
          >
            <SelectTrigger className="h-8 w-[104px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(pageSizeOptions ?? [20, 50, 100]).map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} 条/页
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" aria-label="上一页" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          {pages.map((entry, index) =>
            entry === 'ellipsis' ? (
              <span key={`e-${index}`} className="px-1 text-sm text-muted-foreground">
                …
              </span>
            ) : (
              <Button
                key={entry}
                variant={entry === page ? 'default' : 'ghost'}
                size="icon-sm"
                className="text-xs tabular"
                onClick={() => onPageChange(entry)}
              >
                {entry}
              </Button>
            ),
          )}
          <Button variant="outline" size="icon-sm" aria-label="下一页" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function buildPageWindow(page: number, pageCount: number): Array<number | 'ellipsis'> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const set = new Set<number>([1, pageCount, page - 1, page, page + 1].filter((value) => value >= 1 && value <= pageCount));
  const sorted = [...set].sort((left, right) => left - right);
  const result: Array<number | 'ellipsis'> = [];
  let previous = 0;
  for (const value of sorted) {
    if (value - previous > 1) result.push('ellipsis');
    result.push(value);
    previous = value;
  }
  return result;
}

/** 每页条数切换菜单（供自定义工具栏复用） */
export function PageSizeMenu({ value, options, onChange }: { value: number; options: number[]; onChange: (size: number) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {value} 条/页
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((option) => (
          <DropdownMenuItem key={option} onClick={() => onChange(option)}>
            {option} 条/页
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
