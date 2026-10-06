# Status — 001-omniroute-pack

**Request:** Optional OmniRoute skill pack, separate from the core, on its own branch.
**Size:** M
**Profile:** claude-led   **Leader:** claude-code
**Current phase:** 2-Decisions (WAITING ON USER)
**Branch:** claude/omniroute-pack

## Gates
- [x] Decisions presented (2026-10-06)
- [ ] Decisions answered

## Plan outline (assuming recommended options)
1. Core: generic per-agent `preflight` command in agent files (+ tests, docs).
2. Pack `skills/maestro-omniroute/`: SKILL.md, agent file `opencode-omniroute.yaml`, `omniroute.mjs` (health, check, setup).
3. `check`: /healthz, /v1/models catalog vs agent file, strict free policy, compression header.
4. `setup`: wraps `omniroute setup-opencode` and adds the `x-omniroute-compression: safe` header.
5. Routing rules: no `auto/*` for sensitive cards or reviewers.
6. Tests with a fake OmniRoute server; core tests unchanged without the pack; CI runs both.

## Resume note
Waiting for the user's answers to D1–D6 in decisions.md.
