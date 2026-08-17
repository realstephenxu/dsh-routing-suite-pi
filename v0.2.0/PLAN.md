# Pi 版 Update v0.2 — 实施计划

> 当前阶段：v0.2.0 已实施、编译并通过压力测试。

## 目标

将原版 v0.4 的可借鉴点移植到 Pi 版，同时保持模型无关。

## Phase 0 — 设计（当前）

- [x] 设计文档：`docs/pi-update-v0.2-design.md`
- [x] Schema 草案
- [x] 确认配置默认值
- [x] 确认 `weak` vs `adaptive` fallback 策略

## Phase 1 — Core 更新

- [x] 更新 `routing-rules.json`：
  - 增加 `engineering` 信号
  - 更新 `simpleTail` / `complexTail`
  - 增加可选 `weTeam*` guidance
  - 调整 `complexity.minLength` 到 120
  - 增加复杂词：全面、详细、设计、系统、优化、分析
- [x] 更新 `types.ts`：
  - 增加 `weak` route（或内部枚举）
  - 扩展 `RouterInput` / `RouterOutput`
- [x] 更新 `core.ts`：
  - 歧义工程 fallback
  - 新复杂度判断
  - 新 guidance 拼接
  - `suggestedMinimalTools` 输出
- [x] 更新 core schemas
- [x] 更新 core tests

## Phase 2 — Pi Extension 更新

- [x] 新增 `router-config` 读取/默认值
- [x] 实现两阶段工具面：
  - `before_agent_start` 设置 minimal tools
  - 首次 `tool_call` 后展开 full tools
- [x] 实现 `/dsh-status`
- [x] 实现 `/dsh-route <route|auto>`
- [x] 集成 Plan Mode 优先级
- [x] 更新 Pi extension tests

## Phase 3 — 文档与 Schema 完善

- [x] 更新 `docs/design.md`
- [x] 更新 `docs/acceptance.md`
- [x] 新增 `packages/pi-extension/schemas/router-config.schema.json`
- [x] 新增 `packages/pi-extension/schemas/route-override.schema.json`
- [x] 新增 `packages/pi-extension/schemas/tool-phase.schema.json`

## Phase 4 — 编译与测试

- [x] `npm run build`
- [x] `npm test`
- [x] Pi live stress（DeepSeek V4 Flash）
- [x] 生成最终 artifact

## 风险

- 两阶段工具面可能改变用户预期：默认关闭，显式开启。
- `weak` fallback 可能让部分原本 `off` 的 prompt 开始注入：需要压力测试确认不误伤闲聊。
- `registerTool` 能力依赖 Pi 版本：如果不可用，先只做命令。
