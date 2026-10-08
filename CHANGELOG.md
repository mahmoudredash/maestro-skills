# Changelog

## 1.0.1 — field fixes (from a real project run)
- Decisions: no silent defaults. An unanswered decision is never applied; dependent work waits and the question is asked again.
- Hard rules: never bypass the router with a direct CLI call; the project's own tracker (Spec Kit, WORKFLOW/) stays the source of truth; commits follow `git.commit` (`per_card` | `never`).
- Router: a relay that never started the CLI (e.g. version check timed out under load) is retried on the same model (`dispatch.infra_retries`, `infra_backoff_seconds`).
- Defaults: OpenCode free ids corrected from a real `opencode models` (`mimo-v2.6-flash-free`, `nemotron-3-ultra-free`, `space-bunny-free`); pi entries ship disabled as examples.
- `doctor --fix` disables models your CLIs don't list (your config files only; keeps comments).
- Per-role `models` allowlist to pin a role to exact models (e.g. one implementer, one reviewer, no fallback).
- First-use guidance: `init --project`, present conflicts with existing project rules as a decision, commit `.maestro/`.
- Router: `--avoid-provider` (soft) for cross-review, so same-provider setups (e.g. OpenCode-only) still get a different-model reviewer; `route` hides the skipped list unless `--verbose`.

## 1.0.0 — core
- `maestro` orchestrator: analysis → expert decision gate → plan (speckit) → task cards → workstreams → review → report, with resumable state in `.workflow/`.
- `maestro-decisions`, `maestro-breakdown`, `maestro-workstream`, `maestro-review`.
- `maestro-router`: per-agent model files (opencode, pi, Command Code), tier/good_for routing, provider- or model-scoped usage-limit cooldowns, cross-agent fallback, `on_exhaustion: ask | wait_and_retry`, doctor, dry-run.
- Profiles (`claude-led` default, `free-only`) with configurable roles, models, and effort.
