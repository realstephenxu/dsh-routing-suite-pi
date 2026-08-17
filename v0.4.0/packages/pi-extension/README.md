# dsh-routing-pi

Pi Agent extension for model-agnostic DSH routing.

## Install / Try

```bash
pi -e ./dist/extension.js
```

Or copy to `~/.pi/agent/extensions/`.

## Plan Mode

- `/dsh-plan` toggles read-only mode.
- If another Pi plan-mode extension removes `edit`/`write`, routing automatically forces `plan`.
