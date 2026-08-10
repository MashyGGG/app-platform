# SPEC + 落地 Prompt：APP Web + 管理后台（Monorepo / Vercel / PR 部署）

> 仓库归属：`MashyGGG`  
> 产出用途：把下方「落地 Prompt」整段复制给 AI IDE，按其执行；本文件同时作为需求 single source of truth。

---

## 0. 已确认需求摘要

| 项 | 决定 |
|---|---|
| 仓结构 | **Monorepo**（Turborepo + pnpm workspace）：`apps/app-web` + `apps/admin-web` + **`packages/db`（唯一 Schema Owner）** |
| APP 形态 | Web（Next.js） |
| 后端形态 | 各 app 自带 Next.js Route Handlers；**共用同一套云 PostgreSQL + Redis** |
| APP 页面 | 登录 / 注册 / 忘记密码 / Home（Hello World） |
| 管理后台 | 登录 + RBAC；APP 用户 CRUD；后台用户 CRUD；操作审计；仪表盘 |
| 角色 | `super_admin` / `operator` |
| 认证 | 邮箱密码 + Google OAuth；Session = **JWT**；**禁用用户每次鉴权必拒** |
| 数据库 | PostgreSQL（Neon）；Prisma 仅住在 `packages/db` |
| Redis | 限流 & 缓存（JWT 策略下不用 Redis 存会话） |
| 部署 | PR → GitHub Actions → Vercel（Preview）；main 合并 → Production（两 Vercel Project，Root Directory 分指两 app） |
| i18n | 中 / 英双语 |
| UI | **Ant Design** + **@ant-design/icons** + **Tailwind CSS** |
| 工程化 | ESLint + Prettier + **Husky**（pre-commit）+ lint-staged |
| GitHub | MashyGGG / 单仓名默认 `app-platform` |

---

## 1. 推荐架构（为什么这样选）

### 1.1 Monorepo + `packages/db` 单一 Schema Owner

```
┌─────────────────────────────────────────────────────────┐
│  MashyGGG/app-platform（pnpm + Turborepo）               │
│                                                         │
│  apps/app-web          apps/admin-web                   │
│  Next.js App Router    Next.js App Router               │
│  UI + Route Handlers   UI + Route Handlers              │
│         │                     │                         │
│         └──────────┬──────────┘                         │
│                    ▼                                    │
│           packages/db  ← 唯一 Schema Owner              │
│           schema.prisma / migrations / seed / client    │
└────────────────────┬────────────────────────────────────┘
                     ▼
        ┌────────────────────────┐
        │ Neon PostgreSQL (SoR)  │
        │ Upstash Redis          │
        └────────────────────────┘
                     │
                     ▼
     Vercel × 2 Projects（Root = 各 app 目录）
```

**为什么用 Monorepo（而非双仓复制 schema）：**
- Prisma 官方与业界常见做法是 **共享 `packages/db`**，避免两份 `schema.prisma` 漂移。
- 单一 Migration Owner、类型一次生成、两边 `import` 同一 Client。
- 仍保持「不单独拆 API 仓」：各 app 自带 Route Handlers，MVP 部署用两个 Vercel Project 即可。

### 1.2 Schema 同步硬约束（必须写进实现与 CI）

| 规则 | 要求 |
|---|---|
| **唯一 Owner** | 仅 `packages/db` 可含 `prisma/schema.prisma`、`prisma/migrations/**`、seed |
| **禁止** | `apps/**` 下出现独立 `schema.prisma` / `migrations`；禁止在 app 内 `prisma migrate` |
| **消费方式** | `apps/*` 依赖 workspace 包（如 `@app/db`），只用其导出的 Prisma Client / 类型 |
| **migrate 执行点** | **仅** GHA `push` → `main` 的 job（或独立 migrate job）在 `packages/db` 跑 `prisma migrate deploy` |
| **Preview** | PR Preview **默认不跑 migrate**（防多 PR 抢改 schema）；schema 变更 PR 合 main 后再被 Preview 消费 |
| **CI 硬校验** | 增加 check：`apps/` 下不得存在 `**/prisma/schema.prisma`；`packages/db` 的 `prisma validate` 必须通过；可选对 `schema.prisma` 做 hash 记录于 PR diff 审查 |
| **本地变更流程** | 改表 → 只在 `packages/db` 写 migration → `pnpm --filter @app/db generate` → 两 app typecheck 通过再合 |

违反任一条视为未完成交付。

### 1.3 技术栈推荐（默认锁定，避免 AI 发散）

| 层 | 选型 | 理由 |
|---|---|---|
| Monorepo | **pnpm workspace + Turborepo** | 与 Prisma 官方指南一致；缓存 build |
| 框架 | Next.js 15（App Router）+ TypeScript | 与 Vercel 一流集成 |
| UI | **Ant Design 5** + **@ant-design/icons** + **Tailwind CSS 3** | 后台表格/表单成熟；Tailwind 做布局间距 |
| 工程化 | ESLint + Prettier + Husky + lint-staged（根目录一次配置） | commit 前 format/lint；CI 同样检查 |
| ORM | **Prisma**（仅 `packages/db`）+ PostgreSQL | 单一 schema、migration 成熟 |
| DB 托管 | **Neon**（Serverless Postgres） | 使用 **pooled `DATABASE_URL` + `DIRECT_URL`（migrate）** |
| Redis | **Upstash Redis** | 限流 + 仪表盘缓存（不用作会话存储） |
| Auth | **Auth.js (NextAuth v5)** | Email+Password + Google；两 app 各自 Auth 实例，共享 User 表；**JWT** |
| 密码 | **argon2id**（环境不便则 bcrypt） | 写死一种 |
| 邮件 | **Resend** | 忘记密码 |
| i18n | **next-intl** | App Router 主流 |
| 校验 | Zod | API/表单统一 |
| 部署 | Vercel + GitHub Actions（`vercel` CLI） | PR Preview / main Prod；Root Directory 分指 `apps/app-web`、`apps/admin-web` |

### 1.4 JWT 禁用校验（硬约束）

Session 策略 = Auth.js **JWT**（两 app 独立 cookie 名，例如 `app-web.session-token` / `admin-web.session-token`；`AUTH_SECRET` **各 app 不同**）。

**问题：** 仅在登录时检查 `status`，禁用后旧 JWT 在过期前仍可用 → **AC-8 假绿**。

**必须实现：**

1. JWT/session callback 写入 `userId`；受保护请求不得只信「有 cookie」。
2. **每次**进入受保护页面 / API（middleware 或 `auth()` 包装层）必须校验 DB 中 `User.status`：
   - `disabled` → 拒绝（401/引导登录），并 `signOut` 或删除 cookie，不得继续业务。
3. admin-web 额外：无 `AdminProfile` → 拒绝；有 profile 但 `User.status=disabled` → 同样拒绝。
4. 后台执行「禁用用户」写库成功后，该用户下一请求即失败（不要求主动推送踢下线，但 **禁止** 仅依赖 JWT 过期）。

可选优化（非第一期必须）：JWT 内缓存 `status` + 短 TTL 再查库；第一期直接 **每次鉴权查库（或至少查 status 字段）** 即可。

### 1.5 限流契约（硬约束）

实现：Upstash Ratelimit（或等价 REST 计数）；键前缀 `rl:auth:`。

| 动作 | Key 形态 | 限额 | 窗口 | HTTP |
|---|---|---|---|---|
| 登录失败/尝试 | `rl:auth:login:{ip}:{email}` | **5** | **15 min** | **429** |
| 注册 | `rl:auth:register:{ip}` | **5** | **1 hour** | **429** |
| 请求重置密码 | `rl:auth:reset-req:{email}` | **3** | **1 hour** | **429** |
| 提交重置密码 | `rl:auth:reset-confirm:{ip}` | **5** | **15 min** | **429** |

**统一错误体（JSON）：**

```json
{
  "error": "RATE_LIMITED",
  "messageKey": "errors.rateLimited",
  "retryAfterSec": 900
}
```

- `messageKey` 必须走 i18n；禁止只返回英文硬编码。
- 限流在 **校验密码/写库之前** 触发（防打爆 DB）。
- 仪表盘缓存键：`cache:dash:summary`，TTL **60s**（允许 30–120，默认 60）。

**不要**用 Redis 当用户主数据源。

### 1.6 审计契约（硬约束）

`AuditLog` 字段：`id, actorUserId, action, targetType, targetId, meta(json), ip, createdAt`。

**`action` 枚举（第一期仅这些，禁止随意字符串）：**

| action | 何时写 | targetType | meta 最小内容 |
|---|---|---|---|
| `APP_USER_UPDATE` | 改 APP 用户基础信息 | `User` | `{ fields: string[], before?: object, after?: object }` |
| `APP_USER_DISABLE` | 禁用 | `User` | `{ before: { status }, after: { status } }` |
| `APP_USER_ENABLE` | 启用 | `User` | 同上 |
| `ADMIN_USER_CREATE` | 创建后台用户 | `User` | `{ role }` |
| `ADMIN_USER_UPDATE_ROLE` | 改角色 | `User` | `{ before: { role }, after: { role } }` |
| `ADMIN_USER_DISABLE` | 禁用后台用户 | `User` | `{ before/after status }` |
| `ADMIN_USER_ENABLE` | 启用后台用户 | `User` | 同上 |

**规则：**
- 所有上表写操作 **同一事务内或紧随成功后** 写审计；写库成功但审计失败 → 请求应失败或重试（不可静默丢审计）。
- 第一期：**只读列表**；禁止物理删除审计。
- 登录成功/失败 **不强制** 进 AuditLog（限流与应用日志即可）。
- `actorUserId` = 操作者；禁止用目标用户 id 冒充 actor。

### 1.7 角色权限矩阵（第一期）

| 能力 | super_admin | operator |
|---|---|---|
| 后台登录 | ✅ | ✅ |
| 仪表盘查看 | ✅ | ✅ |
| APP 用户 查/禁/解禁/改基础信息 | ✅ | ✅ |
| 后台用户 CRUD | ✅ | ❌ |
| 角色变更（升/降 super_admin） | ✅ | ❌ |
| 审计日志查看 | ✅ | ✅（只读） |
| 删除审计日志 | ❌ | ❌ |

RBAC 必须三层都做：**middleware 路由门禁 + API/Server Action 鉴权 + UI 藏入口**；仅 UI 隐藏不算通过。

---

## 2. 数据模型（最小可上线）

```text
User
  id, email, emailVerified, passwordHash(nullable for Google-only),
  name, image, locale(default), status(active|disabled),
  createdAt, updatedAt

Account          # Auth.js OAuth 关联
  id, userId, type, provider, providerAccountId, ...

Session          # Auth.js adapter 兼容字段可保留；运行时策略为 JWT
  ...

VerificationToken
  ...

AdminProfile     # 仅后台用户；APP 用户可无此行
  userId, role(super_admin|operator), createdAt, updatedAt

AuditLog
  id, actorUserId, action(/* 见 1.6 枚举 */),
  targetType, targetId, meta(json), ip, createdAt
```

**约定：**
- APP 用户 = `User` 且 **没有** `AdminProfile`
- 后台用户 = `User` + `AdminProfile`
- 默认：**允许**同一人两者皆有（有 AdminProfile 就能进后台）
- `action` 在应用层用 Zod/TS union 约束；DB 可用 `String` + check 或枚举

---

## 3. 仓库与 Vercel 项目

| GitHub Repo | 路径 | Vercel Project | Root Directory | 生产域名（可先用 vercel.app） |
|---|---|---|---|---|
| `MashyGGG/app-platform` | `apps/app-web` | `app-web` | `apps/app-web` | `app-web.vercel.app` |
| 同上 | `apps/admin-web` | `admin-web` | `apps/admin-web` | `admin-web.vercel.app` |

**共享环境变量（两 Project 同值，除 OAuth redirect / `AUTH_SECRET` / `NEXTAUTH_URL`）：**
- `DATABASE_URL`（Neon **pooled**）
- `DIRECT_URL`（Prisma migrate 用）
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
- `AUTH_SECRET`（**两 app 不同**）
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`（建议两套 OAuth Client，callback 分指两 app）
- `RESEND_API_KEY` / `EMAIL_FROM`
- `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_ADMIN_URL`

---

## 4. CI/CD：PR → GitHub Actions → Vercel

### 4.1 目标行为

- **打开/更新 PR（→ main）**：lint + **format:check** + typecheck（turbo）+ **schema 硬约束 check** → 分别（或矩阵）`vercel deploy` 出两 app Preview URL → 评论回 PR
- **合并到 main**：同上检查 → **`packages/db`：`prisma migrate deploy`** → 两 app Production deploy
- **Preview**：共用 Staging Neon/Upstash；**不**在 PR 上 migrate

### 4.2 所需 Secrets

- `VERCEL_TOKEN`、`VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID_APP` / `VERCEL_PROJECT_ID_ADMIN`（或等价两个 project id）
- DB/Redis 等优先配在 Vercel Project Env；GHA 用 `vercel pull` 或显式注入 migrate 所需 `DATABASE_URL`/`DIRECT_URL`

### 4.3 Workflow 要点

```yaml
# 概念结构
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  quality:
    steps:
      - pnpm install
      - lint / format:check / typecheck
      - assert no apps/**/prisma/schema.prisma
      - pnpm --filter @app/db exec prisma validate
  migrate: # only push main
    needs: quality
    steps:
      - pnpm --filter @app/db exec prisma migrate deploy
  deploy:
    needs: [quality] # prod 还需 needs: migrate
    steps:
      - vercel deploy（app-web / admin-web，按 Root Directory）
      - PR 评论 Preview URL
```

**工程化：** 根目录 Husky + lint-staged；`prepare` 启用 husky。

---

## 5. 范围

### in-scope（第一期必须）

**packages/db**
- Prisma schema + initial migration + seed（1 个本地 `super_admin`，密码仅写 README 本地说明）
- 导出 Client；作为唯一 Schema Owner

**apps/app-web**
- 双语壳；注册/登录/忘记密码/重置/登出；Google OAuth
- Home：登录后 “Hello World” + 用户信息
- 限流契约（§1.5）；**JWT 禁用校验（§1.4）**
- README：环境变量、Vercel Root、GHA

**apps/admin-web**
- 双语壳；登录门禁（AdminProfile + status）
- RBAC 三层；APP 用户管理；后台用户管理（仅 super_admin）
- 仪表盘（Redis 短缓存）；审计只读列表（§1.6）
- README：依赖 `@app/db`、禁止本地 migrate

**根仓库**
- pnpm + Turborepo；ESLint/Prettier/Husky；GHA

### out-of-scope（第一期明确不做）

- 第二/第三独立 API 仓或双仓复制 schema
- 原生 App / PWA 强推；支付；多租户；物理删用户；删审计
- 自建邮件 / K8s / 自建 Redis；自定义域名（可用 `*.vercel.app`）

---

## 6. 验收标准（EARS，可 pass/fail）

- **AC-1** WHEN 访客提交合法注册, THE app-web SHALL 创建 User 并自动登录或引导登录。
- **AC-2** WHEN 登录尝试超过 §1.5 限额, THE app-web SHALL 返回 **429** 且 body.`error`=`RATE_LIMITED`，Redis 有对应 key。
- **AC-3** WHEN Google 授权完成, THE app-web SHALL 创建或关联 User 并进入 Home。
- **AC-4** WHEN 请求忘记密码, THE system SHALL 发一次性 token 邮件；使用后失效。
- **AC-5** WHEN 已登录用户打开 Home, THE app-web SHALL 显示 “Hello World”。
- **AC-6** IF 无 AdminProfile 访问 admin-web, THEN SHALL 拒绝。
- **AC-7** WHEN operator 创建后台用户, THE admin-web SHALL 403；UI 无入口或禁用。
- **AC-8** WHEN super_admin 禁用某 APP 用户, THE system SHALL `status=disabled` 并写 `APP_USER_DISABLE` 审计；**即使用户仍持有未过期 JWT，下一受保护请求亦失败**。
- **AC-9** WHEN 打开仪表盘, THE admin-web SHALL 展示聚合指标（允许 ≤缓存 TTL 延迟）。
- **AC-10** WHEN 向 main 开 PR, THE GHA SHALL 部署 Preview 并评论 URL；且 schema 硬约束 check 通过。
- **AC-11** WHEN PR 合入 main, THE GHA SHALL 先 `packages/db` migrate deploy 再 Prod 部署。
- **AC-12** WHEN 切换语言, THE UI SHALL 中/英切换（auth + 后台导航/表格无硬编码残留）。
- **AC-13** IF `apps/` 下存在独立 `prisma/schema.prisma`, THEN CI SHALL 失败。

---

## 7. 未决假设（已采用默认，可改）

- [x] **Monorepo** = `app-platform`；`packages/db` = **唯一 Schema Owner**
- [x] Session = Auth.js **JWT** + **每次受保护请求校验 status**；Redis 仅限流/缓存
- [x] 两 app **不同** `AUTH_SECRET` + **不同** cookie 名
- [x] Preview 共用 Staging；Production 另一套；PR **不** migrate
- [x] 允许同一 User 同时有 AdminProfile
- [x] 密码 = **argon2id**（不便则 bcrypt）
- [x] 限流 / 审计按 §1.5 / §1.6 契约
- [x] UI = antd + icons + Tailwind（不用 shadcn）
- [x] Husky：lint-staged → Prettier + ESLint；CI：`lint` + `format:check`

若你要改以上任一项，改本文件后再丢给 AI IDE。

---

## 8. 端到端验证清单

1. 本地 app-web：注册 → 登录 → Home → 忘记密码走通
2. Google OAuth 走通
3. Seed `super_admin`；纯 APP 用户进后台失败
4. super_admin 建 operator；operator 不能管后台用户
5. 禁用 APP 用户 → **不重新登录**，刷新/请求 Home API 仍失败 → AuditLog 有 `APP_USER_DISABLE`
6. 超限登录返回 429 + `RATE_LIMITED`
7. 仪表盘数字合理；中英切换正常
8. PR：Preview + schema check；main：migrate + Prod
9. 确认 `apps/` 无独立 prisma schema；只通过 `@app/db` 访问 DB

---

# 落地 Prompt（复制给 AI IDE 从这里开始）

````markdown
# 任务：从零搭建 Monorepo APP + 管理后台（Next.js / packages/db / Neon / Upstash / Auth.js / Vercel GHA）

你是资深全栈工程师。请按本 Prompt **完整落地**，遵守「最小可上线、可验证、不扩 scope」。

## 目标仓库

GitHub 用户 `MashyGGG`，**单仓** `app-platform`：

- `apps/app-web` — 用户端
- `apps/admin-web` — 管理后台
- `packages/db` — **唯一** Prisma Schema Owner（schema + migrations + seed + 导出 Client）

工具链：**pnpm workspace + Turborepo** + Next.js 15 App Router + TypeScript + Ant Design 5 + `@ant-design/icons` + Tailwind + next-intl（zh/en）。  
各 app 自带 Route Handlers；共用 Neon PostgreSQL + Upstash Redis。  
**禁止**在 `apps/**` 建立第二份 `schema.prisma` / 跑 `migrate`。  
根目录配置 ESLint + Prettier + Husky + lint-staged。

## 硬性技术选型（不要擅自替换）

- Monorepo: pnpm + Turborepo；DB 包名建议 `@app/db`
- UI: antd + `@ant-design/icons` + Tailwind（禁止 shadcn/MUI）；注意 antd 与 Tailwind preflight 协调 + `ConfigProvider` 中/英 locale
- ORM: Prisma **仅**在 `packages/db`；Neon 使用 `DATABASE_URL`（pooled）+ `DIRECT_URL`（migrate）
- Auth: Auth.js v5 — Credentials + Google；**JWT**；两 app 不同 `AUTH_SECRET` 与 cookie 名
- Password: argon2id（不行再 bcrypt）
- Email: Resend；i18n: next-intl；Validation: Zod
- Deploy: Vercel ×2 Project（Root Directory = `apps/app-web` / `apps/admin-web`）；**GHA + Vercel CLI** 做 PR Preview / main Prod

## Schema 同步硬约束

1. 只有 `packages/db` 可改表、可 `migrate`
2. apps 只依赖 `@app/db` 的 Client
3. CI：若 `apps/**/prisma/schema.prisma` 存在 → **失败**；`prisma validate` 必过
4. `push` main 才 `prisma migrate deploy`；PR Preview **不** migrate

## JWT 禁用校验（硬约束）

- 登录时拒绝 `status=disabled`
- **每次**受保护页面/API 鉴权必须再查（或等价强制校验）`User.status`；disabled → 401/登出，**不得**仅靠 JWT 过期
- admin：无 `AdminProfile` 或 user disabled → 拒绝

## 限流契约

| 动作 | 限额 | 窗口 | 响应 |
|---|---|---|---|
| login | 5 | 15min | 429 `{ error: "RATE_LIMITED", messageKey, retryAfterSec }` |
| register | 5 | 1h | 同上 |
| reset-req | 3 | 1h | 同上 |
| reset-confirm | 5 | 15min | 同上 |

键前缀 `rl:auth:`；限流在写库/验密之前。

## 审计契约

写操作必须落库，`action` **仅允许**：  
`APP_USER_UPDATE` | `APP_USER_DISABLE` | `APP_USER_ENABLE` | `ADMIN_USER_CREATE` | `ADMIN_USER_UPDATE_ROLE` | `ADMIN_USER_DISABLE` | `ADMIN_USER_ENABLE`  
`meta` 含 before/after 或 fields；禁止静默丢审计；禁止删审计。

## 功能范围

**app-web：** 注册/登录/Google/忘记密码/重置/登出/Home Hello World；双语；限流；禁用校验。  
**admin-web：** 门禁 + RBAC 三层（middleware + API + UI）；APP 用户管理；后台用户管理（仅 super_admin）；仪表盘缓存 60s；审计只读。  
**不做：** 双仓复制 schema、独立 API 仓、支付、多租户、物理删用户、删审计、自定义域名。

## GitHub Actions

- PR → main：lint + format:check + typecheck + schema 硬约束 → Vercel Preview（两 app）→ PR 评论 URL
- push → main：同上 → `packages/db` migrate deploy → Production（两 app）
- Secrets：`VERCEL_TOKEN`、`VERCEL_ORG_ID`、两 Project ID；Env 在 Vercel 配置

## 交付物

1. 完整 monorepo（`.gitignore`、根 README、`.env.example`、GHA）
2. `packages/db` schema + migration + seed
3. 两 app 可本地运行、可部署
4. E2E 手工清单；说明 Neon/Upstash/Vercel/Google/Resend 配置

## 执行顺序（必须按序勾选）

- [ ] 1. 初始化 monorepo（pnpm/turbo/eslint/prettier/husky）+ 两 app 骨架（antd/icons/tailwind/next-intl）
- [ ] 2. 实现 `packages/db`（schema/migration/seed/导出 Client）；CI schema 硬约束
- [ ] 3. app-web Auth（credentials+Google）+ 限流契约 + JWT 禁用校验
- [ ] 4. app-web 页面：注册/登录/忘记密码/重置/Home
- [ ] 5. admin-web Auth 门禁 + RBAC 三层
- [ ] 6. APP 用户管理、后台用户管理、仪表盘、审计（按契约写 action）
- [ ] 7. GHA + Vercel（两 Root Directory）+ README
- [ ] 8. 自测：禁用后未过期 JWT 不可用；429 契约；AC 全过

## 验收标准（全部满足才算完成）

1. APP 认证流 + 中英可用；禁用用户登录失败且旧 JWT 受保护请求失败
2. 限流返回 429 + `RATE_LIMITED`
3. 无 AdminProfile 进不了后台；operator 不能管后台用户
4. 写操作审计 action 落在枚举内
5. PR Preview + schema check；main migrate + Prod
6. 无 out-of-scope；无第二份 schema；栈不被替换

## 编码约束

- 最小改动、类型安全；错误用 i18n key
- 组件优先 antd；图标只用 `@ant-design/icons`
- 禁止提交密钥；禁止在 apps 内 migrate
- 先本地跑通再补 CI；每步对照 checklist 打勾
````

---

## 你给 AI IDE 前还需准备的账号（人工）

1. GitHub `MashyGGG` 登录态 / PAT（若 AI 代创仓）
2. Neon 项目（Staging + Prod；记下 pooled + direct URL）
3. Upstash Redis（Staging + Prod）
4. Vercel 账号，**两个 Project**（Root Directory 分别设为 `apps/app-web`、`apps/admin-web`），生成 Token
5. Google Cloud OAuth Client ×2（app / admin 回调 URL）
6. Resend API Key + 发件域名（开发可用 onboarding 域名）

配齐后，把上一节 **「落地 Prompt」** 整段粘贴给新 Session 的 AI IDE，并附上：`在 GitHub 账号 MashyGGG 下创建仓库 app-platform 并实现`。
