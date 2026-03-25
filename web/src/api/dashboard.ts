import type { DashboardOverviewResponse, DashboardTrendResponse, InstanceQuery } from '../types/api';
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

export async function fetchDashboardOverview(filters?: InstanceQuery): Promise<DashboardOverviewResponse> {
  const { data } = await apiClient.get<DashboardOverviewResponse>('/dashboard/overview', {
    params: buildInstanceQueryParams(filters),
  });
  return data;
}

export async function fetchDashboardTrends(
  days: 7 | 30,
  filters?: InstanceQuery,
): Promise<DashboardTrendResponse> {
  const { data } = await apiClient.get<DashboardTrendResponse>('/dashboard/trends', {
    params: {
      days,
      ...buildInstanceQueryParams(filters),
    },
  });
  return data;
}
