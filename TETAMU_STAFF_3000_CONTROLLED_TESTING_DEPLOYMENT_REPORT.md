# TETAMU STAFF 3000 — CONTROLLED TESTING DEPLOYMENT REPORT

Date: 2026-08-30  
Canonical workspace: `C:\CodexTetamuP0`  
Target requested: Railway `testing` / `tetamu-staff-app` / port `3000`

## 1. FINAL VERDICT

**BLOCKED — MIGRATION HISTORY DRIFT / PRE-DEPLOY INTEGRATION GATE FAILED**

No new Railway deployment was created. The currently running Testing deployment remains unchanged.

The reviewed Timesheet fix itself passes focused and full unit coverage, but the isolated deployment source cannot pass the disposable integration gate without carrying an existing untracked Staff appearance migration. Railway Testing already has the related database columns, while its `_prisma_migrations` table does not record the migration. The task explicitly forbids migration reconciliation and requires stopping when an isolated source has an unresolved schema/migration dependency.

## 2. DEPLOYMENT STRATEGY

- Clean worktree: `C:\CodexTetamuP0-staff-testing-deploy-20260830`
- Branch: `codex/staff-testing-timesheet-20260830`
- Base: `9037025b10adb215a17d19acf61df51e23ef95fb`
- Strategy used: clean Git worktree plus explicit extraction of reviewed Staff 3000 files.
- Why this was safer than the main workspace: the canonical workspace contains approximately 257 visible dirty entries and 678 tracked files whose worktree content differs from `HEAD` while marked assume-unchanged. The main workspace was never used as Railway deployment input.
- Outcome: isolation was technically achieved, but the candidate expanded to 121 changed/untracked entries to preserve previously approved Staff runtime dependencies. That candidate could not satisfy the disposable integration gate without importing migration drift, so it was rejected before commit/build/deploy.

## 3. APPROVED FILE MANIFEST

### Reviewed Timesheet fix

| File | Reason | Dependency | Already deployed? | Must deploy now? | Deployed |
|---|---|---|---|---|---|
| `src/lib/attendance/employee-timesheet.ts` | Deduplicate Staff Timesheet workdays and derive employee actionability from canonical Attendance evidence | Attendance resolution/read model | No evidence that current Testing contains this final fix | Yes | No — blocked |
| `src/app/staff/timesheet/page.tsx` | Render one canonical card and correct Waiting-for-manager/no-CTA state | `employee-timesheet.ts`, Staff session scope | No evidence that current Testing contains this final fix | Yes | No — blocked |
| `tests/unit/employee-timesheet-projection.test.ts` | Locks 30 Aug projection contract and month-boundary behavior | Timesheet read model | Test-only | Yes | No — blocked |

### Required reviewed Staff dependencies considered

The clean candidate also extracted the existing Staff 3000 shell, Attendance employee-auth/read services, Approval Center, Android Home clearance/manager priority, Leave/Claims copy, correction CTA, appointments, profile/avatar, roster/schedule, Staff PWA assets, and their focused tests. These were considered because deploying only the three Timesheet files from old Git `HEAD` would revert newer Staff behavior already visible in Testing.

The candidate contained 121 changed/untracked entries. It was **not approved for promotion** because the exact deployed source for the current CLI-origin Railway deployment cannot be reconstructed from a clean commit, and the candidate's Staff appearance source depends on database fields whose migration history is drifted.

Two minimal non-Staff dependency adjustments were isolated only to satisfy existing full-unit contracts:

- `src/app/(business)/team/employees/[employeeId]/page.tsx`: accept `MODIFY_TEAM` or `MODIFY_ATTENDANCE_EMPLOYEES` for the profile shell.
- `src/app/(business)/team/employees/actions.ts`: same capability contract for update action.

They passed tests but were not deployed.

## 4. EXCLUDED DIRTY CHANGES

Confirmed: unrelated main-workspace changes were not deployed.

Excluded categories include:

- PCB / statutory correctness work and statutory migrations.
- POS, inventory, supplier/AP, subscription, analytics, WhatsApp and other unrelated application changes.
- Unrelated Payroll UI/calculation changes.
- The dirty main worktree itself.
- Staff 3100 source and migrations.
- Any unknown mixed hunk that could not be proven to be part of reviewed Staff 3000 work.

No commit was created from the rejected candidate and no Railway upload occurred.

## 5. MIGRATION STATUS

- **NO NEW MIGRATION** was created.
- No existing migration was renamed, deleted or edited.
- No `prisma migrate deploy` was run.
- No `prisma migrate resolve` was run.
- `_prisma_migrations` was not modified.
- Testing drift was left unchanged.

Read-only Testing verification found:

- `businesses.staff_app_logo_url`: present.
- `businesses.staff_app_appearance`: present.
- `_prisma_migrations` entry `20260829110000_canonical_staff_app_appearance`: absent.

The canonical workspace contains an untracked migration directory named `prisma/migrations/20260829110000_canonical_staff_app_appearance/`. It was not copied into the deployment candidate because doing so would import/reconcile the known drift contrary to this task.

Disposable integration created a clean database from the 209 migrations present in the candidate. Prisma Client then expected `staff_app_logo_url`, but the clean database lacked it. This is the exact pre-deploy blocker.

## 6. PRE-DEPLOY TESTS

| Gate | Result |
|---|---|
| Timesheet focused projection tests | PASS |
| Focused Staff/Timesheet/Android/Approval/History suite | PASS — 41/41 |
| Full unit suite | PASS — 1211/1211 |
| Staff/security | PASS inside full unit suite |
| Attendance/Approval | PASS inside focused and full unit suites |
| Protected disposable integration | **FAIL / BLOCKER** — clean migrated DB lacks `businesses.staff_app_logo_url`; execution stopped after root cause was established |
| TypeScript | PASS — `npx tsc --noEmit` |
| ESLint | PASS with 0 errors and 3 existing warnings |
| Prisma generate | PASS |
| Prisma validate | PASS |
| Build | NOT RUN — stop condition triggered before build |

The first full-unit attempt exposed two omitted capability dependencies in the clean candidate. Only the exact tested capability imports/calls were added. The rerun passed 1211/1211.

## 7. RAILWAY TESTING DEPLOYMENT

- Environment: `testing`
- Service: `tetamu-staff-app`
- Intended port: `3000`
- New deployment ID: **NONE**
- Build: NOT STARTED
- Runtime: NOT CHANGED
- Existing deployment retained: `91ed5b14-bffa-42e6-8d2e-de2370d8cf71`
- Existing deployment status: `SUCCESS`
- Existing deployment created at: `2026-08-29T10:54:02.257Z`

## 8. POST-DEPLOY SMOKE

Not applicable because no deployment occurred.

- `/api/health`: NOT RUN as post-deploy smoke
- `/staff/login`: NOT RUN as post-deploy smoke
- `/staff/manifest.webmanifest`: NOT RUN as post-deploy smoke
- 3100 dependency: no 3100 source was introduced into the candidate

## 9. 30 AUG REAL DATA VERIFICATION

Not performed as post-deploy verification because deployment was blocked. No real UAT state was mutated.

- Attendance History: NOT RE-VERIFIED AFTER DEPLOYMENT
- Timesheet card count: NOT RE-VERIFIED AFTER DEPLOYMENT
- Status: NOT RE-VERIFIED AFTER DEPLOYMENT
- CTA: NOT RE-VERIFIED AFTER DEPLOYMENT
- Result: BLOCKED BEFORE DEPLOYMENT

## 10. ANDROID HOME FIX

Source and focused unit coverage for the previously approved Android Home behavior were included in the rejected candidate:

- Bottom nav: focused test PASS
- Manager priority: focused test PASS
- Empty upcoming schedule density: focused test PASS

No post-deploy physical/browser verification was performed because no deployment occurred.

## 11. MOBILE 390

NOT RUN — deployment stop condition triggered before authenticated Testing browser UAT.

## 12. MOBILE 412

NOT RUN — deployment stop condition triggered before authenticated Testing browser UAT.

## 13. PRODUCTION STATUS

**TESTING ONLY**

**PRODUCTION NOT ACCESSED** — no Production service, database, credentials, logs, runtime or application data was targeted. An initial Railway project-status response returned environment metadata for the project; no Production endpoint or secret was opened or used.

**PRODUCTION NOT MODIFIED**

## Required next decision

Before a controlled Staff 3000 deployment can proceed, the repository and Railway Testing migration history must have an owner-approved canonical answer for the already-present Staff appearance columns. This task must not resolve that drift implicitly.

Safe options for a separate, explicitly authorized task are:

1. Establish a clean reviewed base commit that exactly matches the current Railway Testing Staff 3000 source and records the already-applied Staff appearance database state; or
2. Approve a dedicated migration-history reconciliation procedure with independent database backup/evidence and no Production scope.

Until then, deploying the dirty workspace or silently importing the untracked migration would violate the controlled-deployment contract.
