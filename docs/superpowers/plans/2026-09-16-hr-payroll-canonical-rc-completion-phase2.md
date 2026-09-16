# HR/Payroll Canonical RC Completion Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Apply `superpowers:test-driven-development` to every behavior change, `superpowers:systematic-debugging` to every failure, and `superpowers:verification-before-completion` before each commit and the final verdict.

**Goal:** Close the seven remaining engineering gates on the existing canonical HR/Payroll RC and produce a locally reproducible candidate that is `READY_FOR_HUMAN_UAT` only when migration, domain, security, browser, responsive, and full verification evidence all pass.

**Architecture:** Treat the current canonical branch as the source of truth and the old detached overlay only as read-only evidence. Add tests before any behavior change, admit only the minimum code proven by those tests, keep restricted PCB/bank/government operations fail-closed, and execute browser acceptance against a disposable local PostgreSQL database with synthetic personas. Preserve the existing 13 audited source commits without rebase, squash, deletion, or bulk overlay replay.

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma 6, PostgreSQL 18 embedded runtime, Node test runner, ESLint, npm, controlled browser automation.

**Spec:** User-approved “TETAMU HR/PAYROLL — CANONICAL RC COMPLETION PHASE 2”, scheme A (`current-first canonical closure`), confirmed 2026-09-16.

## Global Constraints

- Continue only in `/Users/innovdia/Documents/Codex/2026-09-15/jian/worktrees/hr-payroll-canonical-rc-20260916` on `codex/hr-payroll-canonical-rc-20260916`.
- Preserve the 13 audited source commits ending at `5d0e24b48f5356d7ad2ce09e92b9e779ad61f15b`; do not rewrite, squash, rebase, or delete them.
- Canonical clean root remains `71f4786c828239d4270d93afa9253e8400a8b6ad`; the current evidence commit above the source set is preserved.
- Do not bulk replay the old 592-file overlay. Every old-workspace candidate requires path-level provenance and a test-proven dependency.
- Never push, merge, open a PR, deploy, mutate Railway, or read/write shared Testing/Production business data.
- Never execute a real payment, bank export, PCB Production operation, government export, or statutory submission.
- Keep Human UAT `PENDING`, deployment `NOT_DEPLOYED`, production eligibility false, official export false, bank execution false, and government submission false.
- Put browser screenshots, traces, and large logs outside the Git worktree under `/Users/innovdia/Documents/Codex/2026-09-15/jian/work/hr-payroll-phase2-evidence/`.
- Upgrade `next` and version-coupled official Next packages to `16.3.5`; every resolved `sharp` must be `>=0.35.4`. Do not run `npm audit fix --force` or an unrelated major upgrade.
- A runtime-exploitable high/critical advisory, vulnerable nested `sharp`, Next runtime `<16.3.3`, failed browser viewport, failed migration check, weakened assertion, or incomplete required gate prevents `READY_FOR_HUMAN_UAT`.

---

### Task 1: Freeze continuation state, plan, and Phase 2 source ledger

**Files:**
- Create: `docs/superpowers/plans/2026-09-16-hr-payroll-canonical-rc-completion-phase2.md`
- Modify: `docs/hr-payroll-canonical-rc-source-ledger.md`

**Interfaces:**
- Consumes: immutable Phase 1 commit history, preserved detached workspace hashes, Phase 1 manifest/report.
- Produces: a bounded Phase 2 candidate table containing source path, SHA-256, destination, domain, dependency, selection/rejection reason, tests, target commit, and production restriction.

- [ ] Verify linked-worktree identity, branch, clean status, exact root ancestry, 13 source commits, and unchanged old detached-workspace status digest.
- [ ] Record the already-established current-first design and seven gate order in this plan.
- [ ] Append a Phase 2 section to the existing ledger; do not remove or rewrite Phase 1 provenance.
- [ ] Add every newly considered old-overlay path as `selected`, `rejected`, or `verification-only`, including the dependency reason and SHA-256.
- [ ] Run `rg -n 'TO''DO|TB''D|FIX''ME' docs/superpowers/plans/2026-09-16-hr-payroll-canonical-rc-completion-phase2.md docs/hr-payroll-canonical-rc-source-ledger.md` and resolve every plan placeholder.
- [ ] Run `git diff --check`, inspect the staged diff, and commit the plan and ledger without source changes.

### Task 2: Prove migration 214 over representative pre-RC data

**Files:**
- Create: `tests/integration/people-account-classification-forward-migration.test.ts`
- Create or modify only if the test harness needs a reusable local-only helper: `tests/helpers/people-account-classification-forward-fixture.ts`

**Interfaces:**
- Consumes: migrations 1–213, migration `20260915090000_people_workbench_account_classification`, embedded PostgreSQL utilities, Prisma Client.
- Produces: a disposable-schema integration proof that migration 214 preserves rows, backfills `HUMAN`/`false`, permits explicit `SERVICE`/test classification, creates both indexes, and leaves no database/schema behind.

- [ ] Write a test that copies the Prisma directory without migration 214, deploys the first 213 migrations to a uniquely named local database, and inserts hand-derived synthetic fixtures for human/staff/service/test accounts, two businesses, two branches, valid duplicate email/phone boundaries, and locked timesheet/payroll evidence.
- [ ] Assert before applying migration 214 that `account_type` and `is_test_account` do not exist; run the test and verify RED because the forward-migration runner/assertions are not yet implemented.
- [ ] Implement the smallest test harness that applies only migration 214 with `prisma db execute`, regenerates/validates Prisma separately, and queries the resulting database.
- [ ] Assert literal row counts are unchanged; all pre-existing users are `HUMAN`; all pre-existing memberships are non-test; defaults apply to new rows; both columns are non-null; both expected indexes exist; duplicate legal boundaries remain intact; representative People/Payroll joins return the expected tenant-scoped rows.
- [ ] Assert the local-only hostname guard, uniquely bounded database name, and `finally` cleanup. Query `pg_database` after cleanup and assert zero leftovers with the generated prefix.
- [ ] Run the focused integration test through the embedded PostgreSQL wrapper, then run migration/schema unit tests, Prisma validate, Prisma generate, and `git diff --check`.
- [ ] Commit only the forward-migration proof as `test(hr): verify people classification forward migration`.

### Task 3: Close Leave workflow and evidence-freeze gate

**Files:**
- Test first: `tests/unit/leave-management-phase2*.test.ts`, `tests/integration/leave-management*.test.ts`, `tests/unit/payroll-p5-attendance-integration.test.ts`, `tests/unit/payroll-leave-conflict-resolver.test.ts`
- Modify only if a focused RED test proves a gap: `src/lib/leave/service.ts`, `src/components/staff-pwa/staff-leave.tsx`, or the directly responsible canonical Leave module.

**Interfaces:**
- Consumes: current Leave policies/buckets/ledger, document evidence workflow, locked timesheet snapshots, canonical payroll Leave conflict reader.
- Produces: tested Leave type/balance/carry-forward/half-day/reversal/custom-type/approval/evidence/frozen-input behavior with Sabah inactive or controlled.

- [ ] Build a requirement-to-existing-test matrix covering balance buckets, carry forward/expiry, half days, cancellation restore exactly once, custom types, manager escalation, self-approval denial, branch/business scope, evidence statuses, locked snapshot, payroll frozen reads, and Staff visibility.
- [ ] Run all mapped Leave suites unchanged. For each missing observable behavior, write one minimal failing test with hand-derived expectations before touching production code.
- [ ] Specifically test that “no balance row recorded” is not presented as a recorded zero balance. Verify RED against the current service/UI if the gap exists.
- [ ] Apply only the minimum current-first implementation required by each RED test; do not copy whole overlay files.
- [ ] Re-run focused unit/integration suites, affected payroll snapshot tests, TypeScript, lint, and `git diff --check`.
- [ ] If production behavior changed, commit as `feat(leave): restore evidence-bound payroll leave workflow`; otherwise record the gate as verification-only without a synthetic code commit.

### Task 4: Close Exception/Correction aggregation and action gate

**Files:**
- Test first: `tests/unit/payroll-exception-center-rc.test.ts`, `tests/integration/payroll-exception-center.test.ts`, focused attendance correction tests.
- Candidate production files: `src/lib/payroll/exception-center-read.ts`, `src/lib/payroll/correction-context.ts`, `src/components/payroll-correction-context.tsx`, `src/app/(business)/team/payroll/exceptions/**`, and only directly required current canonical modules.

**Interfaces:**
- Consumes: `getPayrollPeriodReadiness` from `src/lib/payroll/readiness.ts`, attendance timesheet facts, Leave conflict facts, existing access/projection/types, canonical correction lifecycle.
- Produces: bounded read-only exception aggregation and guarded navigation/actions with tenant/branch/group privacy; no dependency on rejected `readiness-runtime` or official statutory setup.

- [ ] Write/port the integration test first and deliberately import the desired canonical reader; verify RED because the reader/UI is absent, not because a restricted dependency is missing.
- [ ] Implement the reader from current canonical readiness, attendance, and Leave facts. Omit official statutory/PCB aggregation and expose an explicit restricted/unavailable state instead of importing rejected modules.
- [ ] Assert bounded query count, 1,000-row cap, branch filtering, zero queries on denied/cross-business access, safe DTO privacy, and no audit mutation.
- [ ] Test unresolved attendance/OT blocks lock, approved correction changes only effective projection, raw records remain unchanged, locked snapshot never rereads live data, submitter cannot self-approve, locked changes fail closed, reopen requires permission/reason/version/audit, and Staff sees only self status.
- [ ] Add responsive exception list/detail UI only after the domain read is GREEN; route all mutations to existing canonical attendance/payroll actions.
- [ ] Run focused unit/integration tests, TypeScript, lint, and `git diff --check`.
- [ ] Commit attendance lifecycle changes as `feat(attendance): restore exception and correction lifecycle` and immutable payroll input changes separately as `feat(payroll): restore immutable corrected payroll inputs` when both diffs exist.

### Task 5: Close Payroll Desktop and Staff self-service gates

**Files:**
- Verify first: existing `tests/unit/payroll-*.test.ts`, Staff V2 suites, RBAC suites, and disposable payroll integrations.
- Modify only after RED: directly responsible canonical Payroll/Staff service, page, component, or CSS files.
- Modify local fixture after a failing fixture-contract test: `scripts/prepare-hr-payroll-five-role-uat.ts` or a new narrowly named eight-role wrapper.

**Interfaces:**
- Consumes: canonical month/run/workspace, locked timesheet/Leave/correction inputs, pay components, current Staff SMS123/session and self-service read models.
- Produces: approved Payroll Desktop scope, eight-role allow/deny evidence, and Staff own-data surfaces without bank/statutory administration exposure.

- [ ] Map existing tests to payroll creation, eligibility, recurring/variable/corrections, calculation/reconciliation, OT/rest-day/holiday/cross-midnight/Sabah engineering, payslip preview/publication, finalize/reopen, immutable snapshots, audit, loading/empty/error/restricted/stale/blocked/ready/final states, and precise permissions.
- [ ] Run mapped suites. Add a failing behavior test only where a required observable outcome is absent.
- [ ] Apply the smallest current-first production change for each RED test; do not replay contaminated `service.ts`, `runs.ts`, or workspace files wholesale.
- [ ] Verify Business Owner, Payroll Admin, HR Manager, Branch Manager, Supervisor, Group Owner, Group Manager, and Staff matrices. VIEW must not imply MODIFY/EXPORT/SUBMIT; branch/group/deep-link access must fail closed; sensitive actions retain step-up verification.
- [ ] Verify Staff SMS123 architecture, session refresh/expiry/revocation, attendance/roster/Leave/correction/OT/timesheet/payslip, current/historical date selection, navigation/sign-out, unavailable/error/restricted states, and own-data privacy.
- [ ] Add a failing fixture-contract test for exactly eight local-only personas, then minimally extend or wrap the existing fixture. Reject non-local database URLs and production mode.
- [ ] Run focused unit/integration suites, TypeScript, lint, and build. Commit only real behavior changes with the approved Payroll/Staff commit names; record verification-only coverage separately.

### Task 6: Apply the independent dependency security upgrade

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: existing employee avatar tests plus a new focused safe-fixture test if no test exercises AVIF input through the actual processing boundary.

**Interfaces:**
- Consumes: current avatar processors, Next Image Optimization, npm lockfile.
- Produces: `next@16.3.5`, version-aligned official Next packages, no resolved `sharp<0.35.4`, safe non-malicious AVIF processing evidence, and an advisory disposition separating runtime from dev-only paths.

- [ ] Capture pre-upgrade `npm ls next sharp`, `npm explain sharp`, `npm audit --json`, package/lock resolutions, and all vulnerable tree paths into the external evidence directory.
- [ ] Write a focused safe AVIF fixture test against the employee-avatar processing boundary and Next Image Optimization-compatible input contract; run it before upgrade to establish current behavior without obtaining or storing an exploit payload.
- [ ] Change only `next`, `@next/env`, and `eslint-config-next` to `16.3.5`, and direct `sharp` to `0.35.4`; regenerate the lockfile with normal npm install semantics, never `npm audit fix --force`.
- [ ] Run the focused safe AVIF tests, full unit tests, TypeScript, lint, and production build.
- [ ] Capture post-upgrade `npm ls next sharp`, `npm explain sharp`, `npm audit --json`; recursively inspect the dependency tree and fail if any `sharp<0.35.4` or runtime Next `<16.3.3` remains.
- [ ] Verify `package.json`, `package-lock.json`, installed package versions, and Next-coupled versions agree.
- [ ] Classify Next/sharp as runtime; classify Prisma/deepmerge and ESLint/js-yaml by actual import/production-tree evidence rather than audit count. Record fixed version, exploit path, breaking-change risk, and remaining disposition.
- [ ] Commit this dependency-only change as an independent security commit, with no domain/UI files included.

### Task 7: Execute local eight-role browser and responsive matrix

**Files:**
- Create external evidence only: `/Users/innovdia/Documents/Codex/2026-09-15/jian/work/hr-payroll-phase2-evidence/browser/**`
- Modify repository files only after a focused failing regression test proves a UI/UX defect.

**Interfaces:**
- Consumes: final local RC build, disposable local database, eight-role fixture/session artifacts.
- Produces: route/role/viewport result matrix, screenshots/traces/digests, and verified cleanup without runtime commit pollution.

- [ ] Create a uniquely named disposable local database, deploy all 214 migrations, seed only synthetic non-sensitive HR/Payroll data, and prepare the eight personas.
- [ ] Start the final production-mode local build on an unused localhost port and verify the health boundary points only to the disposable database.
- [ ] For Desktop roles, smoke People, Employee Profile, Attendance, Timesheet, Leave, Payroll workspace/run, Exceptions/Corrections, Payslip, denied/restricted states, and sign-out.
- [ ] For Staff, smoke login, refresh, attendance, roster, Leave, exception/correction, OT, timesheet, payslip, date picker, and sign-out.
- [ ] At 1440, 834, 390, and 360 CSS pixels, inspect overflow, responsive table/card conversion, modal bounds, sticky actions, contrast/readability, tap targets, keyboard/focus basics, state distinction, terminology, account isolation, and high-risk confirmations.
- [ ] Save screenshots/traces outside the worktree and write SHA-256 evidence digests. Do not stage browser artifacts.
- [ ] For every defect, write a focused regression test, verify RED, make the smallest fix, rerun the affected role/viewport, and commit the UI/UX fix separately.
- [ ] Stop the local server, revoke/delete disposable sessions by dropping the disposable database, and assert no database or process with the generated identifier remains.

### Task 8: Run the 29 final verification gates on final HEAD

**Files:**
- Evidence only under the external evidence directory.
- No source edits unless a failed gate enters the systematic-debugging and TDD cycle.

**Interfaces:**
- Consumes: final source tree after all domain/security/browser fixes.
- Produces: one fresh result for each required verification gate and an explicit blocker list.

- [ ] Run and record: Git diff/status/log; Prisma validate; Prisma generate; 214/214 fresh migrations; representative 213→214 forward migration; full TypeScript; full lint; full unit tests; disposable integration tests; production build.
- [ ] Run and record focused Leave; Exception/Correction; Payroll component/reconciliation; RBAC; locked snapshot; OT/cross-midnight; Staff self-service; PCB/bank/statutory fail-closed regressions.
- [ ] Re-run Desktop browser smoke, Staff browser smoke, and responsive 1440/834/390/360 checks on the exact final HEAD.
- [ ] Run secret, absolute-path, generated-artifact, and migration-integrity scans.
- [ ] Compare unit/integration inventory and assertions against the Phase 2 start to prove no new skip/todo and no weakened assertion.
- [ ] Prove disposable database/process cleanup and final worktree cleanliness after evidence commits.
- [ ] Any failure remains visible in `incompleteRequiredGates`; never weaken a test or omit a failed command to obtain a passing verdict.

### Task 9: Generate Manifest V2 and final report

**Files:**
- Modify: `release-manifests/hr-payroll-canonical-rc-20260916.json`
- Create: `TETAMU_HR_PAYROLL_CANONICAL_RC_COMPLETION_PHASE2_REPORT.md`
- Copy user-facing deliverables after final verification to `/Users/innovdia/Documents/Codex/2026-09-15/jian/outputs/`.

**Interfaces:**
- Consumes: ordered Git history, final tree, file hashes, all 29 verification results, dependency evidence, browser matrix, exclusions, and cleanup proof.
- Produces: deterministic Manifest V2 and a 19-section review report with exactly one permitted verdict.

- [ ] Update ordered commit SHAs, final RC SHA/tree, canonical source digest, included file hashes, migration and forward-migration results, test commands/results, browser/responsive evidence, security disposition, incomplete gates, exclusions, reviewer status, Human UAT, deployment, and production eligibility.
- [ ] Preserve `humanUatStatus=PENDING`, `deploymentStatus=NOT_DEPLOYED`, `productionEligible=false`, `officialExportEligible=false`, PCB Production disabled, bank execution disabled, and government submission disabled.
- [ ] Write the report sections: Executive Summary; Continuation State Proof; Preserved Phase 1 Commits; New Phase 2 Commits; Forward Migration Evidence; Leave Completion; Exception/Correction Completion; Payroll Desktop Completion; Staff Completion; RBAC Matrix; UI/UX and Responsive Evidence; Dependency Security Review; Full Verification; Restricted Features; Manifest V2; Remaining Risks; Human UAT Plan; Deployment Recommendation; Final Verdict.
- [ ] Set the verdict to `READY_FOR_HUMAN_UAT` only when all seven gates and all 29 final checks pass with no security blocker. Otherwise use `PARTIAL_RC_BLOCKED` or `BLOCKED` and list exact failed gates.
- [ ] Independently recompute manifest hashes/source digest, run `git diff --check`, commit report/manifest evidence, rerun manifest verification, and confirm the worktree is clean.
- [ ] Copy the report, manifest, dependency/audit summary, and browser matrix summary to the outputs directory without modifying the repository copies.
- [ ] Stop without push, merge, PR, deployment, Railway mutation, Testing/Production mutation, real payment, PCB activation, or government submission.

## Self-review

- Every Phase 2 requirement maps to one of Tasks 1–9.
- Every behavior change requires a RED test before production code.
- The old overlay is evidence, never a wholesale source.
- The dependency upgrade is isolated and checks nested runtime copies.
- Browser evidence is local/disposable and stored outside runtime commits.
- Verdict language is limited to the three approved values and never implies Production readiness.
