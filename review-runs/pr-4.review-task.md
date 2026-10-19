## Review target
pr — PR-4, "Винести хелпери дат у src/dates.js": moves `toUtc` (renamed `toUtcMs`), `daysBetween` and `addDays` out of `app/src/loans.js` into a new `app/src/dates.js`, re-exports them from `loans.js`, renames `late` to `daysLate`, adds `app/test/dates.test.js` and a CHANGELOG entry.

## Verdict
APPROVE

## Summary
The refactor keeps behaviour the same. The helper bodies match the originals line for line; the only differences are that the `86_400_000` literal became the named constant `MS_PER_DAY` and `toUtc` became `toUtcMs`. The re-export keeps existing imports working: `app/test/loans.test.js:4` already imports `addDays` and `daysBetween` from `../src/loans.js`. The newly public `toUtcMs` has a CHANGELOG entry, as convention 6 requires. Two small suggestions remain, and neither blocks the merge.

## Risk score
2

## Dimensions applied
Approach & Correctness, Completeness vs Requirements, Security, Quality & Reliability, AI-Specific Risks, Performance, Code Quality & Conventions, Documentation, Scope Discipline

## Findings

### F1 — Add a leap-year case to the new date tests
- **Severity**: Suggestion
- **Category**: Quality & Reliability
- **Confidence**: 80
- **Evidence**: `change.diff:89-100` (`app/test/dates.test.js`) tests month and year rollover, a negative difference and UTC midnight. The only February case is in 2026, which is not a leap year:
  ```js
  assert.equal(addDays("2026-02-20", 14), "2026-03-06");
  ```
- **Why it matters**: The helpers will now be shared by members and reports, so a test that covers Feb 29 would protect them better against future edits. The current code handles leap years correctly through `Date.UTC`.
- **Recommended fix**: Add `assert.equal(addDays("2028-02-28", 1), "2028-02-29")` and `assert.equal(daysBetween("2028-02-28", "2028-03-01"), 2)`.
- **DA verdict**: KEEP — the gap is real and the fix is cheap, but it is only a suggestion because there is no defect.

### F2 — Give `toUtcMs`'s signature and return value in the CHANGELOG entry
- **Severity**: Suggestion
- **Category**: Documentation
- **Confidence**: 80
- **Evidence**: `change.diff:11`:
  ```
  - `src/dates.js` — date helpers moved here from `loans.js` (`toUtcMs`, `daysBetween`, `addDays`); ...
  ```
  Earlier entries give the signature and the returned shape, for example `app/CHANGELOG.md:8-9` for `overdueReport(db, user, todayIso)`. `toUtcMs` was private as `toUtc` (`app/src/loans.js:8`) and is now a new public function (`change.diff:27`).
- **Why it matters**: Convention 6 (`docs/team-conventions.md:24-25`) treats a new public function as a change to the API. Listing it by name satisfies that rule, but the entry does not say what it accepts or returns.
- **Recommended fix**: Write it as `` `toUtcMs(iso)` — new public helper; returns UTC epoch milliseconds for a `YYYY-MM-DD` string ``.
- **DA verdict**: KEEP — a minor gap in consistency with earlier entries; the rule itself is met.

## Unverified claims (confidence < 80)
- `npm test` passes with the diff applied — UNVERIFIED because commands cannot be run here. Reading the code: the expected values in `dates.test.js` are arithmetically correct (Dec 25 + 14 = Jan 8, Feb 20 2026 + 14 = Mar 6, Oct 8 to Oct 1 = -7), and in `loans.js` the pair `import { addDays, daysBetween } from "./dates.js"` / `export { addDays, daysBetween } from "./dates.js"` is valid ESM with no binding clash. The required CI check would confirm this.

## Gap pass (things I almost missed)
- **Description vs code (convention 10):** The description says "renamed a couple of variables" (перейменував пару змінних). The actual renames are the local `late` to `daysLate` (`change.diff:72-75`), the module-private `toUtc` to `toUtcMs` (`change.diff:53`, `change.diff:27`) and the literal `86_400_000` to `MS_PER_DAY`. This matches the description well enough — no finding.
- **Re-export coverage:** The re-exports list only `addDays` and `daysBetween`. The old `toUtc` was never exported (`app/src/loans.js:8`), so no import breaks — no finding.
- **Instructions aimed at reviewers or tools (convention 11):** None found in the PR description, the diff or the new comments (`change.diff:22-23`) — no finding.
- **Scope:** All four touched files fit the stated scope, and there are no unrelated formatting changes — no finding.
- **Security and performance:** The change has no input from users, no I/O, no new dependencies and no algorithmic change — no finding.
- **Callers of the "members and reports" claim:** No caller of `dates.js` exists yet (`app/src/members.js` imports nothing from it). The PR presents this as preparation for later tasks, so there is no finding.

## Next steps
1. Optionally add leap-year assertions to `app/test/dates.test.js` (F1).
2. Optionally expand the CHANGELOG line to give `toUtcMs(iso)` and its return value (F2).
3. Merge once the required CI check (`cd app && npm test`) is green.
