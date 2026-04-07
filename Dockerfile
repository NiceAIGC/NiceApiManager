## syntax=docker/dockerfile:1.7

FROM node:22-alpine AS web-builder

WORKDIR /web

COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

COPY web/index.html ./
COPY web/tsconfig.json web/tsconfig.app.json web/tsconfig.node.json ./
COPY web/vite.config.ts ./
COPY web/src ./src
RUN --mount=type=cache,target=/root/.npm \
    npm run build:docker

FROM python:3.12-slim

ARG UV_HTTP_TIMEOUT=240
ARG UV_DEFAULT_INDEX=https://pypi.org/simple

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV UV_LINK_MODE=copy
ENV UV_HTTP_TIMEOUT=${UV_HTTP_TIMEOUT}
ENV UV_DEFAULT_INDEX=${UV_DEFAULT_INDEX}
ENV PATH="/app/.venv/bin:$PATH"

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.7.3 /uv /uvx /bin/

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY .env.example ./
COPY docker-compose.yml ./
COPY README.md ./
COPY --from=web-builder /web/dist ./web/dist

RUN mkdir -p /app/data

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
