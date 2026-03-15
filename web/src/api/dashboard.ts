import type { DashboardOverviewResponse } from '../types/api';
import { apiClient } from './client';

export async function fetchDashboardOverview(tag?: string): Promise<DashboardOverviewResponse> {
  const { data } = await apiClient.get<DashboardOverviewResponse>('/dashboard/overview', {
    params: tag ? { tag } : undefined,
  });
  return data;
}
