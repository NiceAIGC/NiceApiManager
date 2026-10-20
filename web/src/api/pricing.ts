import type { PricingCompareResponse, PricingFacetResponse, PricingModelListResponse } from '../types/api';
import { apiClient } from './client';

export interface PricingQuery {
  instance_id?: number;
  search?: string;
  group_name?: string;
  tag?: string;
  vendor?: string;
  endpoint_type?: string;
  billing_kind?: string;
  offset: number;
  limit: number;
}

export async function fetchPricingModels(params: PricingQuery): Promise<PricingModelListResponse> {
  const { data } = await apiClient.get<PricingModelListResponse>('/pricing/models', { params });
  return data;
}

export interface PricingCompareQuery {
  search?: string;
  tag?: string;
  instance_ids?: number[];
  group_name?: string;
  vendor?: string;
  offset: number;
  limit: number;
}

export async function fetchPricingComparison(params: PricingCompareQuery): Promise<PricingCompareResponse> {
  const { data } = await apiClient.get<PricingCompareResponse>('/pricing/compare', {
    params: {
      ...params,
      instance_ids: params.instance_ids?.length ? params.instance_ids.join(',') : undefined,
    },
  });
  return data;
}

export async function fetchPricingFacets(params?: { instance_id?: number; tag?: string }): Promise<PricingFacetResponse> {
  const { data } = await apiClient.get<PricingFacetResponse>('/pricing/facets', { params });
  return data;
}
