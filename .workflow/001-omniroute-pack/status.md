# Status — 001-omniroute-pack

**Request:** Optional OmniRoute skill pack, separate from the core, on its own branch.
**Size:** M
**Profile:** claude-led   **Leader:** claude-code
**Current phase:** 8-Done (awaiting PR review)
**Branch:** claude/omniroute-pack

## Gates
- [x] Decisions presented (2026-10-06)
- [x] Decisions answered (2026-10-06): D1–D6 approved as recommended

## Plan outline (assuming recommended options)
1. Core: generic per-agent `preflight` command in agent files (+ tests, docs).
2. Pack `skills/maestro-omniroute/`: SKILL.md, agent file `opencode-omniroute.yaml`, `omniroute.mjs` (health, check, setup).
3. `check`: /healthz, /v1/models catalog vs agent file, strict free policy, compression header.
4. `setup`: wraps `omniroute setup-opencode` and adds the `x-omniroute-compression: safe` header.
5. Routing rules: no `auto/*` for sensitive cards or reviewers.
6. Tests with a fake OmniRoute server; core tests unchanged without the pack; CI runs both.

## Execution
Leader implemented directly (no free-model CLIs in this cloud session). See plan.md.

## Final verification
- test: `npm test` → 45 passed, 0 failed (also with no git identity configured)
- CI steps locally: config load, route preview, English-only check → pass
- install.sh: core-only install has no packs; `--with omniroute` installs and the router discovers it
- Preflight from a path containing spaces → runs

## Follow-ups / deferred
- pi support through OmniRoute (verify custom providers on a real install).
- Real end-to-end run against a live OmniRoute + opencode (not possible in this environment).
- Quota-aware pre-dispatch routing (OmniRoute status API needs management auth).

## Resume note
Done. Waiting for the PR review/merge.
