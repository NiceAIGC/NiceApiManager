import type {
  NotificationChannelGroupItem,
  NotificationChannelItem,
  NotificationChannelPayload,
  NotificationContactGroupItem,
  NotificationContactItem,
  NotificationDeliveryListResponse,
  NotificationOverview,
  NotificationRuleItem,
  NotificationTemplateItem,
  NotificationTestResponse,
} from '../types/api';
import { apiClient } from './client';

export interface NotificationRulePayload {
  name: string;
  enabled: boolean;
  event_type: NotificationRuleItem['event_type'];
  severity: NotificationRuleItem['severity'];
  scope: NotificationRuleItem['scope'];
  condition: NotificationRuleItem['condition'];
  delivery: NotificationRuleItem['delivery'];
}

export interface NotificationTemplatePayload {
  name: string;
  channel_type: string;
  subject_template?: string | null;
  body_template: string;
  provider_template_code?: string | null;
  param_map: Record<string, string>;
}

export async function fetchNotificationOverview(): Promise<NotificationOverview> {
  const { data } = await apiClient.get<NotificationOverview>('/notifications/overview');
  return data;
}

export async function fetchNotificationChannels(): Promise<NotificationChannelItem[]> {
  const { data } = await apiClient.get<NotificationChannelItem[]>('/notifications/channels');
  return data;
}

export async function createNotificationChannel(payload: NotificationChannelPayload): Promise<NotificationChannelItem> {
  const { data } = await apiClient.post<NotificationChannelItem>('/notifications/channels', payload);
  return data;
}

export async function updateNotificationChannel(id: string, payload: NotificationChannelPayload): Promise<NotificationChannelItem> {
  const { data } = await apiClient.patch<NotificationChannelItem>(`/notifications/channels/${id}`, payload);
  return data;
}

export async function deleteNotificationChannel(id: string): Promise<void> {
  await apiClient.delete(`/notifications/channels/${id}`);
}

export async function fetchNotificationChannelGroups(): Promise<NotificationChannelGroupItem[]> {
  const { data } = await apiClient.get<NotificationChannelGroupItem[]>('/notifications/channel-groups');
  return data;
}

export async function createNotificationChannelGroup(payload: { name: string; channel_ids: string[] }): Promise<NotificationChannelGroupItem> {
  const { data } = await apiClient.post<NotificationChannelGroupItem>('/notifications/channel-groups', payload);
  return data;
}

export async function updateNotificationChannelGroup(id: string, payload: { name: string; channel_ids: string[] }): Promise<NotificationChannelGroupItem> {
  const { data } = await apiClient.patch<NotificationChannelGroupItem>(`/notifications/channel-groups/${id}`, payload);
  return data;
}

export async function deleteNotificationChannelGroup(id: string): Promise<void> {
  await apiClient.delete(`/notifications/channel-groups/${id}`);
}

export async function fetchNotificationContacts(): Promise<NotificationContactItem[]> {
  const { data } = await apiClient.get<NotificationContactItem[]>('/notifications/contacts');
  return data;
}

export async function createNotificationContact(payload: Omit<NotificationContactItem, 'id' | 'created_at' | 'updated_at'>): Promise<NotificationContactItem> {
  const { data } = await apiClient.post<NotificationContactItem>('/notifications/contacts', payload);
  return data;
}

export async function updateNotificationContact(id: string, payload: Omit<NotificationContactItem, 'id' | 'created_at' | 'updated_at'>): Promise<NotificationContactItem> {
  const { data } = await apiClient.patch<NotificationContactItem>(`/notifications/contacts/${id}`, payload);
  return data;
}

export async function deleteNotificationContact(id: string): Promise<void> {
  await apiClient.delete(`/notifications/contacts/${id}`);
}

export async function fetchNotificationContactGroups(): Promise<NotificationContactGroupItem[]> {
  const { data } = await apiClient.get<NotificationContactGroupItem[]>('/notifications/contact-groups');
  return data;
}

export async function createNotificationContactGroup(payload: { name: string; contact_ids: string[] }): Promise<NotificationContactGroupItem> {
  const { data } = await apiClient.post<NotificationContactGroupItem>('/notifications/contact-groups', payload);
  return data;
}

export async function updateNotificationContactGroup(id: string, payload: { name: string; contact_ids: string[] }): Promise<NotificationContactGroupItem> {
  const { data } = await apiClient.patch<NotificationContactGroupItem>(`/notifications/contact-groups/${id}`, payload);
  return data;
}

export async function deleteNotificationContactGroup(id: string): Promise<void> {
  await apiClient.delete(`/notifications/contact-groups/${id}`);
}

export async function fetchNotificationTemplates(): Promise<NotificationTemplateItem[]> {
  const { data } = await apiClient.get<NotificationTemplateItem[]>('/notifications/templates');
  return data;
}

export async function createNotificationTemplate(payload: NotificationTemplatePayload): Promise<NotificationTemplateItem> {
  const { data } = await apiClient.post<NotificationTemplateItem>('/notifications/templates', payload);
  return data;
}

export async function updateNotificationTemplate(id: string, payload: NotificationTemplatePayload): Promise<NotificationTemplateItem> {
  const { data } = await apiClient.patch<NotificationTemplateItem>(`/notifications/templates/${id}`, payload);
  return data;
}

export async function deleteNotificationTemplate(id: string): Promise<void> {
  await apiClient.delete(`/notifications/templates/${id}`);
}

export async function fetchNotificationRules(): Promise<NotificationRuleItem[]> {
  const { data } = await apiClient.get<NotificationRuleItem[]>('/notifications/rules');
  return data;
}

export async function createNotificationRule(payload: NotificationRulePayload): Promise<NotificationRuleItem> {
  const { data } = await apiClient.post<NotificationRuleItem>('/notifications/rules', payload);
  return data;
}

export async function updateNotificationRule(id: string, payload: NotificationRulePayload): Promise<NotificationRuleItem> {
  const { data } = await apiClient.patch<NotificationRuleItem>(`/notifications/rules/${id}`, payload);
  return data;
}

export async function deleteNotificationRule(id: string): Promise<void> {
  await apiClient.delete(`/notifications/rules/${id}`);
}

export async function testNotification(payload: {
  channel_ids?: string[];
  channel_group_ids?: string[];
  contact_group_ids?: string[];
  template_id?: string | null;
  title?: string;
  body?: string;
  context?: Record<string, unknown>;
}): Promise<NotificationTestResponse> {
  const { data } = await apiClient.post<NotificationTestResponse>('/notifications/test', payload);
  return data;
}

export async function dispatchNotificationEvent(payload: {
  event_type: string;
  severity: NotificationRuleItem['severity'];
  title: string;
  body?: string;
  instance_id?: number | null;
  fields?: Record<string, unknown>;
  dedupe_key?: string | null;
}): Promise<NotificationTestResponse> {
  const { data } = await apiClient.post<NotificationTestResponse>('/notifications/events', payload);
  return data;
}

export async function fetchNotificationDeliveries(params?: {
  instance_id?: number;
  source_type?: string;
  event_type?: string;
  delivery_status?: string;
  offset?: number;
  limit?: number;
}): Promise<NotificationDeliveryListResponse> {
  const { data } = await apiClient.get<NotificationDeliveryListResponse>('/notifications/deliveries', { params });
  return data;
}
