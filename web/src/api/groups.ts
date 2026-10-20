import type {
  GroupCompareResponse,
  GroupLabelItem,
  GroupLabelListResponse,
  GroupLabelPayload,
  GroupNameFacetResponse,
  GroupRatioListResponse,
} from '../types/api';
import { apiClient } from './client';

export interface GroupQuery {
  instance_id?: number;
  tag?: string;
  label_id?: number;
  search?: string;
  platform?: string;
}

export async function fetchGroups(query: GroupQuery = {}): Promise<GroupRatioListResponse> {
  const { data } = await apiClient.get<GroupRatioListResponse>('/groups', {
    params: Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined && value !== '')),
  });
  return data;
}

export async function fetchGroupComparison(params: {
  label_id?: number;
  label_name?: string;
  instance_ids?: number[];
  tag?: string;
}): Promise<GroupCompareResponse> {
  const { data } = await apiClient.get<GroupCompareResponse>('/groups/compare', {
    params: {
      label_id: params.label_id,
      label_name: params.label_name,
      tag: params.tag || undefined,
      instance_ids: params.instance_ids?.length ? params.instance_ids.join(',') : undefined,
    },
  });
  return data;
}

export async function fetchGroupNames(): Promise<GroupNameFacetResponse> {
  const { data } = await apiClient.get<GroupNameFacetResponse>('/groups/names');
  return data;
}

export async function fetchGroupLabels(): Promise<GroupLabelListResponse> {
  const { data } = await apiClient.get<GroupLabelListResponse>('/groups/labels');
  return data;
}

export async function createGroupLabel(payload: GroupLabelPayload & { name: string; group_names?: string[] }): Promise<GroupLabelItem> {
  const { data } = await apiClient.post<GroupLabelItem>('/groups/labels', payload);
  return data;
}

export async function updateGroupLabel(labelId: number, payload: GroupLabelPayload): Promise<GroupLabelItem> {
  const { data } = await apiClient.patch<GroupLabelItem>(`/groups/labels/${labelId}`, payload);
  return data;
}

export async function deleteGroupLabel(labelId: number): Promise<void> {
  await apiClient.delete(`/groups/labels/${labelId}`);
}
