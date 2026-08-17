# DSH Routing Suite for Pi

Model-agnostic, per-prompt workflow routing and session memory for [Pi Agent](https://github.com/earendil-works/pi).

This project adapts the ideas from [dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite) to Pi Agent, and adds:

- Per-prompt routing guidance
- Plan Mode support
- Optional two-phase tool surface
- Session memory and context re-injection
- Cross-session memory recall
- Memory distillation and compaction optimization

## Why

Long coding sessions lose early decisions, file paths, and design constraints. This project helps models with limited context, such as Kimi K3 256k, stay focused by re-injecting relevant context at the right time.

## Versions

| Directory | Version | Highlights |
|---|---|---|
| `v0.1.0` | 0.1.0 | Initial Pi adaptation |
| `v0.2.0` | 0.2.0 | Action rhythm, two-phase tools, route override, weak fallback |
| `v0.3.0` | 0.3.0 | Session memory and context re-injection |
| `v0.4.0` | 0.4.0 | Cross-session memory search and recall |
| `v0.5.0` | 0.5.0 | Memory distillation and compaction optimization |

## Quick Start

### Use the latest version

```bash
cd v0.5.0
npm install
npm run build
npm test
```

### Run with Pi

```bash
pi -e ./packages/pi-extension/dist/extension.js
```

Enable memory:

```bash
pi -e ./packages/pi-extension/dist/extension.js --dsh-memory
```

### Commands

| Command | Description |
|---|---|
| `/dsh-plan` | Toggle DSH plan mode |
| `/dsh-status` | Show routing status |
| `/dsh-route <route>` | Set route override |
| `/dsh-memory` | Show current session memory |
| `/dsh-memory-note <text>` | Add a memory note |
| `/dsh-memory-search <query>` | Search across sessions |
| `/dsh-memory-distill` | Distill current session memory |
| `/dsh-memory-summary` | Show distilled summary |
| `/dsh-memory-config` | Show memory policy |

## Architecture

```text
dsh-routing-core
  ├─ model-agnostic routing rules
  └─ pure classification logic

dsh-routing-pi
  ├─ before_agent_start injection
  ├─ two-phase tool surface
  ├─ session memory
  ├─ cross-session recall
  └─ compaction distillation
```

## License

MIT
