# Decisions — 001 OmniRoute pack

Status: WAITING ON USER

## D1 — Where does OmniRoute sit in the model pool?
Expert role: Platform architect
| Option | Description |
|---|---|
| A ⭐ | OmniRoute models are extra pool members (own agent file `opencode-omniroute`), ranked with the direct models by tier/good_for |
| B | All free implementer/reviewer traffic goes through OmniRoute; direct models disabled |
| C | OmniRoute only as the last fallback, after every direct model is limited |
Recommendation A: adds capacity and smart failover without making OmniRoute a single point of failure.

## D2 — Does the leader go through OmniRoute?
Expert role: Security / quality lead
| Option | Description |
|---|---|
| A ⭐ | Never in `claude-led`; allowed in `free-only` (leader = opencode + an OmniRoute model) |
| B | Yes, also in `claude-led` (`omniroute launch`) |
| C | Never, in any profile |
Recommendation A: decisions and plans need a stable, known model; free-only users still benefit.

## D3 — Sensitive cards and cross-review
Expert role: QA lead
| Option | Description |
|---|---|
| A ⭐ | `auto/*` combos are not used for sensitive cards or the reviewer role; only OmniRoute entries pinned to an explicit provider/model are |
| B | Allow `auto/*` everywhere |
| C | Exclude OmniRoute completely from sensitive cards and review |
Recommendation A: with `auto/*` we cannot know which real model ran, so "reviewer ≠ implementer provider" cannot be guaranteed.

## D4 — Cost guard (fail-open routing can reach paid models)
Expert role: FinOps
| Option | Description |
|---|---|
| A ⭐ | Require OmniRoute strict free policy (`freeAccessPolicy: strict`); `doctor` verifies it; if it cannot be verified, OmniRoute models drop to `standby` with a warning |
| B | Only `hidePaidModels` (weaker: exhausted free tiers may bill) |
| C | Trust the user's OmniRoute setup, no check |
Recommendation A.

## D5 — When OmniRoute is down
Expert role: SRE
| Option | Description |
|---|---|
| A ⭐ | Pre-dispatch health check (`/healthz`, 2 s timeout); if down, skip OmniRoute models with a 10-min cooldown and continue on direct models; note it in status.md |
| B | Stop and ask the user |
| C | Try to auto-start OmniRoute in the background |
Recommendation A (needs a small generic `preflight` hook in core agent files).

## D6 — Compression of task cards
Expert role: Correctness / QA
| Option | Description |
|---|---|
| A ⭐ | `safe` (dedup + whitespace only), set as a provider header in the generated opencode config |
| B | `off` |
| C | OmniRoute's operator default (can be lossy) |
Recommendation A: cards depend on exact names and numbers; lossy compression risks wrong code.

## Assumptions (vetoable)
- Agents: opencode first (official `omniroute setup-opencode`). pi added only after verifying its custom-provider support on a real install. Command Code excluded (no custom base URL documented).
- Base URL default `http://localhost:20128`; API key from env `OMNIROUTE_API_KEY` (placeholder `sk_omniroute` when the server does not require keys); management credentials optional (only for the strict-policy check).
- Default OmniRoute pool entries: `auto/coding:free` (tier 3, normal feature/refactor/tests), `auto/offline` (tier 2, mechanical/docs, quota headroom), `auto/fast` standby.
- Provider bucket `omniroute`, `limit_scope: provider`, cooldown 10 min (OmniRoute already fails over internally, so a 429 from it means it is out of options for now).
- Terms-of-service: the pack's README recommends official free tiers only.
- Core change limited to the generic `preflight` hook (+ tests); no OmniRoute-specific code in core.

## User answers
_pending_
