# Changelog

## 1.0.0 — core
- `maestro` orchestrator: analysis → expert decision gate → plan (speckit) → task cards → workstreams → review → report, with resumable state in `.workflow/`.
- `maestro-decisions`, `maestro-breakdown`, `maestro-workstream`, `maestro-review`.
- `maestro-router`: per-agent model files (opencode, pi, Command Code), tier/good_for routing, provider- or model-scoped usage-limit cooldowns, cross-agent fallback, `on_exhaustion: ask | wait_and_retry`, doctor, dry-run.
- Profiles (`claude-led` default, `free-only`) with configurable roles, models, and effort.
