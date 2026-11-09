import type {
  BatchInstanceBulkUpdatePayload,
  BatchInstanceDeleteResponse,
  BatchInstanceResponse,
  BatchInstanceUpdatePayload,
  Instance,
  InstanceCreatePayload,
  InstanceQuery,
  InstanceListResponse,
  InstanceTestResponse,
  ProxyConnectivityTestPayload,
  ProxyConnectivityTestResponse,
  SingleSyncResponse,
  InstanceUpdatePayload,
} from '../types/api';
import { apiClient } from './client';

function buildInstanceQueryParams(filters?: InstanceQuery) {
  if (!filters) {
    return undefined;
  }

  return {
    ...filters,
    tags: filters.tags?.length ? filters.tags.join(',') : undefined,
  };
}

export async function fetchInstances(filters?: InstanceQuery): Promise<InstanceListResponse> {
  const { data } = await apiClient.get<InstanceListResponse>('/instances', {
    params: buildInstanceQueryParams(filters),
  });
  return data;
}

export async function createInstance(payload: InstanceCreatePayload) {
  const { data } = await apiClient.post<Instance>('/instances', payload);
  return data;
}

export async function createInstancesBatch(payloads: InstanceCreatePayload[]): Promise<BatchInstanceResponse> {
  const { data } = await apiClient.post<BatchInstanceResponse>('/instances/batch-create', {
    items: payloads,
  });
  return data;
}

export async function testInstance(instanceId: number): Promise<InstanceTestResponse> {
  const { data } = await apiClient.post<InstanceTestResponse>(`/instances/${instanceId}/test`);
  return data;
}

export async function testInstanceProxy(
  payload: ProxyConnectivityTestPayload,
): Promise<ProxyConnectivityTestResponse> {
  const { data } = await apiClient.post<ProxyConnectivityTestResponse>('/instances/test-proxy', payload);
  return data;
}

export async function updateInstance(instanceId: number, payload: InstanceUpdatePayload) {
  const { data } = await apiClient.patch<Instance>(`/instances/${instanceId}`, payload);
  return data;
}

export async function updateInstancesBatch(payloads: BatchInstanceUpdatePayload[]): Promise<BatchInstanceResponse> {
  const { data } = await apiClient.patch<BatchInstanceResponse>('/instances/batch-update', {
    items: payloads,
  });
  return data;
}

export async function bulkUpdateInstances(payload: BatchInstanceBulkUpdatePayload): Promise<BatchInstanceResponse> {
  const { data } = await apiClient.patch<BatchInstanceResponse>('/instances/bulk-update', payload);
  return data;
}

export async function deleteInstancesBatch(ids: number[]): Promise<BatchInstanceDeleteResponse> {
  const { data } = await apiClient.post<BatchInstanceDeleteResponse>('/instances/batch-delete', {
    ids,
  });
  return data;
}

export async function syncInstance(instanceId: number): Promise<SingleSyncResponse> {
  const { data } = await apiClient.post<SingleSyncResponse>(`/instances/${instanceId}/sync`);
  return data;
}

export interface BalanceHistoryPoint {
  snapshot_at: string;
  balance: number | null;
  used_amount: number | null;
}

export async function fetchInstanceBalanceHistory(instanceId: number, days = 30): Promise<BalanceHistoryPoint[]> {
  const { data } = await apiClient.get<{ items: BalanceHistoryPoint[] }>(`/instances/${instanceId}/balance-history`, {
    params: { days },
  });
  return data.items;
}

export interface InstanceInsightGroup {
  group_name: string;
  group_desc?: string | null;
  ratio: number;
  platform?: string | null;
  user_ratio?: number | null;
  peak_ratio?: number | null;
  peak_start?: string | null;
  peak_end?: string | null;
  labels: string[];
  snapshot_at?: string | null;
}

export interface InstanceInsightRateChange {
  id: number;
  group_name: string;
  platform?: string | null;
  change_type: 'added' | 'removed' | 'changed';
  old_ratio?: number | null;
  new_ratio?: number | null;
  change_percent?: number | null;
  detected_at?: string | null;
}

export interface InstanceInsightAnnouncement {
  id: number;
  title: string;
  content: string;
  published_at?: string | null;
  synced_at?: string | null;
}

export interface InstanceInsightUsageRow {
  model_name?: string;
  group_name?: string;
  requests: number;
  used_amount: number;
}

export interface InstanceInsights {
  instance_id: number;
  days: number;
  groups: InstanceInsightGroup[];
  rate_changes: InstanceInsightRateChange[];
  announcements: InstanceInsightAnnouncement[];
  model_usage?: InstanceInsightUsageRow[];
  group_usage?: InstanceInsightUsageRow[];
  usage_error?: string | null;
}

export interface InstanceUsageBreakdown {
  models: InstanceInsightUsageRow[];
  groups: InstanceInsightUsageRow[];
  window_start?: string | null;
  window_end?: string | null;
  /** true 表示近 N 天无日志，展示的是最近一批记录 */
  fallback?: boolean;
  error?: string | null;
}

export async function fetchInstanceInsights(instanceId: number, days = 7): Promise<InstanceInsights> {
  const { data } = await apiClient.get<InstanceInsights>(`/instances/${instanceId}/insights`, { params: { days } });
  return data;
}

export async function fetchInstanceUsageBreakdown(instanceId: number, days = 7): Promise<InstanceUsageBreakdown> {
  const { data } = await apiClient.get<InstanceUsageBreakdown>(`/instances/${instanceId}/usage-breakdown`, { params: { days } });
  return data;
}
