# NiceApiManager

这是一个前后端一体化的 NiceApiManager：

- 后端：`FastAPI + SQLAlchemy 2.0 + SQLite + Alembic`
- 前端：`React + TypeScript + Vite + Ant Design`
- Python 包管理：`uv`
- 部署方式：单镜像、单服务、前后端一起打包

当前版本能力：

- 管理多个 `New API` 实例配置
- 支持实例标签筛选
- 支持批量新增、批量编辑、批量删除实例
- 测试实例登录和只读接口连通性
- 手动同步实例的用户信息、分组倍率、定价模型
- 聚合展示总览、分组、定价模型、同步记录
- 仪表盘支持显示金额换算、颜色分档和额度范围筛选
- 使用 `Alembic` 管理数据库结构
- 提供 React 管理台
- 提供 `Docker` / `docker compose` 一体化启动方式
- 整个管理台支持密码登录后访问

当前明确不做的内容：

- 不保存 `tokens` 表
- 不保存 `usage_logs` 表
- 不开放 `/api/tokens` 和 `/api/usage/logs`
- `APScheduler` 仅预留，不启动定时任务

## 目录结构

```text
app/
  api/         FastAPI 路由
  clients/     远端 NewAPI 客户端
  core/        配置、数据库、日志、调度器占位
  models/      SQLAlchemy 模型
  schemas/     Pydantic Schema
  services/    核心业务逻辑
alembic/       数据库迁移
web/           React 管理台
```

## 环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

推荐的 `.env` 内容示例：

```env
NICE_API_MANAGER_APP_NAME=NiceApiManager API
NICE_API_MANAGER_APP_ENV=development
NICE_API_MANAGER_API_V1_PREFIX=/api
NICE_API_MANAGER_DATABASE_URL=sqlite:///./data/niceapimanager.db
NICE_API_MANAGER_CORS_ORIGINS=http://localhost:3000,http://localhost:5173
NICE_API_MANAGER_REQUEST_TIMEOUT=20
NICE_API_MANAGER_SYNC_VERIFY_SSL=true
NICE_API_MANAGER_SCHEDULER_TIMEZONE=Asia/Shanghai
NICE_API_MANAGER_SCHEDULER_ENABLED=false
NICE_API_MANAGER_AUTH_PASSWORD=nicenicenice
NICE_API_MANAGER_AUTH_SECRET_KEY=nicenicenice-secret-key-change-me
NICE_API_MANAGER_AUTH_SESSION_DAYS=30
```

公网部署前至少要修改：

- `NICE_API_MANAGER_AUTH_PASSWORD`
- `NICE_API_MANAGER_AUTH_SECRET_KEY`

## 本地运行

### 1. 准备环境变量

```bash
cp .env.example .env
```

### 2. 安装 Python 依赖

```bash
uv sync
```

### 3. 执行数据库迁移

```bash
uv run alembic upgrade head
```

### 4. 启动后端

```bash
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 5. 本地开发前端

```bash
npm install --prefix web
npm run dev --prefix web
```

开发模式下：

- 后端：`http://localhost:8000`
- 前端：`http://localhost:5173`

### 6. 构建前端静态资源

```bash
npm run build --prefix web
```

构建完成后，后端会直接托管 `web/dist` 中的静态资源。

## Docker 运行

```bash
cp .env.example .env
docker compose up --build
```

启动后接口地址：

- 管理台：`http://localhost:8000`
- 文档地址：`http://localhost:8000/docs`
- 健康检查：`http://localhost:8000/health`

## 已实现接口

- `POST /api/instances`
- `GET /api/instances`
- `PATCH /api/instances/{id}`
- `DELETE /api/instances/{id}`
- `POST /api/instances/batch-create`
- `PATCH /api/instances/batch-update`
- `POST /api/instances/batch-delete`
- `POST /api/instances/{id}/test`
- `POST /api/instances/{id}/sync`
- `POST /api/sync/all`
- `GET /api/dashboard/overview`
- `GET /api/groups`
- `GET /api/pricing/models`
- `GET /api/sync-runs`
- `GET /api/auth/status`
- `POST /api/auth/login`
- `POST /api/auth/logout`

## 已实现页面

- `/dashboard`
- `/instances`
- `/groups`
- `/pricing`
- `/sync-runs`
- `/login`

## 当前前端能力

- 顶部统一布局头部显示当前页面标题
- 仪表盘支持按标签筛选、按显示额度范围筛选
- 仪表盘中的显示额度按分档高亮：
  - `> 100`
  - `10 ~ 100`
  - `0 ~ 10`
  - `< 0`
- 实例列表支持单条编辑、单条测试、单条同步
- 实例列表支持勾选后批量编辑和批量删除
- 实例列表支持通过多行表单批量新增实例

## 数据同步说明

手动同步单个实例时，后端会按下面顺序访问远端 `New API`：

1. `POST /api/user/login`
2. `GET /api/user/self`
3. `GET /api/user/self/groups`
4. `GET /api/pricing`

并将结果写入本地 SQLite：

- `instances`
- `instance_sessions`
- `user_snapshots`
- `group_ratios`
- `pricing_models`
- `sync_runs`

## 设计约束

- 远端账号密码按需求明文保存
- 本地 SQLite 默认位于 `./data/niceapimanager.db`
- 每次同步会覆盖当前实例的 `group_ratios` 和 `pricing_models`
- `user_snapshots` 和 `sync_runs` 会保留历史记录
- 显示金额按远端 `/api/status` 返回的 `quota_per_unit` 换算
- React 前端只对接当前后端接口，不依赖额外未实现接口
