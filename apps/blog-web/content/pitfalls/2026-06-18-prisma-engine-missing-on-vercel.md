---
title: 本地好好的，Vercel 上报 Query Engine 找不到
date: 2026-06-18
summary: Prisma 的查询引擎是个 .node 二进制，靠 import 追踪不到；而且 Windows 上生成的产物没有 Linux 的引擎。
stage: ops
level: intermediate
tags: [prisma, vercel, 部署, 打包, monorepo]
---

## 现象

本地 `pnpm build && pnpm start` 一切正常。部署到 Vercel 之后，任何碰数据库的页面直接 500：

```
Query engine library for current platform "rhel-openssl-3.0.x" could not be found.
```

或者另一种表现：

```
Cannot find module '.prisma/client/default'
```

## 排查

两个独立的问题叠在一起了，分开看才理得清。

### 问题 A：文件追踪抓不到 `.node` 二进制

Next.js 的 `outputFileTracing` 靠**静态分析 import 图**来决定哪些文件要打进 serverless function。Prisma 的查询引擎是运行时用路径拼出来再加载的原生二进制，import 图里根本不存在这条边。

于是构建成功、部署成功、一跑就说引擎不见了。

### 问题 B：在哪台机器上 generate 的，就只有那台机器的引擎

`prisma generate` 默认只生成**当前平台**的引擎。在 Windows 上开发、在 Windows 上 generate，产物里只有 Windows 的引擎。传到 Linux 上自然没有。

## 修法

三处配合，缺一不可。

**1. schema 里声明目标平台**

```prisma
generator client {
  provider      = "prisma-client-js"
  output        = "../generated/client"
  binaryTargets = ["native", "rhel-openssl-3.0.x"]
}
```

`native` 保证本地能跑，`rhel-openssl-3.0.x` 是 Vercel 的运行环境。这样在 Windows 或 macOS 上 generate 出来的产物也是可部署的。

**2. 构建前把引擎拷到应用目录**

```json
{
  "scripts": {
    "build": "node ../../scripts/copy-prisma-engine.mjs && next build"
  }
}
```

**3. 显式告诉 Next 把它带上**

```ts
const nextConfig: NextConfig = {
  serverExternalPackages: ['@prisma/client', '@node-rs/argon2'],
  outputFileTracingRoot: path.resolve(process.cwd(), '../../'),
  outputFileTracingIncludes: {
    '/**/*': ['./generated/client/**/*'],
  },
}
```

三件事各管一段：`serverExternalPackages` 让 webpack 别去打包原生模块（打包了就会在解析 `.node` 时炸）；`outputFileTracingRoot` 让追踪范围覆盖整个 monorepo 而不是单个 app 目录；`outputFileTracingIncludes` 是唯一真正把引擎塞进部署产物的那一行。

## 附带的一个坑：Vercel 项目的构建命令

Vercel 项目的 Root Directory 设成了 `apps/app-web`，那么很自然会把 Build Command 写成 `pnpm build`。

**不行。** 那样解析到的是这个 app 自己的 `next build`，会跳过 `@app/db#generate` —— Prisma client 压根没生成。

必须回到仓库根走 turbo：

```
cd ../.. && pnpm turbo run build --filter=app-web
```

同时项目设置里要开 "Include source files outside of the Root Directory"，否则 `packages/` 根本不会被上传。

## 教训

1. **原生二进制（`.node`、`.wasm`、可执行文件）永远不在 import 图里。** 任何基于静态分析的打包器都看不见它们，必须手动声明。这条对 sharp、argon2、esbuild、各种 CLI 都成立。
2. **"在哪台机器上生成"是构建产物的一个隐藏输入。** 交叉平台的产物必须显式声明目标平台，不能指望默认值。
3. **monorepo 里，构建入口在根，不在应用目录。** 从子目录构建看起来能跑，实际是跳过了依赖包的构建步骤 —— 而它恰好在本地已经跑过一次，所以本地看不出来。
4. 一个通用信号：**"本地好好的，线上不行"，先怀疑构建产物的内容差异，而不是代码逻辑。** 对比 `.next` 目录、对比 `node_modules` 里到底有什么，比读代码快得多。
