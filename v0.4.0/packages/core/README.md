# dsh-routing-core

Model-agnostic routing core for DSH-style per-prompt workflow routing.

## Usage

```ts
import { classifyPrompt, buildGuidance } from "dsh-routing-core";

const classification = classifyPrompt({ prompt: "修复这个 bug" });
const output = buildGuidance(classification);
```

## Rules

Routing rules live in `src/routing-rules.json` and are copied to `dist` at build time.
