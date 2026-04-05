import type { NotificationLogListResponse, SyncRunListResponse } from '../types/api';
import { apiClient } from './client';

export interface SyncLogsQuery {
  instance_id?: number;
  offset: number;
  limit: number;
}

export interface NotificationLogsQuery {
  instance_id?: number;
  source_type?: string;
  offset: number;
  limit: number;
}

export async function fetchSyncRuns(params: SyncLogsQuery): Promise<SyncRunListResponse> {
  const { data } = await apiClient.get<SyncRunListResponse>('/sync-runs', { params });
  return data;
}

export async function fetchNotificationLogs(params: NotificationLogsQuery): Promise<NotificationLogListResponse> {
  const { data } = await apiClient.get<NotificationLogListResponse>('/notification-logs', { params });
  return data;
}
