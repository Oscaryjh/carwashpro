# TETAMU Leave Management Phase 2B

> Environment: **LOCAL / TESTING ONLY**
> Production: **NOT ACCESSED · NOT MODIFIED · NOT VALIDATED**

## Objective

Phase 2B adds deterministic balance buckets, carry forward, expiry, consumption allocation, and exact cancellation restoration to the existing Leave Core and Phase 2A automatic-entitlement engine. It does not replace leave requests, approval, Attendance, Timesheets, or Payroll.

```text
Frozen entitlement period
→ current-period entitlement bucket
→ idempotent period rollover
→ capped carry-forward bucket + explicit lapse evidence
→ deterministic approval allocation
→ expiry of unused carry-forward only
→ exact allocation restoration on cancellation
```

The source-of-truth boundaries remain:

```text
Entitlement != Carry Forward
Carry Forward != Manual Adjustment
Pending Leave does not reserve balance
Approved Leave consumes balance exactly once
Cancellation restores the original allocation exactly once
Attendance and Payroll do not calculate or mutate Leave buckets
```

## Data model

Migration: `20260817233000_leave_management_phase2b`

| Model / field | Purpose |
| --- | --- |
| `LeaveEntitlementBucket` | Frozen current-entitlement or carry-forward grant for one employee, policy, and period |
| `LeavePeriodRollover` | Idempotent source/destination period evidence, including carried and lapsed units |
| `LeaveConsumptionAllocation` | Exact bucket allocation for an approved Leave request |
| `LeaveAllocationRestoration` | Exactly-once restoration of the original allocation |
| `LeaveBucketExpiry` | Exactly-once expiry evidence for unused carry-forward units |
| Policy/version carry fields | Frozen enablement, cap, expiry rule/value, and consumption priority |
| Ledger references | Bucket, allocation, rollover, expiry, and restoration provenance |

Composite tenant ownership, uniqueness constraints, append-only ledger/history guards, and immutable policy versions preserve cross-tenant and historical safety. Bucket status is the only mutable lifecycle fact.

## Carry-forward policy

The policy supports:

- enabled or disabled carry forward;
- an optional carry cap;
- no expiry, days after rollover, months after rollover, or a fixed date in the destination period;
- earliest-expiry-first or oldest-entitlement-first consumption.

Rollover uses the frozen source-period policy version. It calculates the remaining source balance, creates at most one destination carry bucket, records excess as `CARRY_FORWARD_LAPSE`, and is safe to replay. It also ensures the destination period's normal entitlement independently; carry forward never masquerades as a new entitlement.

Calendar-year, service-anniversary, and custom entitlement periods use the existing Phase 2A period resolver. No Sabah statutory values are hardcoded.

## Approval allocation

Approval rereads canonical ledger and bucket evidence inside the existing serializable transaction. Eligible buckets must be active, available, unexpired, and have a positive calculated remainder.

The default order is earliest expiry first, with stable available-date, creation-time, and ID tie breakers. Half-day units remain exact at `0.5`. When a frozen policy permits negative balance, available bucket units are allocated first and only the uncovered amount is recorded as unallocated ledger consumption.

Pending applications create no allocation and reserve no balance. A pending request approved after a bucket expires can only use buckets valid at approval time.

## Expiry and cancellation

Expiry affects unused carry-forward units only. It creates one expiry record and one immutable ledger debit, then marks the bucket expired. Re-running the expiry process does not duplicate the debit and does not change current-period entitlement.

Cancellation restores each original allocation to its original bucket and records one restoration plus ledger credit. If an original carry-forward bucket is already expired, cancellation fails closed with `LEAVE_CANCELLATION_REVIEW_REQUIRED`; it never silently credits current entitlement or another bucket.

## Operations and UI

The Leave workspace exposes:

- carry-forward policy controls and consumption priority in policy revision;
- current entitlement, carry-forward, manual adjustment, consumed, restored, expired, and remaining balance breakdowns;
- carry-forward expiry dates;
- an authorised Local/Testing lifecycle action for due rollover and expiry processing.

The lifecycle action uses the existing `EDIT_LEAVE_POLICY` permission and tenant scope. It is an administrative/test invocation for Phase 2B; a production scheduler is intentionally deferred.

## Audit and security

- Policy revisions remain immutable and effective-dated.
- Rollover, lapse, expiry, allocation, restoration, and lifecycle runs retain stable source keys and audit provenance.
- Employee ownership and manager business/branch scope remain enforced by the existing Leave service.
- Attendance consumes approved Leave day snapshots only.
- Payroll consumes locked Timesheet materialisation only.
- Direct bucket reads or writes were not added to Attendance or Payroll.

## Deferred items

- Authorised Sabah/Malaysia statutory Leave rule pack and legal sign-off.
- Production scheduler/worker for rollover and expiry.
- Leave encashment, hourly Leave, replacement Leave, document repository, and advanced analytics.
- Direct salary calculation from Leave buckets; the existing Attendance → Timesheet → Payroll handoff remains the boundary.

## Final verification

All Phase 2B acceptance work was performed against Local / Testing only.

| Verification | Result |
| --- | --- |
| Targeted unit tests | 31 / 31 passed |
| Targeted integration tests | 5 / 5 passed |
| Full unit suite | 964 / 964 passed |
| Full integration suite | 174 / 174 passed |
| TypeScript | Passed |
| Lint | Passed with 0 errors and 8 pre-existing cross-module warnings |
| Prisma validate / generate | Passed |
| Migration status | 190 migrations; database up to date |
| Fresh migration rebuild | 190 / 190 migrations applied to a disposable database |
| Local production-mode build | Passed |
| Secret scan | Passed; ignored environment files excluded and secret values were not read or printed |
| Canonical working-directory guard | Passed |
| `git diff --check` | Passed |
| Desktop browser acceptance | Passed; root/body overflow 0, console errors 0, hydration errors 0, runtime errors 0 |
| Staff App Leave acceptance | Passed; employee-facing current entitlement, carry-forward, expiry notice, manual adjustment, used, pending, and canonical remaining balance are presented without exposing bucket mutation controls |
| 390px browser acceptance | Passed; manager Leave and Staff App Leave responsive layouts retain root/body overflow 0, console errors 0, hydration errors 0, runtime errors 0 |

## Final status

```text
TETAMU LEAVE MANAGEMENT PHASE 2B
→ READY
```

## Required final matrix

| Gate | Result |
| --- | --- |
| LEAVE CORE | READY |
| AUTOMATIC ENTITLEMENT | READY |
| PRORATION | READY |
| ENTITLEMENT BUCKETS | READY |
| CARRY FORWARD | READY |
| CARRY FORWARD EXPIRY | READY |
| CONSUMPTION ALLOCATION | READY |
| CANCELLATION BUCKET RESTORE | READY |
| STATUTORY LEAVE FOUNDATION | READY |
| SABAH RULE PACK | NOT IMPLEMENTED |
| PAYROLL LEAVE HANDOFF | PARTIAL |

The task-level unit, integration, TypeScript, lint, Prisma, migration, build, secret, canonical, diff, and browser gates have completed successfully.

```text
LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT MODIFIED
PRODUCTION NOT VALIDATED
```
