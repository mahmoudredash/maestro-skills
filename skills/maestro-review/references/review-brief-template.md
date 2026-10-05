# Code review request — T0X <title>

You are a strict senior reviewer. You are READ-ONLY: do not modify any file.
Review the change below against its task card. Report only real problems you can point to
in the diff. Do not invent issues, and do not suggest refactors outside the card's scope.

## The task card (the contract)
<paste the full task card, including Done criteria and DO NOT>

## Verification output (already run by the coordinator)
```
<paste logs/T0X/verify.txt>
```

## The diff
```diff
<paste the output of: git diff>   (and the content of any new untracked files)
```

## Check
1. Does the code do exactly what the Steps and the business rules say, including every worked example?
2. Is every edge case in the card's table handled as specified?
3. Are there any invented APIs or imports that don't exist?
4. Are there changes outside "Files to change", new dependencies, or edited existing tests?
5. Do the tests assert real values, and would they fail if the feature were removed?
6. Any security or data issues (injection, missing auth checks, secrets, PII in logs)?

## Answer with ONLY this JSON
```json
{
  "verdict": "pass" | "fix",
  "findings": [
    { "severity": "blocking" | "minor", "file": "path", "line": 0, "problem": "...", "required": "..." }
  ],
  "done_criteria": { "<criterion text>": true | false }
}
```
