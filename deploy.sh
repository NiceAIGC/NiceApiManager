#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="niceapimanager"
CONTAINER_NAME="niceapimanager"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:18101/health}"
WITH_PULL=0
SHOW_LOGS=0

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "[deploy] 缺少命令: $command_name" >&2
    exit 1
  fi
}

usage() {
  cat <<'EOF'
用法:
  ./deploy.sh             重新构建并重启 niceapimanager 容器
  ./deploy.sh --pull      先 git pull，再重新构建并重启
  ./deploy.sh --logs      部署完成后跟随日志
  ./deploy.sh --help      显示帮助

说明:
  - docker compose 服务名: niceapimanager
  - 实际容器名: niceapimanager
  - 默认健康检查地址: http://127.0.0.1:18101/health
  - 如需自定义健康检查地址，可临时传入:
      HEALTH_URL=http://127.0.0.1:18101/health ./deploy.sh
EOF
}

for arg in "$@"; do
  case "$arg" in
    --pull)
      WITH_PULL=1
      ;;
    --logs)
      SHOW_LOGS=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $arg" >&2
      usage
      exit 1
      ;;
  esac
done

cd "$ROOT_DIR"

require_command docker
require_command curl

echo "[deploy] 项目目录: $ROOT_DIR"
echo "[deploy] compose 服务名: $SERVICE_NAME"
echo "[deploy] 容器名: $CONTAINER_NAME"
echo "[deploy] 健康检查地址: $HEALTH_URL"
echo "[deploy] Docker BuildKit: enabled"

if [[ "$WITH_PULL" -eq 1 ]]; then
  echo "[deploy] 拉取最新代码"
  git pull --ff-only
fi

echo "[deploy] 开始重建并重启容器"
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose up -d --build --force-recreate "$SERVICE_NAME"

echo "[deploy] 等待健康检查: $HEALTH_URL"
for _ in {1..20}; do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "[deploy] 健康检查通过"
    if [[ "$SHOW_LOGS" -eq 1 ]]; then
      echo "[deploy] 跟随日志输出"
      docker compose logs -f "$SERVICE_NAME"
    fi
    exit 0
  fi
  sleep 2
done

echo "[deploy] 健康检查失败，请查看日志" >&2
docker ps --filter "name=$CONTAINER_NAME" >&2 || true
docker compose logs --tail=200 "$SERVICE_NAME" >&2 || true
exit 1
