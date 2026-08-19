# blog-web

学习日志 / 踩坑记录站。monorepo 里的第三个应用，端口 **3002**。

完整方案、学习路线的来源、部署步骤见 [`docs/BLOG-WEB.md`](../../docs/BLOG-WEB.md)。

## 和另外两个应用的区别

|          | app-web / admin-web     | blog-web                            |
| -------- | ----------------------- | ----------------------------------- |
| 数据来源 | PostgreSQL（`@app/db`） | 仓库里的 `.md` 文件                 |
| 认证     | Auth.js + 两层鉴权      | 无                                  |
| UI       | Ant Design 5            | Tailwind + typography               |
| i18n     | next-intl（zh / en）    | 单语言                              |
| 渲染     | 大量 `force-dynamic`    | 全量静态生成                        |
| 发布标签 | `app-web/vX.Y.Z` 等     | `blog-web/vX.Y.Z`（跳过数据库迁移） |

共用的是仓库的工具链：ESLint、Prettier、tsc、Vitest、CI。

## 开发

```bash
pnpm --filter blog-web run dev        # http://localhost:3002
pnpm --filter blog-web run typecheck
pnpm --filter blog-web run build
pnpm vitest run --project blog-web
```

不需要 docker，不需要数据库，不需要 `.env`。

## 写一篇

```
content/posts/YYYY-MM-DD-slug.md      学习笔记
content/pitfalls/YYYY-MM-DD-slug.md   踩坑记录（自动带"踩坑"标记）
```

文件名的日期前缀只用于排序，**不进 URL**。

```yaml
---
title: 标题
date: 2026-08-20
summary: 一句话。卡片和 RSS 用它。
stage: docker # docker | frontend | backend | ops | architecture
level: basic # basic | intermediate | advanced（可省）
tags: [docker, 缓存] # 可省
draft: true # 可省，true 时 dev 可见、构建后不出现
---
```

**frontmatter 写错会让 `pnpm build` 失败并指出是哪个文件的哪个字段。** 这是刻意的 ——
备选方案是静默跳过该文件，那样一个 typo 会让文章从所有索引页消失而没人发现。

## 目录结构

```
content/         内容（唯一的数据源）
src/app/         路由：首页 / roadmap / posts / pitfalls / tags / feed.xml / sitemap
src/components/  只有 PostFilter.tsx 是客户端组件，其余都是服务端组件
src/lib/
  post-meta.ts       纯函数：frontmatter 校验、阅读时长、排序（35 个单测）
  content.ts         读文件、校验、缓存
  markdown.ts        unified 渲染管线 + 从 HAST 收集目录
  roadmap.ts         学习路线数据
  site.ts            站点常量
```

## 学习路线

`src/lib/roadmap.ts` 是路线的唯一来源，`/roadmap` 页面由它生成。给某个检查点加
`post: 'slug'`，页面上就会从"待写"变成指向那篇笔记的链接。
