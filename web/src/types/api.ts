export interface DashboardInstanceSummary {
  instance_id: number;
  instance_name: string;
  enabled: boolean;
  billing_mode: 'prepaid' | 'postpaid';
  tags: string[];
  quota_per_unit?: number | null;
  health_status: string;
  health_error?: string | null;
  last_sync_at?: string | null;
  latest_group_name?: string | null;
  latest_quota?: number | null;
  latest_used_quota?: number | null;
  latest_display_quota?: number | null;
  latest_display_used_quota?: number | null;
  latest_request_count?: number | null;
  today_request_count: number;
}

export interface DashboardOverviewResponse {
  instance_count: number;
  enabled_instance_count: number;
  healthy_instance_count: number;
  unhealthy_instance_count: number;
  prepaid_instance_count: number;
  postpaid_instance_count: number;
  total_quota: number;
  total_used_quota: number;
  total_display_quota: number;
  total_display_used_quota: number;
  total_request_count: number;
  today_request_count: number;
  items: DashboardInstanceSummary[];
}

export interface DashboardTrendPoint {
  date: string;
  label: string;
  used_display_amount: number;
  request_count: number;
}

export interface DashboardTrendResponse {
  days: number;
  start_date: string;
  end_date: string;
  points: DashboardTrendPoint[];
}

export interface DashboardTrendQuery extends InstanceQuery {
  days?: number;
  start_date?: string;
  end_date?: string;
}

export interface Instance {
  id: number;
  name: string;
  base_url: string;
  program_type: 'newapi' | 'rixapi' | 'shellapi';
  username: string;
  enabled: boolean;
  billing_mode: 'prepaid' | 'postpaid';
  tags: string[];
  quota_per_unit?: number | null;
  latest_group_name?: string | null;
  latest_quota?: number | null;
  latest_used_quota?: number | null;
  latest_display_quota?: number | null;
  latest_display_used_quota?: number | null;
  latest_request_count?: number | null;
  today_request_count: number;
  last_sync_at?: string | null;
  last_health_status: string;
  last_health_error?: string | null;
  created_at: string;
  updated_at: string;
  remote_user_id?: number | null;
  has_access_token: boolean;
  session_expires_at?: string | null;
}

export interface InstanceListResponse {
  total: number;
  items: Instance[];
}

export interface InstanceCreatePayload {
  name: string;
  base_url: string;
  program_type: 'newapi' | 'rixapi' | 'shellapi';
  username: string;
  password?: string;
  remote_user_id?: number | null;
  access_token?: string;
  enabled: boolean;
  billing_mode: 'prepaid' | 'postpaid';
  tags: string[];
}

export interface InstanceUpdatePayload {
  name: string;
  base_url: string;
  program_type: 'newapi' | 'rixapi' | 'shellapi';
  username: string;
  password?: string;
  remote_user_id?: number | null;
  access_token?: string;
  enabled: boolean;
  billing_mode: 'prepaid' | 'postpaid';
  tags: string[];
}

export interface BatchInstanceUpdatePayload extends InstanceUpdatePayload {
  id: number;
}

export interface InstanceTestResponse {
  success: boolean;
  instance_id: number;
  program_type: 'newapi' | 'rixapi' | 'shellapi';
  remote_user_id: number;
  remote_username: string;
  remote_group?: string | null;
  billing_mode: 'prepaid' | 'postpaid';
  quota: number;
  used_quota: number;
  display_quota?: number | null;
  display_used_quota?: number | null;
  quota_per_unit?: number | null;
  request_count: number;
  group_count: number;
  pricing_model_count: number;
}

export interface GroupRatioItem {
  id: number;
  instance_id: number;
  instance_name: string;
  group_name: string;
  group_desc?: string | null;
  ratio: number;
  snapshot_at: string;
}

export interface GroupRatioListResponse {
  total: number;
  items: GroupRatioItem[];
}

export interface PricingModelItem {
  id: number;
  instance_id: number;
  instance_name: string;
  model_name: string;
  vendor_id?: number | null;
  vendor_name?: string | null;
  quota_type: number;
  model_ratio: number;
  model_price: number;
  completion_ratio: number;
  enable_groups: string[];
  supported_endpoint_types: string[];
  snapshot_at: string;
}

export interface PricingModelListResponse {
  total: number;
  offset: number;
  limit: number;
  items: PricingModelItem[];
}

export interface SyncRun {
  id: number;
  instance_id: number;
  instance_name: string;
  trigger_type: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  duration_ms?: number | null;
  error_message?: string | null;
  summary_json?: Record<string, unknown> | null;
}

export interface SyncRunListResponse {
  total: number;
  offset: number;
  limit: number;
  items: SyncRun[];
}

export interface SingleSyncResponse {
  id: number;
  instance_id: number;
  trigger_type: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  duration_ms?: number | null;
  error_message?: string | null;
  summary_json?: Record<string, unknown> | null;
}

export interface BulkSyncItem {
  instance_id: number;
  instance_name: string;
  status: string;
  sync_run_id?: number | null;
  error_message?: string | null;
}

export interface BulkSyncPayload {
  instance_ids?: number[];
}

export interface BulkSyncResponse {
  total: number;
  max_workers: number;
  success_count: number;
  failed_count: number;
  items: BulkSyncItem[];
}

export interface AuthStatusResponse {
  authenticated: boolean;
  session_days: number;
}

export interface ChangePasswordPayload {
  current_password: string;
  new_password: string;
}

export interface BatchInstanceResponse {
  count: number;
  items: Instance[];
}

export interface BatchInstanceDeleteResponse {
  count: number;
  deleted_ids: number[];
}

export interface InstanceQuery {
  search?: string;
  tags?: string[];
  billing_mode?: 'prepaid' | 'postpaid';
  enabled?: boolean;
  health_status?: string;
}

export interface AppSettings {
  sync_max_workers: number;
  request_timeout: number;
  sync_verify_ssl: boolean;
  scheduler_timezone: string;
  sync_history_lookback_days: number;
  created_at?: string | null;
  updated_at?: string | null;
}
