import type { AuthStatusResponse, ChangePasswordPayload } from '../types/api';
import { apiClient } from './client';

export async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  const { data } = await apiClient.get<AuthStatusResponse>('/auth/status');
  return data;
}

export async function login(password: string): Promise<AuthStatusResponse> {
  const { data } = await apiClient.post<AuthStatusResponse>('/auth/login', { password });
  return data;
}

export async function logout(): Promise<AuthStatusResponse> {
  const { data } = await apiClient.post<AuthStatusResponse>('/auth/logout');
  return data;
}

export async function changePassword(payload: ChangePasswordPayload): Promise<AuthStatusResponse> {
  const { data } = await apiClient.post<AuthStatusResponse>('/auth/change-password', payload);
  return data;
}
