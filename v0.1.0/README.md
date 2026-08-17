# DSH Routing Suite for Pi

Model-agnostic, per-prompt workflow routing for [Pi Agent](https://github.com/earendil-works/pi).

This repository contains:

- `packages/core` — `dsh-routing-core`, an independent npm package with pure routing logic.
- `packages/pi-extension` — `dsh-routing-pi`, a Pi extension that injects the routing guidance.

## Status

Implemented, compiled, and Pi live stress passed with DeepSeek V4 Flash. Current update design: `docs/pi-update-v0.2-design.md` and `PLAN.md`.

## Commands

```bash
npm install
npm run build
npm test
```

## Use with Pi

```bash
pi -e ./packages/pi-extension/src/extension.ts
# or after build:
pi -e ./packages/pi-extension/dist/extension.js
```

In Pi:

- `/dsh-plan` toggles the built-in DSH plan mode.
- If another Pi plan-mode extension is active (write/edit tools removed), routing automatically forces `plan`.

> Note: if you copy the extension file directly into `~/.pi/agent/extensions/`, make sure `dsh-routing-core` is resolvable (e.g. install the Pi package with `pi install ./packages/pi-extension` or run `npm install` in the copied extension directory).
