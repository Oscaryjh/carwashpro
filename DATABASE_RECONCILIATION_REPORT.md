# DATABASE RECONCILIATION REPORT

Date: 2 September 2026  
Candidate branch: `codex/tetamu-full-system-reconciliation-20260902`  
Scope: local candidate reconciliation only

## Decision

| Check | Result |
| --- | --- |
| Canonical schema safe | **YES** |
| Pending migration required | **YES** |
| Destructive operations | **NO** |
| Data migration required | **NO** |

The full-system snapshot schema and migration history are the canonical base. The only later valid Staff V2 database delta is the forward-only OTP provider-message hardening from `release/staff-v2-payslip-final-polish-20260902` (`bcb00b0b69cb568b59b4872a352aee7bde89b302`). PCB P3 contains no later canonical schema delta that is absent from the full-system base.

## Source comparison

| Source | Migration count | Relevant delta |
| --- | ---: | --- |
| `origin/main` (`86ae5f4`) | 51 | Historical subset; not a safe reconciliation base |
| Full-system snapshot (`587623f`) | 212 | Broadest complete migration history and domain schema |
| PCB P3 (`9f27748`) | 209 | PCB certification package; no missing schema delta over the full-system base |
| Staff V2 final (`bcb00b0`) | 213 | Adds `20260902120000_staff_otp_forward_hardening` |
| Reconciliation candidate | 213 | Full-system history plus the reviewed Staff OTP hardening migration |

## Canonical schema delta

`EmployeeOtpChallenge` gains one nullable mapped field:

```prisma
providerMessageCode String? @map("provider_message_code")
```

The field is nullable so historical OTP challenges remain valid. No backfill, model replacement, enum rename, relation deletion, or payroll/attendance/statutory mutation is required.

## Forward migration review

Migration: `prisma/migrations/20260902120000_staff_otp_forward_hardening/migration.sql`

The migration:

- adds `provider_message_code` with `ADD COLUMN IF NOT EXISTS`;
- leaves the column nullable and performs no synthetic backfill;
- validates a bounded 1–64 character provider code only when a provider reference and delivery acceptance timestamp already exist;
- preserves the existing OTP lifecycle function and extends insert/immutability guards to the new field;
- runs inside one transaction;
- contains no `DROP TABLE`, `DROP COLUMN`, data delete, truncate, destructive type conversion, or record rewrite.

Application runtime does not depend on this optional field to request or verify an OTP. It is forward-compatible defense in depth and can be deployed before or with compatible runtime code.

## Validation evidence

- `npx prisma validate`: **PASS** using a local validation-only `DATABASE_URL`.
- `npx prisma generate`: **PASS**, Prisma Client 6.19.3.
- `npm run prisma:migrate:fresh-check`: **PASS**.
- Fresh disposable PostgreSQL database: all **213 / 213** migrations applied successfully from zero.
- The fresh replay created and removed only a disposable local verification database.

## Deployment implication

The candidate contains one pending forward migration. It has **not** been applied to Railway Testing or Production in this phase. Before a later deployment, run the normal controlled migration process and verify the target migration ledger; do not mark a deployment complete while the target remains at 212 migrations.

## Environment statement

- Main modified: **NO**
- Railway Testing accessed: **NO**
- Railway Testing modified: **NO**
- Production accessed: **NO**
- Production modified: **NO**

