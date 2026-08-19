---
title: 这个博客怎么做的，以及怎么往里加东西
date: 2026-08-19
summary: 内容是仓库里的 .md 文件，不是数据库行。写一篇笔记 = 新建一个文件 + git commit，构建时静态生成。
stage: frontend
level: basic
tags: [nextjs, 静态生成, markdown, 元, 工作流]
---

这个博客本身是 `app-platform` 这个 monorepo 里的第三个应用（`apps/blog-web`），和另外两个业务应用共用同一套 lint / 格式化 / 类型检查 / 测试 / 发布流程，但**不共用数据库**。

## 为什么内容是文件不是数据库

同一个 monorepo 里已经有 PostgreSQL 和 Prisma 了，写个 `Post` 表看起来更顺手。没这么做，三个理由：

1. **它要能独立部署。** 内容进数据库，这个应用就多了 `DATABASE_URL`、Prisma 引擎打包、迁移步骤三样东西 —— 而它们全是前面那些坑的来源。文件方案让它是一个纯静态站点，部署路径上没有任何有状态的东西。
2. **笔记应该和它记录的代码用同一种方式管理。** 写笔记是 `git add`，走 PR，有 diff，能 review，能回滚。数据库里的一行文本没有这些。
3. **构建时全部静态生成。** 每篇笔记都是构建期渲染好的 HTML，运行时零查询、零冷启动。

代价是没有网页后台，只能用编辑器写。对一个人的学习笔记来说这不是代价。

## 加一篇笔记

在 `apps/blog-web/content/` 下面新建文件：

- `content/posts/` —— 学习笔记
- `content/pitfalls/` —— 踩坑记录（自动带上"踩坑"标记）

文件名用 `YYYY-MM-DD-slug.md`。日期前缀只是让目录按时间排，**不会进 URL** —— `2026-08-19-foo.md` 的地址是 `/posts/foo`。

frontmatter 五个字段：

```yaml
---
title: 标题
date: 2026-08-19
summary: 一句话说清这篇讲什么。卡片和 RSS 都用它。
stage: docker # docker | frontend | backend | ops | architecture
level: basic # basic | intermediate | advanced，可省
tags: [docker, 缓存] # 可省
draft: true # 可省。true 时本地可见、构建后不出现
---
```

然后 `pnpm --filter blog-web dev`，开 `localhost:3002`。

## 写错了会怎样

**构建直接失败，并告诉你哪个文件哪一行错了。**

```
Error: Invalid frontmatter in content/posts/2026-08-19-foo.md:
  - `stage` must be one of: docker | frontend | backend | ops | architecture
  - `summary` is required — it is what the cards and the RSS feed show
```

这是刻意的。备选方案是"校验失败就跳过这个文件"，那样一个 typo 会让文章**从所有索引页上静默消失**，而你直到几周后才发现。响亮地失败便宜得多。

而且校验函数是纯函数，有一张完整的边界表测试（`src/lib/post-meta.test.ts`，35 个用例）。写这批测试的时候当场抓出两个真 bug，单独记了一篇：[Date.parse('2026-02-31') 不返回 NaN](/posts/date-parse-rollover)。

## 渲染管线

```
gray-matter  → 拆 frontmatter
remark-parse → Markdown AST
remark-gfm   → 表格、删除线、任务列表
remark-rehype→ HTML AST
rehype-slug  → 给标题生成 id
（自定义插件）→ 从 AST 里收集目录
rehype-autolink-headings → 标题锚点
@shikijs/rehype → 代码高亮（构建期）
rehype-stringify → HTML 字符串
```

两个值得说的决定：

**目录从 HAST 里收，不从 Markdown 源码里收。** 在 `rehype-slug` 跑完之后遍历 AST 拿标题的 `id`，保证目录里的锚点就是页面上真实存在的那个。自己再实现一遍 slug 算法，标题里第一次出现标点符号时目录就会指向不存在的锚点。

**Shiki 在构建期跑，双主题内联成 CSS 变量。** 客户端拿到的是已经高亮好的 HTML，切换深浅色只是一条媒体查询。一个纯展示文本的页面，没道理为了高亮再下一个语法解析器。

整个站点只有一个客户端组件（列表页的搜索框），其余全是服务端组件。

## 部署

独立的 Vercel 项目，独立的发布标签：

```bash
gh release create blog-web/v0.1.0 --generate-notes
```

和另外两个应用一样，走 `.github/workflows/ci.yml`：push 到 main 什么都不触发，只有发布 release 才部署。区别是这个应用不需要数据库迁移。

## 后续想加的

- 按路线阶段自动统计"已写 / 待写"的进度条（现在是路线页面上按 slug 对照）
- 每篇笔记的"最后验证日期"—— 技术笔记会过期，标出来比默默烂掉好
- 一个链接检查器，防止笔记之间的相互引用随着改名而失效
