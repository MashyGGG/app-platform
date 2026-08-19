---
title: Docker 日常操作：镜像、容器、卷、网络
date: 2026-07-21
summary: 这一层是肌肉记忆。练不熟的代价不是"不会"，而是线上出问题时你在生产机器上现查参数。
stage: docker
level: basic
tags: [docker, cli, 网络, volume]
---

命令本身没什么好讲的，`--help` 都有。这篇只记**容易记混的地方**和**排查时真正会用到的那几条**。

## 一、排查四件套

出问题时按这个顺序敲，基本能定位到 80% 的问题：

```bash
docker ps -a                      # 它到底在不在？退出码是多少？
docker logs -f --tail=100 <name>  # 它自己怎么说的？
docker inspect <name>             # 环境变量、挂载、网络、健康状态
docker exec -it <name> sh         # 进去看，前提是它还活着
```

`docker inspect` 输出几百行，用 `--format` 只取要看的：

```bash
docker inspect <name> --format '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}'
docker inspect <name> --format '{{json .NetworkSettings.Networks}}'
docker inspect <name> --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
```

容器已经退出、`exec` 不进去的时候，用同一个镜像起一个临时容器覆盖入口：

```bash
docker run --rm -it --entrypoint sh <image>
```

这条救过我很多次 —— 镜像构建对不对、文件在不在、权限是什么，进去看一眼就知道了。

## 二、`-p` 和容器间互访是两件事

这是我早期最大的误解。

- `-p 5432:5432` 是**把端口发布到宿主机**，给宿主机上的东西（比如你本地的 psql、你本地跑的 Next.js dev server）用的。
- 容器之间互相访问**根本不需要 `-p`**。只要在同一个自定义网络里，直接用容器名当主机名。

```bash
docker network create devnet
docker run -d --name db --network devnet postgres:16-alpine
docker run --rm --network devnet alpine sh -c 'nc -z db 5432 && echo reachable'
```

注意上面 `db` 没有任何 `-p`，照样通。**Docker 内置 DNS 只在自定义网络里生效**，默认的 `bridge` 网络不解析容器名 —— 这也是为什么 Compose 会自动给你建一个专属网络。

由此推出一条几乎每次都会踩的规则：

> 应用配置里的数据库地址，在容器里要写**服务名**（`db:5432`），在宿主机上要写 `localhost:5432`。同一份 `.env` 两边共用时，这就是"本地能连、容器里连不上"的标准原因。

## 三、volume / bind mount / tmpfs

| 类型         | 写法                                 | 谁管理       | 用来干嘛                   |
| ------------ | ------------------------------------ | ------------ | -------------------------- |
| named volume | `-v pgdata:/var/lib/postgresql/data` | Docker       | 数据持久化                 |
| bind mount   | `-v $(pwd)/src:/app/src`             | 你           | 开发时热重载               |
| tmpfs        | `--tmpfs /tmp`                       | 内核（内存） | 临时文件、不落盘的敏感数据 |

两条踩过的：

1. **bind mount 会遮住容器里原有的目录**。经典事故是 `-v $(pwd):/app`，把镜像里构建好的 `/app/node_modules` 整个盖没了。解法是再叠一个匿名 volume 把它顶回来：`-v $(pwd):/app -v /app/node_modules`。
2. **bind mount 的属主是宿主机的 uid**。容器里以非 root 跑的进程可能没有写权限，表现为莫名其妙的 `EACCES`。Linux 上尤其明显，macOS/Windows 因为有文件共享层反而看不出来 —— 于是"本地好好的，上服务器就崩"。

## 四、prune 的杀伤范围

清磁盘的时候一定要看清楚删的是什么：

```bash
docker system df                 # 先看谁占了空间
docker image prune               # 只删悬空镜像（<none>），安全
docker image prune -a            # 删所有没被容器引用的镜像，注意
docker container prune           # 删所有已停止的容器
docker volume prune              # ⚠️ 删所有没被引用的 volume —— 数据没了
docker system prune -a --volumes # ⚠️⚠️ 核弹
```

`docker volume prune` 删掉过我一次本地开发数据库。不是不可恢复的灾难，但重新 seed 一遍要十分钟。**先 `docker system df`，再决定删哪一类**，别直接上 `system prune`。

## 五、检查点：纯 CLI 起一套三件套

不借助 Compose，把 app + postgres + redis 连起来：

```bash
docker network create devnet

docker run -d --name db --network devnet \
  -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=app \
  -v pgdata:/var/lib/postgresql/data \
  --health-cmd 'pg_isready -U postgres' --health-interval 5s \
  postgres:16-alpine

docker run -d --name cache --network devnet redis:7-alpine

docker run -d --name app --network devnet -p 3000:3000 \
  -e DATABASE_URL='postgresql://postgres:dev@db:5432/app' \
  -e REDIS_URL='redis://cache:6379' \
  my-app:dev
```

做完这一遍再去看 Compose，会发现它只是把这些参数换了个写法 —— 而不是一套需要重新学的东西。

## 下一步

下一篇：[Dockerfile：分层、缓存与多阶段构建](/posts/dockerfile-layers-and-cache)
