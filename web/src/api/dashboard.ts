import type {
  DashboardOverviewResponse,
  DashboardTrendQuery,
  DashboardTrendResponse,
  InstanceQuery,
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

export async function fetchDashboardOverview(filters?: InstanceQuery): Promise<DashboardOverviewResponse> {
  const { data } = await apiClient.get<DashboardOverviewResponse>('/dashboard/overview', {
    params: buildInstanceQueryParams(filters),
  });
  return data;
}

export async function fetchDashboardTrends(
  query: DashboardTrendQuery,
): Promise<DashboardTrendResponse> {
  const { data } = await apiClient.get<DashboardTrendResponse>('/dashboard/trends', {
    params: {
      ...buildInstanceQueryParams(query),
    },
  });
  return data;
}
