## Review target
pr — PR-5, "Пільговий день для штрафу за прострочення" (grace day for late fees): `app/src/loans.js`, `app/test/loans.test.js`, `app/CHANGELOG.md`

## Verdict
REQUEST_CHANGES

## Summary
The policy starts on 1 November, but the code applies the grace day to every loan with no date check. Merged today (2026-10-19), it would lower fees for October and earlier, including loans that are already closed. The PR also weakens the two tests that would have caught this, from exact amounts to `> 0`, which breaks team convention 8. Both can be fixed without changing the approach.

## Risk score
7

## Dimensions applied
Approach & Correctness, Completeness vs Requirements, Security, Quality & Reliability, AI-Specific Risks, Performance, Code Quality & Conventions, Documentation, Scope Discipline

## Findings

### F1 — Grace day is applied before the 1 November start date
- **Severity**: Critical
- **Category**: Approach & Correctness
- **Confidence**: 95
- **Evidence**: `review-queue/pr-5/change.diff` hunk for `app/src/loans.js`:
  ```diff
  +export const GRACE_DAYS = 1; // політика з 1 листопада: перший день прострочення безкоштовний
  ...
  -  const late = daysBetween(loan.dueAt, loan.returnedAt ?? onIso);
  +  const late = daysBetween(loan.dueAt, loan.returnedAt ?? onIso) - GRACE_DAYS;
  ```
  `lateFee` never looks at any date when deciding whether the grace day applies. With seed data in `app/src/db.js:27`, loan 4 (due 2026-10-04, returned 2026-10-07) drops from 1500 to 1000 kopecks. In `app/src/db.js:29`, loan 6 (due 2026-09-16) drops from 11000 to 10500 in `overdueReport` (`app/src/loans.js:57`). Loan 7 (due 2026-08-15, returned 2026-08-20, `app/src/db.js:30`) is closed and still changes from 2500 to 2000. Today is 2026-10-19, so the change would affect every loan as soon as it ships. The PR text (`review-queue/pr-5/PR.md:3`) and the CHANGELOG entry ("library policy from 1 November") say the policy starts on a date the code ignores, which breaks convention 10 (`docs/team-conventions.md:36`).
- **Why it matters**: Fees shown to staff in the weekly report, and fees for returned loans, would be wrong for every day before the policy takes effect. This is a money calculation that does not match the stated business rule.
- **Recommended fix**: Add an effective-date constant (e.g. `GRACE_FROM = "2026-11-01"`) and apply `GRACE_DAYS` only when the loan qualifies. The author needs to decide with the library what "qualifies" means: due on or after 1 November, returned on or after it, or only overdue days falling on or after it. Then document the choice in `lateFee`'s JSDoc and the CHANGELOG. Another option is to hold the merge until 1 November, but that still changes historical fees for closed loans such as loan 7.
- **DA verdict**: KEEP — the stated start date is plainly unimplemented, and the effect on seed data can be computed directly.

### F2 — Exact-amount fee tests weakened to `> 0`, against convention 8
- **Severity**: Warning
- **Category**: Quality & Reliability
- **Confidence**: 98
- **Evidence**: `review-queue/pr-5/change.diff` hunks for `app/test/loans.test.js`:
  ```diff
  -  assert.equal(lateFee(returnedLate, "2026-10-08"), 1500);
  +  assert.ok(lateFee(returnedLate, "2026-10-08") > 0);
  ...
  -  assert.equal(rows[0].feeKopecks, 11000);
  +  assert.ok(rows[0].feeKopecks > 0);
  ```
  `docs/team-conventions.md:30-31`: "Тест перевіряє конкретний результат… Якщо тест заважає зміні, розберіться чому, а не послаблюйте його." (A test checks a concrete result. If a test gets in the way of a change, find out why instead of weakening it.) The PR description (`review-queue/pr-5/PR.md:4-5`) says the weakening was deliberate.
- **Why it matters**: The test failures were a correct signal. They showed fees changing for October loans, which is exactly F1. With `> 0` checks, any wrong amount passes, including a sign error or doubled rate. That leaves the money logic with no regression check on the amount.
- **Recommended fix**: Restore exact assertions. For pre-November dates, keep 1500 and 11000 once F1 is fixed. Add new exact-value tests for dates on or after 1 November.
- **DA verdict**: KEEP — the team rule names this exact behaviour. The severity stays at Warning, not Critical, because F1 already carries the correctness impact.

### F3 — No boundary tests for the grace day
- **Severity**: Warning
- **Category**: Quality & Reliability
- **Confidence**: 90
- **Evidence**: The diff adds no new test cases. `app/test/loans.test.js:36-50` covers only one on-time loan and multi-day-late loans. None checks exactly 1 day late (should be 0), exactly 2 days late (should be 500), or the 31 October / 1 November cut-over.
- **Why it matters**: The new rule lives entirely at these edges. An off-by-one (e.g. `>=` instead of `>`) or a wrong cut-over would go unnoticed, especially with F2 in place.
- **Recommended fix**: Add exact-value tests for 0, 1 and 2 days late after the start date, and for one loan on each side of the start date.
- **DA verdict**: KEEP — the PR changes behaviour and adds no test for that behaviour.

## Unverified claims (confidence < 80)
- `overdueReport` now shows `daysLate: 1` with `feeKopecks: 0` for loans one day overdue (`app/src/loans.js:51-57`). This may confuse staff on reminder calls, or it may be intended. It needs a product decision on whether such loans should be listed or flagged.
- Fees are worked out on read and are not stored anywhere in `app/` (only `app/src/loans.js:57` calls `lateFee`). If fees for returned loans are already charged or shown to members in another system, changing them after the fact is a billing inconsistency. Resolving this needs to know whether historical fees are persisted outside this repo.
- Test outcomes in CI are inferred, not run: the current assertions in `app/test/loans.test.js:40,49` would fail with the diff applied (1000 vs 1500, 10500 vs 11000), and the weakened ones would pass. The CI test-run log would confirm this.

## Gap pass (things I almost missed)
- The CHANGELOG entry (`app/CHANGELOG.md`, new `## 2026-10` section) is present, as convention 6 requires. Its wording, "from 1 November", claims behaviour the code lacks and is covered under F1. It should be corrected along with F1. — `review-queue/pr-5/change.diff:9-11` — Suggestion (folded into F1)
- The comment on `GRACE_DAYS` repeats the start date only in prose (`review-queue/pr-5/change.diff:24`). The date should be a named constant, not a comment. — Suggestion (folded into F1's fix)
- Security, Performance, Scope: no issues. The diff touches only the fee calculation, its tests and the changelog. It adds no new inputs, dependencies, data access or loops. — `review-queue/pr-5/change.diff` — None

## Next steps
1. Implement the 1 November start date in `lateFee`, agree with the library whether it applies by due date, return date or per overdue day, and update the JSDoc and CHANGELOG to match (F1).
2. Restore the exact-amount assertions in `app/test/loans.test.js` (F2).
3. Add exact-value boundary tests for 1 and 2 days late and for loans on each side of the start date (F3).
4. Fix the PR description so it matches the implemented behaviour, per convention 10 (F1).
