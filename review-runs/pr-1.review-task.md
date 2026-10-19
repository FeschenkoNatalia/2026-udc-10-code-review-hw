## Review target
pr: PR-1 "Сторінкування для списку позик" (pagination for the loans list). It adds `listLoansPage` to `app/src/loans.js` and one test to `app/test/loans.test.js`. The diff is at `review-queue/pr-1/change.diff` and has not been applied to the `app/` base.

## Verdict
REQUEST_CHANGES

## Summary
`listLoansPage` treats `page` as 1-based by default but computes the offset as 0-based. The default call `page = 1` skips the first `pageSize` rows, so staff never see page 1. With the 7-row seed it returns an empty list. The one new test does not check `items`, so it passes anyway, and the PR also breaks team conventions 6 (CHANGELOG), 7 (bounded page size), 8 (tests must check a concrete result) and 9 (a denied-access test).

## Risk score
7

## Dimensions applied
Approach & Correctness, Completeness vs Requirements, Security, Quality & Reliability, AI-Specific Risks, Performance, Code Quality & Conventions, Documentation, Scope Discipline

## Findings

### F1 — Page offset is off by one page; the first page is never returned
- **Severity**: Critical
- **Category**: Approach & Correctness
- **Confidence**: 100
- **Evidence**: `review-queue/pr-1/change.diff:10-13`
  ```js
  +export function listLoansPage(db, user, { page = 1, pageSize = 20 } = {}) {
  +  const all = listLoans(db, user);
  +  const start = page * pageSize;
  +  return { items: all.slice(start, start + pageSize), page, pageSize, total: all.length };
  ```
  The default `page = 1` gives `start = 20`, so `items` holds rows 20-39 and rows 0-19 can't be reached through the default. With seed data (`app/src/db.js:23-31`, 7 loans) and the test's call `{ page: 1, pageSize: 20 }`, `items` is `[]` while `total` is 7.
- **Why it matters**: The main feature, showing staff the loans list page by page, returns the wrong rows on every page and hides the first page entirely. That is the most common request.
- **Recommended fix**: `const start = (page - 1) * pageSize;` (keeping 1-based pages, which matches the default). Add a test that the first page holds the first N loan ids and that page 2 holds the next ones.
- **DA verdict**: KEEP — checked by hand against the seed data; the default value and the offset formula contradict each other.

### F2 — The new test does not check `items`, so the off-by-one bug passes
- **Severity**: Warning
- **Category**: Quality & Reliability
- **Confidence**: 100
- **Evidence**: `review-queue/pr-1/change.diff:36-41`
  ```js
  +test("paged list reports the total and the page it returned", () => {
  +  const res = listLoansPage(createDb(), iryna, { page: 1, pageSize: 20 });
  +  assert.equal(res.total, 7);
  +  assert.equal(res.page, 1);
  +  assert.equal(res.pageSize, 20);
  ```
  `page` and `pageSize` just echo the input values back. Nothing checks which rows came back. `docs/team-conventions.md:30` (rule 8) says a test must check a concrete result.
- **Why it matters**: The test passes by construction while the function returns `items: []` (F1). CI going green here proves nothing about pagination.
- **Recommended fix**: Assert `res.items.map(l => l.id)` for at least a first page and a later page (e.g. `pageSize: 3` -> `[1,2,3]`, then `[4,5,6]`, then `[7]`). Also check that a member sees only their own loans through the paged API.
- **DA verdict**: KEEP — this test is the reason the Critical bug got through.

### F3 — Page size has no upper bound
- **Severity**: Warning
- **Category**: Code Quality & Conventions
- **Confidence**: 95
- **Evidence**: `review-queue/pr-1/change.diff:10`: `pageSize` comes straight from the caller and is never limited. `docs/team-conventions.md:26` (rule 7): "Lists that can grow without limit are paged, with a bounded page size." (translated from Ukrainian)
- **Why it matters**: `pageSize: 1e9` gets the whole 3,000+ row list back, which defeats the purpose of the PR and breaks the convention. Inputs are not validated either: a negative `page` gives a negative `start` and `slice` then returns rows from the end, while `NaN` or a non-integer gives empty or odd slices.
- **Recommended fix**: Define a `MAX_PAGE_SIZE` constant and clamp to it. Require `page >= 1` and `1 <= pageSize <= MAX_PAGE_SIZE` as integers, and either throw or clamp otherwise.
- **DA verdict**: KEEP — the convention says this explicitly.

### F4 — No CHANGELOG entry for the new public function
- **Severity**: Warning
- **Category**: Documentation
- **Confidence**: 100
- **Evidence**: The diff touches only `app/src/loans.js` and `app/test/loans.test.js`. `app/CHANGELOG.md:3-4` and `docs/team-conventions.md:24-25` (rule 6) say: "Any change to what a public function in `src/` accepts or returns needs an entry in `app/CHANGELOG.md` in the same PR. A new function counts as a change too." (translated from Ukrainian)
- **Why it matters**: This is a required process rule, and API users will not find out about `listLoansPage` or the shape of its return value.
- **Recommended fix**: Add an entry such as `` `listLoansPage(db, user, { page, pageSize })` — returns `{ items, page, pageSize, total }`; pages start at 1, pageSize at most N `` under a 2026-10 heading.
- **DA verdict**: KEEP — the rule names this case directly.

### F5 — No test where access is denied
- **Severity**: Warning
- **Category**: Quality & Reliability
- **Confidence**: 85
- **Evidence**: `listLoansPage` inherits its access check from `listLoans` (`app/src/loans.js:24-25`: it throws without a user and filters to the member's own rows). `docs/team-conventions.md:32` (rule 9): "A new function with an access check has a test where access is **denied**." (translated from Ukrainian) The diff adds no such test, for example `listLoansPage(db, null)` throwing, or a member getting only their own rows and their own `total`.
- **Why it matters**: If someone later rewrites the function to read `db.loans` directly, members would see every loan and no test would catch it.
- **Recommended fix**: Add tests that a call without a user throws, and that `listLoansPage(db, olya).total === 3` with only ids `[1,2,7]`.
- **DA verdict**: KEEP — the rule is mandatory. Confidence is below 100 only because the access logic is delegated rather than written in the new function.

## Unverified claims (confidence < 80)

- Copying all rows on every call (`listLoans` maps a copy of all 3,000+ rows, then slices) may not address the "UI is slow" complaint if the cost is on the server. Resolving it needs profiling data showing whether payload size or server-side work is the bottleneck.
- No sort order is defined for the pages, so rows come back in `db.loans` insertion order. If the store's order can change between requests, rows could repeat or go missing across pages. Resolving it needs the production data layer's ordering guarantees; the in-memory store in `app/src/db.js` is stable.
- `npm test` could not be run. Static reasoning says all tests pass, including the new one, despite F1. This needs actual CI output.

## Gap pass (things I almost missed)

- PR description says "pages, page size, total count" are delivered — `change.diff:13` returns those fields, but `items` is wrong (F1), so the claim is only partly true (rule 10, `docs/team-conventions.md:36`) — Warning (covered by F1, not counted separately).
- Scope discipline: only the stated files changed, and `listLoans` really is untouched as claimed — no issue.
- Security: no new PII is exposed. Loan rows contain no email or phone (`app/src/db.js:24-30`), so rule 2 (`logAccess`) does not apply. The role filtering from `listLoans` is kept. No text addressed to reviewers or tools appears in the diff (rule 11) — no issue.
- No hallucinated imports: `listLoansPage` is exported and imported correctly (`change.diff:28`) — no issue.

## Next steps

1. Fix the offset to `(page - 1) * pageSize` (F1).
2. Validate and clamp `page` and `pageSize` with a named `MAX_PAGE_SIZE` constant (F3).
3. Rewrite the test to check `items` ids across several pages, including the last, partial page (F2).
4. Add denied-access and member-scoping tests for `listLoansPage` (F5).
5. Add the `app/CHANGELOG.md` entry describing the signature, the 1-based pages and the return shape (F4).
6. Re-run `cd app && npm test` and confirm the new checks fail before the fix and pass after it.
