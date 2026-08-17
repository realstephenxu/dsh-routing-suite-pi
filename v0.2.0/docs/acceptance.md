# Acceptance — Pi DSH Routing

Current status: **PASS** (v0.2.0 core + extension tests + Pi live stress with DeepSeek V4 Flash).

## Deterministic

- Core classification matches the existing Codex stress corpus.
- Model name changes do not affect routing.
- `off` routes produce no injection.
- Malformed input fails open.

## Pi Integration

- `before_agent_start` returns `systemPrompt` with routing guidance.
- Plan mode forces `plan`.
- `/dsh-plan` toggles read-only mode.

## Manual Probe

Start Pi with the extension and ask:

```text
请复述你的路由身份。
```

Expected: `DSH-ROUTER-V1`

## Pi Live Stress Result (DeepSeek V4 Flash)

- Version: 0.2.0
- Live subset: 29 cases (17 scenarios, L1-L4)
- Routed: route 29/29, scope 29/29, convergence 29/29
- Baseline: route 20/29, scope 23/29, convergence 29/29
- Routed score 87 >= baseline score 72
- Artifact: `artifacts/pi-live-stress-final.json`
