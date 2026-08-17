# Pi 版 v0.3 — 实施计划

> 当前阶段：v0.3.0 已实施、编译并通过压力测试。

## 目标

为 Pi 版增加“会话记忆与上下文再注入”，解决长对话失忆问题。

## Phase 0 — 设计（当前）

- [x] 设计文档：`docs/v0.3-memory-design.md`
- [x] Memory schema 草案
- [x] 实施计划

## Phase 1 — Memory Core

- [x] 新增 `MemoryStore`：
  - 内存 Map + JSON 文件持久化
  - 原子写
  - per-session 隔离
- [x] 新增 `MemoryTopic` / `MemoryEntry` 类型
- [x] 实现 CRUD：
  - add / update / delete / list
  - supersede
- [x] 实现热路径匹配函数
- [x] 实现注入预算截断

## Phase 2 — Pi Extension 集成

- [x] `before_agent_start` 合并 routing + memory 注入
- [x] `turn_end` 增量抽取
- [x] 命令：
  - `/dsh-memory`
  - `/dsh-memory-note`
  - `/dsh-memory-forget`
  - `/dsh-memory-config`
- [x] `session_before_compact` 提供 memory snapshot
- [x] 配置开关默认关闭

## Phase 3 — Schema

- [x] `memory-entry.schema.json`
- [x] `memory-topic.schema.json`
- [x] `memory-session.schema.json`
- [x] `memory-inject-policy.schema.json`

## Phase 4 — 测试

- [x] MemoryStore 单元测试
- [x] 热路径匹配测试
- [x] Pi extension 集成测试
- [x] `npm run build`
- [x] `npm test`

## Phase 5 — 真机验证

- [x] Kimi K3 256k 长对话测试
- [x] DeepSeek V4 Flash 回归压力测试
- [x] 生成 artifact

## 风险

- 记忆注入可能污染上下文：默认关闭，严格控制预算。
- 异步提取可能延迟：采用批量阈值，不阻塞主流程。
- 热路径匹配可能误判：阈值可配置，保留 LLM 慢路径。
