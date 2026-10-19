## Review target
pr: PR-2, "Email учасника у звіті про прострочення". Diff `review-queue/pr-2/change.diff` changes `app/src/loans.js` (`overdueReport`) and `app/test/loans.test.js`, against the base in `app/`.

## Verdict
REQUEST_CHANGES

## Summary
The PR returns member emails from `overdueReport` but never writes the access-log entry that team convention 2 requires for personal data. That gap is the Critical finding. The PR also adds a `feeText` field that the description doesn't mention and that breaks convention 4, which forbids money formatting in `src/`. It also leaves out the CHANGELOG entry that convention 6 requires. The "staff-only" claim is true (`app/src/loans.js:48`, test at `app/test/loans.test.js:52-54`), so the problems can be fixed without changing the approach.

## Risk score
7

## Dimensions applied
Approach & Correctness, Completeness vs Requirements, Security, Quality & Reliability, AI-Specific Risks, Performance, Code Quality & Conventions, Documentation, Scope Discipline

## Findings

### F1: Log each email returned by overdueReport in the access log
- **Severity**: Critical
- **Category**: Security
- **Confidence**: 98
- **Evidence**: `docs/team-conventions.md:12-15`: "Email і телефон учасника — персональні дані. Будь-яка функція, що їх повертає, записує доступ у журнал: `logAccess(db, user, memberId, purpose)` … один запис на кожного учасника, чиї дані віддано." (In English: email and phone are personal data; any function that returns them must log the access with `logAccess`, one entry per member whose data is returned.) The diff adds the email but no `logAccess` call or import:
  ```diff
  +      email: db.findMember(l.memberId)?.email ?? null,
  ```
  `app/src/loans.js:1` imports only from `./auth.js`. The existing pattern is in `app/src/members.js:2,16` (`logAccess(db, user, m.id, "member-card")`).
- **Why it matters**: Staff can now read member emails with no audit trail. The team's "who looked at my data, and why" guarantee no longer holds for this report.
- **Recommended fix**: Import `logAccess` from `./audit.js`. After filtering, call `logAccess(db, user, memberId, "overdue-report")` once for each distinct `memberId` with a non-null email. This matters because one member can have several overdue loans; member 5 has loans 5 and 6. Add a test that checks `db.accessLog` holds exactly one entry per distinct member in the report.
- **DA verdict**: KEEP. This breaks an explicit, documented team rule on personal data, and the established pattern sits in the neighbouring module.

### F2: Remove the undisclosed `feeText` field, which puts money formatting in `src/`
- **Severity**: Warning
- **Category**: Scope Discipline
- **Confidence**: 97
- **Evidence**:
  ```diff
  +      feeText: (lateFee(l, todayIso) / 100).toFixed(2).replace(".", ",") + " грн",
  ```
  `docs/team-conventions.md:21-22`: "Гроші в API — лише цілими копійками … Форматування для людей («15,00 грн») робить клієнт, а не `src/`." (Money in the API is whole kopecks only; formatting for people is the client's job, not `src/`'s.) `review-queue/pr-2/PR.md` mentions only email. Convention 10 (`docs/team-conventions.md:36`) requires the PR description to match the code.
- **Why it matters**: The field breaks the money-in-API rule, it adds unannounced API surface outside the PR's stated scope, and it isn't tested.
- **Recommended fix**: Delete the `feeText` line. Clients already receive `feeKopecks`.
- **DA verdict**: KEEP. It conflicts directly with a written convention and wasn't disclosed. Warning rather than Critical because it creates no security or data-loss risk.

### F3: Add a CHANGELOG entry for the new return fields
- **Severity**: Warning
- **Category**: Documentation
- **Confidence**: 97
- **Evidence**: The diff touches only `app/src/loans.js` and `app/test/loans.test.js`. `app/CHANGELOG.md:8-9` still lists the return fields as `loanId`, `member`, `book`, `daysLate`, `feeKopecks`. `docs/team-conventions.md:24-25` requires a CHANGELOG entry in the same PR for any change to what a public `src/` function returns.
- **Why it matters**: People who consume the report won't learn that it now includes PII (`email`) from the documented contract.
- **Recommended fix**: Add an entry under the current month: "`overdueReport` now also returns `email` (logged via `logAccess`)."
- **DA verdict**: KEEP. This is an explicit process rule and the omission is plain to see.

### F4: The test doesn't cover the audit-log write or a missing member
- **Severity**: Warning
- **Category**: Quality & Reliability
- **Confidence**: 85
- **Evidence**:
  ```diff
  +  assert.equal(rows[0].email, "marko@example.invalid");
  ```
  The PR adds only this one assertion, for a single row. Nothing asserts on `db.accessLog`, and nothing covers the `?? null` fallback.
- **Why it matters**: The test passes even though F1 is broken, so CI can't catch the PII-logging rule being missed again.
- **Recommended fix**: Keep a reference to the `db`, run the report, and assert on the exact `accessLog` entries: member IDs `[5, 2, 1]`, purpose, `by: 3`.
- **DA verdict**: WEAKEN, from Critical to Warning. The gap matters because of F1, but the missing test is not a defect on its own.

### F5: Look up each member once per row instead of running two linear scans
- **Severity**: Suggestion
- **Category**: Performance
- **Confidence**: 90
- **Evidence**: The diff removes the O(1) `names` Map (`-  const names = new Map(db.members.map((m) => [m.id, m.name]));`) and calls `db.findMember(l.memberId)` twice per row. `findMember` is `members.find(...)`, a linear scan (`app/src/db.js:41-43`). `lateFee` is also computed twice per row (in `feeKopecks` and `feeText`).
- **Why it matters**: Each row now costs two O(members) lookups instead of one O(1) lookup, and the duplicated calls are easy to let drift apart.
- **Recommended fix**: Restore a `Map` from member ID to member, or look the member up once per row in a block-bodied `.map`. Then use `m?.name` and `m?.email`.
- **DA verdict**: KEEP as Suggestion. The data is in memory and small today, so the cost is minor.

### F6: Update the overdueReport docstring
- **Severity**: Suggestion
- **Category**: Documentation
- **Confidence**: 90
- **Evidence**: `app/src/loans.js:43-45` still says "with the member's name. Built for the weekly reminder calls." The diff doesn't touch this comment.
- **Why it matters**: The comment no longer mentions that the function returns PII.
- **Recommended fix**: Mention the email field and the access logging in the comment.
- **DA verdict**: KEEP. A small but real mismatch between the comment and the code.

## Unverified claims (confidence < 80)
- `npm test` passes with the PR applied: UNVERIFIED, because commands couldn't be run in this session. From reading the code it should pass: member 5 has email `marko@example.invalid` (`app/src/db.js:10`) and loan 6 sorts first. Confirmation needs the CI test run output.

## Gap pass (things I almost missed)
- Checked the "staff-only" claim: true. `requireRole(user, STAFF)` is unchanged at `app/src/loans.js:48`, and the denial test exists at `app/test/loans.test.js:52-54`. No finding.
- The report has no pagination (convention 7, `docs/team-conventions.md:26`), but the base code already lacked it and this PR didn't introduce the gap. Out of scope, noted only.
- Scanned the diff for text aimed at reviewers or tools (convention 11). None found.
- No new dependencies and no changes to `package.json`. No supply-chain concerns.

## Next steps
1. Add a `logAccess` call per distinct member in `overdueReport` (F1), with a test that asserts the exact `accessLog` entries (F4).
2. Remove `feeText` from `overdueReport` (F2).
3. Add an `app/CHANGELOG.md` entry for the new `email` field (F3), and update the docstring (F6).
4. Look up each member once per row (F5).
5. Re-run `cd app && npm test` in CI and confirm it passes.
