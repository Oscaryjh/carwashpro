# Payroll P6C — Sabah Statutory Work-Pay Calculation Foundation

Status: **ENGINEERING READY / CANDIDATE RULE NOT ACTIVE**
Jurisdiction: `MY-SABAH`
Candidate version: `MY-SABAH-WORK-PAY-2025-05-CANDIDATE-1`
Effective date represented by the candidate: `2025-05-01`

This phase converts frozen P6B attendance classifications into traceable statutory earning components. It does not activate legal rules, finalize payroll, or change Production.

## Payroll P6C gap audit

| Capability | Result | Evidence / constraint |
| --- | --- | --- |
| Frozen P6B date-level work facts | READY | `PayrollAttendanceInputSnapshot.segmentFacts` supplies local date, branch, context, worked minutes, approved OT minutes and source digests. |
| Frozen compensation input | READY | Calculation references an immutable `EmployeeCompensationVersion`; it never reads a live salary field. |
| Sabah jurisdiction resolution | READY | Segment branches must all resolve to Malaysia + Sabah. Mixed, missing or other jurisdictions fail closed. |
| Versioned statutory work-pay rules | READY | Reuses `StatutoryRuleSet`; candidate is registered as `READY_FOR_HUMAN_SIGN_OFF`, not `ACTIVE`. |
| Monthly ordinary rate / hourly rate | READY | Central fixed-point calculation uses monthly wage ÷ 26, then ordinary rate ÷ normal daily hours. |
| Normal overtime | READY | Date-level `NORMAL_OT`, 1.5 × hourly rate. |
| Rest-day work and overtime | READY | Monthly/weekly half-day bands and 2 × hourly overtime are represented separately. |
| Public-holiday work and overtime | READY | Monthly base is not duplicated; additional work pay and OT are separate components. |
| Daily/hourly ordinary-rate inputs | PARTIAL | The Ordinance depends on prior wage-period wages and actual days. Those frozen facts do not exist yet; calculation returns `REVIEW_REQUIRED`. |
| Coverage above RM4,000 | PARTIAL | Legal occupation/category evidence is not yet canonical. Unknown category returns `REVIEW_REQUIRED`; an explicitly verified manual-labour category is supported. |
| Rest day + public holiday on same date | DEFERRED | Precedence/substitution needs legal confirmation. The engine blocks instead of stacking or guessing. |
| Idempotency and conflict guard | READY | One work-pay snapshot per Payroll entry; identical input is unchanged, changed input conflicts unless regeneration removes the draft snapshot first. |
| Finalized-run immutability | READY | Materialization refuses a `FINALIZED` run. |
| Readiness and reconciliation | READY | Missing/stale snapshots, review status, source mismatch, or component/line mismatch block readiness. |
| Audit trail | READY | Candidate lifecycle is audited; Payroll generation records rule version/source digest plus snapshot and component counts. |
| Human legal sign-off | MISSING | Must be completed outside this implementation before activation. |
| Production activation/deployment | DEFERRED | Explicitly out of scope and not performed. |

## Calculation architecture

```text
Frozen P6B date segments
        +
Frozen compensation version
        +
Exact ACTIVE MY-SABAH rule set
        ↓
Eligibility and jurisdiction gate
        ↓
Central ORP / hourly-rate resolver
        ↓
Date-level statutory classifications
        ↓
Immutable calculation snapshot + trace lines
        ↓
PayrollEntryComponent (STATUTORY)
        ↓
Readiness reconciliation / finalized protection
```

Money is calculated with integer/fraction arithmetic. Minutes remain integers. Rounding to MYR cents happens only when a final component amount is emitted. Audit rates are stored in MYR, not cents.

## Sabah work-pay statutory source matrix

| Rule | Official source / section | Eligibility and formula represented | System mapping | Tests | Result / open question |
| --- | --- | --- | --- | --- | --- |
| Ordinary rate of pay | Sabah Labour Ordinance Cap. 67, s.2(3) | Monthly ORP = monthly wage ÷ 26; hourly rate = ORP ÷ normal hours per day | Snapshot `ordinaryDailyRate`, `hourlyRate` | Monthly RM2,600 / 8h gives RM100 and RM12.50 | **PASS** for monthly; daily/hourly prior-period formula is **REVIEW REQUIRED** |
| Normal overtime | Cap. 67, s.104 | 1.5 × hourly rate × approved OT hours | `NORMAL_OT` | 60-minute boundary and deterministic rounding | **PASS** |
| Monthly/weekly rest-day work | Cap. 67, s.104C | Up to half normal hours: 0.5 ORP; over half up to normal hours: 1 ORP | `REST_DAY_WORK` | Half-day representative case | **PASS** |
| Rest-day overtime | Cap. 67, s.104C | Work beyond normal hours: 2 × hourly rate | `REST_DAY_OT` | 60-minute representative case | **PASS** |
| Monthly public-holiday base | Cap. 67, s.103 | Holiday pay is already included when monthly wages are not reduced | No duplicate base component | Ordinary/paid-leave input emits no extra component | **PASS** |
| Public-holiday work | Cap. 67, s.103 | Additional 2 ORP when an employee works on a paid public holiday | `PUBLIC_HOLIDAY_WORK` | Full normal-day representative case | **PASS** |
| Public-holiday overtime | Cap. 67, s.103 | Beyond normal hours: 3 × hourly rate | `PUBLIC_HOLIDAY_OT` | 60-minute representative case | **PASS** |
| Statutory coverage | Cap. 67 First Schedule as amended by Act A1753 | Monthly wage at or below RM4,000 is eligible for represented work-pay provisions; above threshold requires a verified covered category | `coverageStatus` and blocker codes | Threshold and verified manual-labour cases | **PASS WITH FIX**: canonical legal category still required |
| Rest-day/public-holiday overlap | No engineering-safe precedence conclusion recorded | No automatic stacking | `STATUTORY_WORK_PAY_REST_PUBLIC_HOLIDAY_OVERLAP` | Explicit overlap rejection | **REVIEW REQUIRED** |

Official primary sources:

- [Sabah Labour Ordinance Cap. 67 — consolidated text](https://sagc.sabah.gov.my/sites/default/files/law/Labour%20Ordinance%20%28Sabah%20Cap.%2067%29.pdf)
- [Labour Ordinance of Sabah (Amendment) Act 2025, Act A1753](https://www.jtksabah.gov.my/web/images/warta_2025/A1753_-Labour_Ordinance_of_Sabah_Amendment_Act_2025.pdf)
- [Jabatan Tenaga Kerja Sabah legislation index](https://www.jtksabah.gov.my/utama/sumber/akta/)

## Fail-closed blockers

- `STATUTORY_MONEY_RULE_NOT_ACTIVE`
- `STATUTORY_WORK_PAY_JURISDICTION_NOT_SUPPORTED`
- `STATUTORY_WORK_PAY_INPUT_RECONCILIATION_FAILED`
- `STATUTORY_WORK_PAY_DAILY_HOURLY_PRIOR_PERIOD_FACTS_REQUIRED`
- `STATUTORY_WORK_PAY_COVERAGE_CLASS_REVIEW_REQUIRED`
- `STATUTORY_WORK_PAY_REST_PUBLIC_HOLIDAY_OVERLAP`
- `STATUTORY_WORK_PAY_SNAPSHOT_MISSING`
- `STATUTORY_WORK_PAY_SOURCE_STALE`
- `STATUTORY_WORK_PAY_COMPONENT_RECONCILIATION_FAILED`

## Activation gate

Engineering may register the candidate only. The following sequence remains mandatory:

1. Human reviewer completes the P6C sign-off pack.
2. Any legal questions are resolved and a new version is created if formulas change.
3. Authorized governance action moves the exact reviewed version to `HUMAN_SIGNED_OFF` and then `ACTIVE`.
4. Activation is verified in Local/Testing before any separate Production-owner action.

No implicit fallback to another jurisdiction, an older rule, a draft rule, or a guessed formula is permitted.
