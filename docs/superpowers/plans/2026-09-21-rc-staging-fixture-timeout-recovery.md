# RC Staging Fixture Timeout Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove and fix the RC Staging fixture submit timeout, then safely reconcile and resume the existing partial synthetic installation without deleting or overwriting data.

**Architecture:** Keep product Payroll submission semantics unchanged unless evidence proves a product reliability defect. Add a narrowly scoped fixture transaction policy plus a declarative checkpoint manifest/reconciler that validates all existing application rows before resuming from the sole safe checkpoint; the COMPLETE marker remains the only terminal install marker.

**Tech Stack:** TypeScript, Node test runner, Prisma 6.19.3, PostgreSQL 18, Railway RC Staging.

**Spec:** `docs/superpowers/plans/2026-09-21-rc-staging-fixture-timeout-recovery-spec.md`

## Global Constraints

- Base SHA is exactly `6fbcf4daf29512738ed7e49ef3c3ae149b9500b1`; old frozen refs never change.
- No schema or migration changes; migration ledger remains 216/216.
- No clearing, deletion, replacement, or overwrite of the current Staging database or volume.
- Testing, old Preview, Production, protected databases, and US resources are read/write forbidden.
- Bank execution, Payment Export, PCB government submission and real communications stay disabled.
- Secrets, credentials, database URLs and synthetic identifiers never enter reports or logs.

## Review Focus

- A partial database containing one unknown row must be rejected before any write.
- A known fixture row with one conflicting field or duplicate must be rejected before any write.
- A five-second timeout must roll back review status and audit writes and a retry must create each artifact once.
- Resume must skip every completed phase and produce exactly one COMPLETE marker.
- The fixture-only timeout policy must not alter the default production Payroll transaction budget.

---

### Task 1: Root-cause evidence and classification

**Files:**
- Create: `docs/rc-staging-fixture-timeout-root-cause.md`
- Create: `tests/integration/payroll-submit-transaction-timeout.test.ts`

**Interfaces:**
- Consumes: `submitPayrollRunForReview(context, database)` and the existing partial Staging draft.
- Produces: a measured query/stage profile and an evidence-backed A/B/C selection.

- [ ] Add a controlled-latency integration harness around a real disposable Payroll draft and capture the five-second P2028 failure.
- [ ] Verify RED: after failure the run remains DRAFT, there is no submit audit/publication/payment/COMPLETE marker, and a retry creates no duplicate run, entry, publication or audit artifact.
- [ ] Run a read-only remote diagnostic with a longer diagnostic-only budget, query events and lock/wait sampling; record only aggregate counts/timings.
- [ ] Classify the root cause and document why exactly one of A/B/C is selected.

### Task 2: Minimal timeout fix

**Files:**
- Modify: `scripts/lib/rc-staging-fixture-service.ts`
- Modify: `scripts/lib/rc-staging-hr-core-data.ts`
- Modify: `tests/integration/payroll-submit-transaction-timeout.test.ts`

**Interfaces:**
- Consumes: Task 1's measured cause.
- Produces: a scoped database client/submit path whose finite budget applies only to the guarded fixture when C is proven, or the corresponding minimal A/B implementation if evidence differs.

- [ ] Write the fix-specific RED assertion, including unchanged default product behavior.
- [ ] Implement the smallest selected option with no retry and no global Prisma timeout.
- [ ] Run the targeted timeout and Payroll tests to GREEN.

### Task 3: Manifest reconciliation and resumable installer

**Files:**
- Create: `scripts/lib/rc-staging-fixture-reconciliation.ts`
- Modify: `scripts/lib/rc-staging-fixture-service.ts`
- Modify: `scripts/lib/rc-staging-hr-core-data.ts`
- Modify: `tests/integration/rc-staging-fixture.test.ts`
- Modify: `tests/unit/rc-staging-fixture-contract.test.ts`
- Modify: `docs/rc-staging-synthetic-fixture.md`

**Interfaces:**
- Consumes: the exact partial checkpoint after six valid manual PCB confirmations.
- Produces: `reconcileStagingFixtureCheckpoint()` and resume-only phase functions that reject unknown/conflicting/duplicate state before writes.

- [ ] Add RED cases for exact subset acceptance, unknown row, conflict, duplicate, ambiguous checkpoint and no-write rejection.
- [ ] Split the core fixture at the already-observed checkpoint without changing its synthetic semantics.
- [ ] Implement exhaustive non-empty-table count plus semantic/digest reconciliation and a single deterministic safe resume route.
- [ ] Verify first resume succeeds, second run is verify-only, duplicateCount is zero, 216 migrations and all final counts match, and sessions/OTP are zero.

### Task 4: Local gates, review, commit and immutable source

**Files:**
- Modify: `docs/rc-staging-fixture-timeout-root-cause.md`
- Update: user-facing handoff evidence outside the source tree.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: one reviewed commit and one new immutable remote source ref.

- [ ] Run relevant fixture/Payroll tests, full unit, full integration, TypeScript, lint, build, audit, migration verifier, release validator and source attestation.
- [ ] Obtain independent review and resolve Critical/Important findings with RED/GREEN.
- [ ] Commit the bounded source once, prove the worktree clean, compute SHA/tree/archive/lockfile/source digests, and create a new non-force immutable ref.

### Task 5: Protected partial-state recovery and remaining Staging gates

**Files:**
- Update: `/Users/innovdia/Documents/Codex/2026-09-19/human-uat-companion-mode-hr-payroll/outputs/TETAMU_PRODUCTION_RC_STAGING_LATEST_HANDOFF.md`

**Interfaces:**
- Consumes: Task 4 frozen ref and the pinned RC Staging identities.
- Produces: a complete, idempotent synthetic fixture plus infrastructure/UAT readiness evidence.

- [ ] Re-prove project/environment/service/database/volume/region/fingerprint and protected-deny inventory before any write.
- [ ] Run read-only reconciliation; stop if it is not the exact expected checkpoint.
- [ ] Run resume once and verify-only once; prove final counts, marker/digest, disabled features and zero active sessions/OTP.
- [ ] Continue receiver, six services, backup/PITR/isolated restore, TLS, health, browser/HTTP, OTP/MFA, RBAC, disabled PCB/Payment, POS payment, alerts and rollback gates.
- [ ] Update the handoff and return only the authorized final status.
