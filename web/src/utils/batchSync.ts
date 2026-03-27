import { getErrorMessage } from '../api/client';
import type { SingleSyncResponse } from '../types/api';

export type BatchSyncStatus = 'pending' | 'running' | 'success' | 'failed';

export interface BatchSyncTarget {
  id: number;
  name: string;
}

export interface BatchSyncResultItem {
  key: number;
  name: string;
  status: BatchSyncStatus;
  errorMessage?: string | null;
  detail?: string | null;
  durationMs?: number | null;
}

interface RunBatchSyncOptions {
  targets: BatchSyncTarget[];
  maxWorkers: number;
  syncOne: (instanceId: number) => Promise<SingleSyncResponse>;
  onStateChange: (state: {
    running: boolean;
    completed: number;
    successCount: number;
    failedCount: number;
    activeNames: string[];
    items: BatchSyncResultItem[];
  }) => void;
}

export interface RunBatchSyncResult {
  total: number;
  successCount: number;
  failedCount: number;
  items: BatchSyncResultItem[];
}

export async function runBatchSyncWithConcurrency({
  targets,
  maxWorkers,
  syncOne,
  onStateChange,
}: RunBatchSyncOptions): Promise<RunBatchSyncResult> {
  const workerCount = Math.max(1, Math.min(maxWorkers, targets.length || 1));
  const items = targets.map<BatchSyncResultItem>((target) => ({
    key: target.id,
    name: target.name,
    status: 'pending',
  }));
  const itemIndexMap = new Map(targets.map((target, index) => [target.id, index]));
  const activeNames = new Set<string>();
  let completed = 0;
  let successCount = 0;
  let failedCount = 0;
  let nextIndex = 0;

  const publish = (running: boolean) => {
    onStateChange({
      running,
      completed,
      successCount,
      failedCount,
      activeNames: Array.from(activeNames),
      items: [...items],
    });
  };

  publish(true);

  const runNext = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= targets.length) {
        return;
      }

      const target = targets[currentIndex];
      const itemIndex = itemIndexMap.get(target.id);
      if (itemIndex == null) {
        continue;
      }

      items[itemIndex] = {
        ...items[itemIndex],
        status: 'running',
        errorMessage: null,
        detail: '正在拉取远端数据并写入本地快照',
      };
      activeNames.add(target.name);
      publish(true);

      try {
        const result = await syncOne(target.id);
        successCount += 1;
        items[itemIndex] = {
          ...items[itemIndex],
          status: result.status === 'success' ? 'success' : 'failed',
          errorMessage: result.error_message ?? null,
          durationMs: result.duration_ms ?? null,
          detail: result.summary_json?.history_warning
            ? String(result.summary_json.history_warning)
            : result.status === 'success'
              ? '同步完成'
              : result.error_message ?? '同步失败',
        };
        if (result.status !== 'success') {
          failedCount += 1;
          successCount -= 1;
        }
      } catch (error) {
        failedCount += 1;
        items[itemIndex] = {
          ...items[itemIndex],
          status: 'failed',
          errorMessage: getErrorMessage(error),
          detail: '同步请求失败',
        };
      } finally {
        completed += 1;
        activeNames.delete(target.name);
        publish(completed < targets.length);
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  publish(false);

  return {
    total: targets.length,
    successCount,
    failedCount,
    items,
  };
}
