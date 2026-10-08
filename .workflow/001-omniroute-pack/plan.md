# Plan — 001 OmniRoute pack (decisions D1–D6 approved)

Execution: implemented by the leader directly. This cloud session has no free-model CLIs
(opencode / pi / cmd), so there was nothing to dispatch to; cards were not written.

## Core (generic, no OmniRoute-specific code)
1. `config.mjs`: discover extension packs (`<skills-root>/<skill>/maestro-agents/*.yaml`); config dir overrides by agent name; `extensions.disabled`.
2. Agent files: optional `preflight { cmd, cooldown_minutes, timeout_seconds }`; models: `roles`, `sensitive_ok`.
3. `dispatch.mjs`: run each candidate agent's preflight once per dispatch — 0 ok, 3 demote to standby, else `agent:<name>` cooldown and skip (D4, D5).
4. `route.mjs`: enforce `roles`, `sensitive_ok`, demotion. `limits.mjs`: `agent:` cooldown key.
5. `doctor` / `config`: show packs and preflight results.

## Pack `skills/maestro-omniroute/`
6. Agent `opencode-omniroute`: `auto/coding:free`, `auto/offline`, `auto/fast` (implementer-only, not sensitive — D3), pinned example (disabled).
7. `omniroute.mjs`: `preflight` (health + cost guard), `health`, `check` (catalog + guard), `attest-strict`, `setup` (opencode provider, `x-omniroute-compression: safe` — D6, no secret on disk).
8. SKILL.md with the decision rules; install is opt-in (`install.sh --with omniroute`).

## Verification
- Tests: pack discovery/override/disable, role & sensitivity filters, preflight ok/standby/down/timeout, dry-run, quoting; pack script against a fake OmniRoute server (health, guard verified / attested / not strict, catalog, setup patching, commented config untouched).
- Core-only test keeps the 3 shipped agents when no pack is installed.
