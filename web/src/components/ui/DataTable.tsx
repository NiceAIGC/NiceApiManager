import { Button, Checkbox, Dropdown, Pagination, Spinner, Table } from '@heroui/react';
import type { Key, SortDescriptor } from '@heroui/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { cx } from '../../lib/cx';

export interface DataTableColumn<T> {
  id: string;
  title: ReactNode;
  render?: (row: T) => ReactNode;
  /** 列宽，如 120 或 '12rem' */
  width?: number | string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
}

export interface DataTableSelection {
  selectedKeys: Set<Key>;
  onChange: (keys: Set<Key>) => void;
}

export interface DataTableExpandable<T> {
  expandedKeys: Set<Key>;
  onExpandedChange: (keys: Set<Key>) => void;
  renderExpanded: (row: T) => ReactNode;
  rowExpandable?: (row: T) => boolean;
}

export interface DataTablePagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
}

interface DataTableProps<T> {
  rows: T[];
  columns: Array<DataTableColumn<T>>;
  rowKey: (row: T) => Key;
  loading?: boolean;
  emptyText?: string;
  ariaLabel?: string;
  selection?: DataTableSelection;
  expandable?: DataTableExpandable<T>;
  pagination?: DataTablePagination;
  sortDescriptor?: SortDescriptor;
  onSortChange?: (descriptor: SortDescriptor) => void;
  /** 横向滚动时表格最小宽度（px） */
  minWidth?: number;
  /** 紧凑密度：更小的行高与内边距 */
  compact?: boolean;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
  /** 单击行触发（如展开详情）；不影响复选框 */
  onRowAction?: (row: T) => void;
  /** 双击行触发（如同步实例） */
  onRowDoubleClick?: (row: T) => void;
}

type DisplayItem<T> = { kind: 'data'; row: T; key: Key } | { kind: 'expanded'; row: T; key: Key };

const EXPAND_PREFIX = '__expand__';
const SELECT_COLUMN_ID = '__selection__';
const EXPAND_COLUMN_ID = '__expand_toggle__';

function SelectAllControl({ all, some, onToggle }: { all: boolean; some: boolean; onToggle: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-muted select-none">
      <input
        type="checkbox"
        className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
        checked={all}
        ref={(el) => {
          if (el) el.indeterminate = !all && some;
        }}
        onChange={(event) => onToggle(event.target.checked)}
      />
      全选本页
    </label>
  );
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading,
  emptyText = '暂无数据',
  ariaLabel,
  selection,
  expandable,
  pagination,
  sortDescriptor,
  onSortChange,
  minWidth,
  compact,
  className,
  rowClassName,
  onRowAction,
  onRowDoubleClick,
}: DataTableProps<T>) {
  const items = useMemo<Array<DisplayItem<T>>>(() => {
    const list: Array<DisplayItem<T>> = [];
    for (const row of rows) {
      const key = rowKey(row);
      list.push({ kind: 'data', row, key });
      if (expandable && expandable.expandedKeys.has(key) && (expandable.rowExpandable?.(row) ?? true)) {
        list.push({ kind: 'expanded', row, key: `${EXPAND_PREFIX}${String(key)}` });
      }
    }
    return list;
  }, [rows, rowKey, expandable]);

  const dataKeySet = useMemo(() => new Set(rows.map(rowKey)), [rows, rowKey]);

  const displayColumns = useMemo<Array<DataTableColumn<T>>>(
    () => [
      ...(selection ? [{ id: SELECT_COLUMN_ID, title: null, width: 40 } as DataTableColumn<T>] : []),
      ...(expandable ? [{ id: EXPAND_COLUMN_ID, title: null, width: 40 } as DataTableColumn<T>] : []),
      ...columns,
    ],
    [columns, selection, expandable],
  );

  const columnCount = displayColumns.length;

  const handleSelectionChange = (keys: Set<Key> | 'all') => {
    if (!selection) return;
    if (keys === 'all') {
      selection.onChange(new Set(dataKeySet));
      return;
    }
    selection.onChange(new Set([...keys].filter((key) => dataKeySet.has(key))));
  };

  const toggleExpand = (key: Key) => {
    if (!expandable) return;
    const next = new Set(expandable.expandedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandable.onExpandedChange(next);
  };

  const selectAllState = useMemo(
    () => ({
      all: Boolean(selection) && rows.length > 0 && rows.every((row) => selection?.selectedKeys.has(rowKey(row))),
      some: Boolean(selection) && rows.some((row) => selection?.selectedKeys.has(rowKey(row))),
      onToggle: (checked: boolean) => selection?.onChange(checked ? new Set(dataKeySet) : new Set()),
    }),
    [selection, rows, rowKey, dataKeySet],
  );

  return (
    <div className={cx('flex w-full flex-col gap-3', compact && 'data-table-compact', className)}>
      {selection ? (
        <div className="flex items-center gap-3">
          <SelectAllControl {...selectAllState} />
          <span className="text-sm text-muted">已选 {selection.selectedKeys.size} / {rows.length} 项</span>
        </div>
      ) : null}
      <div className="relative w-full overflow-x-auto rounded-xl border border-border bg-surface">
        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/60">
            <Spinner />
          </div>
        ) : null}
        <Table>
          <Table.ScrollContainer>
            <Table.Content
              aria-label={ariaLabel}
              selectionMode={selection ? 'multiple' : 'none'}
              selectedKeys={selection ? selection.selectedKeys : undefined}
              onSelectionChange={selection ? handleSelectionChange : undefined}
              onRowAction={
                onRowAction
                  ? (key) => {
                      const item = items.find((entry) => entry.key === key && entry.kind === 'data');
                      if (item) onRowAction(item.row);
                    }
                  : undefined
              }
              sortDescriptor={sortDescriptor}
              onSortChange={onSortChange}
              style={minWidth ? { minWidth } : undefined}
            >
              <Table.Header columns={displayColumns}>
                {(column) =>
                  column.id === SELECT_COLUMN_ID ? (
                    <Table.Column id={column.id} style={{ width: column.width }}>
                      {null}
                    </Table.Column>
                  ) : column.id === EXPAND_COLUMN_ID ? (
                    <Table.Column id={column.id} style={{ width: column.width }}>
                      {null}
                    </Table.Column>
                  ) : (
                    <Table.Column
                      id={column.id}
                      isRowHeader={column.id === displayColumns.find((entry) => entry.id !== SELECT_COLUMN_ID && entry.id !== EXPAND_COLUMN_ID)?.id}
                      allowsSorting={column.sortable}
                      style={{
                        width: column.width,
                        textAlign: column.align,
                      }}
                    >
                      {column.title}
                    </Table.Column>
                  )
                }
              </Table.Header>
              <Table.Body items={items} renderEmptyState={() => <div className="py-10 text-center text-sm text-muted">{emptyText}</div>}>
                {(item) =>
                  item.kind === 'expanded' ? (
                    <Table.Row id={item.key} className="bg-surface-secondary">
                      <Table.Cell colSpan={columnCount}>{expandable?.renderExpanded(item.row)}</Table.Cell>
                    </Table.Row>
                  ) : (
                    <Table.Row
                      id={item.key}
                      className={cx(rowClassName?.(item.row), (onRowAction || onRowDoubleClick) && 'cursor-pointer')}
                      onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(item.row) : undefined}
                    >
                      {displayColumns.map((column) =>
                        column.id === SELECT_COLUMN_ID ? (
                          <Table.Cell key={column.id}>
                            <span onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                            <Checkbox slot="selection" aria-label="选择本行">
                              <Checkbox.Control>
                                <Checkbox.Indicator />
                              </Checkbox.Control>
                            </Checkbox>
                            </span>
                          </Table.Cell>
                        ) : column.id === EXPAND_COLUMN_ID ? (
                          <Table.Cell key={column.id}>
                            {expandable && (expandable.rowExpandable?.(item.row) ?? true) ? (
                              <span onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                                <Button isIconOnly variant="ghost" size="sm" aria-label={expandable.expandedKeys.has(item.key) ? '收起详情' : '展开详情'} onPress={() => toggleExpand(item.key)}>
                                  {expandable.expandedKeys.has(item.key) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                </Button>
                              </span>
                            ) : null}
                          </Table.Cell>
                        ) : (
                          <Table.Cell key={column.id}>
                            <div className={cx(column.align === 'right' && 'text-right', column.align === 'center' && 'text-center')}>
                              {column.render ? column.render(item.row) : String((item.row as Record<string, unknown>)[column.id] ?? '')}
                            </div>
                          </Table.Cell>
                        ),
                      )}
                    </Table.Row>
                  )
                }
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>
      {pagination ? <DataTablePaginationBar pagination={pagination} /> : null}
    </div>
  );
}

function DataTablePaginationBar({ pagination }: { pagination: DataTablePagination }) {
  const { page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions } = pagination;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pages = buildPageWindow(page, pageCount);

  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <div className="text-sm text-muted">共 {total} 项</div>
      <div className="flex items-center gap-3">
        {onPageSizeChange ? (
          <Dropdown>
            <Dropdown.Trigger>
              <Button variant="secondary" size="sm" aria-label="每页条数">
                {pageSize} 条/页
                <ChevronDown size={14} />
              </Button>
            </Dropdown.Trigger>
            <Dropdown.Popover>
              <Dropdown.Menu
                selectionMode="single"
                selectedKeys={new Set([String(pageSize)])}
                onSelectionChange={(keys) => {
                  if (keys === 'all') return;
                  const [next] = keys;
                  if (next != null) onPageSizeChange(Number(next));
                }}
              >
                {(pageSizeOptions ?? [10, 20, 50, 100]).map((size) => (
                  <Dropdown.Item key={size} id={String(size)}>
                    {size} 条/页
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        ) : null}
        <Pagination>
          <Pagination.Content>
            <Pagination.Item>
              <Pagination.Previous isDisabled={page <= 1} onPress={() => onPageChange(page - 1)}>
                <Pagination.PreviousIcon />
              </Pagination.Previous>
            </Pagination.Item>
            {pages.map((entry, index) =>
              entry === 'ellipsis' ? (
                <Pagination.Item key={`ellipsis-${index}`}>
                  <Pagination.Ellipsis />
                </Pagination.Item>
              ) : (
                <Pagination.Item key={entry}>
                  <Pagination.Link isActive={entry === page} onPress={() => onPageChange(entry)}>
                    {entry}
                  </Pagination.Link>
                </Pagination.Item>
              ),
            )}
            <Pagination.Item>
              <Pagination.Next isDisabled={page >= pageCount} onPress={() => onPageChange(page + 1)}>
                <Pagination.NextIcon />
              </Pagination.Next>
            </Pagination.Item>
          </Pagination.Content>
        </Pagination>
      </div>
    </div>
  );
}

function buildPageWindow(page: number, pageCount: number): Array<number | 'ellipsis'> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const windowPages = new Set<number>([1, pageCount, page - 1, page, page + 1].filter((entry) => entry >= 1 && entry <= pageCount));
  const sorted = [...windowPages].sort((left, right) => left - right);
  const result: Array<number | 'ellipsis'> = [];
  let previous = 0;
  for (const entry of sorted) {
    if (entry - previous > 1) result.push('ellipsis');
    result.push(entry);
    previous = entry;
  }
  return result;
}
