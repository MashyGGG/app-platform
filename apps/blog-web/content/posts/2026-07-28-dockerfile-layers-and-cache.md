---
title: Dockerfile：分层、缓存与多阶段构建
date: 2026-07-28
summary: Docker 里唯一真正需要"设计"的地方。写法决定构建从 4 分钟变 20 秒，镜像从 1.2 GB 变 180 MB。
stage: docker
level: intermediate
tags: [docker, dockerfile, 构建缓存, 多阶段构建, 性能]
---

Dockerfile 是 Docker 里唯一需要动脑子的部分。其他都是查手册，这里是设计。

## 一条规则推出一切

> **每条指令产生一层。一层的缓存失效，它后面所有层全部失效。**

所有 Dockerfile 优化技巧都是这条规则的推论。记住它，不用背清单。

## 一、缓存顺序：变化频率从低到高

反例，也是我最早的写法：

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY . .              # ← 改任何一行源码，这一层就失效
RUN npm ci            # ← 于是每次都重装依赖
RUN npm run build
```

改一个字符的 CSS，`npm ci` 重跑，四分钟。

正确写法是**把依赖清单和源码分开 COPY**：

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci            # ← 只有 lockfile 变了才重跑
COPY . .
RUN npm run build
```

现在改源码只失效最后两层，二十秒。

pnpm monorepo 稍微麻烦一点，因为 lockfile 在根、包清单散在各处：

```dockerfile
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/blog-web/package.json apps/blog-web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
```

写起来啰嗦，但收益是每次构建都省掉整个安装步骤。

## 二、`.dockerignore`：漏了它，前面全白费

构建上下文是 **daemon 要把整个目录打包传过去**。没有 `.dockerignore`，`node_modules`、`.next`、`.git` 全部传一遍，几百 MB，而且 `COPY . .` 会把宿主机的 `node_modules` 覆盖进去 —— 平台不一致时原生模块直接炸。

最小可用版本：

```
node_modules
**/node_modules
.next
**/.next
.git
.env*
coverage
*.log
Dockerfile
.dockerignore
```

判断标准很简单：**构建产物和本地垃圾都不该进上下文**。

## 三、多阶段构建

目标：构建工具留在构建阶段，运行阶段只要产物。

```dockerfile
# ---- deps: 只装依赖，最稳定的一层 ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# ---- build: 编译 ----
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm build

# ---- runner: 只有运行需要的东西 ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# 先建用户再拷文件，这样 --chown 才有目标
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
```

几个要点：

- `AS deps` / `AS build` 阶段的中间产物**不进最终镜像**。编译器、devDependencies、源码全部留在了那边。
- Next.js 要开 `output: 'standalone'` 才有 `.next/standalone`，它已经把用到的 `node_modules` 裁剪好了。
- `USER app` 一定要在 `COPY` 之后、`CMD` 之前。
- `HEALTHCHECK` 的 `--start-period` 别省，否则启动慢的应用一上来就被判定 unhealthy。

## 四、ENTRYPOINT / CMD 与信号

这个坑很隐蔽：**shell form 会让你的进程收不到 SIGTERM**。

```dockerfile
CMD node server.js          # shell form → 实际是 /bin/sh -c "node server.js"
CMD ["node", "server.js"]   # exec form  → node 直接是 PID 1
```

shell form 下 PID 1 是 `sh`，而 `sh` 不会把 SIGTERM 转发给子进程。结果就是 `docker stop` 等满 10 秒超时，然后 SIGKILL —— 你的优雅关闭逻辑（关连接池、等请求跑完）**一次都没执行过**，而且你不会收到任何报错。

**永远用 exec form（JSON 数组）。**

如果应用本身会 fork 子进程，PID 1 还得负责回收僵尸进程，这时加 `--init`（或 `tini`）：

```bash
docker run --init my-app
```

## 五、BuildKit 缓存挂载

包管理器的缓存不该进镜像层，但又希望跨构建复用。缓存挂载正好：

```dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
```

配套的还有构建期 secret，**不会留在任何一层里**：

```dockerfile
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    pnpm install --frozen-lockfile
```

```bash
docker build --secret id=npmrc,src=$HOME/.npmrc .
```

比 `ARG NPM_TOKEN` 安全得多 —— `ARG` 的值会留在镜像历史里，`docker history` 就能看到。

## 六、瘦身实测

同一个 Next.js 应用：

| 写法                    | 镜像大小 | 改一行源码的重建耗时 |
| ----------------------- | -------- | -------------------- |
| 单阶段 `node:22`        | 1.24 GB  | 3 分 50 秒           |
| 单阶段 `node:22-alpine` | 680 MB   | 3 分 40 秒           |
| 多阶段 + standalone     | 187 MB   | 24 秒                |

体积的大头是 devDependencies 和源码，时间的大头是缓存顺序。**这两件事是独立的，都要做。**

关于 alpine：它用 musl 而不是 glibc，原生模块（`@node-rs/argon2`、`sharp`、Prisma 引擎）可能没有对应的预编译产物，需要现场编译甚至根本跑不起来。遇到诡异的原生模块问题，先换 `node:22-slim`（Debian，glibc）验证一下是不是 musl 的锅 —— 大出来的一百来 MB，通常比排查一整天便宜。

## 检查点

- 镜像 < 250 MB ✅
- 非 root 运行 ✅
- 改一行源码重建 < 30 秒 ✅

三条都做到再往下走。

## 下一步

下一篇：[Docker Compose：本地环境即代码](/posts/compose-local-stack)
