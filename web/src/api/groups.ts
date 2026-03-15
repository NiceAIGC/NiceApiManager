import type { GroupRatioListResponse } from '../types/api';
import { apiClient } from './client';

export async function fetchGroups(instanceId?: number, tag?: string): Promise<GroupRatioListResponse> {
  const { data } = await apiClient.get<GroupRatioListResponse>('/groups', {
    params: {
      ...(instanceId ? { instance_id: instanceId } : {}),
      ...(tag ? { tag } : {}),
    },
  });
  return data;
}
