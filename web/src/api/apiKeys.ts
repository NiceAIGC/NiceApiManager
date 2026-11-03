import { apiClient } from './client';

export interface ApiKeyItem {
  id: number;
  name: string;
  key_prefix: string;
  enabled: boolean;
  created_at?: string | null;
  last_used_at?: string | null;
}

export async function fetchApiKeys(): Promise<ApiKeyItem[]> {
  const { data } = await apiClient.get<{ items: ApiKeyItem[] }>('/api-keys');
  return data.items;
}

export async function createApiKey(name: string): Promise<ApiKeyItem & { key: string }> {
  const { data } = await apiClient.post<ApiKeyItem & { key: string }>('/api-keys', { name });
  return data;
}

export async function toggleApiKey(id: number, enabled: boolean): Promise<ApiKeyItem> {
  const { data } = await apiClient.patch<ApiKeyItem>(`/api-keys/${id}`, { enabled });
  return data;
}

export async function deleteApiKey(id: number): Promise<void> {
  await apiClient.delete(`/api-keys/${id}`);
}
