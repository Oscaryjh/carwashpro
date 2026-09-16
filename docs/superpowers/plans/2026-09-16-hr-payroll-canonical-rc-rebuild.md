# HR/Payroll Canonical RC Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan task by task. Apply `superpowers:test-driven-development` to every behavior change and `superpowers:verification-before-completion` before the final verdict.

**Goal:** Rebuild a reproducible, reviewable HR/Payroll release candidate from immutable clean root `71f4786c828239d4270d93afa9253e8400a8b6ad`, without legitimizing the previous dirty Desktop Testing deployment or changing any deployed environment.

**Architecture:** Treat the old detached workspace only as untrusted source material. Reconcile one bounded domain at a time into an isolated Git worktree, carry tests with the behavior they specify, and create small local commits. Keep bank payment, government submission, PCB certification, deployment, data mutation, and environment configuration outside the RC unless a compile-time dependency requires a minimal fail-closed boundary.

**Tech stack:** Next.js/React/TypeScript, Prisma/PostgreSQL, Node test runner, ESLint, npm.

**Approved specification:** “TETAMU HR/PAYROLL — CANONICAL RC REBUILD FROM CLEAN ROOT”, scheme A, approved 2026-09-16.

## Fixed inputs and safety boundaries

- Clean root and only canonical base: `71f4786c828239d4270d93afa9253e8400a8b6ad` (`origin/main`).
- Local branch: `codex/hr-payroll-canonical-rc-20260916`.
- Isolated worktree: `worktrees/hr-payroll-canonical-rc-20260916` outside the repository checkout.
- Original detached source workspace: `/Users/innovdia/Documents/Codex/2026-09-04/wo-2/work/pcb-p3a` (read-only evidence; never clean, reset, stage, commit, or delete it).
- Reconciliation evidence: `TETAMU_DESKTOP_TESTING_BASELINE_RECOVERY_REPORT.md`, `HR_PAYROLL_RC_RECONCILIATION_REPORT.md`, `file-classification.csv`, the preserved tracked patch and untracked inventory, and the historical HR/Payroll UAT/closure reports under `docs/`.
- The prior Desktop Testing deployment `e253e3d7-6679-4a14-aec4-8bf60e4414ef`, source label `worktree-5f9b5b5-people-43eba5169e98`, and digest `43eba5169e986fff05012776c6d9bcfb1f752ead02d46a193d9497902ea9e21a` are historical evidence only. They do not prove a Git baseline.
- Candidate classifications are review inputs, not approval. Never copy all 592 overlay files, all 308 `YES` rows, the 2,294-file deployment package, or generated/build artifacts.
- Never deploy, push, merge, open a PR, modify Railway, modify Testing/Staff Testing/Production, or use production bank/government/PCB endpoints.
- Stop immediately with `ROOT_MOVED_REVIEW_REQUIRED` if remote `origin/main` no longer resolves to the fixed SHA. Stop with `ROOT_OBJECT_MISSING` if the fixed commit is not a local commit object.

## Baseline evidence captured before replay

- `git ls-remote origin HEAD refs/heads/main` resolved both HEAD and `refs/heads/main` to the fixed SHA.
- The branch did not previously exist locally or remotely; the isolated worktree was created directly from the fixed SHA and began clean.
- `npm ci`: passed; npm reported 7 dependency audit findings (6 high, 1 critical), retained as baseline observations and not auto-fixed.
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tetamu_prisma_validate_only?schema=public npx prisma validate`: passed without connecting to or mutating a database.
- `npx prisma generate`: passed.
- `npm exec -- tsc --noEmit --pretty false`: passed.
- `npm test`: 1,602 passed, 0 failed, 0 skipped.
- `npm run lint`: passed with 13 pre-existing warnings and 0 errors.
- `PORT=3199 npm run build`: passed; the existing middleware deprecation and Edge-runtime import warnings remain baseline observations.
- The worktree and lockfiles remained unchanged after baseline verification.

## Source-to-RC mapping

| RC domain | Candidate source paths | Dependencies | Tests that enter first | Planned commit |
|---|---|---|---|---|
| Schema and People classification | `prisma/schema.prisma` (only required hunks); `prisma/migrations/20260915090000_people_workbench_account_classification/migration.sql` | Existing Employee/User/account models; Prisma client | migration SQL assertions; People read/write unit tests | `feat(hr): add auditable people account classification` |
| HR / People | `src/lib/team/{people-service,people-status,people-directory-read,people-presentation}.ts`; `src/lib/team/employee-profile-*.ts`; `src/app/(business)/team/{actions.ts,people/**,employees/**,access-management/**,home/**}`; employee-profile/people components and CSS | Schema task; staff permission helpers | People directory, account classification, profile, entitlement and presentation tests | `feat(hr): restore canonical people workflows` |
| Payroll immutable inputs | `src/lib/payroll/{service,runs,readiness,workspace,documents,statutory-data}.ts`; employee payroll summary/read/write files | People identity and payroll schema already present at clean root | payroll run foundation, product-integrity, workspace and readiness tests | `feat(payroll): restore immutable payroll input workflow` |
| Attendance / Timesheet | `src/lib/attendance/{p2-service,read-service,resolution-read-service,resolution-workflow-service,business-attendance-projection,effective-session,review-presentation}.ts`; selected attendance pages/actions/components | Existing attendance and roster schema | monthly-timesheet, payroll bridge, resolution workflow and correction sync tests | `feat(attendance): restore reviewed payroll time inputs` |
| Leave | `src/lib/leave/{service,statutory-business-read,leave-conflict-read}.ts`; selected leave pages/components | Existing leave schema; People identity | leave management, admin simplification and payroll leave-conflict tests | `feat(leave): restore payroll-aware leave review` |
| Recurring / variable / corrections | `src/lib/payroll/{entry-editor,correction-context,exception-center-access,exception-center-projection,exception-center-read,exception-center-types,leave-conflict-read,stale-presentation,ux-presentation}.ts`; correction context component and exception pages | Payroll inputs, attendance and leave | exception-center, entry editor, correction context and stale-input tests | `feat(payroll): add controlled correction and exception workflow` |
| OT / Sabah rules | `src/lib/payroll/company-work-pay.ts` and only directly required callers | Existing company work/pay configuration | `tests/unit/payroll-company-work-pay.test.ts` plus focused integration test | `fix(payroll): restore reviewed company work pay rules` |
| RBAC | `src/lib/auth/staff-permissions.ts`; People access-management surfaces and team read-permission checks | Existing business membership and session primitives | permission matrix, team-read and access-management tests | `fix(auth): enforce HR payroll role boundaries` |
| Desktop UI/UX | selected team home/people/payroll workspace, exception, statutory-readiness pages/components/CSS; no payment execution UI | Domain reads/actions and RBAC | semantic navigation, empty/error/loading, responsive and authorization UI tests | `feat(hr-ui): restore accessible desktop HR payroll workspace` |
| Staff compatibility | Exact Git commit `5f9b5b5f350d6ee3670f4d989b203776e6527544` paths only: employee-auth session/route, staff PWA chrome/CSS, and its three tests; exclude later performance-release commits | Clean root is its direct parent; reconcile overlaps after domain work | attendance employee-auth, appointments and staff-PWA tests | `fix(staff): refresh sessions and date picker` (preserve source attribution) |
| Statutory / PCB / bank boundary | Default-exclude payment pages, statutory export/submission modules, PCB V4/certification files, five statutory/PCB migrations and real submission scripts; permit only a minimal fail-closed adapter if a selected core module cannot compile without it | Human legal/finance approval and separate source certification are absent | fail-closed, no-network and non-production fixture tests only | `test(payroll): lock restricted submission boundaries` only if needed |
| Provenance and release evidence | `release-manifests/hr-payroll-canonical-rc-20260916.json`; `TETAMU_HR_PAYROLL_CANONICAL_RC_REBUILD_REPORT.md`; optional deterministic manifest verifier under `scripts/` | All preceding commits and final clean tree | manifest schema/digest verification and final command transcript | `docs(release): record canonical HR payroll RC evidence` |

The tests/fixtures category is not a separate bulk replay. Each test is admitted in the same commit as the behavior it proves. Historical UAT reports are corroborating context only; this rebuild records fresh test results.

## Task 1: Freeze the implementation plan

**Files:**
- Create: `docs/superpowers/plans/2026-09-16-hr-payroll-canonical-rc-rebuild.md`

- [ ] Confirm the worktree is clean at the fixed SHA and that the remote root has not moved.
- [ ] Review this plan for every required domain, prohibited operation, test gate, manifest field, and final verdict.
- [ ] Scan for unresolved placeholder markers: `rg -n 'TO''DO|TB''D|FIX''ME' docs/superpowers/plans/2026-09-16-hr-payroll-canonical-rc-rebuild.md`.
- [ ] Commit only this plan: `git add docs/superpowers/plans/2026-09-16-hr-payroll-canonical-rc-rebuild.md && git commit -m "docs(plan): define canonical HR payroll RC rebuild"`.

## Task 2: Produce a bounded source ledger before copying behavior

**Files:**
- Create: `docs/hr-payroll-canonical-rc-source-ledger.md`

- [ ] Derive candidate paths from `file-classification.csv`, then compare each selected path with the clean root and old detached workspace.
- [ ] Record one row per selected or rejected path: source path, source kind (`tracked diff`, `untracked`, or immutable Git commit), domain, clean-root state, dependency reason, decision, target commit, and source SHA-256.
- [ ] Reject generated/build output, evidence-only bundles, credentials, absolute-machine-path artifacts, deployment scripts, real submission paths, unrelated files, and files whose purpose cannot be proven.
- [ ] Confirm every selected untracked file exists in the preserved inventory and every selected tracked file is represented by the preserved patch or immutable commit.
- [ ] Commit the ledger alone: `git add docs/hr-payroll-canonical-rc-source-ledger.md && git commit -m "docs(reconcile): bound HR payroll source replay"`.

## Task 3: Reconcile schema and migration scope

**Files:**
- Modify only required model/enum fields in `prisma/schema.prisma`.
- Create only the accepted migration under `prisma/migrations/20260915090000_people_workbench_account_classification/`.
- Add focused migration/schema tests under `tests/unit/`.

- [ ] Copy the focused tests first and run them to prove RED because the People classification fields/migration are absent.
- [ ] Apply only the schema hunks required by the People workflow and copy the single People migration.
- [ ] Inspect every SQL statement for destructive DDL, environment assumptions, and reversibility; reject the five PCB/statutory migrations unless a selected behavior proves a hard dependency.
- [ ] Run `npx prisma format`, placeholder-URL `npx prisma validate`, and `npx prisma generate`.
- [ ] Run the repository's disposable/fresh migration check against a newly created local disposable database; never reuse Testing or Production connection strings.
- [ ] Re-run the focused tests to GREEN, then `git diff --check`.
- [ ] Commit schema, migration and its tests together with `feat(hr): add auditable people account classification`.

## Task 4: Restore People and HR workflows

**Files:** selected People paths from the mapping table; no bulk directory copy.

- [ ] Add/copy People tests first; run their exact `node --test --import tsx ...` command and capture the expected RED reason.
- [ ] Reconcile service/read/presentation files one at a time, checking imports against the clean root.
- [ ] Reconcile server actions and profile/directory/access UI only after the domain layer compiles.
- [ ] Verify account states, inactive/former worker handling, missing-data presentation, permission denial, and idempotent writes.
- [ ] Run focused tests, TypeScript, lint on changed paths through the repository lint command, and `git diff --check`.
- [ ] Commit domain code, UI and tests with `feat(hr): restore canonical people workflows`.

## Task 5: Restore immutable payroll inputs and payroll workspace

- [ ] Add/copy payroll foundation, product-integrity, workspace and readiness tests first; demonstrate RED.
- [ ] Reconcile only required payroll service/run/readiness/workspace/document/statutory-data hunks. Preserve immutable finalized-run semantics and deterministic recomputation boundaries.
- [ ] Keep statutory submission, payment execution and certification modules excluded.
- [ ] Prove payroll period identity, duplicate prevention, frozen input snapshots, missing-input behavior, and read authorization.
- [ ] Run focused tests, TypeScript and `git diff --check`; commit with `feat(payroll): restore immutable payroll input workflow`.

## Task 6: Restore attendance, timesheet and leave inputs

- [ ] Add/copy attendance/leave focused tests first and capture RED.
- [ ] Reconcile attendance projection/effective-session/read/review/resolution code; prove cross-midnight and correction behavior.
- [ ] Reconcile leave service/conflict/statutory-business reads; prove approved/pending/rejected and payroll-conflict semantics.
- [ ] Reconcile only the necessary pages/actions/components after domain GREEN.
- [ ] Run focused unit/integration tests, TypeScript, lint and `git diff --check`.
- [ ] Commit attendance with `feat(attendance): restore reviewed payroll time inputs` and leave with `feat(leave): restore payroll-aware leave review`.

## Task 7: Restore corrections, exceptions, recurring/variable inputs and OT/Sabah rules

- [ ] Add/copy focused exception, correction, entry-editor, stale-input and company-work-pay tests first; demonstrate RED.
- [ ] Reconcile correction/exception read models and guarded actions; make stale or incomplete inputs visible and non-finalizable.
- [ ] Reconcile `company-work-pay.ts` only with its proven callers; verify ordinary day, rest day, public holiday, Sabah variation, rounding and cross-midnight boundaries present in the selected tests.
- [ ] Reconcile exception UI after domain behavior is GREEN.
- [ ] Run focused tests, TypeScript, lint and `git diff --check`.
- [ ] Commit correction/exception behavior with `feat(payroll): add controlled correction and exception workflow`; commit work-pay rules separately with `fix(payroll): restore reviewed company work pay rules`.

## Task 8: Restore and verify RBAC

- [ ] Add/copy permission matrix, team-read and access-management tests first; demonstrate RED for the selected behavior.
- [ ] Reconcile only the required `staff-permissions.ts` hunks and access-management surfaces.
- [ ] Prove owner/admin/payroll/manager/staff allow/deny boundaries and cross-business isolation. No high-risk action may silently downgrade to read access.
- [ ] Run focused tests, TypeScript and `git diff --check`; commit with `fix(auth): enforce HR payroll role boundaries`.

## Task 9: Restore desktop UI/UX and Staff compatibility

- [ ] Add/copy semantic UI tests first; demonstrate RED for absent navigation, state, or accessibility behavior.
- [ ] Reconcile desktop team home, People, payroll workspace, correction/exception, loading/empty/error and responsive CSS surfaces. Keep payment-execution UI excluded.
- [ ] Review keyboard reachability, labels, focus, validation feedback, narrow desktop/mobile layout, and clear restricted-state copy.
- [ ] Replay the exact eight-file `5f9b5b5f350d6ee3670f4d989b203776e6527544` change by three-way cherry-pick only if it applies cleanly; otherwise apply its patch path-by-path and document the conflict resolution. Do not include later performance-release commits.
- [ ] Run UI tests plus attendance employee-auth, staff appointments and staff-PWA tests; run TypeScript, lint and build.
- [ ] Commit UI with `feat(hr-ui): restore accessible desktop HR payroll workspace`; preserve `fix(staff): refresh sessions and date picker` attribution for the bounded Staff change.

## Task 10: Enforce restricted-boundary exclusion

- [ ] Search the resulting diff for bank export, government submission, PCB certification, production hostnames, credential reads and network calls.
- [ ] Confirm excluded path families are absent from `git diff 71f4786c828239d4270d93afa9253e8400a8b6ad...HEAD` unless the source ledger identifies a compile-only fail-closed adapter.
- [ ] If such an adapter is necessary, add a failing no-network/fail-closed test first, implement the minimum boundary, and commit code plus test with `test(payroll): lock restricted submission boundaries`.
- [ ] Record that no real bank/government/PCB operation and no deployed data mutation was executed.

## Task 11: Full clean verification

- [ ] Reconfirm root ancestry and clean dependency lockfiles.
- [ ] Run placeholder-URL `npx prisma validate`, `npx prisma generate`, and the fresh disposable migration gate.
- [ ] Run `npm exec -- tsc --noEmit --pretty false`.
- [ ] Run every focused domain suite and disposable integration suite selected in the source ledger.
- [ ] Run `npm test` and record exact pass/fail/skip/todo counts.
- [ ] Run `npm run lint` and distinguish baseline warnings from new warnings.
- [ ] Run `PORT=3199 npm run build` and record route/build warnings.
- [ ] Run `git diff --check`, secret/path scans, generated-artifact scans, and `git status --short`.
- [ ] Any failing required check, unsafe migration, missing dependency, unreviewed restricted boundary, or unexplained source file forces `PARTIAL_RC_BLOCKED` or `BLOCKED`; do not weaken tests or expand scope to obtain a pass.

## Task 12: Generate immutable manifest and final report

**Files:**
- Create: `release-manifests/hr-payroll-canonical-rc-20260916.json`
- Create: `TETAMU_HR_PAYROLL_CANONICAL_RC_REBUILD_REPORT.md`

- [ ] Compute the ordered commit list from the fixed root, selected path list with SHA-256, migration list, excluded boundary list, test commands/results, Node/npm/Prisma versions, and a deterministic source-tree digest that excludes the manifest/report self-reference.
- [ ] Write the manifest with full immutable SHAs only. Include clean root, branch, commit order, source ledger digest, file digests, migration evidence, test/build evidence, exclusions, known baseline warnings, environment-mutation statement, and verdict.
- [ ] Independently recalculate every recorded digest and fail if any value differs.
- [ ] Write the report with executive conclusion, evidence chain, per-domain inclusion/exclusion, commit table, migration gate, test results, security/restriction checks, known gaps, and human UAT scope.
- [ ] The report's final verdict must be exactly one of `READY_FOR_HUMAN_UAT`, `PARTIAL_RC_BLOCKED`, or `BLOCKED`. Never claim Production Ready, Production Eligible, Deployed, or Human UAT Passed.
- [ ] Commit manifest and report with `docs(release): record canonical HR payroll RC evidence`.
- [ ] Re-run manifest verification and `git status --short --branch`; do not push, merge, deploy, or open a PR.

## Verdict rules

- `READY_FOR_HUMAN_UAT`: every selected domain has provenance, behavior tests, migration validation, full regression/build passes, restricted boundaries remain excluded/fail-closed, manifest digests verify, and the branch is clean.
- `PARTIAL_RC_BLOCKED`: a safe, auditable subset exists but one or more required HR/Payroll domains, migrations, dependencies, or verification gates remain incomplete or failed.
- `BLOCKED`: the clean root is invalid/moved/missing, safe provenance cannot be established, or no coherent auditable RC can be built without forbidden scope.

Human UAT remains required even for `READY_FOR_HUMAN_UAT`; this plan does not authorize deployment or production readiness.
