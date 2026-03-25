import type { InstanceCreatePayload, InstanceUpdatePayload } from '../types/api';

export function normalizeBaseUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return normalized;
  }

  try {
    const url = new URL(normalized);
    url.search = '';
    url.hash = '';
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return normalized.replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

export function normalizeInstancePayload<T extends InstanceCreatePayload | InstanceUpdatePayload>(payload: T): T {
  return {
    ...payload,
    name: payload.name.trim(),
    base_url: normalizeBaseUrl(payload.base_url),
    username: payload.username.trim(),
    access_token: payload.access_token?.trim(),
    tags: Array.from(new Set(payload.tags.map((item) => item.trim()).filter(Boolean))),
  };
}
