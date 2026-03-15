import type { BulkSyncResponse, SyncRunListResponse } from '../types/api';
import { apiClient } from './client';

export interface SyncRunsQuery {
  instance_id?: number;
  offset: number;
  limit: number;
}

export async function syncAllInstances(): Promise<BulkSyncResponse> {
  const { data } = await apiClient.post<BulkSyncResponse>('/sync/all');
  return data;
}

export async function fetchSyncRuns(params: SyncRunsQuery): Promise<SyncRunListResponse> {
  const { data } = await apiClient.get<SyncRunListResponse>('/sync-runs', { params });
  return data;
}

