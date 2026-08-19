import type { Stage } from './post-meta'

export type RoadmapItem = {
  id: string
  title: string
  /** Why this block exists at all — the thing a topic list never tells you. */
  why: string
  topics: string[]
  /** The pass/fail signal. "I read about it" is not a checkpoint; this is. */
  deliverable: string
  /** Post slug in this blog that covers it, once written. */
  post?: string
}

export type RoadmapStage = {
  id: Stage
  order: number
  label: string
  tagline: string
  /** Rough calendar budget at ~1h/day. Honest, not aspirational. */
  budget: string
  items: RoadmapItem[]
}

/**
 * The learning path, in the order it is meant to be walked.
 *
 * Sequenced from the public roadmaps (roadmap.sh Docker / DevOps, the 2026
 * full-stack roadmaps) but pruned hard: everything here is either something
 * this monorepo already uses, or something whose absence has already cost me
 * time. A roadmap you cannot finish is a reading list, not a plan.
 */
export const ROADMAP: RoadmapStage[] = [
  {
    id: 'docker',
    order: 0,
    label: '第 0 阶段 · Docker 与容器',
    tagline: '入口。不是因为它最重要，而是因为后面每一站都默认你已经会它。',
    budget: '4–6 周',
    items: [
      {
        id: 'docker-mental-model',
        title: '心智模型：容器到底是什么',
        why: '把容器当"轻量虚拟机"是所有后续误解的源头 —— 它其实只是一个被 namespace 隔离、被 cgroup 限量的普通进程。想通这一点，"为什么容器里 ps 只看得到一个进程"、"为什么容器没有自己的内核"、"为什么 PID 1 收不到信号就杀不掉"全都不用再背。',
        topics: [
          '裸机 / 虚拟机 / 容器三者的边界',
          'namespace（pid / net / mnt / uts / ipc / user）',
          'cgroup v2 与资源限额',
          'UnionFS / OverlayFS 与镜像分层',
          'OCI 规范：镜像、运行时、分发',
          'Docker Engine / containerd / runc 的分工',
        ],
        deliverable:
          '能不查文档说清：docker run 敲下回车后，到进程真正跑起来，中间发生了哪几件事。',
        post: 'container-mental-model',
      },
      {
        id: 'docker-cli',
        title: '日常操作：镜像、容器、卷、网络',
        why: '这一层是肌肉记忆。练不熟的代价不是"不会"，而是出问题时你在生产环境上现查参数。',
        topics: [
          'run / exec / logs / inspect / cp / stats',
          '镜像与容器的生命周期，以及 prune 的杀伤范围',
          'volume vs bind mount vs tmpfs',
          'bridge / host / none，以及自定义网络下的服务名 DNS',
          '端口发布 -p 与容器间互访的区别',
        ],
        deliverable: '不用 Compose，纯 CLI 起一套 app + postgres + redis 并让它们互相连通。',
        post: 'docker-cli-daily-driver',
      },
      {
        id: 'dockerfile',
        title: 'Dockerfile：分层、缓存、多阶段构建',
        why: '这是 Docker 里唯一真正需要"设计"的地方。写法决定构建从 4 分钟变 20 秒，镜像从 1.2 GB 变 180 MB。',
        topics: [
          '每条指令 = 一层；一层失效，后面全部失效',
          '依赖清单先 COPY、源码后 COPY 的缓存顺序',
          '多阶段构建：builder / runner 分离',
          '.dockerignore（漏了它，node_modules 会进构建上下文）',
          'ENTRYPOINT vs CMD、exec form vs shell form 与信号传递',
          'USER 非 root、HEALTHCHECK、构建期 secret',
          'BuildKit 缓存挂载与跨机器缓存复用',
        ],
        deliverable:
          '给本仓库的 Next.js 应用写一个多阶段 Dockerfile：镜像 < 250 MB、以非 root 运行、改一行源码重建 < 30 秒。',
        post: 'dockerfile-layers-and-cache',
      },
      {
        id: 'compose',
        title: 'Docker Compose：本地环境即代码',
        why: '全栈开发者收益最快的一块 —— 一条命令拉起前端、后端、数据库、缓存，新同事第一天就能跑起来。本仓库的 docker compose up -d 就是干这个的。',
        topics: [
          'services / volumes / networks / profiles',
          'depends_on 与 healthcheck 的真实语义（前者不等人，后者才等）',
          '.env、变量插值与 env_file 的优先级',
          '多文件叠加 -f a.yml -f b.yml 与 override 规则',
          '开发用 compose 和生产用 compose 为什么不该是同一个文件',
        ],
        deliverable:
          '读懂本仓库的 docker-compose.yml / docker-compose.apps.yml / docker-compose.remote.yml，说清三者分别解决什么问题。',
        post: 'compose-local-stack',
      },
      {
        id: 'docker-prod',
        title: '生产化：安全、体积、可观测',
        why: '生产事故基本集中在这一节：root 用户、:latest 标签、没有资源上限、没人处理的 healthcheck、写爆磁盘的日志。',
        topics: [
          '不用 :latest：语义化标签 + digest 固定',
          '非 root + 只读根文件系统 + 丢弃多余 capability',
          '镜像扫描（trivy / docker scout）与最小基镜像（distroless 和 alpine 的取舍）',
          '资源限额 --memory / --cpus，以及 OOMKilled 的排查',
          '日志驱动与轮转；stdout 才是容器的日志出口',
          '构建期 secret 不要留在镜像层里',
        ],
        deliverable: '对自己的镜像跑一次 trivy，把 HIGH 以上的问题清零，并记录每一条是怎么清的。',
        post: 'docker-production-checklist',
      },
    ],
  },
  {
    id: 'frontend',
    order: 1,
    label: '第 1 阶段 · 前端（已有优势，补的是"工程"）',
    tagline: '会写页面不等于会交付页面。这一段补的是边界、性能和构建。',
    budget: '3–4 周',
    items: [
      {
        id: 'rsc-boundary',
        title: 'RSC 边界：Server / Client Component',
        why: 'Next.js App Router 最贵的一课。边界画错，密钥泄进浏览器、或者整棵树意外变成客户端组件、bundle 直接翻倍。',
        topics: [
          "'use client' 是边界不是标记：它之下全部是客户端",
          '服务端组件里能读 DB / env，客户端不能',
          'props 必须可序列化；函数传不过去',
          'Streaming、Suspense 与 loading.tsx',
          'force-dynamic / revalidate 与缓存语义',
        ],
        deliverable: '拿本仓库任一页面，画出它的 server/client 边界图，并解释每条边为什么在那里。',
      },
      {
        id: 'perf-cwv',
        title: '性能与 Core Web Vitals',
        why: '"感觉有点慢"不是工程语言。LCP / INP / CLS 才是。',
        topics: [
          'LCP / INP / CLS 各自的成因与修法',
          '图片与字体优化，尺寸占位消除布局抖动',
          '代码分割、动态 import、bundle 分析',
          '缓存头：immutable 静态资源 vs 动态 HTML',
        ],
        deliverable: '对一个真实页面跑 Lighthouse，写下三条改动的前后数字对比。',
      },
      {
        id: 'fe-build',
        title: '构建与依赖：monorepo 的现实',
        why: 'pnpm 的严格 node_modules、Turborepo 的任务图、workspace 包的编译 —— 这三样在本仓库每一条都咬过人。',
        topics: [
          'pnpm workspace 与严格 node_modules 的解析规则',
          'Turborepo 任务依赖 dependsOn: ["^build"] 与缓存命中',
          'transpilePackages 与 serverExternalPackages 的分工',
          'lockfile 冲突与 --frozen-lockfile',
        ],
        deliverable: '解释本仓库为什么必须从根目录构建，而不能进 apps/app-web 直接 next build。',
      },
    ],
  },
  {
    id: 'backend',
    order: 2,
    label: '第 2 阶段 · 后端',
    tagline: '数据正确性 > 功能数量。这一段全部围绕"错了会不会被发现"。',
    budget: '6–8 周',
    items: [
      {
        id: 'sql-and-schema',
        title: 'SQL、索引与迁移',
        why: 'ORM 会替你写 SQL，不会替你背慢查询。索引和事务是后端唯一不能外包的知识。',
        topics: [
          '索引结构与 EXPLAIN ANALYZE 的读法',
          '事务隔离级别与真实会遇到的并发异常',
          'N+1 查询的识别与修复',
          '迁移：expand / contract，为什么不能在同一个版本里删列',
          '连接池：pooled URL 与 direct URL 的区别',
        ],
        deliverable: '给本仓库的一次真实查询跑 EXPLAIN，加一个索引，记录前后耗时。',
      },
      {
        id: 'auth',
        title: '认证与授权',
        why: '"有 cookie"不等于"有权限"。本仓库的两层鉴权模型就是这句话的产物。',
        topics: [
          'Session vs JWT，以及 JWT 无法即时吊销带来的后果',
          '边缘层路由拦截 vs 服务端权威校验',
          'RBAC 矩阵作为唯一事实来源，同时驱动路由、API 和菜单',
          'cookie 属性：HttpOnly / SameSite / Secure / __Secure- 前缀',
          '密码哈希（argon2）与限流的先后顺序',
        ],
        deliverable: '说清本仓库为什么 /api/auth/login 是自己写的，而不是用 Auth.js 的默认端点。',
      },
      {
        id: 'api-design',
        title: 'API 契约与错误模型',
        why: '错误返回是 API 的一部分。服务端返回人话文案，就等于把 i18n 焊死在后端。',
        topics: [
          '统一错误信封与错误码 → HTTP 状态映射',
          '幂等性与重试安全',
          '限流预算与 429 / Retry-After',
          '输入校验放在边界（zod）而不是散落在业务里',
        ],
        deliverable: '给一个新端点写完整的错误分支表，并保证每个分支都有测试覆盖。',
      },
      {
        id: 'testing',
        title: '测试分层',
        why: '测试的价值不在数量，在能否给出 pass/fail 信号。本仓库把纯函数留给 Vitest、跨边界留给 Playwright，就是这个原因。',
        topics: [
          '单元测试只测纯函数：边界表、解析器、契约',
          '端到端测试跨边界：两个应用、两个 cookie、真实数据库',
          '为什么 mock 掉的 Prisma 测试基本没有信息量',
          'CI 里的可复现环境：service container + 一次性数据库',
        ],
        deliverable: '给一段自己写的解析逻辑补一张边界表测试，至少包含一个"静默失败"用例。',
      },
    ],
  },
  {
    id: 'ops',
    order: 3,
    label: '第 3 阶段 · 运维',
    tagline: 'Docker 之后真正的运维路线：Linux → CI/CD → 编排 → IaC → 可观测。',
    budget: '8–12 周',
    items: [
      {
        id: 'linux-net',
        title: 'Linux 与网络基本功',
        why: '所有容器问题最后都会退化成 Linux 问题：权限、文件描述符、端口、DNS、路由。跳过这一节，后面每个报错都得靠搜。',
        topics: [
          '权限与属主（bind mount 权限问题的根源）',
          '进程、信号、PID 1 与优雅退出',
          'ss / dig / curl -v / tcpdump 的最小可用集',
          'DNS 解析顺序、/etc/hosts、容器内的 resolv.conf',
          'systemd 基础与开机自启',
        ],
        deliverable: '不重启容器，定位一次"端口通但请求 502"的问题，写下完整排查路径。',
      },
      {
        id: 'cicd',
        title: 'CI/CD 流水线',
        why: '"能在我机器上跑"是最贵的一句话。流水线的价值就是把它变成"能在任何机器上跑"。',
        topics: [
          'GitHub Actions：job / step / service container / cache',
          '质量门禁的顺序：快的先跑，慢的后跑',
          '构建产物与部署产物的分离',
          '发布触发：为什么 push 到 main 不该自动上生产',
          '迁移先于部署，以及中间那段窗口期的兼容性要求',
          '每个 job 都要有超时（否则一次卡死能跑满六小时）',
        ],
        deliverable:
          '读懂本仓库的 .github/workflows/ci.yml，说清 migrate 和 deploy 为什么必须串行。',
        post: 'ci-pipeline-lessons',
      },
      {
        id: 'orchestration',
        title: '编排：Compose 之后',
        why: '单机 Compose 能撑到比想象中远得多的地方。什么时候该上 K8s 是个成本问题，不是技术品味问题。',
        topics: [
          '什么时候 Compose 就够了，什么时候不够',
          'Kubernetes 核心对象：Pod / Deployment / Service / Ingress / ConfigMap / Secret',
          'liveness / readiness / startup 三种探针的区别',
          'requests 与 limits，以及 OOMKilled 和 CPU throttling',
          '滚动更新与回滚',
        ],
        deliverable: '把第 0 阶段的镜像部署到本地 kind / k3d 集群，能滚动更新并回滚。',
      },
      {
        id: 'iac',
        title: '基础设施即代码',
        why: '点控制台点出来的环境，没人知道它现在长什么样。IaC 的价值是可 diff、可 review、可重建。',
        topics: [
          'Terraform：state、plan/apply、模块化',
          '声明式与幂等到底意味着什么',
          '密钥管理：不进仓库、不进镜像层、不进日志',
          '环境分层（dev / staging / prod）与变量注入',
        ],
        deliverable: '用 Terraform 声明一个最小的云资源，销毁后再重建，确认结果一致。',
      },
      {
        id: 'observability',
        title: '可观测性',
        why: '没有可观测性的系统，故障时只能靠猜。日志、指标、链路是三种不同的问题，不要用一种去回答另一种。',
        topics: [
          '结构化日志与关联 ID',
          '指标：Prometheus 数据模型、四个黄金信号',
          'Grafana 面板与告警阈值的定法',
          '分布式链路追踪与 OpenTelemetry',
          'SLI / SLO / 错误预算',
        ],
        deliverable:
          '给一个服务加上 /metrics，配一条真正值得深夜叫醒你的告警，并解释阈值怎么来的。',
      },
    ],
  },
  {
    id: 'architecture',
    order: 4,
    label: '第 4 阶段 · 架构',
    tagline: '前面四段是"怎么做"，这一段是"为什么这么做，以及代价是什么"。',
    budget: '持续',
    items: [
      {
        id: 'tradeoffs',
        title: '权衡与取舍',
        why: '架构没有正确答案，只有代价清单。能把代价说清楚的人，才算做了架构决策。',
        topics: [
          '单体 / 模块化单体 / 微服务的真实分界线',
          'CAP 与最终一致性在业务上的含义',
          '同步调用 vs 消息队列',
          '缓存策略与失效：穿透、击穿、雪崩',
          '幂等、重试、退避与死信队列',
        ],
        deliverable:
          '给本仓库写一份 ADR：为什么两个应用共用一个数据库，代价是什么，什么条件下该拆。',
      },
      {
        id: 'reliability',
        title: '可靠性设计',
        why: '系统不是不出故障，而是出故障时不要一起死。',
        topics: [
          '超时、重试、熔断、隔板',
          '优雅降级与功能开关',
          '备份与恢复演练（没演练过的备份等于没有备份）',
          '容量规划与压测',
        ],
        deliverable: '给一个依赖注入故障（拔掉 redis），确认应用降级而不是 500。',
      },
      {
        id: 'delivery',
        title: '交付与演进',
        why: '架构是活的。真正的能力是"在不停机的前提下改掉它"。',
        topics: [
          'expand / contract 式数据迁移',
          '蓝绿、金丝雀与影子流量',
          '契约测试与向后兼容',
          '技术债的记账方式：ADR + TODO，而不是口头承诺',
        ],
        deliverable: '设计一次"改字段类型且不停机"的迁移方案，写清每一步的回滚点。',
      },
    ],
  },
]

export const STAGE_LABELS: Record<Stage, string> = {
  docker: 'Docker',
  frontend: '前端',
  backend: '后端',
  ops: '运维',
  architecture: '架构',
}

export function stageById(id: Stage): RoadmapStage | undefined {
  return ROADMAP.find((s) => s.id === id)
}
