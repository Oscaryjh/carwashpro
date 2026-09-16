# HR/Payroll UAT Preview Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy immutable HR/Payroll RC `f2553d3fcf5965b50151a52a374112ccac430417` to a new, fully isolated Railway UAT Preview without changing Testing or Production.

**Architecture:** Keep the existing `Tetamu-POS` Railway project, add one new environment named `hr-payroll-uat-preview-20260917`, and provision one Git-connected Next.js Web service plus one new PostgreSQL service inside that environment. Desktop `/team` and Staff `/staff` share the Web service and Preview database; no worker, cron, WhatsApp connector, real SMS, payment, bank, government, or PCB Production service is inherited.

**Tech Stack:** Git/GitHub, Railway CLI 5.57.5, Railway Git-connected builds, Node.js/npm, Next.js 16.3.5, Prisma, PostgreSQL 18, Playwright-compatible browser smoke.

**Spec:** `docs/superpowers/specs/2026-09-17-hr-payroll-uat-preview-deployment.md`

## Global Constraints

- Runtime source must be exactly `f2553d3fcf5965b50151a52a374112ccac430417`, tree `8d8f7cc821aaf1490c746d72be418b1211302549`, archive SHA-256 `1963e5a46bec9630a0b3be7f60674b6f7bfeff060a9eb8440af1c726ed1e2c82`.
- Push only `codex/hr-payroll-canonical-rc-20260916`; never force-push or push `main`.
- Never merge, create a PR, deploy Production, or overwrite Desktop Testing or Staff Testing.
- Preview must use a new PostgreSQL service and must not reuse, clone, or read Testing/Production business data.
- Never print or persist tokens, passwords, OTPs, `DATABASE_URL`, provider credentials, private keys, or session cookies in Git, reports, terminal summaries, screenshots, or public URLs.
- `NODE_ENV=production`; Preview integrations must be mock/intercept/disabled and must not contact real SMS, WhatsApp, email, bank, payment, government, PCB Production, webhook, storage, cron, queue, AI, or OCR providers.
- A missing Preview-safe integration guard is `PREVIEW_EXTERNAL_INTEGRATION_GUARD_MISSING` and stops execution before Railway resource creation.
- Migrations must use `prisma migrate deploy`; never use `migrate reset`, `db push`, database drop, force migration, or migration-history edits.
- Fixture writes must be idempotent, synthetic, Preview-only, and fail closed for Testing and Production.
- Human UAT remains `PENDING`; automatic smoke never means Human UAT passed or Production eligible.
- Existing Testing and Production deployment IDs, domains, variable fingerprints, and migration heads must match their pre-deployment baselines after Preview work.
- New running Web/PostgreSQL resources add usage-based Railway cost. Railway's current official pricing bills CPU, RAM, volume storage, and egress by usage; the current workspace has no hard usage limit configured.

## Read-only Railway Baseline

- Project: `Tetamu-POS`, ID `ec8b25a7-4fb9-4959-8353-b4af000f4e80`.
- Testing environment: `testing`, ID `ac9ef980-6805-4bf2-99f2-72dc7579d99d`.
- Production environment: `production`, ID `bef43b86-32dc-486e-a1ef-bb9f9699e4f5`.
- Testing Desktop: service `e967b54d-dd06-4741-be99-e6e55e70af0e`, deployment `e253e3d7-6679-4a14-aec4-8bf60e4414ef`, domain `tetamu-pos-web-testing.up.railway.app`.
- Testing Staff environment service: `5f4fb86d-85d6-4a30-a027-6c2d36425c93`, deployment `5b3a4171-2a75-4164-aee2-efcc2fead738`, domain `tetamu-staff-app-testing.up.railway.app`.
- Testing canonical Singapore database: service `49c45405-1634-4292-9df3-bc27fe9a62a1`, deployment `7498c681-c14f-4f1a-ab2c-5afdb7c23412`.
- Production Web: service `e967b54d-dd06-4741-be99-e6e55e70af0e`, deployment `ee8c83f4-e33a-4742-b71c-e87849abecb8`, domain `tetamu-pos-web-production.up.railway.app`.
- Production Singapore database: service `45c5d61e-85b5-43b9-919a-0e1eaedaffa5`, deployment `5a6fd688-65f7-43c5-ba9a-d88413664ba8`.
- Current environment list contains only `testing` and `production`; the requested Preview name is unique at baseline.
- Both environments also contain shared service definitions; the Preview architecture must not duplicate or activate their workers, cron jobs, WhatsApp connector, or existing volumes.
- Current workspace usage is already billable and no hard usage limit is configured. Exact future cost cannot be known before measuring Preview resource use.

---

### Task 1: Freeze and verify the canonical source identity

**Files:**
- Read: `release-manifests/hr-payroll-canonical-rc-20260916.json`
- Read: `package.json`
- Read: `package-lock.json`
- No modifications

**Interfaces:**
- Consumes: immutable source SHA and Manifest V2.
- Produces: a pass/fail identity record used by every later task.

- [x] **Step 1: Confirm linked worktree and branch**

  Run `git rev-parse --show-toplevel`, canonicalize `git rev-parse --git-dir` and `git rev-parse --git-common-dir`, confirm they differ, confirm no superproject, and confirm branch `codex/hr-payroll-canonical-rc-20260916`.

- [x] **Step 2: Confirm source ancestry and clean state**

  Run `git merge-base --is-ancestor f2553d3fcf5965b50151a52a374112ccac430417 HEAD` and `git status --porcelain=v1 -uall`. Expected: ancestry exit 0 and no status entries.

- [x] **Step 3: Recompute immutable identity**

  Run `git rev-parse f2553d3fcf5965b50151a52a374112ccac430417^{tree}` and `git archive --format=tar f2553d3fcf5965b50151a52a374112ccac430417 | shasum -a 256`. Expected tree and digest are the values in Global Constraints.

- [x] **Step 4: Validate Manifest V2**

  Confirm `READY_FOR_HUMAN_UAT`, `PENDING`, `NOT_DEPLOYED`, `productionEligible=false`, `finalVerification.blockedItems=[]`, `incompleteRequiredGates=[]`, 32 ordered commits, exact Git order, and all 91 included-file SHA-256 values.

- [x] **Step 5: Validate dependency identity**

  Run `npm ls next sharp`, scan the lockfile with semver, and confirm Next `16.3.5`, Sharp `0.35.4`, zero Sharp `<0.35.4`, and zero Next runtime `<16.3.3`.

### Task 2: Record the Railway non-mutation baseline

**Files:**
- Create later: `TETAMU_HR_PAYROLL_UAT_PREVIEW_DEPLOYMENT_REPORT.md`
- No Railway mutations

**Interfaces:**
- Consumes: authenticated Railway CLI and project ID.
- Produces: environment/service/deployment/domain/variable-fingerprint baseline for final isolation comparison.

- [x] **Step 1: Authenticate without exposing credentials**

  Run `npx -y @railway/cli@5.57.5 whoami`; record only successful authentication, never tokens.

- [x] **Step 2: Inventory projects and environments**

  Run `railway list --json` and explicit `railway status --project ec8b25a7-4fb9-4959-8353-b4af000f4e80 --environment <testing|production> --json`.

- [x] **Step 3: Capture critical immutable identifiers**

  Record the IDs and domains in Read-only Railway Baseline. Before any mutation, compute SHA-256 fingerprints of raw variable JSON in memory for every existing service; do not print raw values.

- [x] **Step 4: Record cost and limit state**

  Run `railway usage --workspace cd1d5a2c-bcd1-43c8-bfc0-be18fc60fe06 --json`; record current/estimated usage and whether a hard limit exists without changing billing controls.

### Task 3: Prove Preview integration and fixture guards before resource creation

**Files:**
- Read: `scripts/validate-release-environment.mjs`
- Read: `src/lib/attendance/employee-auth/config.ts`
- Read: `scripts/hr-payroll-eight-role-uat-contract.ts`
- Read: `scripts/prepare-hr-payroll-eight-role-uat.ts`
- Test: `tests/unit/attendance-employee-auth.test.ts`
- Test: `tests/unit/hr-payroll-eight-role-uat.test.ts`
- Test: `tests/unit/release-environment-validator.test.ts`
- No runtime source modifications permitted in this deployment task

**Interfaces:**
- Consumes: exact canonical source configuration behavior.
- Produces: a hard allow/stop decision before push and Railway resource creation.

- [x] **Step 1: Verify production-build OTP behavior**

  Run the focused auth tests and directly inspect `getEmployeeAuthConfig`. Expected safe Preview behavior would accept a Preview-only mock/intercept under `NODE_ENV=production` while refusing real provider calls.

- [x] **Step 2: Verify eight-role fixture target guard**

  Run the fixture contract tests. Expected safe Preview behavior would allow only an explicitly identified Preview database while rejecting Testing and Production fingerprints.

- [x] **Step 3: Apply the stop condition**

  Observed canonical behavior is fail-closed but does not implement the required Preview path: production mode rejects mock OTP, and the eight-role fixture accepts only localhost while also rejecting `NODE_ENV=production`. Therefore set `PREVIEW_EXTERNAL_INTEGRATION_GUARD_MISSING`, do not push, and do not create Railway resources. Resume Tasks 4-11 only from a newly audited RC that adds explicit Preview-only guards and preserves all fail-closed Production behavior.

### Task 4: Run push gates and push only the RC branch

**Files:**
- No source modifications

**Interfaces:**
- Consumes: Task 3 PASS from a newly audited RC.
- Produces: remote branch SHA verified by `git ls-remote`.

- [ ] **Step 1: Run source quality gates**

  Run `npx tsc --noEmit`, `npm run lint`, `npm test`, and `npm run build`. Require zero failures; lint warning count must not exceed the audited baseline of 13.

- [ ] **Step 2: Run source hygiene gates**

  Scan tracked changes for secrets, generated artifacts, absolute local paths, new skip/todo markers, and weakened assertions. Require zero prohibited findings.

- [ ] **Step 3: Push without force**

  Run `git push origin codex/hr-payroll-canonical-rc-20260916:codex/hr-payroll-canonical-rc-20260916`. Never use `--force` and never push another ref.

- [ ] **Step 4: Verify remote SHA**

  Run `git ls-remote --heads origin refs/heads/codex/hr-payroll-canonical-rc-20260916`; require the approved remote head and prove the immutable runtime source commit is available to Railway.

### Task 5: Create the isolated Preview environment and services

**Files:**
- No repository modifications

**Interfaces:**
- Consumes: pushed audited source and unique Preview names.
- Produces: one Preview environment, one Web service, and one PostgreSQL service.

- [ ] **Step 1: Recheck name uniqueness and capacity**

  List environments/services immediately before creation. If the Preview name exists unexpectedly or Railway rejects capacity, stop with `PREVIEW_RESOURCE_LIMIT_BLOCKED`; never target Testing.

- [ ] **Step 2: Create the environment**

  Create `hr-payroll-uat-preview-20260917` without duplicating Testing or Production. Record the returned environment ID.

- [ ] **Step 3: Create PostgreSQL**

  Create `tetamu-hr-payroll-uat-db` from Railway's PostgreSQL 18 template inside the Preview environment, with its own volume. Record service, deployment, and volume IDs.

- [ ] **Step 4: Create Web service**

  Create `tetamu-hr-payroll-uat-web` in the Preview environment. Do not create a Staff service because `/team` and `/staff` share the same Next.js deployment.

- [ ] **Step 5: Assert absence of inherited services**

  Confirm no worker, cron, WhatsApp connector, backup job, restore job, Testing volume, or Production volume exists in the Preview environment.

### Task 6: Configure safe Preview variables without deployment

**Files:**
- No repository modifications

**Interfaces:**
- Consumes: Preview service IDs and private database reference.
- Produces: a variable-name and value-fingerprint record; raw secrets remain sealed.

- [ ] **Step 1: Set release and environment identity**

  Configure `NODE_ENV=production`, the audited Preview environment selector, `APP_RELEASE_SHA`, `APP_RELEASE_SOURCE_DIGEST`, and the private Preview `DATABASE_URL` reference.

- [ ] **Step 2: Set independent cryptographic secrets**

  Generate Preview-only session, employee-auth, MFA, statutory-artifact, and payroll-payment secrets in memory and send them through stdin. Never copy Testing/Production values and never print generated values.

- [ ] **Step 3: Disable all external integrations**

  Configure the audited Preview-only OTP interceptor, WhatsApp disabled/mock mode, email disabled/sandbox, AI disabled, OCR disabled, payment/bank/government/PCB Production disabled, official export disabled, webhook absent, storage absent, and all worker/cron entry points absent.

- [ ] **Step 4: Validate variable safety**

  List variable names and hash the full variable JSON in memory. Require no Testing/Production database fingerprint or real provider credential name/value to be active.

### Task 7: Migrate and seed the isolated database

**Files:**
- Use the newly audited Preview fixture script from the immutable approved RC
- No migration history edits

**Interfaces:**
- Consumes: empty Preview PostgreSQL and Preview-only fixture guard.
- Produces: 214 migrations and one idempotent eight-role synthetic business.

- [ ] **Step 1: Prove empty and isolated database identity**

  Query only server version, current database, schema table count, and a salted connection fingerprint. Compare against Testing/Production fingerprints without revealing hosts or credentials.

- [ ] **Step 2: Validate and generate Prisma client**

  Run `npx prisma validate` and `npx prisma generate` against the Preview environment.

- [ ] **Step 3: Deploy migrations**

  Run `npx prisma migrate deploy`. Confirm exactly 214 successful migrations, head `20260915090000_people_workbench_account_classification`, zero failed migrations, and the audited schema hash.

- [ ] **Step 4: Seed synthetic fixture**

  Run the Preview-only idempotent fixture. Require one clearly synthetic business, at least two branches, one group, all eight personas, attendance/roster/leave/exception/correction/OT/timesheet/payroll/payslip data, and restricted payment/statutory/PCB states.

- [ ] **Step 5: Verify idempotency and credential handling**

  Run the fixture twice, compare business/payroll/device counts, and require no duplicates. Store credential handoff material only in a restricted external evidence location and report only its location.

### Task 8: Deploy immutable Git source and issue the Preview domain

**Files:**
- No local upload and no repository modifications

**Interfaces:**
- Consumes: remote audited source, configured Web service, migrated Preview DB.
- Produces: one successful commit-bound Railway deployment and HTTPS domain.

- [ ] **Step 1: Connect the Git source**

  Connect `tetamu-hr-payroll-uat-web` to `Oscaryjh/carwashpro` and the approved RC ref. Require Railway/GitHub metadata to resolve the actual source commit to the audited immutable SHA; never use `railway up`.

- [ ] **Step 2: Configure deploy settings**

  Use `npm run build`, `npm start`, port `8080`, health path `/api/health`, one Singapore replica, no cron, no volume, and no inherited worker command.

- [ ] **Step 3: Wait for deployment terminal state**

  Record deployment ID, timestamp, status, source metadata, image digest, and logs. Stop on build, migration, health, or startup failure and use systematic debugging before any change.

- [ ] **Step 4: Generate the Railway domain**

  Generate one Railway domain for port 8080. Record only the public HTTPS URL and domain ID.

### Task 9: Run post-deployment smoke and responsive checks

**Files:**
- Evidence stays outside the worktree

**Interfaces:**
- Consumes: Preview URL and securely handed-off synthetic credentials.
- Produces: health, Desktop, Staff, RBAC, restricted-feature, and viewport evidence.

- [ ] **Step 1: Verify deployment identity and health**

  Require HTTPS 200, database ready, Preview environment, full source SHA, source digest, deployment ID, and no startup/migration loop. Cross-check health values against Railway source/deployment metadata.

- [ ] **Step 2: Run Desktop smoke**

  Verify login, People, profile, Attendance, Timesheet, Roster, Leave, Exceptions/Corrections, OT, Payroll workspace/run/components/reconciliation/payslip, permission denial, and sign-out.

- [ ] **Step 3: Run Staff smoke**

  Verify Preview-only OTP, Attendance, Roster, Leave, correction, approved OT, locked Timesheet, Pay/Payslip, date navigation, own-only boundary, and sign-out.

- [ ] **Step 4: Run eight-role RBAC checks**

  Require Branch Manager branch scope, Supervisor no Payroll, Group Manager no bank/statutory/mutation, Staff own-only, Payroll Read not Modify/Export/Submit, and deep-link denial.

- [ ] **Step 5: Verify restricted features**

  Prove bank execution, paid marking, official statutory export, government submission, PCB Production, and unapproved Sabah/Maternity activation remain unavailable.

- [ ] **Step 6: Run responsive smoke**

  At 1440, 834, 390, and 360 pixels, verify People, Payroll Run, payment blocked state, Staff Home, Staff Payslip, and Staff date picker.

### Task 10: Prove environment isolation after deployment

**Files:**
- Create later: `TETAMU_HR_PAYROLL_UAT_PREVIEW_DEPLOYMENT_REPORT.md`

**Interfaces:**
- Consumes: Task 2 baseline and current Railway metadata.
- Produces: exact before/after proof or `ENVIRONMENT_ISOLATION_BREACH`.

- [ ] **Step 1: Re-read Testing and Production topology**

  Compare environment IDs, critical service deployment IDs, domains, image digests, volumes, source metadata, and in-memory variable fingerprints with Task 2.

- [ ] **Step 2: Re-read migration heads**

  Use read-only database access to confirm Testing/Production migration heads did not change.

- [ ] **Step 3: Check outbound evidence**

  Inspect Preview logs and fixture audit rows for zero real SMS, WhatsApp, email, bank, payment, government, statutory, webhook, AI, and OCR outbound requests.

- [ ] **Step 4: Apply breach stop rule**

  If any non-Preview environment changed, stop with `ENVIRONMENT_ISOLATION_BREACH`; record evidence and do not roll back or overwrite other environments without explicit authorization.

### Task 11: Prepare human UAT handover and final verification

**Files:**
- Create: `TETAMU_HR_PAYROLL_HUMAN_UAT_CHECKLIST.md`
- Create: `TETAMU_HR_PAYROLL_UAT_PREVIEW_DEPLOYMENT_REPORT.md`

**Interfaces:**
- Consumes: verified deployment, smoke, and isolation evidence.
- Produces: ordinary-user checklist, Preview URL, secure credential handoff location, rollback/delete procedure, cost note, risks, and final verdict.

- [ ] **Step 1: Write the 25-flow human checklist**

  For each requested flow include number, role, precondition, plain-language steps, expected result, actual result, PASS/FAIL, screenshot/notes, bug severity, and retest status.

- [ ] **Step 2: Write the deployment report**

  Include all 23 required sections. Do not include secret material; identify the credential handoff channel/location only.

- [ ] **Step 3: Document rollback/delete without executing it**

  Record how to stop the Preview Web service, preserve or export synthetic evidence if approved, and delete only the Preview environment/database by exact IDs. Never delete Testing or Production.

- [ ] **Step 4: Run verification-before-completion**

  Freshly rerun Git identity, remote SHA, Railway deployment/source metadata, health, migration count/head, fixture idempotency, smoke results, restricted-feature checks, isolation comparison, secret scan, and document validation.

- [ ] **Step 5: Set the only allowed verdict**

  Use `READY_FOR_HUMAN_UAT_ON_PREVIEW` only when every deployment and isolation gate passes. Use `PREVIEW_DEPLOYMENT_BLOCKED` when no Preview was created. Use `PREVIEW_DEPLOYED_WITH_BLOCKERS` only when an isolated Preview exists but smoke failed. Never state Production Ready, Production Eligible, Human UAT Passed, or Production Deployed.

## Current Execution Checkpoint

- Completed: Tasks 1 and 2; Task 3 investigation and focused tests.
- Stop code: `PREVIEW_EXTERNAL_INTEGRATION_GUARD_MISSING`.
- No Git push occurred; the remote RC branch did not exist at the check time.
- No Railway environment, service, database, domain, variable, migration, or deployment was created or changed.
- Required next engineering work is outside this deployment's authorization: create and audit a new RC with a dedicated Preview runtime environment, production-build-safe intercepted OTP, and a Preview-database allowlist/fingerprint guard for the idempotent eight-role fixture.
