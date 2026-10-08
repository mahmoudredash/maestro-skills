---
name: maestro-review
description: Tests and reviews work produced by free models — runs the card's checks for real, gets a read-only cross-review from a model of a different provider, issues PASS / FIX / TAKEOVER, and runs the whole-feature final review. Use at maestro Phases 5–7, inside a workstream, or whenever delegated or AI-generated changes must be verified before commit.
license: MIT
metadata:
  version: 1.0.0
---

# Review

**Evidence = command output you ran yourself + the diff you read yourself.** An
implementer's report, or a reviewer model's opinion, is input to your decision, not proof.

## Per-card review
1. **Scope:** `git status --porcelain` and `git diff --stat`. Every changed path must appear in the card's "Files to change". Unexpected files mean FIX, or revert those paths.
2. **Verify:** run every command in the card's Verify section. Save the output to `logs/T0X/verify.txt`. Any failure means FIX.
3. **Cross-review** (cheap, and catches what tests miss):
   - Fill in `references/review-brief-template.md`, including the full `git diff`.
   - Dispatch with `--role reviewer --read-only --exclude-model <implementer agent:model> --avoid-provider <implementer provider>`. The same model is never its own reviewer. A different provider is preferred, but when every eligible reviewer shares the implementer's provider (for example an OpenCode-only setup), a different model from that provider still reviews.
   - The reviewer returns a JSON verdict. A `blocking` finding means FIX, **after you confirm it in the diff**. Reviewer models sometimes hallucinate problems: drop any finding you cannot point to in the diff.
   - If the reviewer dispatch comes back `exhausted`, skip the cross-review for normal cards and note it. For sensitive cards, escalate to the leader instead.
4. **Done criteria:** tick each one. The card's worked examples must exist as passing tests.
5. **Verdict:**
   - **PASS:** steps 1–4 are clean. Commit, except sensitive cards, which go to the leader (`AWAITING-LEADER`).
   - **FIX:** concrete and fixable. Append feedback to the card, written as `file:line → what is wrong → what it must be`, and re-run the Verify commands. Small cosmetic issues (a typo, a lint autofix): fix them yourself and PASS. That is cheaper than a retry.
   - **TAKEOVER:** 3 failed attempts across models, the model went far off-track, or the card turns out to be wrong or underspecified. Return it to the leader with a one-line reason.

## Final review (leader or `roles.final_reviewer`)
1. Run the full test, lint, typecheck, and build suite (`config.yaml → verification`, or auto-detected). Record the real output.
2. If the agent has `code-review` or `security-review` skills, run them on the branch diff. Otherwise apply `references/review-checklist.md`, section B. `security-review` is mandatory when any card was sensitive.
3. Check every success criterion in `analysis.md`, and every approved D# (grep for the code that applies it).
4. Check consistency across cards: no duplicated helpers, consistent naming and patterns.
5. Fix the issues (or write a new card for each and route it), then repeat steps 1–4. Fill in "Final verification" in `status.md`.

## Honesty
If something still fails, say which command fails, include its output, and explain why it
is not fixed. Never round "mostly passing" up to "passing".
