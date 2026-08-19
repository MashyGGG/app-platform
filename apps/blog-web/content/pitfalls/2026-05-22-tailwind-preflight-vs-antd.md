---
title: 加上 Tailwind 之后，Ant Design 的按钮全变透明了
date: 2026-05-22
summary: 两套 CSS reset 打架。Tailwind 的 preflight 把 button 的背景清零，而 antd 的样式没有把它抢回来。
stage: frontend
level: basic
tags: [tailwind, antd, css, reset]
---

## 现象

项目本来用 Ant Design。为了排版方便引入 Tailwind，装完的那一刻：

- 所有 `<Button>` 背景色没了，只剩一圈边框。
- `<h1>`–`<h6>` 全变成正文大小。
- 部分组件的边框消失。

组件库版本没动，一行业务代码都没改。

## 排查

Tailwind 的 base 层里有一份叫 **preflight** 的 CSS reset（基于 modern-normalize）。它做的事情之一是：

```css
button,
[type='button'] {
  background-color: transparent;
  background-image: none;
}

h1,
h2,
h3,
h4,
h5,
h6 {
  font-size: inherit;
  font-weight: inherit;
}
```

这是刻意设计 —— Tailwind 假设你所有样式都用工具类写，所以先把浏览器默认样式抹平。

而 antd 也有自己的一套 reset，并且它的组件样式是靠 CSS-in-JS 在运行时注入的。两份 reset 相遇时，谁赢取决于插入顺序和优先级 —— 而 preflight 在这几个选择器上正好赢了。

## 修法

关掉 preflight，只把 Tailwind 当布局工具用：

```ts
// tailwind.config.ts
export default {
  content: ['./src/**/*.{ts,tsx}'],
  // Ant Design 自带 reset。preflight 会和它打架（按钮、标题、边框），
  // 所以这里只用 Tailwind 的布局/间距能力。
  corePlugins: { preflight: false },
} satisfies Config
```

代价是要清楚地知道自己放弃了什么：`box-sizing: border-box` 的全局设置、图片的 `display: block`、以及一堆浏览器默认值的抹平。实践下来 antd 自己的 reset 覆盖了绝大部分，没出过问题。

## 反过来的情况

这个博客应用（`apps/blog-web`）**没有** antd，只有 Markdown 渲染出来的 HTML。这时候情况正好相反：需要 preflight，而且需要 `@tailwindcss/typography` 来给正文排版。

```ts
export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'media',
  plugins: [typography], // preflight 保持开启
} satisfies Config
```

同一个 monorepo 里两个应用配置相反，是对的 —— 因为它们的约束不同。**统一配置本身不是目标。**

## 教训

1. **一个页面上只能有一套 CSS reset。** 引入任何带 reset 的库之前，先确认现有的是哪一套。
2. **症状会指向根因。** "按钮透明 + 标题变小 + 边框消失"这个组合是 preflight 的指纹，认出来就不用二分查找了。遇到大面积样式异常，先去 devtools 里看那个元素的 computed style 是被哪条规则改的。
3. **配置的正确性取决于上下文，不取决于一致性。** 同一个 monorepo 里，用组件库的应用关掉 preflight、纯内容的应用开着它，两边都对。
4. 把原因写进配置文件的注释里。这种"为什么关掉一个看起来该开的开关"的决定，半年后没人记得，很容易被"顺手清理一下"改回去。
