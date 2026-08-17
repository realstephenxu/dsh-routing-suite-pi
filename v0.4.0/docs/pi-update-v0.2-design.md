# Pi 版 Update v0.2 — 设计文档（编译前）

> 本文件只做设计，不包含实施代码。

## 1. 背景

原版 `dsh-router-standard` v0.4 更新带来了几个值得借鉴的点：

1. We-Team 近场引导：一句一动作、2-3 句一个决策句。
2. 两阶段工具面：先最小工具面建立行动节律，首次工具调用后展开完整工具面。
3. 路由可见 / 可调：`dev_router_status` / `dev_router_mode`。
4. 歧义工程任务不要直接 `off`。
5. 复杂度判断阈值与词表调整。

本次 Pi 版 Update v0.2 将把这些点以“模型无关、Pi 原生”的方式纳入。

## 2. 目标

- 保持对所有 Pi 模型/provider 通用。
- 不引入 DeepSeek 专属 persona、`run_code`、Cordis 等机制。
- 在 Pi Extension 能力范围内实现：
  - 更有效的近场引导；
  - 可选的两阶段工具面；
  - 路由状态可见与手动覆盖；
  - 更合理的歧义工程任务 fallback；
  - 更贴近原版的复杂度判断。

## 3. 非目标

- 不做模型名分支。
- 不做 DeepSeek Harness 注入器。
- 不实现 Code Mode / SDK sections。
- 不恢复 mode-boost。

## 4. 架构变化总览

```text
dsh-routing-core (纯逻辑)
   ├─ 新增/调整 signals、guidance、complexity
   ├─ 新增 ambiguousEngineering fallback
   └─ 新增 route override 辅助类型

dsh-routing-pi (Pi Extension)
   ├─ before_agent_start：分类 + 注入 guidance
   ├─ 可选 two-phase tools：
   │    首轮 setActiveTools(minimal)
   │    首次 tool_call 后 setActiveTools(full)
   ├─ /dsh-status：显示当前路由状态
   └─ /dsh-route <route|auto>：手动覆盖下一轮路由
```

## 5. 核心模块设计

### 5.1 路由类型扩展

```ts
export type Route =
  | "plan"
  | "inspect"
  | "fix"
  | "build"
  | "adaptive"
  | "weak"      // 新增：模型自分类，等价原版 weak
  | "off";
```

> 说明：`weak` 是原版的重要概念。Pi 版可将其作为“有工程意图但无法明确分类”的 fallback，也可以映射到 `adaptive`。首版建议保留 `adaptive` 作为对外 route，内部增加 `weak` 作为可选。

### 5.2 输入扩展

```ts
export interface RouterInput {
  prompt: string;
  permissionMode?: string;
  permission_mode?: string;
  model?: string;

  /** Pi 可选：是否允许模型自分类 fallback */
  allowWeak?: boolean;

  /** Pi 可选：手动覆盖路由 */
  overrideRoute?: Route | "auto";
}
```

### 5.3 输出扩展

```ts
export interface RouterOutput {
  route: Exclude<Route, "off">;
  complex: boolean;
  marker: string;
  identity: string;
  guidance: string;

  /** 新增：建议的首轮最小工具面（供 Pi extension 使用） */
  suggestedMinimalTools?: string[];

  /** 新增：是否建议使用两阶段工具展开 */
  twoPhase?: boolean;
}
```

## 6. Guidance 文案更新设计

### 6.1 简单任务 tail

当前：

```text
Keep the workflow tight: act, verify, report.
```

建议改为：

```text
Keep one action per sentence. Make a decision every 2-3 sentences, then continue.
Act, verify, report.
```

### 6.2 复杂任务 tail

当前：

```text
Check architecture, dependencies, integration points, compatibility, and relevant edge cases before finishing. Stop when evidence is sufficient.
```

建议改为：

```text
Check architecture, dependencies, integration points, compatibility, and relevant edge cases.
Keep one action per sentence.
End each reasoning block with a decision or an information need.
Stop when evidence is sufficient.
```

### 6.3 可选的 We-Team 风格（默认不启用）

原版使用 `We/我们` 集体人称。为了保持通用性，设计为可选配置：

```json
{
  "guidanceStyle": "neutral" | "we-team"
}
```

默认 `neutral`；`we-team` 时在 build/fix/adaptive 前追加：

```text
We/我们：先分类任务——build → 直接生产；fix → 先查后修。
我们的节奏：每句一个动作；每 2-3 句一个决策句然后继续。
```

## 7. 歧义工程任务 fallback

### 7.1 新增信号

在 `routing-rules.json` 增加：

```json
"engineering": "(?:代码|程序|脚本|函数|模块|服务|接口|项目|系统|库|组件|页面|功能|实现|开发|构建|部署|code|program|script|function|module|service|api|project|system|library|component|page|feature|implement|develop|build|deploy)"
```

### 7.2 分类规则

当现有逻辑得到 `off` 时，额外判断：

```text
if (engineering signal matched) {
  route = allowWeak ? "weak" : "adaptive";
  complex = isComplexTask(prompt);
}
```

这样避免“看看这段代码”这类有工程意图但缺少明确 fix/build/inspect 关键词的 prompt 被当成闲聊。

## 8. 两阶段工具面设计

### 8.1 配置

```json
{
  "twoPhaseTools": true,
  "expandAfterFirstToolCall": true,
  "minimalTools": {
    "plan": ["read", "bash", "grep", "find", "ls"],
    "inspect": ["read", "bash", "grep", "find", "ls"],
    "fix": ["read", "bash", "edit"],
    "build": ["read", "bash", "edit", "write"],
    "adaptive": ["read", "bash", "edit", "write"]
  }
}
```

### 8.2 行为

- `before_agent_start` 时如果 `twoPhaseTools=true` 且尚未展开：
  - 根据 route 设置 `pi.setActiveTools(minimalTools[route])`。
- 首次 `tool_call` 后：
  - 记录已展开状态；
  - `pi.setActiveTools(fullTools)`。
- `off` 或纯聊天不触发工具面修改。
- 外部 Plan Mode 激活时，`plan` 路由保持只读工具面，不自动展开写工具。

### 8.3 安全边界

- 两阶段工具面是可选能力，默认关闭，避免改变现有用户预期。
- 展开后不再次收缩，避免打断工作流。
- 如果 Pi 不支持 `setActiveTools`，自动降级为纯提示注入。

## 9. 路由可见与手动覆盖

### 9.1 `/dsh-status`

输出示例：

```text
route=fix
override=none
planMode=off
twoPhase=expanded
identity=DSH-ROUTER-V1
```

### 9.2 `/dsh-route <route|auto>`

- `plan|inspect|fix|build|adaptive|off`：设置下一轮/本次会话覆盖。
- `auto`：清除覆盖，恢复自动分类。
- 优先级：`overrideRoute` > `planMode` > 自动分类。

### 9.3 可选工具

如果 Pi 支持 `registerTool`，可注册：

- `dsh_router_status`
- `dsh_router_mode`

让模型也能读取/调整路由。首版建议先做命令，工具后续再加。

## 10. Schema 设计

### 10.1 `routing-rules.schema.json` 更新

- `signals` 增加 `engineering`。
- `guidance` 增加：
  - `simpleTail`
  - `complexTail`
  - `weTeamBuild`
  - `weTeamFix`
  - `weTeamAdaptive`
- 这些字段均可选，默认由 core 提供 fallback。

### 10.2 `router-config.schema.json`（新增）

用于 Pi extension 配置。

### 10.3 `route-override.schema.json`（新增）

用于手动覆盖状态。

### 10.4 `tool-phase.schema.json`（新增）

用于两阶段工具面状态。

## 11. 测试计划

### 11.1 Core 单元测试

- 新增歧义工程 fallback 用例。
- 新增复杂度词表用例。
- 新增 guidance 包含“一句一动作 / 决策句”断言。
- 保持原有 64 条 stress 用例通过。

### 11.2 Pi Extension 测试

- mock `pi.setActiveTools` 验证两阶段工具面。
- 验证首次 `tool_call` 后展开。
- 验证 `/dsh-status` 输出。
- 验证 `/dsh-route` 覆盖。
- 验证 Plan Mode 与 override 优先级。

### 11.3 真机压力测试

- 复用 `packages/pi-extension/scripts/pi-live-stress.mjs`。
- 使用 DeepSeek V4 Flash。
- 预期 routed route/scope/convergence 仍为 29/29。
- 记录 baseline 对比。

## 12. 文件变更预测

```text
packages/core/src/routing-rules.json       修改 signals/guidance
packages/core/src/types.ts                 扩展 Route/RouterInput/RouterOutput
packages/core/src/core.ts                  增加 fallback、复杂度、guidance 生成
packages/core/schemas/*.json               更新/新增
packages/pi-extension/src/extension.ts     增加两阶段工具面、状态命令
packages/pi-extension/schemas/*.json       新增
packages/pi-extension/tests/*.test.mjs     增加测试
docs/pi-update-v0.2-design.md              本文档
PLAN.md                                    实施计划
```

## 13. 验收标准

- `npm test` 全部通过。
- `npm run build` 通过。
- Pi live stress：routed 29/29 route/scope/convergence。
- 不引入模型名分支。
- 默认配置下不改变现有用户行为（两阶段工具面默认关闭）。
