# RC Staging Fixture Timeout Recovery Specification

The authorized source baseline is commit `6fbcf4daf29512738ed7e49ef3c3ae149b9500b1`.

The implementation must first prove why `submitPayrollRunForReview` exceeds Prisma's five-second interactive-transaction deadline when the guarded RC Staging fixture is installed through Railway's public database proxy. It must record the source location, query count, stage timings, database execution versus network/wait evidence, lock evidence, data volume, and whether normal in-platform production traffic is exposed to the same risk. A timeout must not be raised without that evidence.

The selected fix must be exactly one of the authorized options: shorten the product transaction (A), use a finite timeout on the proven transaction (B), or change only the fixture orchestration/client budget when the cause is fixture-only public-proxy latency (C). No global timeout, blind retry, weakened readiness/MFA/RBAC guard, Payroll/PCB semantic change, schema, migration, or unrelated change is allowed.

The existing partially installed Staging database must not be cleared, replaced, or overwritten. Resume is allowed only after exact pinned Staging identity checks and a manifest reconciliation proves every existing application row is an expected, conflict-free, duplicate-free subset at an unambiguous checkpoint. Unknown rows, changed fields, digest mismatch, or duplicates must stop recovery. Completed steps must not be re-created. Completion creates one unique COMPLETE marker.

Tests must pin timeout atomicity, retry idempotency, partial-state rejection and recovery, final semantic counts, session/OTP cleanup, disabled Payment Export/banking/PCB submission/communications, and the existing 216-migration ledger. After RED/GREEN, run the required unit, integration, TypeScript, lint, production build, fixture verifier, release validator, source attestation and independent review gates. Checked-in changes require one bounded commit and a new immutable frozen ref; old refs are immutable.

Only after the repaired source, exact reconciliation, first resume and verify-only second run all pass may the previously authorized isolated RC Staging infrastructure validation continue. Production, Testing, old Preview, protected databases, and the US database remain forbidden.
