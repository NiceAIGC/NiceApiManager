import { Alert, Button, ProgressBar } from '@heroui/react';

import { AppModal, DataTable, StatusChip } from './ui';
import type { DataTableColumn } from './ui';

export type SyncProgressStatus = 'pending' | 'running' | 'success' | 'failed';

export interface SyncProgressItem {
  key: string | number;
  name: string;
  status: SyncProgressStatus;
  errorMessage?: string | null;
  detail?: string | null;
  durationMs?: number | null;
}

interface SyncProgressModalProps {
  open: boolean;
  title: string;
  running: boolean;
  total: number;
  completed: number;
  successCount: number;
  failedCount: number;
  activeNames?: string[];
  items: SyncProgressItem[];
  onClose: () => void;
  onRetryFailed?: (items: SyncProgressItem[]) => void;
}

function formatStatus(status: SyncProgressStatus) {
  if (status === 'running') return { color: 'accent' as const, label: '同步中' };
  if (status === 'success') return { color: 'success' as const, label: '成功' };
  if (status === 'failed') return { color: 'danger' as const, label: '失败' };
  return { color: 'default' as const, label: '等待中' };
}

function formatDuration(durationMs?: number | null) {
  if (durationMs == null) return '-';
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)} s`;
}

export function SyncProgressModal({
  open,
  title,
  running,
  total,
  completed,
  successCount,
  failedCount,
  activeNames = [],
  items,
  onClose,
  onRetryFailed,
}: SyncProgressModalProps) {
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const failedItems = items.filter((item) => item.status === 'failed');
  const columns: DataTableColumn<SyncProgressItem>[] = [
    { id: 'name', title: '实例', width: 180, render: (item) => <strong>{item.name}</strong> },
    {
      id: 'status',
      title: '状态',
      width: 90,
      render: (item) => {
        const meta = formatStatus(item.status);
        return <StatusChip color={meta.color}>{meta.label}</StatusChip>;
      },
    },
    { id: 'duration', title: '耗时', width: 90, render: (item) => formatDuration(item.durationMs) },
    {
      id: 'detail',
      title: '说明',
      render: (item) => item.errorMessage ? <span className="text-danger">{item.errorMessage}</span> : item.detail || '-',
    },
  ];

  return (
    <AppModal
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen && !running) onClose(); }}
      title={title}
      size="lg"
      isDismissable={!running}
      footer={() => (
        <div className="flex justify-end gap-2">
          {!running && failedItems.length > 0 && onRetryFailed ? (
            <Button variant="secondary" onPress={() => onRetryFailed(failedItems)}>重试失败实例（{failedItems.length}）</Button>
          ) : null}
          <Button variant="primary" isDisabled={running} onPress={onClose}>关闭</Button>
        </div>
      )}
    >
      <div className="sync-progress-stack flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <ProgressBar value={percent} minValue={0} maxValue={100} aria-label="同步进度">
            <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
          </ProgressBar>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div>总数：{total}</div><div>已完成：{completed}</div><div>成功：{successCount}</div><div>失败：{failedCount}</div>
          </div>
          <Alert status={running ? 'accent' : failedCount ? 'warning' : 'success'}>
            <Alert.Indicator /><Alert.Content>
              <Alert.Title>{running ? `正在同步 ${activeNames.length} 个实例` : failedCount ? `同步结束，失败 ${failedCount} 个` : '全部实例同步完成'}</Alert.Title>
              <Alert.Description>
                {activeNames.length ? <span className="flex flex-wrap gap-2">{activeNames.map((name) => <StatusChip key={name} color="accent">{name}</StatusChip>)}</span> : '详情见下方逐项结果表。'}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        </div>
        <DataTable rows={items} columns={columns} rowKey={(item) => item.key} emptyText="暂无同步记录" minWidth={600} />
      </div>
    </AppModal>
  );
}
