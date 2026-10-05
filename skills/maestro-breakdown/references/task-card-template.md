# T0X — <imperative title, e.g. "Add delivery-fee calculation to OrderService">

| Field | Value |
|-------|-------|
| Run | <NNN>-<slug> |
| Type | feature · refactor · api · tests · ui · docs · mechanical · analysis · complex-logic · migration |
| Sensitivity | normal · sensitive |
| Workstream | W1 |
| Depends on | T0Y · none |
| Size | <files> files, ~<lines> lines |

## 1. Goal
<One or two sentences: what exists after this card that did not exist before.>

## 2. Context (self-contained)
- Project: <stack and versions, e.g. "Node 20, NestJS 10, Prisma 5, Jest">
- Why: <business reason, one line>
- Decisions that apply (quoted):
  - D2: "<exact approved decision text>"
- Conventions: <e.g. "services throw AppError(code, message); never return null for not-found">

## 3. Read these first
- `src/orders/order.service.ts` lines 1–80 (class structure, constructor injection)
- `src/common/errors.ts` (AppError)

## 4. Existing code to reuse (do NOT reinvent)
```ts
// src/common/money.ts
export function roundMoney(value: number, decimals = 2): number
```

## 5. Files to change
| Action | Path | What |
|--------|------|------|
| modify | `src/orders/order.service.ts` | add method `calculateDeliveryFee` |
| create | `src/orders/order.service.fee.spec.ts` | unit tests |

## 6. Steps
1. In `src/orders/order.service.ts`, add `import { roundMoney } from '../common/money';` next to the other imports.
2. Add this public method to class `OrderService`, directly after `createOrder()`:
   ```ts
   calculateDeliveryFee(weightKg: number, zone: 'A' | 'B' | 'C'): number {
     // per D2: base by zone + 1.5 per kg above 5kg, rounded to 2 decimals
   }
   ```
3. Rule: base A=20, B=35, C=50. Each kg above 5 adds 1.5. Round with `roundMoney`.
   Worked examples: (3kg, A) → 20.00 · (5kg, B) → 35.00 · (8kg, C) → 54.50 · (6.4kg, A) → 22.10
4. If `weightKg <= 0`, throw `new AppError('INVALID_WEIGHT', 'Weight must be positive')`.

## 7. Edge cases
| Input | Expected |
|-------|----------|
| weightKg = 0 | throws AppError INVALID_WEIGHT |
| weightKg = 5 exactly | no surcharge |

## 8. Tests to write
File: `src/orders/order.service.fee.spec.ts`
- `returns base fee under threshold` → (3, 'A') = 20
- `adds surcharge above 5kg` → (8, 'C') = 54.5
- `rounds to 2 decimals` → (6.4, 'A') = 22.1
- `rejects non-positive weight` → (0, 'A') throws INVALID_WEIGHT

## 9. Verify (run every command; paste the real output in your final message)
```bash
npx jest src/orders/order.service.fee.spec.ts   # expect: 4 passed, 0 failed
npx tsc --noEmit                               # expect: no errors
npx eslint src/orders                           # expect: no errors
```

## 10. DO NOT
- Do not modify any file not listed in section 5.
- Do not add dependencies.
- Do not change existing tests or snapshots.
- Do not reformat or "clean up" unrelated code.
- Do not commit or push. The reviewer commits.

## 11. Done criteria
- [ ] `calculateDeliveryFee` exists with the exact signature above
- [ ] All 4 worked examples are covered by passing tests
- [ ] tsc and eslint are clean
- [ ] The diff touches only the files in section 5

## 12. If blocked
Stop. Write `.workflow/<NNN>-<slug>/BLOCKED.md` with: what you tried, the exact error, and the question you need answered. Do not guess.

## 13. Final report format (your last message)
```
FILES CHANGED: <list>
VERIFY OUTPUT: <each command + its real output>
NOTES: <anything the reviewer must know; decisions you had to make>
```

---
<!-- Feedback from review is appended below on FIX verdicts -->
