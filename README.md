# NiceApiManager


<img width="1250" height="600" alt="image" src="https://github.com/user-attachments/assets/b0bfc08e-63de-4658-836f-937a5ea1b68b" />
<img width="1250" height="600" alt="image" src="https://github.com/user-attachments/assets/4e1b4bd2-a1fc-406a-95f4-3b01f0d9524d" />
<img width="600" height="500" alt="image" src="https://github.com/user-attachments/assets/667e8b13-c05f-4e15-b210-c5c7203874a3" />



NiceApiManager 是一个面向 NewAPI / RixAPI / ShellAPI 站点的统一管理后台，采用前后端一体化部署：

- 后端：`FastAPI + SQLAlchemy + Alembic`
- 前端：`React + TypeScript + Vite + Ant Design`
- 数据库：默认 `SQLite`
- 部署方式：推荐 `Docker Compose` 单容器部署

## 功能简介

- 管理多个实例，支持标签、优先级、批量新增、批量编辑、批量删除
- 支持账密登录和 `远端用户 ID + Access Token` 两种认证方式
- 支持本地直连、公用 SOCKS5、自定义 SOCKS5
- 支持实例连通性测试、手动同步、批量同步和同步记录
- 聚合展示实例余额、周期已用、分组倍率、定价模型和每日用量
- 支持在系统设置中修改统计时区、默认同步周期、并发数、SSL 校验等运行参数

## Docker 部署

### 1. 准备环境变量

```bash
cp .env.example .env
```

最少需要改这两个值：

```env
NICE_API_MANAGER_AUTH_PASSWORD=change-this-password
NICE_API_MANAGER_AUTH_SECRET_KEY=change-this-secret-key
```

常用环境变量如下：

```env
NICE_API_MANAGER_APP_NAME=NiceApiManager API
NICE_API_MANAGER_APP_ENV=development
NICE_API_MANAGER_API_V1_PREFIX=/api
NICE_API_MANAGER_DATABASE_URL=sqlite:///./data/niceapimanager.db
NICE_API_MANAGER_CORS_ORIGINS=http://localhost:3000,http://localhost:5173
NICE_API_MANAGER_REQUEST_TIMEOUT=20
NICE_API_MANAGER_SYNC_VERIFY_SSL=true
NICE_API_MANAGER_SCHEDULER_TIMEZONE=Asia/Shanghai
NICE_API_MANAGER_AUTH_PASSWORD=change-this-password
NICE_API_MANAGER_AUTH_SECRET_KEY=change-this-secret-key
NICE_API_MANAGER_AUTH_SESSION_DAYS=30
```

### 2. 构建并启动

```bash
docker compose up -d --build
```

如果是更新后强制重建容器：

```bash
docker compose up -d --build --force-recreate
```

### 3. 查看状态

```bash
docker compose ps
docker compose logs -f niceapimanager
```

### 4. 访问

- 管理台：`http://<你的主机>:8000`
- OpenAPI 文档：`http://<你的主机>:8000/docs`
- 健康检查：`http://<你的主机>:8000/health`
 
如果直接使用仓库内置的 `docker-compose.yml`，默认映射端口是 `18101`，对应访问地址为：

- 管理台：`http://<你的主机>:18101`
- OpenAPI 文档：`http://<你的主机>:18101/docs`
- 健康检查：`http://<你的主机>:18101/health`

首次登录密码使用 `.env` 中的 `NICE_API_MANAGER_AUTH_PASSWORD`。

## 基本使用

### 1. 登录后台

启动后访问管理台，使用 `.env` 中配置的管理密码登录。

### 2. 配置系统设置

建议先到“系统设置”完成以下配置：

- 统计时区
- 默认实例同步周期
- 批量同步并发数
- 公用 SOCKS5 代理
- SSL 校验策略

### 3. 新增实例

在“实例管理”中添加实例，至少提供下面任一认证方式：

- 用户名 + 密码
- 远端用户 ID + Access Token

如实例需要代理，可选择：

- 本地直连
- 公用 SOCKS5
- 自定义 SOCKS5

保存前可以直接测试当前代理连通性。

### 4. 同步数据

实例创建后可执行：

- 单实例同步
- 批量同步全部实例

同步完成后可在以下页面查看结果：

- 仪表盘
- 分组倍率
- 定价模型
- 同步记录

## 数据与升级

- SQLite 数据默认存放在 `./data/niceapimanager.db`
- 容器启动时会自动执行 `alembic upgrade head`
- 重建容器不会删除 `./data` 中的持久化数据

## MySQL 配置

项目默认使用 SQLite，但也支持 MySQL。当前镜像已经内置 `PyMySQL` 驱动，只需要把 `.env` 里的数据库连接改成 MySQL URL 即可。

示例：

```env
NICE_API_MANAGER_DATABASE_URL=mysql+pymysql://niceapi:your-password@mysql:3306/niceapimanager?charset=utf8mb4
```

使用 MySQL 时注意：

- 目标 MySQL 数据库需要提前创建，例如 `niceapimanager`
- 容器启动时仍会自动执行 `alembic upgrade head`
- 如果 MySQL 和应用在同一个 `docker compose` 网络里，主机名可以直接写 MySQL 服务名，例如 `mysql`
- 如果 MySQL 在宿主机或外部服务器，请把主机名改成真实地址，并确保容器网络可以访问
- 使用 MySQL 时，`./data` 这个 SQLite 挂载目录不会再存储业务数据，可以保留，也可以按你的部署习惯移除
