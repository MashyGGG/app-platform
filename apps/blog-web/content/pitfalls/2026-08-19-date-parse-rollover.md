---
title: Date.parse('2026-02-31') 不返回 NaN
date: 2026-08-19
summary: 一个不存在的日期被 V8 悄悄滚成了 3 月 3 日。校验函数因此放行，被这个博客自己的第一批单元测试当场抓住。
stage: backend
level: basic
tags: [javascript, 日期, 校验, 单元测试, 静默失败]
---

## 现象

给这个博客写 frontmatter 校验的时候，日期校验是这么写的：

```ts
if (!ISO_DATE.test(date)) errors.push('date 必须形如 YYYY-MM-DD')
else if (Number.isNaN(Date.parse(date))) errors.push(`date 不是真实存在的日期: ${date}`)
```

看起来挺严谨：先卡格式，再卡"是不是真实日期"。

然后单元测试红了：

```
× rejects impossible date and names the offending key
  AssertionError: expected true to be false
```

也就是说 `2026-02-31` **通过了校验**。

## 原因

`Date.parse('2026-02-31')` 不返回 `NaN`。V8 会把 2 月 31 日**滚动**成 3 月 3 日，然后返回一个完全合法的时间戳。

```js
new Date('2026-02-31').toISOString()
// → '2026-03-03T00:00:00.000Z'
```

规范里对 ISO 格式的日期是要求判非法的，但实现在这里落到了宽松的回退解析路径上。结论很简单：

> **`Date.parse` 能判断"能不能解析"，不能判断"是不是真实存在的日期"。**

## 修法

解析回去再比一遍。日期被滚动过，年月日就对不上了：

```ts
export function isRealDate(iso: string): boolean {
  if (!ISO_DATE.test(iso)) return false
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}
```

用 `Date.UTC` 而不是本地时区的构造函数，否则跨时区跑测试会飘。

## 同一批测试还抓出了第二个

日期格式化函数原来是这么写的：

```ts
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${y} 年 ${Number(m)} 月 ${Number(d)} 日` : iso
}
```

传 `'not-a-date'` 进去，`split('-')` 得到 `['not', 'a', 'date']`，三个都是真值，于是渲染出：

```
not 年 NaN 月 NaN 日
```

看起来像渲染 bug，实际上是数据 bug —— 而且会让人往完全错误的方向排查。

修法是先卡格式再格式化：

```ts
if (!ISO_DATE.test(iso)) return iso
```

## 教训

1. **"能解析"和"合法"是两个问题。** 这条不止适用于日期：`parseInt('12abc')` 是 12，`JSON.parse('1')` 是合法的但不是对象，`new URL('http://')` 也能构造出来。宽松解析器一律要在外面再套一层语义校验。
2. **滚动（rollover）是一类隐蔽的静默失败。** 输入非法，输出合法，没有任何异常。这类 bug 只能靠边界表测出来，靠 code review 看不出来。
3. **格式化函数要对垃圾输入闭嘴，而不是编造输出。** 渲染出 `NaN` 会把排查引到 UI 层，原样透传至少能让人一眼看出是数据脏了。
4. 这两个 bug 都是**在写第一批单元测试的过程中被发现的**，写完代码到测试红只隔了几分钟。这正是本仓库把"边界表 + 静默失败解析器"划给单元测试的原因 —— 这类问题 E2E 测不出来，review 也看不出来。
