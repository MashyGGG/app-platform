---
title: 容器到底是什么：一个被隔离和限量的普通进程
date: 2026-07-14
summary: 把容器当"轻量虚拟机"是后续所有误解的源头。想通 namespace + cgroup + 联合文件系统这三件事，一大半"奇怪现象"就不用背了。
stage: docker
level: basic
tags: [docker, linux, namespace, cgroup, 基础]
---

学 Docker 最贵的一步不是记命令，是**先把心智模型建对**。模型错了，后面每一个"奇怪现象"都要单独背一遍。

## 一句话结论

> 容器不是虚拟机。容器就是宿主机上一个**普通的 Linux 进程**，只不过它被 namespace 蒙住了眼睛，被 cgroup 勒住了脖子，并且看到的文件系统是若干只读层叠出来的。

三个词，对应三项内核能力：

| 能力                 | 内核机制            | 解决的问题 |
| -------------------- | ------------------- | ---------- |
| 看不见别人           | namespace           | 隔离       |
| 用不了太多           | cgroup              | 限量       |
| 文件系统能共享又能改 | UnionFS / OverlayFS | 分层与复用 |

## 一、namespace：它只是看不见

Linux 有若干种 namespace，容器常用这几种：

- `pid` —— 容器里 `ps` 只看得到自己的进程，因为它在一个独立的 PID 编号空间里，自己的主进程是 PID 1。
- `net` —— 独立的网卡、路由表、iptables 规则、端口空间。所以两个容器可以都监听 8080 而不冲突。
- `mnt` —— 独立的挂载点视图，这是"容器里的 `/` 和宿主机不一样"的原因。
- `uts` —— 独立的 hostname。
- `ipc` —— 独立的共享内存 / 信号量。
- `user` —— 容器里的 root 可以映射成宿主机上的普通用户（rootless 的基础）。

验证一下比看十遍文档管用：

```bash
# 容器里只有一个进程
docker run --rm alpine ps aux

# 但在宿主机上它就是一个普通进程，看得见
docker run -d --name sleeper alpine sleep 300
ps -ef | grep "sleep 300"

# 关掉 pid namespace，容器立刻能看到宿主机全部进程
docker run --rm --pid=host alpine ps aux | head
```

最后一条是关键实验：**隔离是可以关掉的**。能被一个 flag 关掉的东西，显然不是虚拟机边界。

## 二、cgroup：它只是用不了太多

namespace 管"看得见什么"，cgroup 管"能用多少"。CPU、内存、PID 数量、块设备 IO 都在这里。

```bash
docker run --rm --memory=64m --cpus=0.5 alpine sh -c 'echo ok'
```

一个直接后果：**容器里的进程默认不知道自己被限了多少**。老版本 JVM 和 Node 会去读宿主机的总内存来决定堆大小，于是在一台 64 GB 的机器上跑一个 `--memory=512m` 的容器，堆按 64 GB 规划，然后被 OOMKilled。现代运行时基本都能读 cgroup 了，但这个坑的形状值得记住：

> 容器不是虚拟机，所以进程看到的"机器信息"未必是它实际能用的。

排查 OOMKilled 的第一条命令：

```bash
docker inspect <container> --format '{{.State.OOMKilled}} {{.State.ExitCode}}'
```

`ExitCode` 是 137 基本就是被 SIGKILL 了，配合 `OOMKilled=true` 就实锤了。

## 三、联合文件系统：镜像为什么能这么省

镜像是**只读层的叠加**，容器启动时在最上面加一层可写层。这解释了几件事：

1. 十个容器跑同一个镜像，磁盘上只有一份只读层。
2. 容器里删掉一个文件，底层那一层其实还在（只是被"白障"文件遮住了）。所以 **`RUN rm` 删不掉上一层里的东西，镜像也不会变小**。
3. 容器停掉，可写层就没了 —— 数据要活下来，必须放进 volume。

第 2 点是新手最常见的镜像瘦身失败：

```dockerfile
# ❌ 无效。secret 已经在上一层里了，rm 只是在新层里遮住它
COPY secret.pem /tmp/secret.pem
RUN use-it && rm /tmp/secret.pem
```

镜像层可以被任何人 `docker history` / 解包翻出来。构建期敏感文件要用 BuildKit 的 `--mount=type=secret`，或者干脆放到多阶段构建里被丢弃的那一段。

## 四、Docker、containerd、runc、OCI 各是什么

被这几个名字绕晕过一次，理清之后就很简单：

- **OCI** —— 规范。定义了镜像长什么样、运行时接口是什么、镜像怎么分发。
- **runc** —— 最底层的运行时。真正去调 `clone()`、建 namespace、写 cgroup 的那个东西。
- **containerd** —— 守护进程，管镜像拉取、快照、容器生命周期，往下调 runc。
- **Docker Engine** —— 在 containerd 之上再包一层：CLI、构建、网络、Compose 这些开发者体验。

所以 Kubernetes"移除 Docker 支持"从来不意味着镜像不能用了 —— 镜像是 OCI 标准的，K8s 只是不再经过 Docker Engine 这一层，直接使唤 containerd。

## 五、`docker run` 到底发生了什么

第 0 阶段的交付物就是这个。按顺序：

1. CLI 把请求发给 Docker daemon（默认走 `/var/run/docker.sock`）。
2. daemon 查本地有没有这个镜像；没有就去 registry 拉 —— 先拉 manifest，再按 digest 拉缺的层。
3. 用联合文件系统把镜像层叠好，在最上面加一层可写层。
4. 建 namespace（pid / net / mnt / uts / ipc），配 cgroup 限额。
5. 建网络：默认 bridge 下给容器一张 veth，接到 `docker0`，分配 IP；`-p` 的话再写 iptables DNAT 规则。
6. 挂载 volume / bind mount。
7. `runc` 在这套环境里起进程，执行 `ENTRYPOINT` + `CMD`。这个进程就是容器里的 PID 1。
8. 容器的生命周期 = PID 1 的生命周期。**PID 1 退出，容器就结束**。

最后一句解释了那个经典问题："我的容器起来就退出了"。因为你的 `CMD` 是个跑完就结束的命令，不是常驻进程。容器没有"后台"，它只有一个前台进程。

## 下一步

- 检查点交付物：不查文档把上面第五节复述一遍。
- 下一篇：[日常操作：镜像、容器、卷、网络](/posts/docker-cli-daily-driver)
