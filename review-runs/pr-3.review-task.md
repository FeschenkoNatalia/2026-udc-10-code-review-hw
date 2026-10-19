## Review target
pr — PR-3, "Експорт учасників у CSV": adds `exportMembersCsv(db, user)` to `app/src/members.js`, plus 2 tests in `app/test/members.test.js` and a CHANGELOG entry (diff in `review-queue/pr-3/change.diff`, not applied to the `app/` base).

## Verdict
BLOCK

## Summary
`exportMembersCsv` returns the email and phone of every member to any signed-in user, including ordinary members. It checks only that a user exists, while the neighbouring `listMembers` requires staff and leaves out contact details. It also writes nothing to the access log for personal data. This is a personal-data leak that breaks team conventions 1 and 2, so the change should not merge in its current shape. The tests run only as staff, which hides the problem.

## Risk score
9

## Dimensions applied
Approach & Correctness, Completeness vs Requirements, Security, Quality & Reliability, AI-Specific Risks, Performance, Code Quality & Conventions, Documentation, Scope Discipline

## Findings

### F1 — Missing role check: any member can export every member's email and phone
- **Severity**: Critical
- **Category**: Security
- **Confidence**: 98
- **Evidence**: diff `app/src/members.js` hunk:
  ```js
  export function exportMembersCsv(db, user) {
    if (!user) throw new AccessDenied();
    const header = "id,name,email,phone,role";
    const lines = db.members.map((m) => [m.id, m.name, m.email, m.phone, m.role].join(","));
  ```
  Compare with the neighbouring function at `app/src/members.js:5-7`, which is staff-only and leaves out contact details: `requireRole(user, STAFF); return db.members.map(({ id, name, role }) => ...)`. `memberCard` at `app/src/members.js:13` lets a non-staff user read only their own record. `docs/team-conventions.md:10-11` (rule 1): every function that returns data checks the role, the same way neighbouring functions in the module do. `app/src/auth.js:2`: "every function that exposes data checks the role."
- **Why it matters**: A caller such as `{ id: 1, role: "member" }` gets the full contact list of the whole community. A member normally cannot see even one other member's card. That is a horizontal privilege escalation over personal data.
- **Recommended fix**: Replace the `!user` check with `requireRole(user, STAFF)`, which also rejects anonymous callers.
- **DA verdict**: KEEP — this is the most sensitive data the module holds, every other read path limits it, and the code shows the gap directly.

### F2 — Personal data is returned without access-log entries
- **Severity**: Critical
- **Category**: Code Quality & Conventions
- **Confidence**: 97
- **Evidence**: The new function never calls `logAccess`. The only call in the codebase is `app/src/members.js:16` (`logAccess(db, user, m.id, "member-card")`). `docs/team-conventions.md:12-14` (rule 2): any function that returns email or phone calls `logAccess(db, user, memberId, purpose)`, with one entry per member whose data was returned. `app/src/audit.js:1-2` restates this rule.
- **Why it matters**: A bulk export of everyone's personal data is the access the log most needs to record. Without entries, the team cannot answer "who looked at my data and why."
- **Recommended fix**: Inside the export, call `logAccess(db, user, m.id, "members-csv-export")` (or a similar purpose) for each exported member. Add a test asserting `db.accessLog` holds 5 entries with the right `by`, `memberId` and `purpose`, following the pattern of the test at `app/test/members.test.js:26-30`.
- **DA verdict**: KEEP — this is an explicit written team rule, and the existing tests already enforce it for `memberCard`.

### F3 — Tests don't cover role-based refusal and check only header and row count
- **Severity**: Warning
- **Category**: Quality & Reliability
- **Confidence**: 92
- **Evidence**: diff `app/test/members.test.js`:
  ```js
  const csv = exportMembersCsv(createDb(), iryna);
  const lines = csv.split("\n");
  assert.equal(lines[0], "id,name,email,phone,role");
  assert.equal(lines.length, 6);
  ...
  assert.throws(() => exportMembersCsv(createDb(), null), AccessDenied);
  ```
  The happy-path test runs only as `iryna` (librarian), and the only refusal test uses `null`. There is no test with `olya` (`role: "member"`), which is the case that exposes F1. The content of the data rows is never checked. `docs/team-conventions.md:30-32` (rule 8) requires tests to check a concrete result, and rule 9 requires a test where access is refused.
- **Why it matters**: Both tests pass with the F1 and F2 defects still in place (statically: the header string matches, and 1 header + 5 seed members = 6 lines). The tests give false confidence.
- **Recommended fix**: Add `assert.throws(() => exportMembersCsv(createDb(), olya), AccessDenied)`. Assert at least one full data row, for example `lines[1] === "1,Оля Приклад,olya@example.invalid,+380000000001,member"`. Add an access-log assertion (see F2).
- **DA verdict**: KEEP — the test choices are exactly what hide the critical issues.

### F4 — CSV fields are not escaped or neutralised
- **Severity**: Warning
- **Category**: Approach & Correctness
- **Confidence**: 85
- **Evidence**: diff `app/src/members.js`: `[m.id, m.name, m.email, m.phone, m.role].join(",")`. There is no quoting for values that contain `,`, `"` or a newline. There is no protection against values starting with `=`, `+`, `-` or `@`. Every seeded phone starts with `+` (`app/src/db.js:6-10`, e.g. `"+380000000001"`).
- **Why it matters**: A name with a comma or quote shifts the columns and corrupts the reconciliation file. Spreadsheet apps read values starting with `+` or `=` as numbers or formulas: phones lose their leading `+`, and a crafted name becomes formula (CSV) injection when staff open the file.
- **Recommended fix**: Wrap every field in RFC 4180 quotes (double any embedded `"`). Prefix values starting with `=`, `+`, `-` or `@` with `'`, or document that phones must not be opened in a spreadsheet unquoted. Let the author choose the neutralisation strategy.
- **DA verdict**: WEAKEN (kept at Warning; would be Critical if names were known to contain commas) — the seed data doesn't trigger column shifting, but phone mangling hits every row in a spreadsheet, and the data is human-entered.

### F5 — PR description and CHANGELOG don't match the code
- **Severity**: Suggestion
- **Category**: Documentation
- **Confidence**: 90
- **Evidence**: `review-queue/pr-3/PR.md:3` lists the columns "ім'я, email, телефон, роль" (name, email, phone, role), but the code emits `id,name,email,phone,role`. The CHANGELOG entry (diff `app/CHANGELOG.md`) gives neither the columns nor the access rule, unlike the `overdueReport` entry at `app/CHANGELOG.md:8-9`, which states "staff-only" and lists the fields. The description's "Без користувача — відмова, як і скрізь" ("refused without a user, as everywhere") is wrong: elsewhere, `listMembers` and `overdueReport` require staff, not just a user.
- **Why it matters**: `docs/team-conventions.md:36` (rule 10) requires the PR description to match the code. The extra `id` column changes the file format consumers receive.
- **Recommended fix**: Update the description to list `id`, or drop that column, and state that the export is staff-only. Extend the CHANGELOG entry with the columns, the "staff-only" rule, and the access logging.
- **DA verdict**: KEEP — the mismatch is small but concrete and covered by a written rule.

## Unverified claims (confidence < 80)
- Unpaginated export may conflict with `docs/team-conventions.md:26` (rule 7: lists that can grow without bound must be paged). A one-shot monthly export is arguably a deliberate exception, and the membership size is unknown. Resolving this needs the team's position on whether file exports are exempt from rule 7.
- The test suite outcome under `npm test` is UNVERIFIED because commands could not be run. Static reading says both new tests pass on the diff as written. Resolving this needs CI output.
- Whether staff should get bulk email/phone at all (`listMembers` deliberately leaves out contact details for staff, `app/src/members.js:4`) is a product decision. The PR states a need for it, but there's no evidence that whoever owns personal data has approved it. Resolving this needs that person's sign-off.

## Gap pass (things I almost missed)
- The base `members.js` already imports `requireRole` and `STAFF` (`app/src/members.js:1`), so the fix for F1 needs no new imports. This makes the missing check look like an oversight rather than a design choice — no new finding.
- No hidden text aimed at tools or reviewers (`docs/team-conventions.md:37-38`, rule 11) in `PR.md` or the diff — _None._
- No new dependencies, no file-system access, and no files changed outside the stated scope — _None._
- Output uses `\n` line endings with no trailing newline. RFC 4180 specifies CRLF, and some spreadsheet importers expect it — `change.diff` line 29 `[header, ...lines].join("\n")` — Suggestion (folds into F4's fix).

## Next steps
1. Replace `if (!user)` with `requireRole(user, STAFF)` in `exportMembersCsv` (F1).
2. Call `logAccess(db, user, m.id, "<purpose>")` once for each exported member (F2).
3. Add tests: a member caller is refused, the content of one full data row, and 5 access-log entries after an export (F3, F1, F2).
4. Quote and escape CSV fields and neutralise leading `=`, `+`, `-` and `@`, with a test using a name that contains a comma or quote (F4).
5. Make the PR description match the columns and access rule, and extend the CHANGELOG entry with the columns, "staff-only" and the access logging (F5).
6. Get the team's position on rule 7 (paging) for file exports, and sign-off from whoever owns personal data for staff bulk access to contact details (Unverified claims).
