export * from './index';
export type TableColumnsType<T> = Array<{
  key?: string;
  title?: import('react').ReactNode;
  dataIndex?: keyof T;
  render?: (value: unknown, record: T, index: number) => import('react').ReactNode;
  sorter?: unknown;
}>;
export type TablePaginationConfig = { current?: number; pageSize?: number; total?: number; onChange?: (page: number, pageSize: number) => void };
export type ColumnsType<T> = TableColumnsType<T>;
export type TabsProps = { items: Array<{ key: string; label: import('react').ReactNode; children: import('react').ReactNode }> };
