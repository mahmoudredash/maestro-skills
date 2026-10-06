# Changelog

## 1.1.0 — extension packs + OmniRoute
- Router: skills that ship `maestro-agents/*.yaml` are discovered as extension packs (overridable from the config dir, `extensions.disabled` to turn off).
- Router: per-agent `preflight` hook (0 ok · 3 fallback-only · else skip + `agent:<name>` cooldown); per-model `roles` and `sensitive_ok`.
- New optional pack `maestro-omniroute`: OpenCode through a local OmniRoute gateway, health + strict-free-policy preflight, safe compression, `setup` / `check` / `attest-strict`.

## 1.0.0 — core
- `maestro` orchestrator: analysis → expert decision gate → plan (speckit) → task cards → workstreams → review → report, with resumable state in `.workflow/`.
- `maestro-decisions`, `maestro-breakdown`, `maestro-workstream`, `maestro-review`.
- `maestro-router`: per-agent model files (opencode, pi, Command Code), tier/good_for routing, provider- or model-scoped usage-limit cooldowns, cross-agent fallback, `on_exhaustion: ask | wait_and_retry`, doctor, dry-run.
- Profiles (`claude-led` default, `free-only`) with configurable roles, models, and effort.
