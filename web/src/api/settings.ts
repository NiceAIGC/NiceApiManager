import type { AppSettings, NotificationTestPayload, NotificationTestResponse } from '../types/api';
import { apiClient } from './client';

export async function fetchAppSettings(): Promise<AppSettings> {
  const { data } = await apiClient.get<AppSettings>('/settings');
  return data;
}

export async function updateAppSettings(payload: AppSettings): Promise<AppSettings> {
  const { data } = await apiClient.patch<AppSettings>('/settings', payload);
  return data;
}

export async function sendTestNotification(payload: NotificationTestPayload = {}): Promise<NotificationTestResponse> {
  const { data } = await apiClient.post<NotificationTestResponse>('/settings/notifications/test', payload);
  return data;
}
