# UAT Preview Safety Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and prove a production-grade `uat-preview` runtime with isolated access, OTP, and database/fixture guards, without touching Railway, Testing, or Production.

**Architecture:** A shared executable environment parser is consumed by both Next.js and the release validator. Narrow Preview-only modules enforce access, challenge-bound HMAC OTP, and denylist-first database identity before existing authentication/RBAC and before fixture writes. Existing production and testing paths remain separate and receive non-regression coverage.

**Tech Stack:** Next.js 16.3.5, TypeScript, Node.js 22+, node:test/tsx, Prisma/PostgreSQL, Next middleware, HMAC-SHA-256.

**Spec:** `docs/superpowers/specs/2026-09-17-uat-preview-safety-guards-design.md`

## Global Constraints

- Work only in `/Users/innovdia/Documents/Codex/2026-09-15/jian/worktrees/hr-payroll-canonical-rc-20260916` on `codex/hr-payroll-canonical-rc-20260916`.
- Preserve the existing ordered commits and keep `f2553d3fcf5965b50151a52a374112ccac430417` in ancestry.
- Do not push, merge, create a PR, create Railway resources, deploy, or modify Railway variables.
- Do not access or mutate Testing or Production data and do not send real SMS, WhatsApp, email, bank, government, or PCB Production traffic.
- Every behavior change follows RED, observed expected failure, minimal GREEN, focused regression, then its exact commit.
- `uat-preview` always uses `NODE_ENV=production`; unknown deployed environments fail closed.
- Preview OTP never falls back to `mock`, `sms123`, or `twilio_verify`.
- Database denylist checks execute before allowlist checks and before any write.
- Browser screenshots, traces, videos, credentials, database URLs, OTPs, and session artifacts remain outside Git.
- The only successful final verdict is `READY_FOR_CONTROLLED_UAT_PREVIEW_DEPLOYMENT`.

---

### Task 1: First-class production-grade UAT Preview runtime

**Files:**
- Create: `src/lib/release/environment-contract.mjs`
- Create: `src/lib/release/environment-contract.d.mts`
- Modify: `src/lib/release/environment.ts`
- Modify: `tests/unit/release-handoff-guards.test.ts`
- Create: `tests/unit/uat-preview-runtime.test.ts`
- Modify: `docs/hr-payroll-canonical-rc-source-ledger.md`

**Interfaces:**
- Produces: `parseRuntimeEnvironment(env): RuntimeEnvironment` and `isProductionGradeEnvironment(value): boolean`.
- Preserves: `runtimeEnvironment`, `releaseIdentity`, `isProductionRuntime`, and `assertLocalDatabaseTarget` consumers.
- Runtime environments: `development | testing | uat-preview | production`.

- [ ] **Step 1: Add runtime RED tests**

  Test literal outcomes for `uat-preview`, existing development/testing/production mappings, unknown explicit values, and missing Railway environment identity on a Railway deployment. Assert `releaseIdentity` reports `uat-preview`, never `development`.

- [ ] **Step 2: Run runtime RED**

  Run: `npx tsx --test tests/unit/release-handoff-guards.test.ts tests/unit/uat-preview-runtime.test.ts`

  Expected: FAIL because `uat-preview` currently returns `development` and unknown values do not throw.

- [ ] **Step 3: Add the shared parser and minimal runtime wiring**

  Implement one strict parser in the `.mjs` module with the declared `.d.mts` type surface. Reject an unknown selected value. If Railway deployment identity is present but both `APP_ENVIRONMENT` and `RAILWAY_ENVIRONMENT_NAME` are absent, throw `RUNTIME_ENVIRONMENT_REQUIRED_FOR_DEPLOYED_BUILD`. Keep the existing local `NODE_ENV` mappings.

- [ ] **Step 4: Run runtime GREEN and non-regression**

  Run the command from Step 2 and `npx tsc --noEmit`.

- [ ] **Step 5: Commit runtime identity**

  Stage only the runtime contract, runtime tests, approved design/plan, and source-ledger rows. Commit as `feat(runtime): add production-grade uat preview identity`.

### Task 2: Isolated challenge-bound Preview OTP interceptor

**Files:**
- Modify: `src/lib/attendance/employee-auth/config.ts`
- Modify: `src/lib/attendance/employee-auth/provider.ts`
- Modify: `src/lib/attendance/employee-auth/otp-service.ts`
- Create: `src/lib/attendance/employee-auth/uat-preview-otp.ts`
- Create: `scripts/read-uat-preview-employee-otp.ts`
- Create: `tests/unit/uat-preview-employee-otp.test.ts`
- Modify: `tests/unit/attendance-employee-auth.test.ts`
- Modify: `tests/integration/attendance-employee-auth.test.ts`
- Modify: `docs/hr-payroll-canonical-rc-source-ledger.md`

**Interfaces:**
- Produces: provider name `uat_preview_intercept`, `deriveUatPreviewOtp({ challengeId, phoneNumber, expiresAt }, seed): string`, `assertUatPreviewOtpConfiguration(env): UatPreviewOtpConfig`, and `UatPreviewEmployeeOtpProvider`.
- Consumes: Task 1 `runtimeEnvironment`; existing OTP challenge expiry, attempt, rate-limit, invalidation, and single-use state.
- Provider reference format: `uat-preview:v1:<challenge-id>:<expiry-epoch-seconds>`; it contains no OTP or phone number.

- [ ] **Step 1: Add configuration and provider RED tests**

  Cover the accepted Preview identity and all rejections: Production, Testing, development, project/environment/Web service mismatch, missing seed, access gate disabled, restricted action enabled, non-synthetic phone, and real provider credentials. Assert the factory throws instead of returning another provider and injected SMS123/Twilio request functions remain at zero calls.

- [ ] **Step 2: Run OTP RED**

  Run: `npx tsx --test tests/unit/uat-preview-employee-otp.test.ts tests/unit/attendance-employee-auth.test.ts`

  Expected: FAIL because the provider name and Preview configuration do not exist.

- [ ] **Step 3: Implement minimal HMAC provider**

  Derive six digits from HMAC-SHA-256 over a domain-separated canonical value containing challenge ID, normalized allowlisted phone, and expiry epoch. Parse and validate the provider reference on verification, compare codes with the existing timing-safe helper, and return `EXPIRED` after expiry. Do not set `otpHash`; keep `verificationMode="provider"`.

- [ ] **Step 4: Add lifecycle RED tests through the real OTP service**

  Use disposable integration state to prove successful Staff login, expired challenge rejection, replay rejection, attempt lock, request/verify rate limits, and allowlist denial. Capture console output and assert neither the derived code nor full phone appears.

- [ ] **Step 5: Run lifecycle RED, then add only required service integration**

  Run: `npx tsx --test --test-concurrency=1 tests/integration/attendance-employee-auth.test.ts`

  Expected before service wiring: FAIL because Preview challenges cannot select or verify the new provider. Wire the provider without changing the existing challenge lifecycle, then rerun to GREEN.

- [ ] **Step 6: Add guarded CLI helper and focused GREEN**

  The helper accepts `--challenge-id`, loads the challenge from the already-guarded database, rejects non-Preview identity/non-allowlisted/expired records, and writes only the six-digit result to stdout. It has no HTTP route and never logs environment values.

- [ ] **Step 7: Run OTP regression and commit**

  Run the unit and integration commands above plus existing `staff-sms123-otp`, `staff-twilio-verify`, delivery-lifecycle, and transaction-timeout tests. Commit as `feat(auth): add isolated uat preview otp interceptor`.

### Task 3: Preview-wide access protection before application auth

**Files:**
- Create: `src/lib/release/preview-access.ts`
- Modify: `src/middleware.ts`
- Create: `tests/unit/uat-preview-access.test.ts`
- Modify: `tests/unit/attendance-employee-auth.test.ts`
- Modify: `tests/unit/business-context-recovery.test.ts`
- Modify: `docs/hr-payroll-canonical-rc-source-ledger.md`

**Interfaces:**
- Produces: `evaluateUatPreviewAccess(request, env): Promise<{ allowed: true } | { allowed: false; response: Response }>`.
- Consumes: Task 1 strict runtime parser.
- Excludes: `/api/health`, `/_next/static/*`, `/_next/image/*`, and required public metadata assets only.

- [ ] **Step 1: Read the installed Next.js 16 proxy/matcher guide**

  Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`, especially matcher exclusions and Server Function caveats. Keep action-level authorization unchanged.

- [ ] **Step 2: Add access RED tests**

  Exercise real `NextRequest` objects for Desktop, Staff, and API routes. Prove missing/wrong credentials return 401 with a generic response and `WWW-Authenticate`; correct credentials continue to the existing login/RBAC layer; health/static are excluded; deep links cannot bypass; Testing/Production behavior is unchanged.

- [ ] **Step 3: Run access RED**

  Run: `npx tsx --test tests/unit/uat-preview-access.test.ts tests/unit/attendance-employee-auth.test.ts tests/unit/business-context-recovery.test.ts`

  Expected: FAIL because Preview requests currently reach the application without the outer gate.

- [ ] **Step 4: Implement constant-time Basic access**

  Decode Basic credentials without echoing them, hash/compare fixed-length byte arrays with equal work, and apply the gate before all existing middleware branches. Expand the static matcher to the documented negative pattern and retain the original path-specific back-office logic inside the middleware body.

- [ ] **Step 5: Run access GREEN, TypeScript, and build**

  Run the Step 3 command, `npx tsc --noEmit`, and `npm run build`.

- [ ] **Step 6: Commit access protection**

  Commit as `feat(security): protect uat preview application access`.

### Task 4: Denylist-first database identity and idempotent synthetic fixture

**Files:**
- Create: `scripts/uat-preview-database-guard.ts`
- Modify: `scripts/hr-payroll-eight-role-uat-contract.ts`
- Modify: `scripts/prepare-hr-payroll-core-acceptance.ts`
- Modify: `scripts/prepare-hr-payroll-eight-role-uat.ts`
- Create: `scripts/verify-hr-payroll-uat-preview-fixture.ts`
- Modify: `tests/unit/hr-payroll-eight-role-uat.test.ts`
- Create: `tests/unit/uat-preview-database-guard.test.ts`
- Create: `tests/integration/uat-preview-fixture-idempotency.test.ts`
- Modify: `docs/hr-payroll-canonical-rc-source-ledger.md`

**Interfaces:**
- Produces: `assertHrPayrollUatFixtureEnvironment(env): FixtureGuard`, `databaseConnectionFingerprint(databaseUrl, databaseServiceId, secret): string`, `assertPreviewDatabaseContents(database, guard): Promise<FixtureState>`, and `capturePreviewFixtureCounts(database, businessId): Promise<FixtureCounts>`.
- `FixtureCounts` includes Business, employee accounts/memberships, active devices, Attendance punches/timesheets/corrections, Leave requests/days/evidence, Payroll runs/entries/components, and Payslip publications.
- Synthetic marker: fixed business name `Tetamu HR Acceptance Test` plus fixed slug `tetamu-hr-uat-preview-synthetic-v1`.

- [ ] **Step 1: Add pure guard RED tests**

  Add literal tests for local disposable acceptance, correct Preview identity, each environment/Web/database service mismatch, database-name mismatch, fingerprint mismatch, missing secret, restricted provider/action enablement, and sanitized errors. Add combined allowlist+denylist inputs and prove each denylist category wins first.

- [ ] **Step 2: Run pure guard RED**

  Run: `npx tsx --test tests/unit/hr-payroll-eight-role-uat.test.ts tests/unit/uat-preview-database-guard.test.ts`

  Expected: FAIL because production/remote mode is currently rejected unconditionally and no fingerprint contract exists.

- [ ] **Step 3: Implement the minimal pure guard**

  Canonicalize connection identity without returning or logging it. Evaluate forbidden environment IDs, Web/database service IDs, database names, and fingerprints before any expected-value comparison. Keep the original exact-loopback local mode unchanged.

- [ ] **Step 4: Add database-content and two-run RED integration**

  On a disposable PostgreSQL database, migrate to 214/214, use fake Preview Railway IDs, and assert an unrelated row is rejected before write. On an empty database run the fixture twice and compare literal count snapshots for every required domain. Assert one active device and a single synthetic marker.

- [ ] **Step 5: Run integration RED**

  Run: `node scripts/run-integration-disposable.mjs --file tests/integration/uat-preview-fixture-idempotency.test.ts` if the runner accepts `--file`; otherwise run `DATABASE_URL=<disposable-url> npx tsx --test --test-concurrency=1 tests/integration/uat-preview-fixture-idempotency.test.ts` inside the existing disposable runner lifecycle.

  Expected: FAIL because the core acceptance script currently creates random Business, employee, Attendance, Leave, Payroll, and Payslip rows on each run.

- [ ] **Step 6: Make Preview fixture identity deterministic and idempotent**

  Execute the pure environment guard and read-only database-content guard before the first Prisma write. In Preview mode use fixed synthetic identities and marker; on a matching marker reconstruct/reuse the artifact and upsert/reuse eight-role identities. Leave local disposable behavior and its loopback guard intact. Never update non-marker rows.

- [ ] **Step 7: Run fixture GREEN and leak scan**

  Rerun Steps 2 and 5. Capture stdout/stderr and prove raw URL, hostname, username, password, guard secret, fingerprint secret, and OTP seed are absent.

- [ ] **Step 8: Commit fixture safety**

  Commit source and tests together as `feat(uat): bind preview fixture to railway database identity`.

### Task 5: Production-grade Preview release validator

**Files:**
- Modify: `scripts/validate-release-environment.mjs`
- Modify: `tests/unit/release-environment-validator.test.ts`
- Create: `tests/unit/uat-preview-release-validator.test.ts`
- Modify: `docs/environment-variable-contract.md`
- Modify: `docs/hr-payroll-canonical-rc-source-ledger.md`

**Interfaces:**
- Consumes: Task 1 `parseRuntimeEnvironment` and `isProductionGradeEnvironment`.
- Produces: production-grade Preview contract with full 40-hex SHA, 64-hex source digest, database/identity/access/OTP/fixture guards, disabled real providers and restricted integrations, disabled worker/cron, and false eligibility flags.

- [ ] **Step 1: Add validator RED matrix**

  Spawn the real validator and cover a valid Preview contract plus one failing case per required field/flag. Assert unknown environment is rejected. Preserve the existing valid Production Twilio/SMS123 cases and Testing mock case.

- [ ] **Step 2: Run validator RED**

  Run: `npx tsx --test tests/unit/release-environment-validator.test.ts tests/unit/uat-preview-release-validator.test.ts`

  Expected: FAIL because `uat-preview` currently bypasses every production check.

- [ ] **Step 3: Implement Preview contract without weakening Production**

  Import the shared parser. Apply common production-grade secrets/source/database validation to Production and Preview, then apply mutually exclusive provider contracts. For Preview require `uat_preview_intercept`, blank real-provider credentials, disabled outbound/restricted flags, exact identity variables, fixture/fingerprint settings, access gate, and `productionEligible=false`.

- [ ] **Step 4: Run validator GREEN and start-command smoke**

  Run Step 2 plus controlled environment invocations of `node scripts/validate-release-environment.mjs web`, `notification`, `analytics`, and `whatsapp`. Preview must allow only `web` and reject worker scopes.

- [ ] **Step 5: Commit validator**

  Commit as `fix(release): enforce production-grade uat preview contract`.

### Task 6: Local production-mode proof, complete regression, and immutable evidence

**Files:**
- Create: `scripts/verify-uat-preview-release-manifest.mjs`
- Modify: `release-manifests/hr-payroll-canonical-rc-20260916.json`
- Modify: `docs/hr-payroll-canonical-rc-source-ledger.md`
- Create: `TETAMU_HR_PAYROLL_UAT_PREVIEW_SAFETY_GUARD_REPORT.md`
- External evidence only: `/Users/innovdia/Documents/Codex/2026-09-15/jian/work/uat-preview-safety-guards-20260917/`

**Interfaces:**
- Manifest adds `uatPreviewEnvironmentContract`, `previewOtpInterceptor`, `previewAccessProtection`, `previewFixtureGuard`, `forbiddenEnvironmentIdentities`, `localEndToEndProof`, and `nextAllowedAction`.
- `nextAllowedAction` is exactly `CONTROLLED_UAT_PREVIEW_DEPLOYMENT` only when every required gate passes.

- [ ] **Step 1: Create a fresh disposable database and migrate 214/214**

  Use the existing embedded/disposable PostgreSQL tooling. Record only sanitized command, migration count/head, duration, and exit status outside the worktree.

- [ ] **Step 2: Calculate local Preview identity inputs**

  Use synthetic Railway IDs, a local-simulation flag rejected when a real Railway deployment ID is present, generated high-entropy access/OTP/fingerprint secrets kept outside Git, and the keyed fingerprint produced by the guard helper.

- [ ] **Step 3: Run production build and Preview fixture twice**

  Run `npm run build`, then start the final build with `NODE_ENV=production` and `APP_ENVIRONMENT=uat-preview`. Run core/eight-role preparation twice and use the fixture verifier to prove count equality and no non-marker rows.

- [ ] **Step 4: Run browser and responsive proof**

  Through the actual browser, prove access denial/allow, Desktop login, Staff HMAC OTP login, eight-role RBAC/deep-link denial, health `uat-preview` identity, restricted payment/statutory/PCB states, and 1440/834/390/360 layouts. Store screenshots/traces outside the worktree and record sanitized hashes/paths only.

- [ ] **Step 5: Audit outbound calls and clean ephemeral state**

  Prove SMS123/Twilio/WhatsApp/email/payment/webhook call counts are zero, expire/revoke session and OTP artifacts, stop local processes, and remove the disposable database through its bounded cleanup path.

- [ ] **Step 6: Run full fresh verification**

  Run Prisma validate/generate; fresh 214/214 and 213→214 migrations; TypeScript; lint; full unit; disposable integration; production build; auth, Preview, Leave, Attendance/Exception/Correction, Payroll, RBAC, Staff, and fail-closed suites; `npm ls next sharp`; vulnerable-version scan; secret/absolute-path/generated-artifact scans; skip/todo/weakened-assertion checks; and final cleanup verification.

- [ ] **Step 7: Build immutable canonical identity**

  After runtime commits, calculate full source SHA, tree, deterministic `git archive` SHA-256, ordered commits, and hashes for all included files. Write a manifest verifier that parses the JSON, compares Git identities and file hashes, checks every new required section, and rejects any verdict/next-action mismatch.

- [ ] **Step 8: Write Manifest V2 and safety report**

  Keep `humanUatStatus=PENDING`, `deploymentStatus=NOT_DEPLOYED`, every production/restricted eligibility false, and document remaining risks. Set the successful verdict only if all preceding evidence is PASS.

- [ ] **Step 9: Verify evidence and commit**

  Run the manifest verifier, report scans, `git diff --check`, and targeted JSON/Markdown validation. Commit as `docs(release): record uat preview safety guard evidence`.

- [ ] **Step 10: Final clean-state and non-mutation check**

  Confirm branch/ancestry/ordered commits, clean status, remote RC branch still absent, Railway environments still only Testing and Production, and existing Testing/Production deployment IDs unchanged. Do not push or deploy.
