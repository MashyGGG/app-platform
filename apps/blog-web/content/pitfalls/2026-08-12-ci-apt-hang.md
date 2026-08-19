---
title: CI 里 apt 卡死 50 分钟，而 timeout 杀不掉它
date: 2026-08-12
summary: playwright install --with-deps 背后是 sudo apt-get。apt 源挂了它就一直等；给它加 timeout 反而制造了一个必然失败的锁。
stage: ops
level: intermediate
tags: [ci, github-actions, playwright, apt, 超时]
---

## 现象

E2E job 的 "Install Playwright browsers" 这一步开始随机变慢。两次记录：

- 第一次：50 分钟后才继续。
- 第二次：6 分钟。
- 第三次：直接顶到 job 超时。

日志停在 `apt-get update` 那一行，没有任何报错，没有任何进展输出。

## 排查

命令是常见写法：

```yaml
- run: pnpm --filter @app/e2e exec playwright install --with-deps chromium
```

`--with-deps` 会去装 Chromium 需要的系统库，实现是 shell 出去调 `sudo apt-get install`。

翻 runner 日志发现：默认的 apt 镜像 `azure.archive.ubuntu.com` 没有响应，apt 回退到公共 archive，然后就一直等着。apt 在网络无响应时不会快速失败，它会耐心地等。

## 第一次修（错的）

想当然的做法是给它加个超时：

```yaml
- run: timeout 300 pnpm --filter @app/e2e exec playwright install --with-deps chromium
```

结果更糟：下一次跑，**7 秒**就失败了，报错是

```
Could not get lock /var/lib/apt/lists/lock — held by process 3700 (apt-get)
```

原因是 `timeout` 只给它的**直接子进程**发信号 —— 这里是 `pnpm`。真正的 `apt-get` 是 `sudo` 底下的一个 root 属主的孙子进程，`timeout` 碰不到它。于是 pnpm 被杀，apt 活着，继续攥着 `/var/lib/apt/lists/lock`。重试进来一看锁被占，立刻死。

**这个"修复"把一次偶发的挂起，变成了一次必然的失败。**

## 原因

两层：

1. **根因**：apt 镜像不可靠，而 apt 在网络无响应时的行为是无限等待。
2. **放大**：`timeout` 的信号只到直接子进程，杀不掉 sudo 底下的孙子进程；杀了中间那层反而留下一个持锁的孤儿。

## 修法

不要跑 apt。

GitHub 的 runner 镜像本身就带 Chrome 和 Edge，也就是说 **Chromium 需要的系统库早就装好了**。`--with-deps` 在这个环境里是纯粹的多余动作。

```yaml
- name: Install Chromium
  run: pnpm --filter @app/e2e exec playwright install chromium

# 两秒钟，但这是敢去掉 --with-deps 的底气：
# 如果 runner 镜像哪天不再带某个库，这里立刻失败并说清是哪个，
# 而不是在 67 条用例中间表现为"浏览器起不来"。
- name: Verify Chromium launches
  run: |
    pnpm --filter @app/e2e exec node -e "
      const { chromium } = require('@playwright/test')
      chromium.launch()
        .then(async (b) => { console.log('✅ chromium ' + b.version()); await b.close() })
        .catch((e) => { console.error('❌ chromium will not launch: ' + e.message); process.exit(1) })
    "
```

再加两道保险：

```yaml
- uses: actions/cache@v4          # 浏览器构建由 playwright 版本决定，随 lockfile 缓存
  with:
    path: ~/.cache/ms-playwright
    key: playwright-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}

# 每个 job 都有预算。默认是 360 分钟。
timeout-minutes: 30
```

## 教训

1. **卡住比失败更贵。** 失败会红，会有人看；卡住只是"CI 好像有点慢"，可以烧掉一整天。给每个 job 都配 `timeout-minutes`。
2. **`timeout` / `kill` 只作用于直接子进程。** 中间隔了 `sudo`、`sh -c`、包管理器的时候，你杀掉的是中间人，真正干活的那个还活着 —— 而且可能攥着锁。
3. **去掉一个便利选项之前，先补一个能证伪的检查。** 敢删 `--with-deps` 是因为加了那个两秒的启动验证。没有它，这就是在赌 runner 镜像的内容。
4. 遇到"偶发变慢"，先问**这一步真的需要联网吗**。最快的网络请求是不发的那个。
