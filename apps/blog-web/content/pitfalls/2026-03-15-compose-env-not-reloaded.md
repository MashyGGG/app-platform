---
title: 改了 .env，docker compose up 之后还是旧值
date: 2026-03-15
summary: Compose 认为配置没变就不重建容器。而环境变量是写死在容器创建那一刻的，重启不会重新读。
stage: docker
level: basic
tags: [docker, compose, 环境变量, 缓存]
---

## 现象

改了 `.env` 里的一个变量，然后：

```bash
docker compose up -d
# → Container app  Running     ← 注意是 Running，不是 Recreated
```

进容器一看，`env` 里还是旧值。`docker compose restart app` 也没用。

## 原因

两层：

1. **环境变量是容器创建时固化的。** 它写在容器的配置里，`restart` 只是重新跑 PID 1，不会重新计算环境。要换环境变量，必须**重建容器**。
2. **Compose 会跳过它认为没变的服务。** 它比对的是解析后的服务配置。如果 `.env` 里的值是通过 `env_file` 注入的，Compose 可能不认为服务定义变了 —— 于是打印 `Running` 就走了。

两种注入方式行为不一样，这是最容易搞混的地方：

```yaml
services:
  app:
    # A：变量插值。.env 的值在解析时就被替换进服务定义 → 改了会触发重建
    environment:
      DATABASE_URL: ${DATABASE_URL}

    # B：env_file。服务定义里只有文件名，文件内容变了服务定义没变 → 不一定重建
    env_file: .env
```

用 B 写法踩坑的概率高得多。

## 修法

立刻生效：

```bash
docker compose up -d --force-recreate app
```

想确认到底生效没有，别猜，直接看容器里的实际值：

```bash
docker compose exec app env | grep DATABASE_URL
docker inspect $(docker compose ps -q app) --format '{{json .Config.Env}}'
```

想彻底避免，就用变量插值（A 写法），让 `.env` 的内容真的进入服务定义：

```yaml
environment:
  DATABASE_URL: ${DATABASE_URL:?DATABASE_URL is required}
```

`:?` 那段的额外收益：变量没设的时候 `docker compose up` **直接失败并说清缺哪个**，而不是把空字符串传进去，让应用在三层之下报一个看不懂的连接错误。

## 教训

1. **容器是不可变的。** 环境变量、挂载、网络这些都是创建时固化的，改配置就得重建。`restart` 只重启进程，不重建容器 —— 这两个词的区别值得刻在脑子里。
2. **"看起来成功了"要能被验证。** `up -d` 打印 `Running` 是它工作正常的表现，不是你的改动生效的证据。改完配置就去 `exec env` 看一眼，两秒钟的事。
3. **配置缺失要早失败、响亮地失败。** `${VAR:?message}` 把一个"运行时莫名其妙的错误"变成"启动时一句人话"。同样的原则适用于任何配置读取：宁可启动不了，也不要带着空值跑起来。
4. 这条和 [CI 里的 apt 卡死](/posts/ci-apt-hang) 是同一类问题的两面 —— **没有反馈的成功，比明确的失败更贵。**
