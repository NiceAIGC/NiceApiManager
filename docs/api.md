# NiceApiManager API

中转站聚合管理后台的 HTTP API。所有接口挂载在 `/api` 前缀下，返回 JSON。

## 认证

两种方式任选其一，所有 `/api/*` 接口（除 `auth/login`、`auth/status` 外）都需要认证：

```http
Authorization: Bearer nam-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

```http
X-API-Key: nam-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- API Key 在后台「系统设置 → API 访问密钥」生成，格式 `nam-` + 48 位十六进制。
- Key 只在创建时明文返回一次，服务端仅保存 SHA-256 哈希。
- 浏览器登录态（Cookie 会话）同样有效，外部调用建议用 API Key。

### 通用约定

| 约定 | 说明 |
|---|---|
| 时间字段 | ISO 8601 字符串（服务端时间带时区），展示时区由「系统设置 → 统计时区」决定 |
| 金额 | `display_amount` 类字段为已换算的美元金额；`quota` 类为上游原始额度整数 |
| 分页 | 参数 `offset`/`limit` 或 `page`/`page_size`，具体见各接口；响应含 `total` |
| 错误 | `4xx/5xx` + `{"detail": "..."}`，校验失败时 `detail` 为字段错误数组 |
| 鉴权失败 | `401 {"detail": "Unauthorized"}` |

---

## 认证

### POST /api/auth/login

密码登录，成功后写入会话 Cookie。

```json
{ "password": "your-admin-password" }
```

### GET /api/auth/status

返回当前认证状态：`{"authenticated": true, "session_days": 30}`（公开接口）。

### POST /api/auth/logout

退出登录，清除会话。

### POST /api/auth/change-password

```json
{ "current_password": "...", "new_password": "...", "confirm_password": "..." }
```

---

## 实例

实例即一个被监控的 NewAPI / RixAPI / ShellAPI / Sub2API 站点。

### GET /api/instances

| 参数 | 类型 | 说明 |
|---|---|---|
| `search` | string | 匹配实例名 / 站点地址 / 用户名 |
| `tags` | string | 逗号分隔的标签，全部命中才返回 |
| `tag` | string | 单个标签（兼容旧参数） |
| `billing_mode` | `prepaid` \| `postpaid` | 计费方式 |
| `enabled` | bool | 启用状态 |
| `health_status` | `healthy` \| `unhealthy` \| `degraded` \| `unknown` | 健康状态 |
| `page` / `page_size` | int | 分页 |

响应：

```json
{
  "total": 6,
  "items": [{
    "id": 1,
    "name": "主站",
    "remark": "主力",
    "base_url": "https://example.com",
    "program_type": "newapi",
    "username": "user1",
    "proxy_mode": "direct",
    "enabled": true,
    "auto_disabled": false,
    "balance_alert_enabled": true,
    "balance_alert_threshold": 20,
    "effective_balance_alert_threshold": 20,
    "notification_channel_ids": ["channel-1"],
    "notification_channel_group_ids": ["group-ops"],
    "notify_rate_changes": true,
    "notify_announcements": true,
    "billing_mode": "prepaid",
    "priority": 3,
    "sync_interval_minutes": 120,
    "tags": ["主力"],
    "quota_per_unit": 500000,
    "latest_display_quota": 123.45,
    "latest_display_used_quota": 10.2,
    "total_display_used_quota": 456.7,
    "today_display_used_amount": 1.23,
    "today_request_count": 42,
    "last_7d_display_used_amount": 8.9,
    "last_7d_request_count": 300,
    "last_health_status": "healthy",
    "health_status": "healthy",
    "last_health_error": null,
    "last_sync_at": "2026-10-31T09:00:00+08:00",
    "last_synced_at": "2026-10-31T09:00:00+08:00",
    "updated_at": "2026-10-31T09:00:00+08:00",
    "has_access_token": false,
    "session_expires_at": null,
    "last_7d_usage": [{ "date": "2026-10-25", "label": "10-25", "used_display_amount": 1.1, "request_count": 30 }]
  }]
}
```

### POST /api/instances

创建实例。

```json
{
  "name": "主站",
  "base_url": "https://example.com",
  "program_type": "auto",
  "auth_mode": "password",
  "username": "user1",
  "password": "pass1",
  "proxy_mode": "direct",
  "billing_mode": "prepaid",
  "priority": 3,
  "sync_interval_minutes": 120,
  "tags": ["主力"],
  "enabled": true,
  "balance_alert_enabled": false,
  "balance_alert_threshold": null,
  "notification_channel_ids": [],
  "notification_channel_group_ids": [],
  "notify_rate_changes": true,
  "notify_announcements": true
}
```

`auth_mode` 可为 `password`（用户名+密码）或 `token`（远端用户 ID + 访问密钥）。`program_type` 支持 `auto`/`newapi`/`rixapi`/`shellapi`/`sub2api`。

### PATCH /api/instances/{instance_id}

更新单个实例。字段同创建（`password`/`access_token` 留空表示不变）。

### DELETE /api/instances/{instance_id}

删除实例，级联清理快照、分组倍率、同步记录、公告、倍率变更等关联数据。

### POST /api/instances/batch-create

```json
{ "items": [ { /* 同创建单个实例 */ } ] }
```

### PATCH /api/instances/batch-update

```json
{ "items": [ { "id": 1, /* ...其余同创建 */ } ] }
```

### POST /api/instances/batch-delete

```json
{ "ids": [1, 2, 3] }
```

### POST /api/instances/{instance_id}/sync

立即同步单个实例（拉取余额、分组倍率、定价、公告、历史用量）。返回同步记录。

### POST /api/sync/all

批量同步全部启用实例。

```json
{ "instance_ids": [1, 2] }   // 可省略，省略即全部启用实例
```

### POST /api/instances/{instance_id}/test

只读连通性测试（登录并读取账号信息），返回远端用户信息摘要。

### POST /api/instances/test-proxy

测试站点连通性与代理。

```json
{ "base_url": "https://example.com", "proxy_mode": "custom", "socks5_proxy_url": "user:pass@host:port" }
```

### GET /api/instances/{instance_id}/balance-history

| 参数 | 默认 | 说明 |
|---|---|---|
| `days` | 30 | 返回最近 N 天余额快照（1–180） |

```json
{ "items": [{ "snapshot_at": "2026-10-31T08:00:00+08:00", "balance": 123.45, "used_amount": 10.2 }] }
```

---

## 仪表盘

### GET /api/dashboard/overview

实例聚合概览，筛选参数同 `GET /api/instances`。返回 `instance_count`、`enabled_instance_count`、`healthy_instance_count`、`total_display_quota` 等字段及 `items` 明细。

### GET /api/dashboard/trends

| 参数 | 默认 | 说明 |
|---|---|---|
| `days` | 7 | 趋势窗口天数（1–90） |
| `start_date` / `end_date` | - | 自定义区间（`YYYY-MM-DD`），优先于 days |
| `breakdown_limit` | 8 | 堆叠明细实例数（1–20） |
| 其余 | - | 同实例筛选参数 |

```json
{
  "days": 7,
  "start_date": "2026-10-25",
  "end_date": "2026-10-31",
  "points": [{ "date": "2026-10-25", "used_display_amount": 12.3 }],
  "series": [{ "key": "1", "instance_id": 1, "instance_name": "主站", "total_used_display_amount": 80.1 }]
}
```

---

## 分组倍率

### GET /api/groups

| 参数 | 说明 |
|---|---|
| `instance_id` | 按实例筛选 |
| `tag` | 按实例标签筛选 |
| `label_id` | 按分组标签筛选 |
| `search` | 分组名模糊匹配 |
| `platform` | Sub2API 平台筛选 |

### GET /api/groups/names

全部分组名列表（用于筛选下拉）。

### GET /api/groups/compare

跨实例对比同一逻辑分组。

| 参数 | 说明 |
|---|---|
| `label_id` 或 `label_name` | 对比该标签下的分组 |
| `instance_ids` | 逗号分隔实例 ID |
| `tag` | 按实例标签筛选 |

### 分组标签

- `GET /api/groups/labels` 列表
- `POST /api/groups/labels` 创建 `{ "name": "...", "remark": "...", "group_names": ["default"] }`
- `PATCH /api/groups/labels/{label_id}` 更新
- `DELETE /api/groups/labels/{label_id}` 删除
- `POST /api/groups/labels/{label_id}/assign` 给分组打标签 `{ "group_names": ["vip"] }`
- `POST /api/groups/labels/{label_id}/unassign` 移除标签

---

## 定价

### GET /api/pricing/models

| 参数 | 说明 |
|---|---|
| `instance_id` / `tag` | 实例筛选 |
| `search` | 模型/供应商模糊匹配 |
| `group_name` | 仅该分组启用的模型 |
| `vendor` / `endpoint_type` | 供应商 / 端点类型筛选 |
| `offset` / `limit` | 分页（limit ≤ 500） |

### GET /api/pricing/facets

筛选项与统计（供应商列表、实例数、模型数等）。

### GET /api/pricing/compare

跨实例对比同一模型价格，参数同 models（`instance_ids` 逗号分隔）。

价格统一换算为美元 / 1M tokens（按次计费为美元 / 次）。

---

## 倍率变更与公告

### GET /api/rate-changes

| 参数 | 说明 |
|---|---|
| `instance_id` | 按实例筛选 |
| `page` / `page_size` | 分页（page_size ≤ 200） |

```json
{
  "total": 3,
  "items": [{
    "id": 1, "instance_id": 1, "instance_name": "主站",
    "group_name": "default", "platform": null,
    "change_type": "changed",          // added | removed | changed
    "old_ratio": 1.0, "new_ratio": 1.5, "change_percent": 50.0,
    "notified": true, "detected_at": "2026-10-31T09:00:00+08:00"
  }]
}
```

### GET /api/announcements

参数同 rate-changes。

```json
{
  "total": 2,
  "items": [{
    "id": 1, "instance_id": 1, "instance_name": "主站",
    "title": "站点维护通知", "content": "...",
    "published_at": "2026-10-30T10:00:00+08:00",
    "synced_at": "2026-10-31T09:00:00+08:00",
    "notified": true
  }]
}
```

---

## 日志

### GET /api/sync-runs

| 参数 | 说明 |
|---|---|
| `instance_id` | 按实例筛选 |
| `offset` / `limit` | 分页（limit ≤ 200） |

### GET /api/notification-logs

| 参数 | 说明 |
|---|---|
| `instance_id` | 按实例筛选 |
| `source_type` | `rule` 规则通知 / `test` 测试通知 |
| `offset` / `limit` | 分页（limit ≤ 200） |

---

## 设置

### GET /api/settings

返回全部运行时设置：同步并发、超时、时区、代理、通知渠道与分组、告警规则、倍率变更策略、公告策略、数据保留天数等。

### PATCH /api/settings

整体更新设置（先 GET 再改字段后整体 PATCH）。关键字段：

| 字段 | 说明 |
|---|---|
| `sync_max_workers` / `request_timeout` / `sync_verify_ssl` | 同步并发、超时、证书校验 |
| `scheduler_timezone` | 统计时区（IANA） |
| `sync_history_lookback_days` | 每次同步回补的历史天数 |
| `default_sync_interval_minutes` | 新增实例默认同步周期 |
| `shared_socks5_proxy_url` / `default_instance_proxy_mode` | 公用代理与默认代理模式 |
| `notification_enabled` / `notification_check_interval_minutes` | 告警巡检开关与间隔 |
| `default_balance_alert_threshold` / `default_notification_channel_id` | 默认告警阈值 / 默认渠道 |
| `notification_channels` / `notification_channel_groups` / `notification_rules` | 渠道、渠道分组、三类告警规则 |
| `rate_change_notify_enabled` / `rate_change_min_percent` / `rate_change_cooldown_minutes` | 倍率变更推送策略 |
| `announcement_sync_enabled` / `announcement_notify_enabled` | 公告同步与推送 |
| `retention_*_days` | 各历史表保留天数 |

### POST /api/settings/notifications/test

发送测试通知。

```json
{ "channel_ids": ["channel-1"], "group_ids": ["group-ops"], "title": "可选", "body": "可选" }
```

```json
{ "success": true, "total": 1, "success_count": 1, "failed_count": 0,
  "items": [{ "channel_id": "channel-1", "channel_name": "运维群", "success": true, "error_message": null }] }
```

---

## API 密钥管理

### GET /api/api-keys

```json
{ "items": [{ "id": 1, "name": "监控脚本", "key_prefix": "nam-3f9a1c", "enabled": true,
  "created_at": "...", "last_used_at": "..." }] }
```

### POST /api/api-keys

```json
{ "name": "监控脚本" }
```

响应包含明文 `key` 字段，**仅此一次返回**。

### PATCH /api/api-keys/{key_id}

```json
{ "enabled": false }
```

### DELETE /api/api-keys/{key_id}

永久吊销。

---

## 典型调用示例

```bash
# 1. 创建 API Key（浏览器会话或已有 Key）
curl -s -X POST https://your-host/api/api-keys \
  -H "X-API-Key: $NAM_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"cli"}'

# 2. 列出实例
curl -s https://your-host/api/instances -H "X-API-Key: $NAM_KEY"

# 3. 同步全部
curl -s -X POST https://your-host/api/sync/all -H "X-API-Key: $NAM_KEY"

# 4. 查询倍率变更
curl -s "https://your-host/api/rate-changes?page=1&page_size=20" -H "X-API-Key: $NAM_KEY"
```

Python:

```python
import requests

BASE = "https://your-host/api"
HEADERS = {"X-API-Key": "nam-..."}

instances = requests.get(f"{BASE}/instances", headers=HEADERS).json()
overview = requests.get(f"{BASE}/dashboard/overview", headers=HEADERS).json()
```
