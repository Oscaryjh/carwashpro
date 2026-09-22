# TETAMU POS Core Pilot — Phase 1 implementation plan

## Authority and safety boundary

- Authoritative source audit: `D:\Dev\TETAMU_POS_PILOT_PRODUCTION_READINESS_AUDIT.md`.
- Exact base: `c48fb152631646da4a7f98dca16e5f8fbc93c40a`.
- Work only in `D:\Dev\TetamuPOS-core-pilot-phase1-20260922`.
- Do not connect to Railway, Production, Testing, RC Staging, or any existing/remote database.
- Do not deploy, push, tag, rotate credentials, pair WhatsApp, or send real messages.
- Disposable synthetic local PostgreSQL is permitted only for repository validation.

## Atomic execution sequence

1. Verify the isolated base, ancestry, clean tree, lockfile digest, and repository scripts; run the base lockfile's clean `npm ci` without changing manifests.
2. Add RED tests for a single hard-coded POS Pilot frozen-domain policy, covering routes, actions, services, exports, artifacts, batches, submissions, and queue/job entry points. Implement the minimum fail-closed policy and runtime validation while leaving POS customer finance paths outside the frozen boundary.
3. Add RED tests for Web process/readiness/database health; implement a redacted DB-aware endpoint with dependency injection for deterministic tests.
4. Define and test Worker liveness/readiness state covering database, queue, loop heartbeat, and fatal startup configuration without creating a new deployment or Railway configuration.
5. Add RED tests for WhatsApp process/session/send readiness and for non-production live-send rejection. Implement explicit Production identity gating while retaining mock/local test modes.
6. Classify the complete ordered migration history for the Pilot, semantically review every destructive/tightening migration, and document the controlled future cutover procedure. Do not run or alter Production migrations.
7. Re-run POS finance, tenant, branch, RBAC, queue, retry, delivery, replay, and audit regression suites; then run clean install, TypeScript, lint, unit, disposable integration, production build, dependency audit, secret scan, and migration static review on the exact candidate.
8. Commit coherent atomic changes with command-scoped identity. After every commit, verify author, committer, full commit SHA, tree SHA, clean exact-commit state, and base ancestry. Never amend an approved commit; fixes use a new commit.
9. Produce `D:\Dev\TETAMU_POS_PILOT_CLOSURE_PHASE1_REPORT.md`, record exact immutable candidate identity and remaining blockers, and open the report directly in Codex.

## Stop conditions

Stop and report `BLOCKED_BEFORE_PHASE2` if work would require Production access or mutation, a real credential, an existing/remote database, an unsafe migration fork/rewrite, weakened POS assertions, an unreviewed dependency change, a failing mandatory gate, or any source provenance ambiguity.
