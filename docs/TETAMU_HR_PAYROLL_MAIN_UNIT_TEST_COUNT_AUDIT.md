# TETAMU HR & Payroll — Main Unit Test Count Audit

Date: 26 August 2026
Main workspace: `C:\CodexTetamuP0`
Standalone Staff workspace: `C:\CodexTetamuP0-staff-ui`
Scope: audit only; no product, workflow, UI, deployment or Production changes

## 1. Executive Summary

The reported `Main 1160 → Main 1130` comparison is invalid. The only retained raw execution producing `1160/1160` ran in `C:\CodexTetamuP0-staff-ui`, so it was the standalone Staff suite, not Main.

Current Main genuinely discovers and passes `1130/1130`. An isolated clean-HEAD Main run at `6a5db24` discovers `1118` tests, not 1160. There is therefore no evidence that 30 Main tests disappeared. The apparent reduction is a baseline attribution/reporting error caused by comparing Staff with Main.

No deleted test file, hidden skip/todo, changed unit glob, commented-out test block, or critical Fresh E2E assertion weakening was found.

```text
MAIN UNIT TEST COUNT AUDIT
→ REVIEW REQUIRED
```

The audit is `REVIEW REQUIRED` because historical Baseline A is unsupported and contradicted by its raw command. This is a documentation/baseline defect, not evidence of missing Main coverage.

## 2. Baseline 1160 Evidence

`docs/TETAMU_HR_PAYROLL_STAFF_APP_FINAL_SYNC_CLOSURE.md` reports both workspaces as `1160/1160`, but retains no separate Main command, Main log, JUnit file or discovery manifest.

The Codex session record at:

```text
C:\Users\oscar\.codex\sessions\2026\08\08\rollout-2026-08-08T13-50-24-019fdfec-2c56-7d93-8d32-16bed64159d7.jsonl
```

contains raw call `call_nvowZXF3rYNBCs4FAKexe04d`. Its exact working directory was:

```text
C:\CodexTetamuP0-staff-ui
```

The command was equivalent to:

```powershell
.\node_modules\.bin\tsx.cmd --test tests/unit/*.test.ts
```

The retained result was `tests 1160`, `pass 1160`, `fail 0`, `skipped 0`, `todo 0`. This is Staff evidence, not Main evidence.

| Baseline field | Finding |
|---|---|
| Claimed suite | Main unit |
| Actual raw-command suite | Standalone Staff unit |
| Command | `tsx --test tests/unit/*.test.ts` |
| Runner | Node test runner through `tsx` |
| Include/exclude | `tests/unit/*.test.ts`; no explicit exclude |
| Historical Main artifact | Not found |
| Conclusion | “Main 1160” is unconfirmed/mislabelled |

## 3. Current 1130 Evidence

Audited Main state:

```text
Branch: codex/testing-release-2026-08-24
HEAD: 6a5db24
Working tree: dirty; existing changes preserved
```

Fresh canonical result:

```text
tests       1130
suites      1
pass        1130
fail        0
cancelled   0
skipped     0
todo        0
duration    12659.9913 ms
```

Local evidence:

```text
C:\CodexTetamuP0\.tmp\main-unit-current.spec.log
C:\CodexTetamuP0\.tmp\main-unit-current.junit.xml
```

JUnit contains 1127 leaf cases while Node reports 1130 because Node also counts three suite-level nodes. Staff has the same three-node difference (`1157` leaf versus `1160` Node), so counting semantics do not hide the cross-workspace 30-case difference.

## 4. Test Runner / Command

| Item | Main | Staff |
|---|---|---|
| Package script | `tsx --test tests/unit/*.test.ts` | Same |
| Runner | Node test runner via `tsx` | Same |
| Node | `v24.15.0` | Same audit runtime |
| `tsx` | `4.23.12` | Equivalent workspace command |
| Jest/Vitest config | None found | None found |
| Explicit exclude/filter | None | None |

The Main `package.json` unit command did not change. Its only relevant script diff adds `test:integration:disposable`, which does not affect unit discovery.

## 5. Test File Comparison

| Metric | Reported old Main | Main clean HEAD | Current Main | Current Staff |
|---|---:|---:|---:|---:|
| Physical unit files | Unknown | 196 | 197 | 202 |
| Node-discovered tests | Claimed 1160, unsupported | 1118 | 1130 | 1160 |
| Passed | Claimed 1160 | 1111 | 1130 | 1160 |
| Failed | Claimed 0 | 7 | 0 | 0 |
| Skipped | Claimed 0 | 0 | 0 | 0 |
| Todo | Claimed 0 | 0 | 0 | 0 |

The clean-HEAD run used an isolated Git worktree and did not modify the current dirty Main workspace. It independently proves that tracked Main HEAD was not a 1160-test suite.

## 6. Exact 30-Test Delta

There is no set of “30 disappeared Main tests.” The exact measurable delta is between two different workspaces:

```text
Current Staff JUnit leaf cases: 1157
Current Main JUnit leaf cases:  1127
Net cross-workspace difference:   30
```

| Test file | Staff | Main | Main − Staff | Reason |
|---|---:|---:|---:|---|
| `attendance-resolution-workflow.test.ts` | 7 | 8 | +1 | Newer Main queue contract |
| `claims-presentation.test.ts` | 0 | 3 | +3 | New Main tests |
| `embedded-postgres-utils.test.ts` | 2 | 0 | -2 | Staff infrastructure |
| `employee-profile-shell.test.ts` | 7 | 8 | +1 | Newer Main edit contract |
| `hr-payroll-product-integrity.test.ts` | 7 | 10 | +3 | Newer Main navigation contracts |
| `payroll-p5-attendance-integration.test.ts` | 10 | 11 | +1 | Main negative regression |
| `people-hr-entitlement-ux.test.ts` | 6 | 7 | +1 | Newer Main People contract |
| `runtime-staff-app-logo.test.ts` | 2 | 0 | -2 | Staff runtime ownership |
| `staff-appointments.test.ts` | 10 | 0 | -10 | Staff feature tests |
| `staff-attendance-history.test.ts` | 8 | 0 | -8 | Staff feature tests |
| `staff-pwa.test.ts` | 34 | 29 | -5 | Different application contracts |
| `staff-schedule.test.ts` | 7 | 0 | -7 | Staff feature tests |
| `staff-surface.test.ts` | 4 | 0 | -4 | Staff runtime/surface tests |
| `staff-timesheet.test.ts` | 8 | 0 | -8 | Staff feature tests |
| `staff-twilio-verify.test.ts` | 0 | 6 | +6 | Main Twilio adapter tests |
| **Total in differing files** | **112** | **82** | **-30** | **Different suites, not deletions** |

The full name-set comparison is `55 Staff-only names` versus `25 Main-only names`, also yielding net `-30`. It is not a one-to-one list of 30 removed Main names.

Staff-only groups: embedded Postgres (2), old HR navigation contracts (2), old Team activity contract (1), runtime logo (2), appointments (10), attendance history (8), Staff PWA/mobile contracts (11), schedule (7), Staff surface (4), and Staff timesheet (8).

Main-only groups: attendance queue (1), claims presentation (3), employee edit action (1), HR product integrity (5), Payroll P5 blocker (1), People/Team activity contracts (2), Main Staff retirement/PWA boundary (6), and Twilio Verify adapter (6).

## 7. Deleted Tests Audit

`git status`/`git diff --name-status` shows modified tests and one untracked new file, but no deleted file under `tests/unit`:

```text
?? tests/unit/claims-presentation.test.ts
```

Three obsolete declarations are removed in the current diff:

1. `HR navigation gates Payroll and Statutory independently`
2. `Attendance Settings stays inside the Attendance workspace navigation`
3. `Team activity sits after Payroll in the workspace navigation and is paginated at ten records`

They have replacement contracts for nested statutory/Payroll navigation, unified Time, Team activity outside the six-item HR navigation, and permission-gated People editing. The tracked diff contains 11 added and 3 removed declarations; the new Claims file adds 3 more tests.

## 8. Moved Tests Audit

No 30-case Main-to-other-suite move was found. The major Staff-only files were introduced on the Staff branch, including:

| Staff-only group | Git evidence |
|---|---|
| Embedded Postgres | `c985ca0` |
| Runtime logo | `80fb162` |
| Appointments | `a702f63`, `f390c0a` |
| Attendance history | `0c55370` |
| Schedule | `1692dbb` |
| Staff surface | `026d733` |
| Timesheet | `13fccb7` |

These are standalone Staff ownership, not tracked Main deletions.

## 9. Consolidated Tests Audit

No 30-case parameterization or describe restructuring was identified. Stable Node-versus-JUnit semantics add three nodes to both suites, so they do not explain the 30 net difference.

## 10. Skipped/Todo Audit

Searches covered `.skip`, `xit`, `xdescribe`, `test.skip`, `describe.skip`, `it.skip` and test `todo` declarations.

Results:

- no actual skipped/todo declaration in Main or Staff;
- Main runtime: `skipped 0`, `todo 0`;
- Staff runtime: `skipped 0`, `todo 0`;
- the sole broad `.skip` text hit was an ordinary property `paged.skip`, not a test directive.

## 11. Filter/Config Audit

Checked:

- `package.json` unit scripts;
- Jest/Vitest/test config files;
- include/exclude/testMatch/testRegex equivalents;
- workspace configuration;
- CLI glob and flags;
- unit test directory placement.

Findings:

- Main still uses `tsx --test tests/unit/*.test.ts`;
- no Jest/Vitest config exists;
- no name filter, changed glob or explicit file exclusion exists;
- the additive disposable Integration command does not affect unit discovery.

No 30-test filtering regression was found.

## 12. Assertion Weakening Audit

Fresh E2E-adjacent diffs were inspected for removed assertions, strict-to-loose changes, removed negative cases, and removed permission/immutability/tenant assertions.

No such weakening was found. Changed suites continue to use strict and negative assertions including `assert.equal`, `assert.deepEqual`, `assert.match`, `assert.doesNotMatch` and `assert.rejects`.

The three removed navigation declarations were obsolete information-architecture contracts with replacement coverage. They were not failing business-rule tests silently deleted without replacement.

## 13. Fresh E2E Fix Test Audit

### Timesheet P2 materialization and transaction order

- Product source: `src/lib/attendance/timesheet-service.ts`
- Integration suite: `tests/integration/attendance-monthly-timesheet.test.ts`
- Added strict regression: `A3 materializes roster-backed P2 coverage before a branch can be marked ready`
- Rejection and exact P2 exception count remain asserted.

### Session-only exclusion

No test was removed or skipped to bypass session-only behavior. Canonical attendance/payroll source boundaries remain covered.

### Type-specific Attendance resolution options

- Product surface: `src/app/(business)/team/attendance/resolutions/page.tsx`
- Main gained an exact missing-punch queue regression.
- No permission or negative-case assertion was removed.

### Payroll P5 fail-closed coverage

- File: `tests/unit/payroll-p5-attendance-integration.test.ts`
- Added test: `P5 blocks hourly paid leave until an approved hourly leave-unit policy exists`
- It asserts the blocker and exact empty component result.

Conclusion: Fresh E2E changes added or retained strict regression coverage; they did not delete 30 tests.

## 14. Git History Evidence

| Evidence | Finding |
|---|---|
| Main HEAD | `6a5db24` |
| Staff HEAD | `09a286b` |
| Main deleted unit files | None |
| Main new unit file | `tests/unit/claims-presentation.test.ts` |
| Main unit script diff | None |
| Main runner-config diff | None |
| Raw 1160 workdir | `C:\CodexTetamuP0-staff-ui` |

An isolated worktree at Main `6a5db24` was run without touching current changes:

```text
tests       1118
pass        1111
fail        7
skipped     0
todo        0
duration    15538.7669 ms
```

The seven failures were stale source/test-contract mismatches at clean HEAD. For this count audit, the decisive fact is that clean Main HEAD discovers `1118`, not `1160`.

## 15. Current Re-run Result

```text
Command:  C:\CodexTetamuP0\node_modules\.bin\tsx.cmd --test tests\unit\*.test.ts
Files:    197
Tests:    1130
Passed:   1130
Failed:   0
Skipped:  0
Todo:     0
Duration: 12659.9913 ms
```

Current Staff comparison run:

```text
Files:    202
Tests:    1160
Passed:   1160
Failed:   0
Skipped:  0
Todo:     0
Duration: 12437.8714 ms
```

## 16. 30-Test Classification

The supplied classification list assumes a valid Main 1160 baseline. Applying it to a Staff-versus-Main reporting error would fabricate a migration that did not happen.

| Classification | Count | Evidence |
|---|---:|---|
| `MOVED` | 0 | No 30-case Main move found |
| `CONSOLIDATED` | 0 | No 30-case consolidation found |
| `OBSOLETE_WITH_REPLACEMENT` | 0 | Three declaration replacements exist but are unrelated to the reported 30 |
| `DELETED_WITHOUT_REPLACEMENT` | 0 | No deleted Main file/coverage found |
| `SKIPPED` | 0 | Source and runtime both show zero |
| `FILTERED` | 0 | Command/glob/config unchanged |
| `UNKNOWN` | 0 | The numerical cause is known |
| **`BASELINE_MISATTRIBUTED`** | **30** | Staff 1160 was labelled Main before comparison with Main 1130 |
| **Total** | **30** | |

`BASELINE_MISATTRIBUTED` is necessary because none of the proposed migration categories truthfully describes a result executed in another workspace.

## 17. Coverage Impact

No evidence shows a 30-test Main coverage loss:

- current Main has one more physical unit file than clean Main HEAD;
- tracked declaration diff is net `+8` (`+11/-3`);
- the new Claims presentation file adds 3 tests;
- Fresh E2E adds strict Timesheet, Attendance queue and Payroll P5 regressions;
- current Main passes 1130 with zero skip/todo;
- Staff retains its separate 1160-test suite.

Current Main discovery rises from clean HEAD `1118` to working-tree `1130`, a net increase of 12 runner nodes.

## 18. Risks

1. The historical closure document contains an unsupported Main count and must not be used as a canonical Main baseline.
2. The exact dirty Staff manifest used for the old 1160 run was not frozen, although its path and output are retained.
3. Current Main is dirty. `1130` is canonical for this audited working-tree state, not automatically for every commit or future merge.
4. Counts alone are not coverage metrics. Future results should retain workspace, branch, commit, status, command, file manifest and JUnit/spec artifact.
5. Two workspaces must not be reported as equivalent merely because they use the same glob and produce the same pass count.

## 19. Final Verdict

```text
MAIN UNIT TEST COUNT AUDIT
→ REVIEW REQUIRED
```

Reasons:

- Current Main `1130/1130` is real and reproducible.
- No deleted file, hidden skip/todo, filter regression, commented-out block or critical Fresh E2E assertion weakening was found.
- The historical raw `1160/1160` result belongs to standalone Staff.
- Therefore no 30 Main tests can honestly be listed as disappeared; the “30” is a baseline misattribution.

Canonical-count conclusion:

```text
1130 is the correct current canonical Main unit count for the audited working tree.
```

The old statement that Main was `1160/1160` remains unsupported unless a separate historical Main artifact is produced. No business, product or test-config change is required by this audit.
