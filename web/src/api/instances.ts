import type {
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
