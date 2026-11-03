import { useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react';

import { AppModal, Button, Progress, StatusBadge } from './ui';
import { cn } from '@/lib/utils';

export interface SyncProgressItem {
  key: number | string;
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  error?: string | null;
}

interface SyncProgressModalProps {
  open: boolean;
  title?: string;
  running: boolean;
  total: number;
  completed: number;
  successCount: number;
  failedCount: number;
  activeNames?: string[];
  items: SyncProgressItem[];
  onRetryFailed?: (items: SyncProgressItem[]) => void;
  onClose: () => void;
}

const statusMeta = {
  pending: { label: '等待中', icon: CircleDashed, className: 'text-muted-foreground' },
  running: { label: '同步中', icon: Loader2, className: 'animate-spin text-primary' },
  success: { label: '成功', icon: CheckCircle2, className: 'text-emerald-500' },
  failed: { label: '失败', icon: XCircle, className: 'text-destructive' },
} as const;

export function SyncProgressModal({
  open,
  title = '同步进度',
  running,
  total,
  completed,
  successCount,
  failedCount,
  activeNames = [],
  items,
  onRetryFailed,
  onClose,
}: SyncProgressModalProps) {
  const [showAll, setShowAll] = useState(false);
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const failedItems = items.filter((item) => item.status === 'failed');
  const visibleItems = showAll ? items : items.slice(0, 8);

  useEffect(() => {
    if (open) setShowAll(false);
  }, [open]);

  return (
    <AppModal
      open={open}
      onOpenChange={(value) => {
        if (!value && !running) onClose();
      }}
      title={title}
      description={running ? '正在调用各上游站点，请勿关闭页面。' : '同步已完成，可查看结果或重试失败项。'}
      size="md"
      footer={
        <>
          {!running && failedItems.length && onRetryFailed ? (
            <Button variant="outline" onClick={() => onRetryFailed(failedItems)}>
              重试失败（{failedItems.length}）
            </Button>
          ) : null}
          <Button variant={running ? 'secondary' : 'default'} disabled={running} onClick={onClose}>
            {running ? '同步中…' : '完成'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {completed}/{total} 已完成
            </span>
            <span className="text-muted-foreground tabular">{percent}%</span>
          </div>
          <Progress value={percent} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <StatusBadge tone="success">成功 {successCount}</StatusBadge>
            <StatusBadge tone={failedCount ? 'destructive' : 'muted'}>失败 {failedCount}</StatusBadge>
            {activeNames.length ? <span>进行中：{activeNames.join('、')}</span> : null}
          </div>
        </div>

        <div className="flex flex-col divide-y rounded-lg border">
          {visibleItems.map((item) => {
            const meta = statusMeta[item.status];
            const Icon = meta.icon;
            return (
              <div key={item.key} className="flex items-start gap-2 px-3 py-2 text-sm">
                <Icon className={cn('mt-0.5 size-4 shrink-0', meta.className)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{item.name}</div>
                  {item.error ? <div className="mt-0.5 break-words text-xs text-destructive">{item.error}</div> : null}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{meta.label}</span>
              </div>
            );
          })}
          {items.length > 8 ? (
            <div className="px-3 py-2">
              <Button variant="ghost" size="sm" onClick={() => setShowAll((value) => !value)}>
                {showAll ? '收起列表' : `展开全部 ${items.length} 项`}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </AppModal>
  );
}
