---
name: maestro-omniroute
description: Optional Maestro extension pack that adds a local OmniRoute gateway as an extra source of free models for maestro-router — health-checked before every dispatch, guarded against paid fall-through, with safe prompt compression. Use when setting up, checking, or troubleshooting OmniRoute for Maestro, or when the user asks to route free-model work through OmniRoute. The core works without it.
license: MIT
compatibility: Requires the maestro core skills, Node 18+, OpenCode, delegate-skills' opencode-delegate, and a running OmniRoute (npm i -g omniroute).
metadata:
  version: 1.0.0
---

# Maestro × OmniRoute (extension pack)

`OR` = `node <skills-root>/maestro-omniroute/scripts/omniroute.mjs`
`MR` = `node <skills-root>/maestro-router/scripts/maestro.mjs`

## What the pack adds
- **Agent `opencode-omniroute`** (`maestro-agents/opencode-omniroute.yaml`): the router discovers it automatically. It is the same OpenCode CLI as the core `opencode` agent, but its models are served by OmniRoute. Its models join the normal ranking (tier, `good_for`) alongside the direct models (decision D1).
- **Preflight** before every dispatch, through the core's generic `preflight` hook:
  - Gateway down → the agent is skipped and cooled down for 10 minutes, and work continues on direct models (D5).
  - Cost guard not confirmed → its models are used **only as fallback** (D4).
- **Safe compression:** the OpenCode provider sends `x-omniroute-compression: safe` (dedup and whitespace only), so task cards keep their exact names and numbers (D6).

## Rules the pack enforces (approved decisions)
| Decision | Rule |
|---|---|
| D1 | OmniRoute models are extra pool members. They never replace the direct models. |
| D2 | The leader never goes through OmniRoute in `claude-led`. In `free-only` you may set `roles.leader.model` to a pinned OmniRoute model. |
| D3 | `auto/*` combos hide which real model ran, so they are `roles: [implementer]` and `sensitive_ok: false`: never a reviewer, never a sensitive card. **Pinned** models (`omniroute/<provider>/<model>`) are traceable and may do both. Give them `provider: <upstream>` so cross-review exclusion and limits line up with the direct agents. |
| D4 | OmniRoute's `auto/<category>:free` filtering is fail-open: with no free match it uses the full pool, **paid models included**. Its models count as primary only when the strict free policy (`freeAccessPolicy: strict`) is **verified** (management key) or **attested** by you. A server that reports a non-strict policy always means fallback-only. |
| D5 | Gateway down never stalls the work: skip it, cool it down, use the direct models. |
| D6 | Compression stays `safe` for task cards. |

## Setup (once)
```bash
npm i -g omniroute && omniroute                   # start the gateway (http://localhost:20128)
export OMNIROUTE_API_KEY=sk_omniroute             # or a real key if your server requires keys
$OR setup                                         # adds/updates the "omniroute" provider in opencode.json (backup: .bak)
#   then, in the OmniRoute dashboard: enable the strict free policy (STRICT_ZERO_COST), then EITHER
export OMNIROUTE_MANAGEMENT_KEY=...               #   (lets `check` verify it), OR
$OR attest-strict                                 #   (records that you enabled it yourself)
$OR check                                         # health, catalog vs the agent file, cost guard
$MR doctor                                        # the router's view, including preflight=ok|standby|down
```
If `omniroute` is on PATH, `setup` also runs `omniroute setup-opencode`. If `opencode.json` contains
comments, `setup` leaves it untouched and prints the snippet to paste by hand.

## Day to day
- Nothing to do. The router runs the preflight once per dispatch.
- After a gateway outage, its models come back by themselves when the 10-minute cooldown ends.
  `$MR limits clear agent:opencode-omniroute` brings them back immediately.
- To add a model: copy the agent file to `~/.config/maestro/agents/` (your copy replaces the pack's) and add entries. Run `$OR check` to confirm OmniRoute knows each id.
- To disable the pack without uninstalling it: `extensions: { disabled: [maestro-omniroute] }` in `config.yaml`.

## Use official free tiers only
OmniRoute lists the terms-of-service risk of some "free" routes itself. Prefer providers' official
free tiers. Do not connect accounts in ways their terms forbid.

## Not supported (yet)
- **pi:** waits until custom-provider support is verified on a real install.
- **Command Code:** no documented custom base URL.
- **Quota-aware routing before dispatch:** v1 relies on OmniRoute's own failover plus Maestro's cooldowns.
