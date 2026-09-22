# TETAMU POS Core Pilot — controlled cutover design

This document is a future procedure only. Phase 1 does not execute it and does not change Railway or Production.

## Preconditions

1. Release Owner separately approves the exact immutable candidate commit, tree, source digest, root and connector lockfile digests, and 213-migration baseline.
2. Railway Web automatic pre-deploy migration is disabled in a separately approved infrastructure change. Web, Worker, and connector remain on the old artifacts while migration runs.
3. A maintenance window, traffic freeze, operator, observer, rollback owner, RTO, and RPO are recorded.
4. Immediately before the window, create a fresh Production backup, compute SHA-256, validate `pg_restore --list`, and restore it into a separate local disposable PostgreSQL instance.
5. On that disposable restore, rehearse the exact Production prefix `51 → 213`, capture every migration name/duration, verify 213 successful / 0 failed / 0 rolled back, run row-count and constraint checks from the migration classification, and execute the POS/tenant/WhatsApp regression set.

## Explicit migration phase

1. Freeze application writes and prove the freeze using an allowlisted synthetic read-only probe.
2. Start one isolated migration job from the exact candidate artifact. It must use the artifact's local Prisma executable (`node_modules/.bin/prisma migrate deploy` on the Linux runtime), not `npx`, not a floating package, and not Web startup.
3. Stream and retain job logs. Observe `_prisma_migrations` from the migration job's controlled connection only; record start/end time, applied name, checksum, failure text, and job identity.
4. Stop immediately on the first non-zero command, failed migration row, unexpected migration name/checksum, connection identity mismatch, row-count variance, or timeout. Do not start Web/Worker/connector candidate traffic.
5. After success, require exact `213 successful / 0 failed / 0 rolled back`, schema invariants, application DB readiness, and owner go/no-go approval before switching any application service.

## Application switch and health order

1. Switch Web to the exact candidate artifact; require `/api/health` HTTP 200 with `process=alive`, `application=ready`, and `database=reachable`.
2. Switch Worker; require startup configuration success, DB reachable, queue available, and fresh worker-loop heartbeat.
3. Switch WhatsApp connector only after its persisted session backup/rollback evidence is approved. `/health` may report process healthy while `SESSION_NOT_CONNECTED`; customer traffic is allowed only at `READY_TO_SEND` and after allowlisted UAT authorization.
4. Run read-only smoke checks, then POS checkout/customer payment/refund/invoice/receipt/package/daily-closing synthetic checks under the approved Pilot fixture boundary.
5. Verify every frozen-domain route/action/service/export/batch/submission/job still returns `FROZEN_DOMAIN_DENIED` before DB write or external effect.

## Stop and rollback

- Before any post-migration write, a failed gate stops traffic switch and leaves old artifacts active.
- After schema migration but before candidate traffic, application rollback may use the old artifacts only if compatibility checks pass; otherwise restore the verified cutover backup under the approved recovery runbook.
- After candidate writes begin, rollback is a Release Owner decision using the recorded compatibility matrix and fresh backup. A simple application redeploy is not evidence of database rollback.
- Never delete the legacy US PostgreSQL service during this cutover.

## Evidence bundle

The external release attestation binds the final full commit SHA, tree SHA, source digest, build artifact digest, lockfile digests, migration transcript, backup digest, restore transcript, health results, deployment IDs, timestamps, and rollback decision. It must not modify the candidate source tree and must not contain credentials or plaintext provider secrets.

