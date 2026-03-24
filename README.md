# NiceApiManager

这是一个前后端一体化的 NiceApiManager：

- 后端：`FastAPI + SQLAlchemy 2.0 + SQLite + Alembic`
- 前端：`React + TypeScript + Vite + Ant Design`
- Python 包管理：`uv`
- 部署方式：单镜像、单服务、前后端一起打包

当前版本能力：

- 管理多个 `New API` 实例配置
- 支持区分预付费 / 后付费实例，后付费仅统计周期已用额度
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

`docker compose` 使用的是单服务部署：

- 服务名：`niceapimanager-backend`
- 暴露端口：宿主机 `8000` -> 容器 `8000`
- 数据目录：宿主机 `./data` -> 容器 `/app/data`
- 启动命令：容器启动时自动执行 `alembic upgrade head`，然后启动 `uvicorn`

基础使用步骤：

### 1. 准备环境变量

```bash
cp .env.example .env
```

公网部署前至少修改：

- `NICE_API_MANAGER_AUTH_PASSWORD`
- `NICE_API_MANAGER_AUTH_SECRET_KEY`

### 2. 构建并启动服务

```bash
docker compose up --build -d
```

### 3. 检查服务状态

```bash
docker compose ps
docker compose logs -f niceapimanager-backend
```

容器启动后会自动执行数据库迁移；`docker compose ps` 中状态变为 `healthy` 后即可访问。

### 4. 访问管理台

默认地址：

- 管理台：`http://localhost:8000`
- 文档地址：`http://localhost:8000/docs`
- 健康检查：`http://localhost:8000/health`

首次登录密码来自 `.env` 中的 `NICE_API_MANAGER_AUTH_PASSWORD`。

### 5. 停止或重建

停止服务：

```bash
docker compose down
```

重新构建并启动：

```bash
docker compose up --build -d
```

如果只想重启容器而不重建镜像：

```bash
docker compose restart
```

### 6. 数据持久化说明

- SQLite 数据库默认写入 `./data/niceapimanager.db`
- 执行 `docker compose down` 不会删除 `./data` 中的持久化数据
- 如需全新初始化，可以先停止容器，再手动清理 `./data`

### 7. 手动验证

可以用下面的命令确认容器内服务已正常响应：

```bash
curl http://localhost:8000/health
```

预期返回：

```json
{"status":"ok"}
```
