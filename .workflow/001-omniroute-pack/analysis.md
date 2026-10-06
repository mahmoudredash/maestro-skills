# Analysis — 001 OmniRoute pack

## Request
Add OmniRoute support as a separate, optional skill pack in this repo, on its own branch.
The v1 core must keep working unchanged without it.

## Goal / success criteria
- `skills/maestro-omniroute/` installs alongside the core and adds OmniRoute-backed models to the
  router's pool with no edits to the core's shipped agent files.
- With the pack absent, all core tests pass and behaviour is identical.
- With the pack installed but OmniRoute down, dispatch keeps working on direct models (no stall).
- Free-only spending is enforceable (no silent fall-through to paid models).
- `doctor` reports OmniRoute health, catalog and cost-guard status.

## What OmniRoute is (verified from its repo docs, v3.8.x)
- Local gateway, OpenAI-compatible, default `http://localhost:20128/v1`.
- Zero-config auto combos as model names: `auto`, `auto/coding`, `auto/fast`, `auto/cheap`,
  `auto/offline` (most quota headroom), `auto/<category>:<tier>` e.g. `auto/coding:free`.
- **Category/tier filtering is fail-open**: if a constraint matches nothing, the full pool is
  used, so `auto/coding:free` can reach a paid model. Hard guarantee only with the opt-in
  `freeAccessPolicy: "strict"` (STRICT_ZERO_COST) or `hidePaidModels` (weaker).
- Own failover: rate limits/timeouts/5xx fail over (up to 3 provider attempts); circuit breakers,
  per-connection cooldowns, per-model lockouts.
- Health: `GET /healthz` (public, lightweight); `/api/monitoring/health` and
  `GET /api/omniroute/status` (management auth); `GET /v1/models` (API key);
  `GET /api/usage/om-usage?format=json` (own usage; key needs `allowUsageCommand`).
- Response headers name the real provider/model (`X-OmniRoute-Provider`, `X-OmniRoute-Model`,
  `X-OmniRoute-Decision`), but the delegate relays do not surface HTTP headers, so with `auto/*`
  Maestro cannot know which real model wrote a card.
- Compression: per-request header `x-omniroute-compression: off|safe|default|allow-lossy`; the
  operator default profile can be lossy ("aggressive").
- Memory/skills injection: off by default since v3.8.30.
- Client setup: `omniroute setup-opencode` writes an `omniroute` provider into
  `~/.config/opencode/opencode.json` (models addressed as `omniroute/<model>`). No official setup
  for pi or Command Code. Pi supports custom OpenAI-compatible providers (to verify on a real
  install). Command Code has no documented custom base URL.

## Current state of Maestro (relevant)
- Router reads `agents/*.yaml`; each file = one agent CLI + its models
  (`skills/maestro-router/scripts/lib/config.mjs`, `route.mjs`).
- Limits are tracked per provider bucket across agents (`limits.mjs`).
- No pre-dispatch health hook exists: an agent whose backend is down is only detected after a
  failed relay run (costly: one relay start per model).
- Extension point documented in `extensions/README.md`.

## Affected areas
- New: `skills/maestro-omniroute/` (SKILL.md, agent file, scripts, tests).
- Core (small, generic): an optional per-agent `preflight` command in agent files, run once per
  dispatch; non-zero exit → the agent is skipped (and briefly cooled down). Not OmniRoute-specific.
- CI: run pack tests too; core tests must still pass without the pack.

## Risks
- Paid spend through fail-open routing (cost).
- Loss of traceability with `auto/*` (which model wrote/reviewed the code).
- Lossy compression of task cards (correctness).
- OmniRoute as a single point of failure (availability).
- Terms-of-service risk of some "free" routes listed by OmniRoute itself (legal).

## Open decisions → decisions.md (D1–D6)
