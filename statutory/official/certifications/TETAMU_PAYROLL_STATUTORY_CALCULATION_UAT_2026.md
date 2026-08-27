# TETAMU Payroll Statutory Calculation UAT 2026

## Certification boundary

This certification covers EPF, SOCSO, EIS and LINDUNG 24 calculation behavior for the August 2026 Testing payroll fixture. PCB is explicitly excluded because the employee PCB profile/application remains incomplete. It is represented as `BLOCKED / PCB_PROFILE_INCOMPLETE`, presented as pending, and excluded from net pay.

Environment: `TESTING_DISPOSABLE_AUTOMATION`  
Fixture: `UAT-PAYROLL-001`  
Evidence: `SYNTHETIC_TESTING / PAYROLL_PAYSLIP_UAT`  
Official export eligible: `FALSE`  
Payment or submission: `NO`

## Official evidence

| Scheme | Official version | Effective | Retained artifact SHA-256 | Dataset SHA-256 | Status |
| --- | --- | --- | --- | --- | --- |
| EPF | `KWSP_THIRD_SCHEDULE_2025_10` | 2025-10-01 | `c4904e44f0cb15a251a59e4f34c11a1ededa0868b962b2ebd9b81270285358b1` | `17c6787a8b28fb0e1b30f9c350a70491a0f882e833b7cf17a3d1251acc45a4b3` | VERIFIED |
| SOCSO | `PERKESO_ACT4_SKBBK_2026_06` | 2026-06-01 | `e76b2a03740f6da4a305919c677d4935a05e9166502e5f06afe1030b7407caa1` | `1e1b17a332e2b596b1efa85c075428c54b16d059730726e3f67cef710f334460` | VERIFIED |
| EIS | `PERKESO_ACT800_2024_10` | 2024-10-01 | `3499fec4271b45ae3e3055b2071075f96f65dc451775ed23adf39f9deec5376a` | `ca14f3decb605af4df4c837f281666a6816699947d1658614bbd336f809ae08e` | VERIFIED |
| LINDUNG 24 | `PERKESO_LINDUNG24_PHASE1_2026_06` | 2026-06-01 | `e76b2a03740f6da4a305919c677d4935a05e9166502e5f06afe1030b7407caa1` | `1e1b17a332e2b596b1efa85c075428c54b16d059730726e3f67cef710f334460` | VERIFIED |

## RM3,000 official expected vs engine actual

| Scheme | Official expected | Engine actual | Rule row | Result |
| --- | ---: | ---: | --- | --- |
| EPF employee | RM330.00 | RM330.00 | `EPF-151` | PASS |
| EPF employer | RM390.00 | RM390.00 | `EPF-151` | PASS |
| SOCSO employee | RM14.75 | RM14.75 | `ACT4-34` | PASS |
| SOCSO employer | RM51.65 | RM51.65 | `ACT4-34` | PASS |
| EIS employee | RM5.90 | RM5.90 | `ACT800-34` | PASS |
| EIS employer | RM5.90 | RM5.90 | `ACT800-34` | PASS |
| LINDUNG 24 employee, local opt-out | RM0.00 | RM0.00 | canonical `NO_CONTRIBUTION` | PASS |
| LINDUNG 24 employer | RM0.00 | RM0.00 | not employer-funded | PASS |
| PCB | DEFERRED | DEFERRED | `PCB_PROFILE_INCOMPLETE` | PASS |

Gross is RM3,000.00. Employee deductions excluding PCB are RM350.65 and net pay excluding PCB is RM2,649.35. Employer statutory cost is RM447.55 and does not reduce employee net pay.

## Boundary and scenario coverage

Official table selection was verified below, at and above the RM3,000 band boundary; at and above the RM6,000 PERKESO ceiling; and at and above the RM20,000 EPF table-to-formula boundary. The complete machine-readable cases are frozen in the companion JSON certification.

LINDUNG 24 scenarios passed for local opt-out, local opt-in, foreign mandatory coverage and multiple-employer selection of another employer. The RM3,000 opt-in contribution is RM22.15; it is not used in the baseline opt-out net pay.

## Payslip and governance

The Payslip now distinguishes a calculated zero from a scheme that was not calculated. A calculated LINDUNG 24 zero is displayed as `RM 0.00`; blocked PCB is displayed as `Pending configuration (not included in net pay)` and is never rendered as `PCB RM0.00`.

The PCB exception is proceedable only when it is the sole statutory blocker and the frozen snapshot is synthetic, LOCAL/TESTING, purpose-bound to `PAYROLL_PAYSLIP_UAT`, and officially non-exportable. Production, real evidence, a missing scheme or any additional statutory blocker continues to fail closed.

Any synthetic snapshot denies official statutory export/submission. No payment, bank export, mark-paid action, official statutory submission or Production action was executed.

## Verdict

`TETAMU PAYROLL CALCULATION — READY EXCEPT PCB`

The existing finalized and published August 2026 Testing Payroll was not reopened or modified. Calculation, reconciliation and Payslip presentation certification used retained official datasets plus disposable/unit verification.
