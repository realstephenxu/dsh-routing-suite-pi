# Design — DSH Routing for Pi

## Goals

- Provide per-prompt routing for all Pi models/providers.
- Do not branch on model name or provider.
- Reuse the routing rules from the Codex adaptation.
- Support Pi Plan Mode in the first version.
- Keep routing advisory and fail-open.

## Architecture

```text
dsh-routing-core (pure npm package)
        |
        v
dsh-routing-pi (Pi extension)
```

The Pi extension listens to `before_agent_start` and appends routing guidance to the system prompt.

## Identity

- Cross-platform identity: `DSH-ROUTER-V1`.
- Route marker: `[DSH route: <route>; DSH-ROUTER-V1; core v1; rules v2]`.

## Plan Mode

- Built-in `/dsh-plan` toggles read-only tool selection; CLI flag `--dsh-plan` starts in plan mode.
- External Pi plan-mode extensions are detected by checking active tools for missing `edit`/`write`.
- When plan mode is active, the router forces `plan`.
