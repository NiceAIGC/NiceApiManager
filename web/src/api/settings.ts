import type { AppSettings } from '../types/api';
import { apiClient } from './client';

export async function fetchAppSettings(): Promise<AppSettings> {
  const { data } = await apiClient.get<AppSettings>('/settings');
  return data;
}

export async function updateAppSettings(payload: AppSettings): Promise<AppSettings> {
  const { data } = await apiClient.patch<AppSettings>('/settings', payload);
  return data;
}
