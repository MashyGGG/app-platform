---
title: CI/CD 流水线：从本仓库的 ci.yml 里学到的六件事
date: 2026-08-15
summary: 发布不是 push、每个 job 都要有超时、迁移必须先于部署 —— 都是这条流水线用真实故障换来的。
stage: ops
level: intermediate
tags: [ci, github-actions, 部署, 发布流程, vercel]
---

这篇不讲 GitHub Actions 语法，讲**为什么这条流水线长成现在这样**。每一条都对应一次真实的事故或返工。

## 1. 推 main 不该部署任何东西

本仓库的规则是：

- `pull_request → main`：只跑质量门禁和 E2E，**不部署**。
- `release: published`：解析标签 → 质量 → 迁移 → 部署。
- **push 到 main：什么都不触发。**

为什么不用"合并即部署"？因为合并的时机由 review 决定，上线的时机应该由人决定。这两件事被绑在一起之后，任何一次"顺手合个 PR"都变成一次上线。

标签同时选择部署目标：

```
app-web/v1.2.0    → 只部署 app-web
admin-web/v1.2.0  → 只部署 admin-web
v1.2.0            → 两个都部署（共享代码或数据库变更）
```

标签格式不合法就在第一个 job 直接失败，后面的迁移和部署根本不会跑。**把校验放在最前面，让错误发生在便宜的地方。**

配套的一条：Vercel 自己的 Git 集成必须关掉（`vercel.json` 里 `git.deploymentEnabled: false`）。否则它会在流水线背后自己部署，你以为的门禁全部形同虚设。

## 2. 迁移必须在部署之前，而且它们之间有一段窗口

```
migrate（改数据库）→ deploy（换代码）
```

顺序不能反：新代码依赖新表，先部署会直接 500。

但正因为是这个顺序，中间那段时间里**旧代码正在跑新的数据库结构**。所以：

> 任何一次迁移都必须能被**上一个版本**的代码正常读写。

这就是 expand / contract：

- 第 N 版：加列（可空 / 有默认值），新旧代码都能跑。
- 第 N+1 版：代码开始写新列，双写一段时间。
- 第 N+2 版：确认没人再读旧列，才删。

**永远不要在停止使用某列的同一个版本里删掉它。** 这条规则的代价是多发一两次版本，不遵守的代价是一次回滚就把数据搞坏。

用 `needs:` 把它们串起来，还有一个好处：迁移失败时部署不会发生，线上继续跑旧代码 —— 一次失败的发布变成一次无事发生。

## 3. 每个 job 都要有 `timeout-minutes`

GitHub Actions 的默认超时是 **360 分钟**。

这不是理论问题。本仓库有一次 `playwright install --with-deps` 卡在 `apt-get update` 上：runner 默认的 apt 镜像不响应，回退到公共源，然后就一直挂着。一次跑了 50 分钟，另一次 6 分钟。如果不是恰好有人在看，它会在那里坐满六小时，占着 runner、挂着 PR。

现在每个 job 都有明确预算：

```yaml
quality: timeout-minutes: 20
e2e:     timeout-minutes: 30   # 正常 6–12 分钟
migrate: timeout-minutes: 15
deploy:  timeout-minutes: 20
```

定值原则：**取实际耗时的两倍左右**。宽到不会误杀正常构建，紧到卡住时你还在看屏幕就已经红了。

（这次 apt 事故本身的完整排查过程另写了一篇：[CI 里的 apt 卡死](/posts/ci-apt-hang)。）

## 4. 快的先跑，慢的后跑

`quality` 这个 job 内部的顺序是刻意的：

```
schema 守卫 → prisma validate → 迁移到一次性库 → 漂移检查
→ generate → lint → format → typecheck → 单元测试 → build
```

schema 守卫零秒，`build` 好几分钟。把最便宜、最容易失败的检查放前面，开发者拿到反馈的中位时间就短得多。

单元测试放在 `build` 前面也是这个道理 —— 它一秒钟跑完 200 多个用例，没理由让它排在几分钟的构建后面。

反过来，`quality` 和 `e2e` 是两个**并行**的 job，因为它们互不依赖。串起来只会让总时长变成两者之和。

## 5. 依赖服务要探活，而且探活方式要对

CI 里用 service container 起 Postgres / Redis 很容易，坑在**怎么确认它好了**。

本仓库那个 Upstash REST shim 没有自带 healthcheck。第一版探活写的是 `curl -sf http://localhost:8079/ping` —— 看起来合理，实际上这个 shim 根本没有 `/ping` 路由，它对任何未知路径都返回 404 加一段 JSON。而 `curl -sf` 分不清"404 说明服务活着"和"连不上说明服务没起来"。

于是探活永远"成功"，真正的失败推迟到第一次登录时，表现为一个莫名其妙的认证错误。

改成用客户端真正会用的方式探：

```bash
curl -sS -X POST -H 'Authorization: Bearer $TOKEN' \
  -H 'Content-Type: application/json' \
  -d '["PING"]' http://localhost:8079
# 匹配返回里的 PONG
```

匹配 `PONG` 同时证明了三件事：端口通、token 对、命令真的到了 Redis。

> **探活要探应用真正走的那条路径**，不要探一个"看起来像健康检查"的地址。

## 6. CI 的环境变量要能证伪

E2E job 里这两行：

```yaml
AUTH_SECRET_APP: ci-e2e-app-secret-value-at-least-32-chars
AUTH_SECRET_ADMIN: ci-e2e-admin-secret-value-at-least-32-chars
```

上面有一句注释：**这两个必须不同**。因为测试里有一条断言是"一个应用签发的 token 不能被另一个应用解开"。如果 CI 里图省事共用一个 secret，这条测试会稳定通过 —— 而它想防的那个真实漏洞正好就存在。

这是我从这条流水线里学到最有价值的一条：

> **配置成一个绿灯的测试，和配置成一个有意义的测试，是两回事。** 写完一条安全断言，要问自己：什么样的环境配置会让它变成永远通过的空断言？

## 检查点

读完自己项目的 CI 配置，能回答：

1. 哪些 job 是并行的，为什么？
2. 迁移和部署之间那段窗口期，旧代码会不会崩？
3. 哪个 job 没有超时？
4. 有没有哪条断言，其实因为环境配置而永远为真？
