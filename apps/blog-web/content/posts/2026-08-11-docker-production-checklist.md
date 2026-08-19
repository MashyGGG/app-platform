---
title: Docker 生产化检查清单
date: 2026-08-11
summary: 生产事故集中在这几条：root 用户、:latest、没有资源上限、没人管的 healthcheck、写爆磁盘的日志。一条一条过。
stage: docker
level: advanced
tags: [docker, 安全, 生产, trivy, 可观测]
---

前面几篇是"能跑起来"。这篇是"跑在生产上不出事"。按检查清单的形式写，方便照着过一遍。

## 1. 不要用 `:latest`

`:latest` 不是"稳定版"的同义词，它只是"最后一次被推上去的那个"。用它意味着：

- 你无法回滚 —— 因为你不知道上一次跑的是什么。
- 两台机器可能在跑不同的代码，而 `docker images` 显示的标签一模一样。
- 基础镜像的一次上游更新就能在半夜把服务弄挂。

```dockerfile
# ❌
FROM node:latest
# ⚠️ 好一些，但 22 里的补丁版本还是会漂
FROM node:22-alpine
# ✅ 生产：连 digest 一起钉死
FROM node:22.14.0-alpine@sha256:...
```

自己的镜像同理：打 `v1.4.2` 这样的语义化标签，部署时引用 digest。`latest` 留给本地随手试。

## 2. 不要用 root 跑

默认容器里的进程是 root。一旦发生容器逃逸，或者 bind mount 了宿主机目录，root 的破坏力和普通用户完全是两回事。很多 Kubernetes 集群的准入策略直接拒绝 root 容器。

```dockerfile
RUN addgroup -S app && adduser -S app -G app
COPY --chown=app:app . .
USER app
```

再往前一步，运行时也收紧：

```bash
docker run \
  --read-only \                      # 根文件系统只读
  --tmpfs /tmp \                     # 确实要写的地方单独给
  --cap-drop=ALL \                   # 丢掉所有 capability
  --security-opt=no-new-privileges \ # 禁止提权
  my-app:v1.4.2
```

`--read-only` 是个很好的自检：跑不起来说明应用在往镜像里写东西，那本身就该改。

## 3. 一定要有资源上限

没有 limit，一个内存泄漏的容器能把整台机器拖死，连带旁边所有服务。

```yaml
deploy:
  resources:
    limits: { cpus: '1.0', memory: 512M }
    reservations: { memory: 256M }
```

限了之后要能排查：

```bash
docker stats --no-stream
docker inspect <c> --format '{{.State.OOMKilled}} {{.State.ExitCode}}'
```

`ExitCode 137` + `OOMKilled true` = 被内存限额杀了。这时候要么调大 limit，要么去查为什么会涨 —— 但至少你**知道**它死于什么，而不是"服务偶尔就没了"。

配套地，运行时的堆参数也要跟 limit 对齐（`NODE_OPTIONS=--max-old-space-size=...`），否则运行时按它以为的内存规划，撞上 cgroup 上限直接被杀。

## 4. healthcheck 要有人处理

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
```

关键在于：**只写 HEALTHCHECK 不配重启策略，它就只是个状态灯**。要配上：

```yaml
restart: unless-stopped
```

以及理解探针的区别（K8s 里更明确，Compose 里也是同一套思路）：

- **liveness** —— 挂了就重启。
- **readiness** —— 没准备好就别转发流量给它，但不要重启。
- **startup** —— 启动慢的应用，给它一段宽限期，别在启动过程中就判死刑。

把 readiness 当 liveness 用是常见事故：依赖数据库暂时抖了一下，健康检查失败，容器被重启，重启后依然连不上数据库，于是无限重启风暴，把数据库彻底压死。

**健康检查只检查自己，不要级联检查依赖。**

## 5. 日志只写 stdout，并且要轮转

容器的日志出口是 stdout / stderr。写进容器内文件的日志，容器一没就没了，而且会把磁盘写爆。

```yaml
logging:
  driver: json-file
  options: { max-size: '10m', max-file: '3' }
```

不配这个，`json-file` 默认无上限。我见过 `/var/lib/docker/containers` 把根分区吃满导致整台机器不可用的情况 —— 应用本身没有任何问题。

## 6. 扫镜像

```bash
trivy image --severity HIGH,CRITICAL my-app:v1.4.2
docker scout cves my-app:v1.4.2
```

第一次跑通常会看到几十条，绝大部分来自基础镜像。处理顺序：

1. 换更小的基础镜像（`-slim` / `-alpine` / distroless）—— 一次就能消掉大半。
2. 更新基础镜像的 patch 版本。
3. 剩下的逐条判断：真的在使用这个组件吗？有没有替代？

把扫描接进 CI，并且**只对新增漏洞失败**。上来就要求全零，结果一定是有人加 `--exit-code 0` 把它关掉。

## 7. secret 不进镜像层

```dockerfile
# ❌ ARG 的值留在镜像历史里，docker history 能看到
ARG NPM_TOKEN
# ❌ 上一层已经有了，rm 只是遮住
COPY .env .
RUN build && rm .env
```

```dockerfile
# ✅ BuildKit secret，不写进任何一层
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc pnpm install
```

运行时的 secret 走环境变量或 secret 管理服务注入，**不要 `COPY` 进镜像**。镜像会被推到 registry，会被别人拉，会被缓存在很多台机器上。

## 8. 优雅关闭

```dockerfile
CMD ["node", "server.js"]  # exec form，PID 1 才收得到 SIGTERM
STOPSIGNAL SIGTERM
```

应用侧监听信号，停止接收新请求、等在途请求结束、关闭连接池，再退出。默认只有 10 秒宽限期，不够就 `docker stop -t 30`。

这条不做，滚动更新时每次都会掉一批请求，而且监控上只表现为零星 5xx，很难归因。

## 上线前的最终清单

- [ ] 镜像用固定标签 + digest，不是 `latest`
- [ ] `USER` 非 root，`--cap-drop=ALL`，根文件系统只读
- [ ] CPU / 内存 limit 已设，运行时堆参数与之对齐
- [ ] HEALTHCHECK 存在，且只检查自己，配了 restart 策略
- [ ] 日志到 stdout，配了 max-size / max-file
- [ ] trivy HIGH+ 已清零或有明确豁免记录
- [ ] 构建期 secret 走 BuildKit，`docker history` 里翻不到东西
- [ ] exec form + 信号处理 + 优雅关闭验证过
- [ ] `.dockerignore` 齐全，构建上下文 < 10 MB

## 下一步

Docker 这一段到这里就结束了。下一站是 [CI/CD](/posts/ci-pipeline-lessons) —— 把这些检查项变成流水线里自动跑的东西，而不是一张需要人记得看的清单。
