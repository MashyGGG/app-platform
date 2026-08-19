---
title: 升到 Next.js 15，params 变成了 Promise
date: 2026-04-09
summary: params / searchParams / cookies() / headers() 全部异步化了。报错信息指向的位置，和真正要改的位置不是一个地方。
stage: frontend
level: basic
tags: [nextjs, app-router, 迁移, 破坏性变更]
---

## 现象

升级 Next.js 15 之后，动态路由页面报：

```
Error: Route "/posts/[slug]" used `params.slug`.
`params` should be awaited before using its properties.
```

有时候更隐蔽：不报错，但 `params.slug` 是 `undefined`，页面直接走到 `notFound()`。

## 原因

Next.js 15 把这几个 API 全改成了异步：

- `params`
- `searchParams`
- `cookies()`
- `headers()`
- `draftMode()`

理由是这些值本质上要等请求到达才知道，同步返回会挡住流式渲染。15 里它们返回 Promise，同步访问只能走兼容层（会警告），未来版本直接移除。

## 修法

页面组件本来就可以是 async，改起来不难：

```tsx
// ❌ Next 14
export default function PostPage({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug)
}

// ✅ Next 15
type Params = { params: Promise<{ slug: string }> }

export default async function PostPage({ params }: Params) {
  const { slug } = await params
  const post = getPost(slug)
}
```

容易漏掉的三个地方：

**1. `generateMetadata` 也要改**

```tsx
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  // ...
}
```

**2. `generateStaticParams` 不用改**

它的返回值仍然是同步的普通数组 —— 因为它在构建时跑，不属于请求上下文。这一处不一致我改错过两次。

**3. 类型定义要跟着改**

`params` 的类型必须写成 `Promise<{...}>`。写成 `{...}` 的话 `await` 一个非 Promise 在 TypeScript 里不报错（`await` 对普通值是合法的），于是类型检查通过，运行时行为却取决于 Next 内部有没有走兼容层。**这是个类型系统看不见的 bug。**

官方有个 codemod 能扫一遍：

```bash
npx @next/codemod@canary next-async-request-api .
```

跑完还是要人工过一遍，它认不出被包了一层的用法。

## 教训

1. **框架的破坏性变更，报错位置未必是修改位置。** 这次报错在 `params.slug` 那一行，但真正要改的是函数签名和类型定义。
2. **`await` 一个非 Promise 是合法的 JavaScript。** 所以"加了 await 就不报错了"不代表类型对了 —— 类型标注必须同步改成 `Promise<T>`，否则你只是让编译器闭嘴。
3. **迁移时要问"哪些同族 API 也变了"。** 这次是 `params`、`searchParams`、`cookies`、`headers`、`draftMode` 一起变。只改报错那一个，剩下的会在别的页面上重新出现一遍。
4. 大版本升级前先读 upgrade guide 的 breaking changes 部分再动手，比一个一个报错地修快得多。
