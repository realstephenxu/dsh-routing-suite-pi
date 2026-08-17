# 🧭 DSH Routing Suite for Pi

**Model-agnostic routing + session memory for [Pi Agent](https://github.com/earendil-works/pi).**
**面向 Pi Agent 的模型无关路由与会话记忆套件。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Pi](https://img.shields.io/badge/Pi-Agent-6f42c1)
![Model Agnostic](https://img.shields.io/badge/Model-Agnostic-brightgreen)
![Version](https://img.shields.io/badge/version-0.6.0-blue)

---

## 🧭 What is DSH Routing? / 什么是 DSH 路由？

DSH Routing is a **per-prompt workflow router** for coding agents.

Instead of letting every request follow the same heavy workflow, it looks at the **current user message** and chooses the smallest fitting workflow:

- `plan` — 只做方案，不修改
- `inspect` — 先检查、诊断、复现
- `fix` — 修复问题并验证
- `build` — 实现、构建、交付
- `adaptive` — 混合任务，边修边建
- `weak` — 有工程意图但无法明确归类，让模型自分类
- `off` — 问候/闲聊，不注入任何路由

It is **model-agnostic**: it never branches on the model name or provider.

DSH 路由是一个**逐轮任务分类器**，不按模型名分支，只根据当前 prompt 选择最合适的工作流。

---

## ✨ Features / 功能

### 🌍 Model Agnostic / 模型无关

- No model-name branching.
- 不按模型名分支，所有 Pi 支持的模型通用。
- Works with DeepSeek, Kimi, OpenAI, Anthropic, Google, and more.
- 兼容 DeepSeek、Kimi、OpenAI、Anthropic、Google 等模型。

### 🧭 Per-Prompt Routing / 逐轮路由

- Reclassifies **every user prompt** instead of keeping a fixed persona.
- 每一轮都重新分类，而不是固定一种 persona。
- Injects a route marker such as:

```text
[DSH route: fix; DSH-ROUTER-V1; core v2; rules v3]
```

- Provides near-field guidance matched to the current route.
- 根据当前路由注入对应的近场引导。

### 🧠 Session Memory / 会话记忆

- Re-inject key decisions, designs, files, and errors at the right time.
- 在合适时机重新注入关键决策、设计、文件与错误，缓解长对话失忆。

### 🔁 Cross-Session Recall / 跨会话召回

- Search and reuse memory from previous sessions in the same workspace.
- 检索并复用同一工作区历史会话中的记忆。

### 🗜️ Distillation & Compaction / 蒸馏与压缩

- Distill memory before compaction and provide structured summaries.
- 在压缩前蒸馏记忆，并提供结构化摘要。

### 🛠️ Plan Mode & Two-Phase Tools / 计划模式与两阶段工具

- `/dsh-plan` and `--dsh-plan`.
- Optional `--dsh-two-phase` minimal-first tool surface.
- 可选的两阶段工具面，首轮最小工具，首次工具调用后展开。

---

## 🧭 Routing Examples / 路由示例

| User Prompt / 用户输入 | Route / 路由 |
|---|---|
| `你好` | `off` |
| `只做实施方案，不要修改文件` | `plan` |
| `诊断这个报错并告诉我原因` | `inspect` |
| `修复登录失败并运行回归测试` | `fix` |
| `实现一个健康检查端点` | `build` |
| `修复崩溃并重构这个模块` | `adaptive` |
| `看看这段代码` | `adaptive` / `weak` |
| `今天天气不错` | `off` |

---

## 🧩 Routing Commands / 路由命令

| Command / 命令 | Description / 说明 |
|---|---|
| `/dsh-status` | Show current routing state / 显示当前路由状态 |
| `/dsh-route <route>` | Set a route override / 设置路由覆盖 |
| `/dsh-route auto` | Clear the route override / 清除路由覆盖 |
| `/dsh-plan` | Toggle plan mode / 切换计划模式 |

Supported route values:

```text
plan | inspect | fix | build | adaptive | weak | auto
```

---

## 🧠 Memory Commands / 记忆命令

| Command / 命令 | Description / 说明 |
|---|---|
| `/dsh-memory` | Show current session memory / 查看当前会话记忆 |
| `/dsh-memory-note <text>` | Add a memory note / 添加记忆笔记 |
| `/dsh-memory-search <query>` | Search across sessions / 跨会话搜索记忆 |
| `/dsh-memory-distill` | Distill current session memory / 蒸馏当前会话记忆 |
| `/dsh-memory-summary` | Show distilled summary / 显示蒸馏摘要 |
| `/dsh-memory-config` | Show memory policy / 显示记忆策略 |
| `/dsh-trajectory` | Show current trajectory / 显示当前轨迹 |
| `/dsh-phase <phase>` | Set trajectory phase / 设置轨迹阶段 |
| `/dsh-trajectory-mode <mode>` | Set trajectory mode / 设置轨迹模式 |

---

## 🚀 Quick Start / 快速开始

### Use the latest version / 使用最新版本

```bash
cd v0.6.0
npm install
npm run build
npm test
```

### Run with Pi / 使用 Pi 运行

```bash
pi -e ./packages/pi-extension/dist/extension.js
```

### Enable memory / 启用记忆

```bash
pi -e ./packages/pi-extension/dist/extension.js --dsh-memory
```

### Enable two-phase tools / 启用两阶段工具

```bash
pi -e ./packages/pi-extension/dist/extension.js --dsh-two-phase
```

---

## 🏗️ Architecture / 架构

```text
dsh-routing-core
  ├─ Model-agnostic routing rules
  ├─ Per-prompt classification
  └─ Guidance generation

dsh-routing-pi
  ├─ before_agent_start injection
  ├─ Two-phase tool surface
  ├─ Plan mode & route override
  ├─ Session memory
  ├─ Cross-session recall
  └─ Compaction distillation
```

---

## 🧠 Memory Design / 记忆设计

```text
before_agent_start
  ├─ Routing guidance
  ├─ Current session memory snapshot
  └─ Cross-session history recall

turn_end
  └─ Extract decisions / files / errors / todos

session_before_compact
  └─ Provide distilled memory summary
```

Memory is stored in:

```text
~/.pi/agent/dsh-memory-v0.5.json
```

---

## 📦 Versions / 版本矩阵

| Directory / 目录 | Version / 版本 | Highlights / 亮点 |
|---|---|---|
| `v0.1.0` | 0.1.0 | Initial Pi adaptation / 初始 Pi 适配 |
| `v0.2.0` | 0.2.0 | Action rhythm, two-phase tools, route override / 行动节奏、两阶段工具、路由覆盖 |
| `v0.3.0` | 0.3.0 | Session memory & context re-injection / 会话记忆与上下文再注入 |
| `v0.4.0` | 0.4.0 | Cross-session memory search & recall / 跨会话记忆检索与召回 |
| `v0.5.0` | 0.5.0 | Memory distillation & compaction optimization / 记忆蒸馏与压缩优化 |
| `v0.6.0` | 0.6.0 | Trajectory state & lightweight control / 轨迹状态与轻量控制 |

> Latest stable: **v0.6.0**
> 最新稳定版：**v0.6.0**

---

## 🛠️ Development / 开发

```bash
# From any version directory / 在任意版本目录下
npm install
npm run build
npm test
```

Each version is independent and contains:

- `packages/core` — `dsh-routing-core`
- `packages/pi-extension` — `dsh-routing-pi`
- `docs/` — design docs / 设计文档
- `schemas/` — JSON schemas
- `tests/` — unit tests

---

## 📄 License / 许可证

MIT License. See [LICENSE](LICENSE).

---

## 🙌 Acknowledgments / 致谢

- [dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)
- [Pi Agent](https://github.com/earendil-works/pi)
- [pi-topic-memory](https://github.com/fan56/pi-topic-memory)
- [EchoCore](https://github.com/mook-wenyu/EchoCore)
- [Lore](https://github.com/BYK/loreai)
