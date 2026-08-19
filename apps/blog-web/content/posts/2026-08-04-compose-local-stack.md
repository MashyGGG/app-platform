---
title: Docker Compose：把本地环境写成代码
date: 2026-08-04
summary: 全栈开发者收益最快的一块。顺便拆解本仓库那三个 compose 文件各自在解决什么问题。
stage: docker
level: intermediate
tags: [docker, compose, 本地环境, 依赖健康检查]
---

Compose 是全栈开发者投入产出比最高的一块 Docker 知识：一条命令拉起数据库、缓存、依赖服务，新同事第一天就能跑通项目。

## 一、最小可用骨架

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: app
    ports: ['5432:5432']
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U app']
      interval: 5s
      timeout: 5s
      retries: 20

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      retries: 20

volumes:
  pgdata:
```

注意几件事：

- 没有 `version:` 字段了。Compose V2 已经忽略它，还会警告。
- `postgres` 发布了端口（本地要用 psql 连），`redis` 没有（只有容器之间用）。**不需要就别发布**，发布出去的每一个端口都是一个攻击面。
- Compose 自动建一个项目专属网络，所以服务之间用服务名互通。

## 二、`depends_on` 不等于"等它好了"

这是 Compose 最贵的一个误解：

```yaml
# ❌ 只保证 postgres 容器"启动了"，不保证它能接受连接
depends_on: [postgres]
```

容器起来到 PostgreSQL 真正 ready 之间有几秒钟。应用在这几秒里连库，直接崩。表现是"第一次 `up` 总失败，再 `up` 一次就好了"—— 典型的竞态。

正确写法是配合 healthcheck：

```yaml
# ✅ 等到 healthcheck 通过才启动
depends_on:
  postgres:
    condition: service_healthy
  redis:
    condition: service_healthy
```

**能写 healthcheck 的服务都写上**。这不只是给 `depends_on` 用的，CI 里的 service container、生产的编排器也全靠它。

顺带一提：`condition: service_healthy` 只在**启动时**等一次。运行中依赖挂掉，应用要自己重试 —— 这是应用的责任，不是 Compose 的。

## 三、开发和生产不该是同一个文件

本仓库有三个 compose 文件，各自的边界很清楚，值得抄：

| 文件                        | 跑什么                                       | 解决什么问题                                      |
| --------------------------- | -------------------------------------------- | ------------------------------------------------- |
| `docker-compose.yml`        | 只有依赖：postgres、redis、Upstash REST shim | 本地开发时应用在宿主机上 `pnpm dev`，依赖在容器里 |
| `docker-compose.apps.yml`   | 把两个应用也容器化                           | 验证"构建出来的镜像本身跑不跑得起来"              |
| `docker-compose.remote.yml` | 应用在容器里，但连**真实**的 Neon / Upstash  | 联调线上数据，配 `.env.remote`                    |

三条经验：

1. **日常开发不要把应用装进容器。** 热重载、断点调试、IDE 的类型提示都会变难受。让依赖在容器里、应用在宿主机上，是最舒服的分工。
2. **但一定要有一个"应用也进容器"的文件。** 否则镜像构建的问题只会在 CI 或线上才暴露。
3. **连真实服务的那份必须显式区分。** 本仓库用单独的 `.env.remote` + 单独的文件名，就是为了让"我现在在动生产数据"这件事没法被忽略。

## 四、那个 Upstash REST shim

这个设计值得单独说，因为它是"本地环境如何忠实模拟生产"的好例子。

应用在生产上用 Upstash 的 **REST** 接口访问 Redis（Serverless 环境没法维持长连接）。如果本地直接连原生 Redis 协议，那本地跑通的代码路径**和线上根本不是同一条**。

所以 compose 里多了一个中间层：

```yaml
redis-http:
  image: hiett/serverless-redis-http:latest
  environment:
    SRH_MODE: env
    SRH_TOKEN: local_token
    SRH_CONNECTION_STRING: redis://redis:6379
  ports: ['8079:80']
  depends_on:
    redis:
      condition: service_healthy
```

应用连 `http://localhost:8079`，走的是和生产一模一样的 REST 客户端代码。**多起一个容器，换来"本地跑通 = 线上跑通"的可信度**，非常划算。

这条经验可以推广：

> 本地环境的价值取决于它的**保真度**。省掉一个中间层看起来简单，代价是本地的绿灯不再说明任何事。

## 五、profiles：一个文件装下多套组合

不想为"要不要带上某个可选服务"再开一个文件：

```yaml
services:
  mailhog:
    image: mailhog/mailhog
    profiles: [mail]
    ports: ['8025:8025']
```

默认 `docker compose up` 不会起它，要 `docker compose --profile mail up`。适合放邮件调试、监控面板这类不是人人都需要的东西。

## 六、日常命令

```bash
docker compose up -d                  # 后台起
docker compose ps                     # 谁在跑，健康状态如何
docker compose logs -f --tail=100 app # 跟某个服务的日志
docker compose exec postgres psql -U app
docker compose down                   # 停掉并删容器，volume 保留
docker compose down -v                # ⚠️ 连 volume 一起删，数据没了
docker compose up -d --force-recreate # 改了 env 但容器没重建时用
```

最后一条：改了 `.env` 之后 `up -d` 有时不重建容器，因为 Compose 认为配置没变。环境变量没生效又找不到原因时，`--force-recreate` 一下。

## 检查点

读懂本仓库那三个 compose 文件，能说清"为什么开发时应用不在容器里"和"那个 shim 存在的意义"。

## 下一步

下一篇：[Docker 生产化检查清单](/posts/docker-production-checklist)
