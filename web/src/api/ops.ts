import { apiClient } from './client';

export interface RateChangeEventItem {
  id: number;
  instance_id: number;
  instance_name: string;
  group_name: string;
  platform?: string | null;
  change_type: 'added' | 'removed' | 'changed';
  old_ratio?: number | null;
  new_ratio?: number | null;
  change_percent?: number | null;
  notified: boolean;
  detected_at: string;
}

export interface AnnouncementItem {
  id: number;
  instance_id: number;
  instance_name: string;
  title: string;
  content: string;
  published_at?: string | null;
  synced_at: string;
  notified: boolean;
}

interface PagedQuery {
  instance_id?: number;
  page?: number;
  page_size?: number;
}

export async function fetchRateChanges(params: PagedQuery): Promise<{ total: number; items: RateChangeEventItem[] }> {
  const { data } = await apiClient.get<{ total: number; items: RateChangeEventItem[] }>('/rate-changes', { params });
  return data;
}

export async function fetchAnnouncements(params: PagedQuery): Promise<{ total: number; items: AnnouncementItem[] }> {
  const { data } = await apiClient.get<{ total: number; items: AnnouncementItem[] }>('/announcements', { params });
  return data;
}
