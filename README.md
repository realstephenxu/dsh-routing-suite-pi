# 🧭 DSH Routing Suite for Pi

**Model-agnostic routing + session memory for [Pi Agent](https://github.com/earendil-works/pi).**
**面向 Pi Agent 的模型无关路由与会话记忆套件。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Pi](https://img.shields.io/badge/Pi-Agent-6f42c1)
![Model Agnostic](https://img.shields.io/badge/Model-Agnostic-brightgreen)
![Version](https://img.shields.io/badge/version-0.5.0-blue)

---

## ✨ Features / 功能

### 🌍 Model Agnostic / 模型无关

- No model-name branching.
- 不按模型名分支，所有 Pi 支持的模型通用。

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

## 📦 Versions / 版本矩阵

| Directory / 目录 | Version / 版本 | Highlights / 亮点 |
|---|---|---|
| `v0.1.0` | 0.1.0 | Initial Pi adaptation / 初始 Pi 适配 |
| `v0.2.0` | 0.2.0 | Action rhythm, two-phase tools, route override / 行动节奏、两阶段工具、路由覆盖 |
| `v0.3.0` | 0.3.0 | Session memory & context re-injection / 会话记忆与上下文再注入 |
| `v0.4.0` | 0.4.0 | Cross-session memory search & recall / 跨会话记忆检索与召回 |
| `v0.5.0` | 0.5.0 | Memory distillation & compaction optimization / 记忆蒸馏与压缩优化 |

> Latest stable: **v0.5.0**
> 最新稳定版：**v0.5.0**

---

## 🚀 Quick Start / 快速开始

### Use the latest version / 使用最新版本

```bash
cd v0.5.0
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

---

## 🧩 Commands / 命令

| Command / 命令 | Description / 说明 |
|---|---|
| `/dsh-plan` | Toggle DSH plan mode / 切换计划模式 |
| `/dsh-status` | Show routing status / 显示路由状态 |
| `/dsh-route <route>` | Set route override / 设置路由覆盖 |
| `/dsh-memory` | Show current session memory / 查看当前会话记忆 |
| `/dsh-memory-note <text>` | Add a memory note / 添加记忆笔记 |
| `/dsh-memory-search <query>` | Search across sessions / 跨会话搜索记忆 |
| `/dsh-memory-distill` | Distill current session memory / 蒸馏当前会话记忆 |
| `/dsh-memory-summary` | Show distilled summary / 显示蒸馏摘要 |
| `/dsh-memory-config` | Show memory policy / 显示记忆策略 |

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

## 🏗️ Architecture / 架构

```text
dsh-routing-core
  ├─ Model-agnostic routing rules
  └─ Pure classification logic

dsh-routing-pi
  ├─ before_agent_start injection
  ├─ Two-phase tool surface
  ├─ Session memory
  ├─ Cross-session recall
  └─ Compaction distillation
```

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
