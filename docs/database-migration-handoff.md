# Database Migration Handoff

## Artifact and order

Prisma schema and every directory under `prisma/migrations` form one immutable migration artifact. The Production Owner must deploy the same base commit and source digest accepted in Testing.

Safe order:

1. capture and verify a recoverable backup;
2. stop or quiesce incompatible writers if the reviewed migration requires it;
3. run `npx prisma migrate status`;
4. run `npx prisma migrate deploy` exactly once from the release artifact;
5. start web and workers from the same artifact;
6. verify `/api/health`, worker logs and smoke tests.

## Prohibited Production commands

- `prisma migrate dev`
- `prisma migrate reset`
- Local embedded Postgres helpers
- Local golden UAT seed or fixture preparation
- truncate, fresh rebuild, drop database or destructive recovery shortcuts

## Verification evidence

Development verifies:

- Prisma schema validation and client generation;
- Local migration status;
- complete 0-to-latest migration replay on a disposable Local database;
- Local production-mode build after generation.

Testing verifies its own migration status. Production status and migration execution are not verified by Development and remain a Production Owner action.

## Failure policy

Do not edit an already-applied migration and do not mark a failed migration resolved without evidence. On failure:

1. stop the rollout and preserve logs;
2. keep web/workers from writing against a partially migrated schema;
3. determine whether the reviewed response is restore/rollback or forward-fix;
4. execute only the Production Owner-approved recovery path;
5. re-run status, health and smoke checks and document the incident.

Application-level payment, queue and ledger idempotency does not make arbitrary database rollback safe. Restore decisions must consider external sends and payments.
