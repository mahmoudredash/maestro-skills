---
name: maestro-breakdown
description: Converts an approved plan (or a speckit tasks.md) into ultra-explicit, self-contained task cards that a small or free model can execute without guessing, tagged with Type / Sensitivity / Workstream so the router can pick the right free model. Use at maestro Phase 4, or whenever work is about to be handed to a weaker model or another agent.
license: MIT
metadata:
  version: 1.0.0
---

# Task cards for free models

Free models often have a small context window, follow instructions weakly, make up APIs,
wander out of scope, and claim success they didn't achieve. Write cards that leave them
**no room to guess**. A well-written card is the biggest single saver of tokens and retries
in the whole pipeline.

## Sizing
- One card = **one coherent change**: about 1–3 files and roughly ≤150 changed lines. Split anything larger.
- Every card is **verifiable on its own**, with a command whose output proves it works.
- Order cards by dependency. Shared scaffolding (types, interfaces, constants, migrations) goes in early cards, so later cards reference real code.
- If you cannot write a step without "use your judgment", "handle appropriately", or "as needed", the card isn't ready. Specify it fully, or split the uncertain part out and decide it yourself first.

## Router fields (required in every card's header)
- **Type** (exactly one): `feature` · `refactor` · `api` · `tests` · `ui` · `docs` · `mechanical` · `analysis` · `complex-logic` · `migration`.
- **Sensitivity**: `sensitive` if the card touches anything listed under `sensitive_topics` in the config (money, auth, security, migrations on existing data, deleting data). Otherwise `normal`. Sensitive cards get the strongest free models and a mandatory leader diff check.
- **Workstream**: `W1`, `W2`, … (from the plan).

## What every card contains
Use `references/task-card-template.md` exactly.
1. **Self-contained context**: quote the decision text (not just "D2"). Never write "as discussed".
2. **Exact file paths** to create or modify, and the files to read first, with line ranges.
3. **Existing code to reuse**: exact import paths and signatures, copied from the repo.
4. **Numbered imperative steps** naming every function, field, type, route, and error message.
5. **Code skeletons** for anything non-trivial. For business rules: the formula plus worked numeric examples.
6. **An edge-case table**, with the expected behavior for each case.
7. **Tests to write**: the file path, the test names, and the inputs → expected outputs.
8. **Verification commands** and the output to expect.
9. **A DO NOT list** specific to this card (files not to touch, no new dependencies, no editing tests to make them pass, no commit).
10. **Done criteria** as a checklist.
11. **If blocked**: write `BLOCKED.md` in the state folder and stop. No improvising.

## Self-check before saving
- [ ] Could someone with ONLY this card and the repo finish it?
- [ ] Is every name real in this repo (spot-check with grep)?
- [ ] Are business rules backed by worked numeric examples?
- [ ] Is there a command that fails before the change and passes after it?
- [ ] Are Type, Sensitivity, and Workstream set?

Save the cards as `tasks/T01-<slug>.md`, …, list the workstreams in `workstreams.md`, and add the cards to `status.md`.
