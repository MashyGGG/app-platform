# 实现方案：每日口语日练 MVP（落在 app-platform monorepo）

> 输入规格：[NEW-PRODUCT-daily-speaking-v2.0-standalone.md](NEW-PRODUCT-daily-speaking-v2.0-standalone.md)（下称「SPEC」）
> 本文只回答一件事：**SPEC 的 MVP，在本仓库怎么落。** 产品范围一律以 SPEC 为准，本文不改范围。
> 撰写日期：2026-08-14 · 状态：**已拍板，可开工**（§8 四项已确认）

---

## 1. 本仓库现状（一句话版）

`app-platform` = pnpm + Turborepo，两个 Next.js 15（App Router / React 19）应用共用**一套** Prisma schema 与一个 PostgreSQL：


| 位置                          | 现在有什么                                                   | 对本需求的价值                                 |
| --------------------------- | ------------------------------------------------------- | --------------------------------------- |
| `apps/app-web` (3000)       | 注册 / 登录 / home，next-intl(zh/en) + antd5，NextAuth JWT 会话 | **学生端就长在这里**：i18n、UI、会话、错误信封全部现成        |
| `apps/admin-web` (3001)     | RBAC + 审计日志 + 后台                                        | MVP **不动它**（SPEC §3：运营只需批量导入，不做可视化 CMS） |
| `packages/db`               | 唯一 schema owner + `prisma` 单例 + migrations + seed       | 新表只能加在这里（不可协商约束 1/2）                    |
| `packages/shared`           | 密码、限流、错误信封、zod、redis、email                              | OTP 邮件、限流、`jsonError` 直接复用              |
| `e2e` / `vitest.config.mts` | Playwright 黑盒 + Vitest 纯函数（83 个）                        | SPEC 的 14 条 AC 正好对上这两层                  |


两条验证信号：`pnpm lint && format:check && typecheck && test && build`（+ schema-owner 守卫），以及 `pnpm e2e`。

## 2. SPEC 读下来是什么（MVP 部分）

一个学生、一天一场、8 分钟、五拍：**今日一题 → 可选跟读 → 30–90s 独白 → 只给一个下一步 → 再试或跳过 → 收工**，7 天后一句**模板**进步文案。

工程上真正被约束死的只有 6 件事，其余都是"不做"：

1. **同步出分**：P2 提交 → P3 出现，目标 8s / P95 15s，**超 20s 走降级**（不是失败），落 `degraded_flag`。
2. **恰好一个赢家**：A（听不清）> B（在背稿）> C（没说完），UI 绝不展示第二条。
3. **显式状态机 + 独立失败态**：`NOT_STARTED→WARMUP?→SPEAKING→SCORING→RETRY→COMPLETED`，旁挂 `FAILED` / `DEGRADED`；失败与降级都**不消耗当日资格**。
4. **每次练习一条有主键的记录**（原则 E），禁止 JSON 数组累加。
5. **发音评估必须支持「传入参考文本」的音素模式**（原则 B）；自由说场景先命中 prompt 预挂词，再退化到 ASR 低置信词。
6. **7 天句纯模板、零 LLM**（AC-S8 要能断言"日志无 LLM 调用"）。

验收面：AC-S1…S10 + AC-I1…I4，全部可 pass/fail —— 这决定了下面的测试分层。

## 3. 与本仓库的 3 处正面冲突，及处理


| #   | 冲突                                                         | 处理                                                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | SPEC 决策 2：**独立 App + 独立后端 + 独立数据库，从零搭建**；而你要求落在本项目         | 落在 `apps/app-web`，**但按可拆分方式组织**：所有代码收敛在 `src/app/[locale]/today`、`src/app/[locale]/me`、`src/app/api/speaking/`**、`packages/shared/src/speaking/**`，与现有 auth/home 零耦合。表名统一 `Speaking*` 前缀。将来要独立成新仓，是搬目录 + 搬 6 张表，不是重写。**新表仍必须写在 `packages/db/prisma/schema.prisma`**（不可协商约束 1，`check:schema-owner` 会拦） |
| C2  | SPEC 4.4：**邮箱一次性码、无密码**；本仓库是 email+password + NextAuth JWT | **加一条 OTP 通道，不动现有密码登录**。复用 `VerificationToken`（identifier 命名空间 `otp:<email>`，与现有 `reset:<email>` 同款）+ 现有 email 发信 + 现有限流。验证通过后走 NextAuth credentials 签发**同一个** `app-web.session-token` cookie —— 于是 `requireUser` / `requireApiUser` 两层鉴权原样生效，AUTH_SECRET 隔离（不可协商约束 4）不受影响                            |
| C3  | SPEC 5.3：运营 `POST /ops/import`                             | MVP **不做接口**，做 CLI：`pnpm speaking:import <file.json>`（在 `packages/db`，复用 seed 的连接方式）。理由：走 admin-web 就要动 RBAC 矩阵 + 给 `AuditAction` 闭合枚举加值（要迁移），为 2–3 个内部运营付这个代价不划算，也违反 SPEC 原则 5。校验逻辑（AC-I1）抽成纯函数供 Vitest 直测                                                                                           |


## 4. 技术方案

### 4.1 数据模型（追加到 `packages/db/prisma/schema.prisma`）

```prisma
enum SpeakingSessionStatus { NOT_STARTED WARMUP SPEAKING SCORING RETRY COMPLETED FAILED DEGRADED }
enum SpeakingWinnerType    { A B C }
enum SpeakingRetryState    { PENDING DONE SKIPPED }
enum SpeakingSentenceKind  { warmup paraphrase }

model SpeakingPrompt   { id, text, warmupSentence, modelAudioKey, checklist Json, sort Int, isActive Bool }
model SpeakingWord     { id, lemma @unique, ipa, phonemes Json, audioKey, gloss }
model SpeakingPromptWord { promptId, wordId  @@id([promptId, wordId]) }   // 预挂易错词
model SpeakingSentence { id, promptId, text, audioKey, kind }
model SpeakingSession  { id, userId, promptId, status, audioKey, durationMs, transcript,
                         winnerType, winnerPayload Json, retryAudioKey, retryState,
                         degradedFlag Bool, startedAt, completedAt }
model DailyCompletion  { id, userId, date @db.Date, sessionId, winnerType, retryState
                         @@unique([userId, date]) }   // ← AC-I2 幂等靠它
```

`app_user` 直接用现有 `User`（SPEC 的 app_user 字段是 `User` 的子集）。所有表 `userId` 走 `onDelete: Cascade`，与 `AuditLog` 的 Restrict 无关。

### 4.2 语音链路：一个接口，两个实现（这是整个方案的关键决定）

仓库里没有任何语音厂商凭据，而 CI / e2e / pre-commit 都必须能跑。所以：

```
packages/shared/src/speaking/speech.ts
  interface SpeechProvider {
    transcribe(pcm16k): { text, words: {w, confidence}[] }
    assess(pcm16k, referenceText): { phonemes: {...}[], worstWords: [...] }   // 必须支持参考文本（原则 B）
  }
```

- `stub`（默认，`SPEECH_PROVIDER=stub`）：确定性实现——按音频字节做哈希派生结果，同一输入永远同一输出。**这是 e2e 能断言 AC-S3 / AC-I3 的前提。** 另支持 `SPEAKING_TEST_HOOK=fail|slow` 注入 500 / 25s，专门喂 AC-S6 / AC-S10。
- `azure`（或任意支持音素级 + 参考文本的服务）：生产实现，只在配了 key 时启用。SPEC §5.3 明确不绑厂商。

**赢家判定（A>B>C）与教练语一律走规则层 + 模板，MVP 不接 LLM。** SPEC §4.3 允许小 LLM 做三选一分类，但没有任何一条 AC 依赖它，而规则层可以被 Vitest 表驱动直测、零成本、零延迟。LLM 留在同一个接口后面，Next 阶段再换。→ 这是本文对 SPEC 的**唯一功能性简化**，见 §8 待确认 Q3。

### 4.3 音频：绕开 ffmpeg

SPEC 要「播放用压缩、评分用未压缩 16k」。在 Vercel 上做转码要带 ffmpeg，重且慢。MVP 的做法：**客户端 AudioWorklet 直接采 16k PCM，上传一份 WAV，播放和评分共用**。90 秒 ≈ 2.9MB，可接受。真需要双格式时再在服务端加转码，接口不变。

存储走 `AudioStore` 接口：dev/e2e 落 `.data/audio/`（git-ignored），生产用 **Vercel Blob**（已定，见 §8）。库里只存 key + 时长。

**保留策略（因 Vercel Blob Hobby 只有 1 GB，必须有）**：录音只保留 **7 天**——这正好是 `/me` 周视图需要的窗口，过期音频由 `speaking:prune` 定时任务删除，`SpeakingSession.audioKey` 置空但记录本身永久保留（原则 E 不受影响）。7 天 × 30 人/天 × 2 条（首说 + 再试）× 2.9 MB ≈ 1.2 GB —— 已经压线，所以 §4.4 里把「每天活跃 ≤ 20 人」写成红线之一。

### 4.4 免费资源清单（MVP 全程零付费，2026-08 核对）


| 依赖                 | 选型                  | 免费额度                                           | 够不够 / 注意                                                                                                 |
| ------------------ | ------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **邮件（OTP）**        | **Resend**（仓库已集成）   | 3,000 封/月、**100 封/天**、1 个自定义域名、日志留 30 天        | 百~千学生的登录码够用；**100/天是硬顶**。本地/CI 无 `RESEND_API_KEY` 时现有代码直接打印到 console（`email.ts:48`），所以开发与 e2e 本来就零成本、零发信 |
| 邮件备选               | Brevo               | **300 封/天**（9,000/月）含 API                      | 日发信量顶到 Resend 上限时切它；抽象成 `EmailSender` 接口，改 env 即可                                                        |
| **语音（ASR + 音素评估）** | **Azure Speech F0** | STT **5 音频小时/月**、TTS 50 万字符/月、发音评估在 F0 可用不额外收费 | **这是最紧的一环**：5h ≈ 200 次 90 秒会话/月。且 F0 **并发只有 1**，超了返回 429 —— 必须做重试 + 排队，或验证期只放 20–30 个种子用户                |
| 语音（开发/CI）          | 仓库内 `stub` provider | 无限                                             | M0–M4 全部验收不碰 Azure，pre-commit / CI / e2e 永远免费                                                            |
| **音频存储**           | **Vercel Blob**（已定） | Hobby **1 GB 存储 + 10 GB/月 传输**                | 16k WAV 90s ≈ 2.9MB → 仅约 **340 条**常驻。**必须配 7 天保留策略**（§4.3）。换来的是零新增供应商、与托管同源、`@vercel/blob` 三行接完 |
| Postgres           | Neon 免费档            | —                                              | 仓库现状即如此                                                                                                  |
| Redis（限流）          | Upstash 免费档         | —                                              | 仓库现状即如此                                                                                                  |
| 托管                 | Vercel Hobby        | —                                              | 免费但**禁止商业用途**；一旦要收费/对外经营需升 Pro                                                                           |


**结论：MVP 阶段真实花费 = ¥0**，前提是四条红线不破：

1. 邮件 ≤ **100 封/天**（Resend 硬顶，超了切 Brevo）
2. 语音 ≤ **5 音频小时/月**（Azure F0，≈200 次会话），且**并发 1**
3. 音频常驻 ≤ **1 GB**、月传输 ≤ **10 GB**（Vercel Blob Hobby）
4. 由 2、3 反推：**验证期日活控制在 20 人以内、种子用户 20–30 个**

四者都在埋点里计数，接近阈值先降级（语音额度耗尽 → 当日改走 stub/纯规则反馈并明确提示；Blob 接近满 → 提前 prune 到 3 天），**不报错**。

> 额度保护同时说明为什么 §4.2 的 stub provider 不是"测试玩具"：它是**免费额度的兜底运行模式**。

### 4.5 路由与 API

```
/[locale]/today          唯一主页（登录后落地）· force-dynamic
/[locale]/today/result   可深链，但「再试」不跳路由（AC-S4）
/[locale]/me             7 天模板句 + 完成日历（只读）
/[locale]/auth           邮箱 + 6 位码
```


| 方法   | 路径                                       | 说明                                                                |
| ---- | ---------------------------------------- | ----------------------------------------------------------------- |
| POST | `/api/auth/otp/request`                  | 发码；限流新增 budget `otp-req` 3/h，**在任何 DB 读之前执行**（复用 rate-limit 既有纪律） |
| POST | `/api/auth/otp/verify`                   | 校验 → 首次即建号 → 签发 app-web cookie（AC-S9）                             |
| GET  | `/api/speaking/today`                    | 今日 prompt + 热身素材 + 当日 session（`dayIndex % N` 轮转 + 近 7 天不重复）       |
| POST | `/api/speaking/sessions`                 | 当日幂等取回/创建（AC-I2，靠 `DailyCompletion` + session 唯一约束）               |
| POST | `/api/speaking/sessions/{id}/audio`      | 同步返回 `{winnerType, coachLine, retryItems[]}`                      |
| POST | `/api/speaking/sessions/{id}/retry`      | 再试 → COMPLETED                                                    |
| POST | `/api/speaking/sessions/{id}/skip-retry` | 跳过 → COMPLETED，`retryState=SKIPPED`（AC-S5）                        |
| GET  | `/api/speaking/me/week`                  | 7 天模板句 + 日历                                                       |


全部错误走 `packages/shared/src/errors.ts` 的 `{error, messageKey}` 信封，前端用 next-intl 翻译（服务端不出人话文案）。所有受保护路由 `export const dynamic = 'force-dynamic'` + `requireApiUser()`。

**20s 降级**（AC-S10）是**客户端计时**：接口继续跑，前端到 20s 弹「网络有点慢，可以先跳过或稍后重试」，同时打一次 `PATCH degradedFlag`；结果回来时用户还在页面就照常渲染。这与「接口报错→FAILED」是两条独立分支，不合并。

### 4.6 测试分层（直接映射 AC）

- **Vitest（纯函数，无 DB）**：赢家判定表（A>B>C 边界）、7 天模板句计数（4A/2B/1C → AC-S8）、`dayIndex % N` + 近 7 天不重复轮转（AC-I4）、导入校验器（AC-I1）、OTP 码生成/过期、i18n key 契约。
- **Playwright（跨边界）**：AC-S1…S7、S9、S10、I2、I3 —— 用 stub provider + `SPEAKING_TEST_HOOK` 注入 500 / 25s。麦克风用 `--use-fake-device-for-media-capture` + fake wav。
- AC-S2 的 `home_to_recording_ms ≤ 10000` 落成埋点事件，e2e 断言事件存在且达标。

## 5. 交付顺序（每步都留一个可跑的验证信号）


| 步   | 内容                                                     | 验证                                  |
| --- | ------------------------------------------------------ | ----------------------------------- |
| M0  | Prisma 新表 + migration + `speaking:import` CLI + 21 题种子 | `pnpm db:migrate`、AC-I1/I4 的 Vitest |
| M1  | OTP 登录（request/verify + 限流 + 页面）                       | AC-S9 的 e2e                         |
| M2  | `/today` + 录音 + stub 评分 + 赢家规则                         | AC-S1/S2/S3                         |
| M3  | 当屏再试 / 跳过 / 收工 + `/me` 模板句                             | AC-S4/S5/S8                         |
| M4  | 热身拍、FAILED、DEGRADED                                    | AC-S6/S7/S10                        |
| M5  | Azure Speech 接线（有 key 才启用）+ 排队退避 + `speaking:prune` + 文档 | 手工跑 SPEC §12 的 11 步                 |


M0–M4 全程不需要任何语音厂商凭据 —— 这是刻意的：MVP 的全部验收都能在 CI 里跑绿。

## 6. 明确不做（与 SPEC §14 一致，加两条本仓库特有的）

SPEC §14 全部照搬；另加：**不动 admin-web、不动 RBAC 矩阵、不给 `AuditAction` 加枚举值、不新建第二个 Next 应用、不新建第二个 Prisma schema。**

## 7. 主要风险


| 风险                   | 影响                 | 缓解                                            |
| -------------------- | ------------------ | --------------------------------------------- |
| 浏览器录音权限/编码在移动端差异大    | 直接打 AC-S2 的 10s 目标 | AudioWorklet + 主流机型手测；不做多层弹窗（SPEC §4.3 已定死流程） |
| 真实 provider 的 P95 延迟 | 8s / 15s 目标        | 降级路径（AC-S10）先于 provider 接线做好，延迟超标不阻塞发布        |
| Vercel Blob 免费档仅 1 GB | 上线 ~340 条录音后写入失败    | `AudioStore` 接口 + **7 天保留 + `speaking:prune`**（§4.3）；容量埋点，逼近上限自动缩到 3 天。接口不变，将来换 R2/S3 是改一个实现 |
| Azure F0 并发 = 1        | 两人同时提交 → 429       | 服务端排队 + 指数退避重试；退避耗尽走 DEGRADED（已有分支），不新增失败态                                          |
| 21 题内容没人产            | 上线即空               | M0 的 CLI + 校验先行，内容缺项直接被拒（AC-I1）               |


## 8. 已确认决策（2026-08-14 拍板）


| #  | 决策                                                    | 影响                                                                                 |
| -- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Q1 | **落在 `apps/app-web`**，按 §3-C1 的可拆分方式组织                 | 不新建 app，不新建 Vercel 项目；`Speaking*` 前缀 + 目录收敛保证将来可整体搬走                                |
| Q2 | **音频存储用 Vercel Blob**                                 | 与托管同源、零新增供应商；代价是免费档只有 1 GB，因此 **7 天保留 + `speaking:prune` 成为 MVP 必做项**（§4.3、§7）      |
| Q3 | **三选一分类与教练语 = 规则 + 模板，MVP 不接 LLM**                    | 确认 §4.2 的简化。规则表由 Vitest 表驱动直测；LLM 位置留在同一接口后，Next 阶段再换。AC-S8「日志无 LLM 调用」因此天然成立      |
| Q4 | **语音服务用 Azure Speech**（F0 免费档起步）                      | 音素级 + 参考文本（原则 B）最成熟；受 5 音频小时/月 + **并发 1** 约束，故 M5 必须含排队退避，验证期日活 ≤ 20              |


> Q2 与前一版建议（Cloudflare R2，10 GB + 零出站）不同。选 Vercel Blob 是拿容量换运维简单，本文已按此调整 §4.3 / §4.4 / §7；一旦录音量超 1 GB，换 R2 只需替换 `AudioStore` 的一个实现。

---

**下一步**：开新 session 从 M0 做起（本文即为该 session 的输入依据）。