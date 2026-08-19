# `apps/blog-web` — 学习日志 / 踩坑记录站

> 需求：系统学习 Docker 及其之后的必备知识，并把学习过程和日常踩的坑记录成博客，
> 独立部署到 Vercel。本文是这个需求的**方案记录**：学习路径怎么定的、应用为什么长成
> 这样、怎么写内容、怎么上线。

---

## 1. 学习路径

### 1.1 检索来源

路线不是拍脑袋定的，先检索了公开的路线图和 2026 年的实践文章，再按"这个仓库真的用得上
吗"裁剪了一遍：

- [roadmap.sh · Docker Roadmap](https://roadmap.sh/docker) — 容器底层机制、镜像构建、
  编排的标准分段（namespace / cgroup / UnionFS、Dockerfile 与分层缓存、registry、
  多阶段构建、Swarm / K8s、容器安全）
- [roadmap.sh · DevOps Roadmap](https://roadmap.sh/devops) 与
  [milanm/DevOps-Roadmap](https://github.com/milanm/DevOps-Roadmap) — Docker 之后的顺序
- [Docker for Full Stack Developers in 2026 (nucamp)](https://www.nucamp.co/blog/docker-for-full-stack-developers-in-2026-containers-compose-and-production-workflows)
  — 全栈岗位对 Docker 的真实要求：Compose 起本地全栈、Dockerize 一个 API、CI 里构建推镜像
- [Docker Roadmap: Zero to Production-Ready (Scaler)](https://www.scaler.com/blog/docker-roadmap/)
- [Dockerfile Best Practices 2026](https://lucaberton.com/blog/dockerfile-best-practices-2026/)
  与 [Docker Images Best Practices](https://oneuptime.com/blog/post/2026-02-02-docker-images-best-practices/view)
  — 生产事故的集中区：`:latest`、root 用户、无资源上限、没人处理的 healthcheck、镜像体积
- [2026 full-stack developer roadmap (TheServerSide)](https://www.theserverside.com/blog/Coffee-Talk-Java-News-Stories-and-Opinions/Roadmap-Full-Stack-Developer-DevOps-Git-Docker-Containers)
  与 [Coursera · DevOps Learning Roadmap](https://www.coursera.org/resources/devops-learning-roadmap)

**公开路线的一致结论**：Linux 与网络 → 脚本与 Git → CI/CD → 容器与编排 → IaC 与云 →
可观测与安全。跳段会得到"面试一问就穿帮"的浅层知识。

### 1.2 裁剪后的路线（代码在 `apps/blog-web/src/lib/roadmap.ts`）

| 阶段 | 主题 | 检查点数 | 预算 |
| --- | --- | --- | --- |
| 第 0 阶段 | Docker 与容器 | 5 | 4–6 周 |
| 第 1 阶段 | 前端（工程化） | 3 | 3–4 周 |
| 第 2 阶段 | 后端 | 4 | 6–8 周 |
| 第 3 阶段 | 运维 | 5 | 8–12 周 |
| 第 4 阶段 | 架构 | 3 | 持续 |

两条设计原则：

1. **每个检查点带一个可验证的交付物。** 不是"了解 cgroup"，而是"对自己的镜像跑一次
   trivy 并把 HIGH 以上清零"。做不出来就是没学过 —— 这和本仓库
   `docs/UNIT-TESTING.md` 里"测试的价值在于能给出 pass/fail 信号"是同一条原则。
2. **凡是本仓库已经在用的东西优先。** Compose 那一节直接读本仓库的三个 compose 文件；
   CI 那一节直接读 `.github/workflows/ci.yml`。有真实上下文的知识才留得住。

路线页面会自动对照 `content/` 下已写的文章，标出"已记录 / 待写"。

---

## 2. 应用形态与关键决策

### 2.1 一句话

`apps/blog-web` 是 monorepo 里的第三个 Next.js 15 应用，端口 3002，**内容是仓库里的
Markdown 文件**，构建期全量静态生成，独立部署到自己的 Vercel 项目。

### 2.2 决策表

| 决策 | 选择 | 理由 | 代价 |
| --- | --- | --- | --- |
| 内容存储 | `content/**/*.md` 文件 | 独立部署的前提。进数据库就要 `DATABASE_URL` + Prisma 引擎打包 + 迁移，而这三样正是本仓库最主要的部署坑来源 | 没有网页后台，只能用编辑器写 |
| 是否接 `@app/db` | **不接** | 这个应用不读任何业务数据。不依赖就不会被数据库故障波及，发布也不需要迁移 | 无法展示站点统计之类的动态数据 |
| 是否接认证 | **不接** | 纯公开内容，没有需要保护的东西 | — |
| i18n | **不用 next-intl** | 笔记本身就是中文的；内容即语言。加 `[locale]` 段等于要维护两份内容 | 将来要英文版得重构路由 |
| UI 库 | Tailwind + `@tailwindcss/typography`，**不用 antd** | 内容站要的是排版，不是表单控件。没有 antd 就不用关 preflight | 与另两个应用视觉不统一（可接受，定位不同） |
| 代码高亮 | Shiki，**构建期**执行 | 一个只展示文字的页面没道理为高亮再下一个语法解析器 | 构建慢一点 |
| 渲染方式 | 全量静态生成 | 运行时零查询、零冷启动 | 新增文章要重新构建 |
| 客户端组件 | 只有 1 个（列表页搜索框） | 其余全是服务端组件 | — |

### 2.3 目录

```
apps/blog-web/
├─ content/
│  ├─ posts/      YYYY-MM-DD-slug.md   学习笔记
│  └─ pitfalls/   YYYY-MM-DD-slug.md   踩坑记录（自动带"踩坑"标记）
└─ src/
   ├─ app/
   │  ├─ page.tsx              首页：统计 + 路线入口 + 最近更新
   │  ├─ roadmap/              学习路线（数据来自 lib/roadmap.ts）
   │  ├─ posts/                列表 + [slug] 详情（含目录、上下篇）
   │  ├─ pitfalls/             只看踩坑
   │  ├─ tags/ + tags/[tag]/
   │  ├─ feed.xml/route.ts     RSS
   │  └─ sitemap.ts
   ├─ components/              Badges / PostCard / PostFilter(client) / SiteChrome / Toc
   └─ lib/
      ├─ post-meta.ts          纯函数：frontmatter 校验、阅读时长、排序（有单测）
      ├─ post-meta.test.ts     35 个用例的边界表
      ├─ content.ts            读文件、校验、缓存
      ├─ markdown.ts           unified 渲染管线 + 目录提取
      ├─ roadmap.ts            学习路线数据
      └─ site.ts               站点常量（RSS / sitemap 共用）
```

### 2.4 两个值得记下来的实现细节

**目录从 HAST 里收集，不从 Markdown 源码里收集。**
在 `rehype-slug` 跑完之后遍历 AST 拿标题的 `id`。自己再实现一遍 slug 算法，标题里第一次
出现标点时目录就会指向不存在的锚点 —— 而且不会报错。

**frontmatter 校验失败时构建直接失败，不是跳过该文件。**
跳过意味着一个 typo 会让文章从所有索引页上静默消失，几周后才被发现。响亮失败便宜得多：

```
Error: Invalid frontmatter in content/posts/2026-08-19-foo.md:
  - `stage` must be one of: docker | frontend | backend | ops | architecture
  - `summary` is required — it is what the cards and the RSS feed show
```

---

## 3. 内容工作流

### 3.1 加一篇

```bash
# 学习笔记
apps/blog-web/content/posts/2026-08-20-my-note.md
# 踩坑记录
apps/blog-web/content/pitfalls/2026-08-20-my-pitfall.md
```

文件名里的日期前缀只是排序用，**不进 URL**：`2026-08-20-my-note.md` → `/posts/my-note`。

```yaml
---
title: 标题
date: 2026-08-20
summary: 一句话说清这篇讲什么。卡片和 RSS 都用它。
stage: docker # docker | frontend | backend | ops | architecture
level: basic # basic | intermediate | advanced（可省，默认 basic）
tags: [docker, 缓存] # 可省
draft: true # 可省。true 时 dev 可见、构建后不出现
---
```

```bash
pnpm --filter blog-web run dev   # http://localhost:3002
```

### 3.2 踩坑记录的固定结构

不强制，但建议按这个骨架写 —— 重点在最后一条：

```
## 现象     贴真实报错，不要转述
## 排查     试了什么，排除了什么
## 原因     根因，以及为什么第一直觉是错的
## 修法     可以直接抄的代码
## 教训     下次靠什么提前避开（这条才是复利）
```

### 3.3 把某篇笔记挂到路线上

在 `src/lib/roadmap.ts` 对应检查点上加 `post: 'slug'`。路线页面会自动从"待写"变成"已记录"
并生成链接。

---

## 4. 部署

### 4.1 Vercel 项目设置（一次性）

新建第三个 Vercel 项目，指向同一个仓库：

| 设置项 | 值 |
| --- | --- |
| Root Directory | `apps/blog-web` |
| Build Command | `cd ../.. && pnpm turbo run build --filter=blog-web` |
| Include source files outside of the Root Directory | **开启** |
| Install Command | 默认 |
| 环境变量 | `NEXT_PUBLIC_BLOG_URL`（可选，用于 RSS / sitemap 的绝对地址；不设则回落到 Vercel 注入的域名） |

Build Command 必须回到仓库根走 turbo，理由和另两个应用完全一样：在 Root Directory 里跑
`pnpm build` 会解析到该应用自己的 `next build`。对这个应用来说暂时不致命（它不依赖
`@app/db#generate`），但保持一致可以避免以后加了 workspace 依赖时踩坑。

`apps/blog-web/vercel.json` 里 `git.deploymentEnabled: false` —— 和另两个应用一样，
禁止 Vercel 自己的 Git 集成在流水线背后部署。

### 4.2 GitHub 侧

新增一个仓库 secret：**`VERCEL_PROJECT_ID_BLOG_WEB`**（其余 `VERCEL_TOKEN` /
`VERCEL_ORG_ID` 复用）。

### 4.3 发布

```bash
gh release create blog-web/v0.1.0 --generate-notes
```

`ci.yml` 的标签映射现在是：

| 标签 | 部署 | 是否迁移数据库 |
| --- | --- | --- |
| `app-web/vX.Y.Z` | app-web | 是 |
| `admin-web/vX.Y.Z` | admin-web | 是 |
| `blog-web/vX.Y.Z` | blog-web | **否** |
| `vX.Y.Z` | app-web + admin-web | 是 |

`vX.Y.Z` **不含** blog-web，这是刻意的：那个标签的含义是"共用数据库的那两个应用"，而
blog-web 既不共用数据库也不共用发布节奏。

对 workflow 的改动是三处：

1. `resolve-release` 增加 `blog-web/` 分支，并输出 `needs_migrate`。
2. `migrate` 加 `if: … needs_migrate == 'true'` —— blog-web 单独发布时整个跳过，不会因为
   一篇笔记的错别字去开生产环境的审批门。
3. `deploy` 的 `if` 改成 `always() && …` 加显式的 result 检查。**这一步是必要的**：被
   跳过的依赖会连带跳过下游 job，而显式检查把门禁原样放了回去 —— migrate 失败或被取消
   仍然阻止部署。

---

## 5. 验证信号

这个应用挂在仓库既有的两条信号上，没有新增第三条：

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

- **`pnpm test`** — `vitest.config.mts` 里新增了 `appProject('blog-web')`。35 个用例覆盖
  frontmatter 校验的完整边界表、阅读时长、排序稳定性、slug 推导。全是纯函数，符合
  `docs/UNIT-TESTING.md` §1 的划分（边界表 + 静默失败解析器）。
- **`pnpm build`** — 因为内容在构建期校验，**任何一篇文章的 frontmatter 写错都会让构建
  失败**。这就是内容的 CI 门禁，不需要额外的 lint 工具。
- **E2E 不覆盖这个应用**，是刻意的。Playwright 那一套的价值在于跨边界（两个应用、两个
  cookie、Edge runtime、真实数据库），而这个站点是静态 HTML，没有边界可跨。加进去只会让
  E2E job 多构建一个应用、多花几分钟，换不到任何信息。

写第一批单元测试时当场抓出两个真 bug（`Date.parse('2026-02-31')` 不返回 NaN、
`formatDate` 对垃圾输入渲染出 `NaN`），已记在 `content/pitfalls/2026-08-19-date-parse-rollover.md`。

---

## 6. 与仓库既有约定的关系

| 约定 | 这个应用的情况 |
| --- | --- |
| `packages/db` 独占 schema | 不涉及 —— 没有任何 `.prisma` 文件，`pnpm check:schema-owner` 自然通过 |
| 只用 `@app/db` 的 prisma 单例 | 不涉及 —— 不连数据库 |
| 两套 AUTH_SECRET | 不涉及 —— 没有认证 |
| `AuditLog` 只追加 | 不涉及 |
| `.env` 不入库 | 遵守；这个应用只有一个可选变量 `NEXT_PUBLIC_BLOG_URL` |
| `vercel.json` 必须保持精简 | 遵守 —— 只有 `git.deploymentEnabled: false` |
| 发布而非推送 | 遵守 —— 新增 `blog-web/vX.Y.Z` 标签 |

---

## 7. 首批内容

**学习笔记（6 篇）**

| 文件 | 对应检查点 |
| --- | --- |
| `container-mental-model` | 0.1 容器到底是什么 |
| `docker-cli-daily-driver` | 0.2 日常操作 |
| `dockerfile-layers-and-cache` | 0.3 分层与缓存 |
| `compose-local-stack` | 0.4 Compose |
| `docker-production-checklist` | 0.5 生产化 |
| `ci-pipeline-lessons` | 3.2 CI/CD |
| `how-this-blog-works` | 元：怎么往里加东西 |

**踩坑记录（6 条，全部来自本仓库或本次开发的真实问题）**

| 文件 | 一句话 |
| --- | --- |
| `ci-apt-hang` | `--with-deps` 背后是 apt，卡死 50 分钟；加 `timeout` 反而制造了一个必然失败的锁 |
| `prisma-engine-missing-on-vercel` | `.node` 二进制不在 import 图里，文件追踪抓不到 |
| `tailwind-preflight-vs-antd` | 两套 CSS reset 打架 |
| `date-parse-rollover` | `Date.parse('2026-02-31')` 不返回 NaN |
| `next15-async-params` | `params` 变成 Promise，而 `await` 非 Promise 是合法的 |
| `compose-env-not-reloaded` | 环境变量在容器创建时固化，`restart` 不重新读 |

---

## 8. 后续待办

- [ ] 在 Vercel 建第三个项目，配好 Root Directory / Build Command，把
      `VERCEL_PROJECT_ID_BLOG_WEB` 加进仓库 secret
- [ ] 发第一个 release：`gh release create blog-web/v0.1.0`
- [ ] 给每篇笔记加"最后验证日期"—— 技术笔记会过期，标出来比默默烂掉好
- [ ] 加一个链接检查器（构建期扫 `/posts/...` 内链是否存在），防止改名后互相引用失效
- [ ] 路线页面加进度条：按已写文章数自动统计每个阶段的完成度
- [ ] 补完剩余检查点的笔记，按路线顺序推进
