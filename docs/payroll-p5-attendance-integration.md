# Payroll P5 — Attendance-to-Payroll Integration

### A. Objective

Payroll consumes finalized Attendance; it never reinterprets punches. The P5 forward flow is `LOCKED Timesheet revision → employee Payroll Attendance snapshot → Attendance component lines → reconciliation`.

### B. Existing Payroll Attendance Audit

| Classification | Finding | P5 decision |
| --- | --- | --- |
| CURRENT CANONICAL | Compensation versions, recurring/variable/correction snapshots, component-line aggregates, Draft/Review/Finalized workflow and locked Timesheet run provenance | Retained and extended |
| LEGACY | `calculation.ts`, `PayrollSetting` divisors/multipliers and legacy Timesheet session entries | Kept for historical compatibility; not called by the P5 forward generator |
| MANUAL INPUT | Audited component adjustments and statutory overrides | Retained; refresh preserves manual components |
| ATTENDANCE-DERIVED | P5 employee snapshot and `sourceType=ATTENDANCE` component lines | New canonical path |
| UNSAFE INFERENCE — CRITICAL | Current approved Leave plus current Payroll Holiday were read after Timesheet lock | Removed from Payroll generation |
| UNSAFE INFERENCE — CRITICAL | Worked minutes above a daily target automatically became overtime | Removed; `approvedOvertimeMinutes` remains zero until a formal approved OT source exists |
| UNSAFE INFERENCE — HIGH | Monthly unpaid leave reduced `BASIC_SALARY` directly and used an unverified divisor | Removed; full Basic Salary remains explainable and the unsupported deduction blocks readiness |
| DEFERRED | Malaysia absence/OT/rest-day/public-holiday formulas and statutory classification | Fail closed pending formal versioned policy |

No P5 runtime query reads raw punches, GPS, correction conversations or current roster to calculate money.

### C. Domain Boundary

The payroll-facing DTO contains only employee, period, locked revision, finalized outcome units, digests and policy blockers. It excludes punch/device/GPS data, manager notes and Attendance exception history. Attendance capabilities do not grant Payroll visibility; Payroll uses this safe DTO without gaining raw Attendance access.

### D. Locked Timesheet Contract

Only a `LOCKED` `AttendanceMonthlyTimesheet.currentRevision` whose period matches Payroll is accepted. The Run snapshots Timesheet id/revision/digest/locked time, and every employee snapshot repeats and validates the exact evidence. Submit and Finalize re-read the current locked revision inside serializable transactions.

### E. Attendance Payroll Snapshot

`PayrollAttendanceInputSnapshot` is tenant-scoped and one-to-one with a Payroll Entry. It freezes regular days/minutes, paid/unpaid Leave units, authorized/unauthorized absence units, rest-day/PH minutes, approved OT minutes, source-day count, policy blockers, Timesheet provenance and an employee-level SHA-256 source digest. Raw Attendance data is absent.

### F. Monthly Pay Basis

Monthly full salary remains the frozen compensation base rate and produces one `BASIC_SALARY` line. Attendance never creates a second regular-pay line. Unsupported absence/unpaid formulas block workflow instead of reducing Basic Salary.

### G. Daily Pay Basis

Finalized regular days produce `REGULAR_DAILY_PAY = approved day units × frozen daily rate`. Frozen paid-Leave fractions produce a separate `PAID_LEAVE_PAY` line. Unpaid Leave and unauthorized absence remain distinct snapshot facts and do not silently become a guessed deduction.

### H. Hourly Pay Basis

Finalized regular minutes produce `REGULAR_HOURLY_PAY = approved minutes × frozen hourly rate ÷ 60`, rounded once to integer cents. Raw clock differences are never read. Hourly paid-Leave units fail closed because P2 currently does not freeze an approved payable-hours policy.

### I. Paid Leave

P2 now freezes `leaveDayFractionSnapshot` together with the approved paid outcome. Monthly pay remains unchanged; Daily pay can use the frozen fraction. Hourly paid Leave is blocked until a formal payable-hours policy exists.

### J. Unpaid Leave

Only `APPROVED_UNPAID_LEAVE` increments unpaid-Leave units. No punch, suspected no-show and NOT_SCHEDULED never do. Monthly deduction requires a formal rate policy and therefore blocks today; no `/30` or other divisor is used.

### K. Unauthorized Absence

`UNAUTHORIZED_ABSENCE` is stored separately from unpaid Leave. Monthly money impact is blocked by the missing absence-rate policy; provenance cannot be collapsed into an unpaid-Leave reason.

### L. Authorized Absence

Authorized absence has no implied paid/unpaid treatment. Any such input blocks with `AUTHORIZED_ABSENCE_PAY_POLICY_NOT_READY` until explicit frozen treatment exists.

### M. Late / Early

Finalized present-late/present-early outcomes contribute ordinary approved units only. P5 creates no late or early deduction without a formal policy.

### N. Overtime

P2 has no formal approved OT source. Excess worked minutes do not create OT; readiness reports `OVERTIME_APPROVAL_SOURCE_NOT_READY` as a warning. No overtime amount is materialized.

### O. Rest Day

Frozen rest-day worked minutes remain input facts. Because no repository-backed versioned rate policy exists, any positive rest-day work blocks with `REST_DAY_RATE_POLICY_NOT_READY` and creates no money line.

### P. Public Holiday

Frozen public-holiday worked minutes remain input facts. Current Payroll Holiday records and legacy multipliers are not canonical P5 policy; positive PH work blocks with `PUBLIC_HOLIDAY_RATE_POLICY_NOT_READY`.

### Q. Policy / Legal Formula Gate

| Formula | Source | Version | Status |
| --- | --- | --- | --- |
| Monthly full salary | Frozen Compensation Version `MONTHLY` base rate | Compensation version id | READY |
| Daily regular pay | Frozen Compensation Version `DAILY` base rate + locked approved day units | Compensation version + Timesheet revision | READY |
| Hourly regular pay | Frozen Compensation Version `HOURLY` base rate + locked approved minutes | Compensation version + Timesheet revision | READY |
| Daily paid Leave | Frozen Daily rate + P2 paid-Leave day fraction | Compensation version + Timesheet revision | READY |
| Monthly unpaid Leave deduction | UNKNOWN | None | BLOCKED |
| Unauthorized absence deduction | UNKNOWN | None | BLOCKED |
| Authorized absence treatment | UNKNOWN | None | BLOCKED |
| Hourly paid-Leave units | UNKNOWN | None | BLOCKED |
| Overtime approval/rate | UNKNOWN | None | BLOCKED |
| Rest-day work rate | UNKNOWN | None | BLOCKED |
| Public-holiday work rate | UNKNOWN | None | BLOCKED |
| Late/Early deduction | UNKNOWN | None | BLOCKED |

Legacy `workingDaysPerMonth`, overtime and public-holiday multiplier fields are not accepted as proof of an official, versioned legal policy.

### R. Payroll Components

Supported P5 lines use `sourceType=ATTENDANCE`: `REGULAR_DAILY_PAY`, `REGULAR_HOURLY_PAY`, and `PAID_LEAVE_PAY`. Monthly Basic Salary remains `sourceType=BASIC_SALARY`. Unsupported scenarios generate blockers, not zero-valued or guessed component lines.

### S. Source Provenance

Each Attendance line references its employee snapshot id as both source id/version id and records the exact Timesheet revision, period, units, frozen rate, calculation basis, human-readable formula and amount. DB triggers reject cross-entry, cross-member, cross-run or revision-mismatched references.

### T. Readiness

Central `readiness.ts` checks the locked Timesheet, exact current revision/digest/locked timestamp, period, employee snapshot, membership scope, policy blockers and component reconciliation. New codes include `MISSING_LOCKED_TIMESHEET`, `STALE_ATTENDANCE_SOURCE`, `TIMESHEET_REVISION_INVALID`, `APPROVED_ATTENDANCE_INPUT_NOT_MATERIALISED` and `ATTENDANCE_PAY_POLICY_NOT_READY`.

### U. Recalculation

Explicit Draft refresh updates the Run provenance, rebuilds SYSTEM lines and employee Attendance snapshots, preserves MANUAL lines and valid P4C variable/correction lines, reconciles aggregates and increments `calculationRevision`. Stable line keys prevent duplicates.

### V. Stale Timesheet Handling

If Attendance is reopened or relocked, a non-finalized Run becomes stale. Submit/Finalize fail until the Run returns to Draft and is explicitly refreshed. Review never auto-refreshes.

### W. Finalized Payroll Immutability

Finalized entries, components, aggregates and Attendance snapshots remain unchanged when Attendance later changes. Existing DB guards retain immutable finalized Payroll and P5 adds snapshot guards outside Draft.

### X. Correction Bridge

`proposeAttendancePayrollCorrection` deterministically compares supported old/new frozen inputs and returns a proposed earning/deduction delta. It never writes or approves a correction. Any future write must use the existing P4C submitter/approver workflow and a future Payroll; historical Payroll is not rewritten.

### Y. Tests / Risks

Coverage includes no-punch boundary, paid/unpaid distinction, unauthorized absence provenance, Monthly double-count protection, Daily/Hourly precision, no automatic OT, policy blockers, idempotent refresh, manual-line preservation, stale revision rejection, exact snapshot provenance and additive migration guards. Remaining risks are the intentionally unsupported legal formulas and the legacy pre-P2 Monthly compatibility path, which never infers an Attendance money effect.

### Z. P5 Completion Gate

P5 can be READY when supported Monthly/Daily/Hourly normal flows work from locked snapshots and every unsupported formula fails closed. Payment P3A remains `PUBLIC_BANK_SPEC_NOT_READY`. Statutory P2 is not entered automatically.
