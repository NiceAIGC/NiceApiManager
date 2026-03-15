import type { PricingModelListResponse } from '../types/api';
import { apiClient } from './client';

export interface PricingQuery {
  instance_id?: number;
  search?: string;
  group_name?: string;
  tag?: string;
  offset: number;
  limit: number;
}

export async function fetchPricingModels(params: PricingQuery): Promise<PricingModelListResponse> {
  const { data } = await apiClient.get<PricingModelListResponse>('/pricing/models', { params });
  return data;
}
