import type {
  BatchInstanceDeleteResponse,
  BatchInstanceResponse,
  BatchInstanceUpdatePayload,
  InstanceCreatePayload,
  InstanceListResponse,
  InstanceTestResponse,
  InstanceUpdatePayload,
} from '../types/api';
import { apiClient } from './client';

export async function fetchInstances(tag?: string): Promise<InstanceListResponse> {
  const { data } = await apiClient.get<InstanceListResponse>('/instances', {
    params: tag ? { tag } : undefined,
  });
  return data;
}

export async function createInstance(payload: InstanceCreatePayload) {
  const { data } = await apiClient.post('/instances', payload);
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

export async function updateInstance(instanceId: number, payload: InstanceUpdatePayload) {
  const { data } = await apiClient.patch(`/instances/${instanceId}`, payload);
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

export async function syncInstance(instanceId: number) {
  const { data } = await apiClient.post(`/instances/${instanceId}/sync`);
  return data;
}
