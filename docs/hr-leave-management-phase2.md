# TETAMU HR — Leave Management Phase 2

> Environment: **LOCAL / TESTING ONLY**
> Production: **NOT ACCESSED · NOT MODIFIED · NOT VALIDATED**

## 1. Scope and canonical boundaries

Phase 2 extends the existing Leave Core. It does not replace the request, approval, immutable ledger, Roster, Attendance, Timesheets, or Payroll domains.

```text
Leave Policy != Leave Balance
Statutory Minimum != Company Policy
Entitlement != Manual Adjustment
Pending Leave != Balance Consumption
Approved Leave consumes exactly once
Cancelled Approved Leave restores exactly once
Carry Forward != New Annual Entitlement
Public Holiday != Rest Day != Roster != Attendance != Payroll
```

## 2. Phase 2A — automatic entitlement foundation

- Effective-dated, tenant-scoped statutory rule-set models.
- Company leave policy overlay; a company benefit cannot be below an ACTIVE statutory minimum.
- Calendar-year, service-anniversary, and custom entitlement periods.
- Deterministic service-month, proration, rounding, eligibility, tier, and jurisdiction snapshots.
- One immutable `EmployeeLeaveEntitlement` calculation and one idempotent ledger credit.
- Re-running generation does not duplicate balance.
- Exact workplace jurisdiction is required; the engine does not fall back to nationwide or infer jurisdiction from an address.

## 3. Phase 2B — leave balance buckets and carry forward

- Annual entitlement remains a tracked balance bucket.
- Carry-forward is recorded independently from current-year entitlement.
- Carry-forward limits, expiry, consumption ordering, and immutable ledger evidence are retained.
- Event-based maternity/paternity leave never creates an annual balance bucket.
- Unpaid leave is non-accrual and never creates a balance bucket.
- Existing company custom leave types remain unchanged.

## 4. Phase 2C — Sabah statutory leave rule pack

Canonical identity:

| Field | Value |
| --- | --- |
| Version | `MY-SABAH-LEAVE-2025-05` |
| Jurisdiction | `MY-SABAH` |
| Effective from | `2025-05-01` |
| Current engineering state | `READY_FOR_HUMAN_SIGN_OFF` |
| Runtime activation | **Not performed** |

### Governed lifecycle

```text
DRAFT
  → READY_FOR_REVIEW
  → READY_FOR_HUMAN_SIGN_OFF
  → ACTIVE          (explicit authorised human action only)
  → SUPERSEDED
```

- The creator cannot independently review or activate the same pack.
- Only a platform statutory administrator may activate a signed-off pack.
- Business Leave UI exposes Draft installation, submission, and independent-review preparation only; it exposes no activation action.
- `ACTIVE` requires exact jurisdiction, actor, timestamp, source hashes, validation evidence, and sign-off checklist.
- Reviewed rule rows, tiers, and official source evidence are database-immutable.
- Leave Request statutory decision snapshots are database-immutable after insertion.
- Overlapping ACTIVE packs for the same tenant, jurisdiction, and date range are rejected.
- The migration contains no automatic rule-pack seed and never activates legal rules.

### Official source evidence

| Source | Official URL | Retrieved | SHA-256 |
| --- | --- | --- | --- |
| Labour Ordinance of Sabah (Amendment) Act 2025, Act A1753 | https://www.jtksabah.gov.my/web/images/warta_2025/A1753_-Labour_Ordinance_of_Sabah_Amendment_Act_2025.pdf | 17 Aug 2026 | `0393FB6576935DBF339ECFB260DF04F372EDD37CF0DF4934A907297BABAC053F` |
| JTK Sabah FAQ for Act A1753 | https://www.jtksabah.gov.my/web/images/warta_2025/SOALAN_LAZIM.pdf | 17 Aug 2026 | `6DF898040DDD0867A67DED10083396C5AD4B9C628A1360E4BA8BF91669A52299` |
| Labour Ordinance, Sabah Cap. 67 | https://sagc.sabah.gov.my/sites/default/files/law/LabourLawCap67.pdf | 17 Aug 2026 | `9A31CB6DE91A2858B86EAAF382A30A7B7BCFAD3DCBFA929CB61E0757F21A8150` |

The hashes identify the exact reviewed files. They do not constitute legal approval.

### Sabah statutory source-to-system matrix

| Category | Law / section encoded | Effective date | System mapping | Verification |
| --- | --- | --- | --- | --- |
| Annual leave | Labour Ordinance (Sabah Cap. 67), section 104D | Pack coverage from 1 May 2025; section 104D predates A1753 | 8/12/16 service tiers, anniversary period, completed-month termination proration, statutory whole-day rounding, absence evidence review | Boundary, proration, rounding, exact-jurisdiction and regression tests |
| Sick leave | Labour Ordinance (Sabah Cap. 67), section 104E as amended by Act A1753 | 1 May 2025 | Separate 14/18/22 calendar-year balance with medical and notification evidence | Tier, evidence, period and bucket-separation tests |
| Hospitalisation leave | Labour Ordinance (Sabah Cap. 67), section 104E as amended by Act A1753 | 1 May 2025 | Separate 60-day calendar-year balance; medical certification rather than admission receipt alone | Independent-category and non-interference tests |
| Maternity leave | Labour Ordinance (Sabah Cap. 67), section 83 as amended by Act A1753 and section 87; section 84 is deleted | 1 May 2025 | 98 consecutive calendar days; leave eligibility and allowance eligibility are independent review results; `paid=true` is not allowance eligibility | Duration, source-mapping, no-bucket and eligibility-separation tests |
| Maternity allowance eligibility | Labour Ordinance (Sabah Cap. 67), sections 83(5)–(6) and 87 | 1 May 2025 | Employment lookback, minimum days, surviving-child and notice evidence produce a separate review result; RM calculation remains deferred | Evidence/source tests; final legal adjudication requires human review |
| Paternity leave | Labour Ordinance (Sabah Cap. 67), section 104EA inserted by Act A1753 | 1 May 2025 | 7 consecutive calendar days including rest/public holidays; service, marriage, notice, confinement and event-count evidence | Duration, evidence, unknown-fact and no-bucket tests |

The implementation mapping is a review aid. It does not replace counsel's interpretation of the official text.

### Rule matrix encoded for human review

| Category | Encoded rule | Balance semantics |
| --- | --- | --- |
| Annual leave | 8 / 12 / 16 days by completed service tier; service-anniversary period; termination proration by completed months; statutory whole-day rounding; unauthorised absence above 10% produces `REVIEW_REQUIRED` | Period balance |
| Sick leave | 14 / 18 / 22 days by completed service tier; medical evidence; late/unknown notification is reviewed rather than silently rejected | Separate period balance |
| Hospitalisation leave | 60 days; medical evidence; separate from ordinary sick leave | Separate period balance |
| Maternity leave | 98 calendar days per event; leave eligibility and monetary allowance eligibility are separate; unknown evidence is reviewed | Event-based, no bucket |
| Paternity leave | 7 consecutive calendar days including rest/public holidays; married male employee, immediate service, confinement count, 22-week and notice evidence | Event-based, no bucket |
| Unpaid leave | Company-policy non-accrual leave | No bucket |

The rule engine returns explicit review outcomes. Missing event evidence never becomes automatic eligibility or automatic rejection.

### Compliance result vocabulary

```text
COMPLIANT
BELOW_MINIMUM
REVIEW_REQUIRED
NOT_APPLICABLE
```

These are evidence states, not a legal-compliance guarantee.

## 5. Leave Request snapshots

At submission, the request freezes the applicable facts:

- exact jurisdiction code;
- statutory rule-set version and category;
- eligibility evidence/result;
- duration calculation;
- pay-treatment decision;
- compliance result.

Later rule-pack or policy revisions do not rewrite historical requests.

## 6. RBAC and tenant scope

- All reads and writes remain inside the authenticated business.
- Exact branch/workplace jurisdiction is resolved from canonical business configuration only.
- Policy mutations require `EDIT_LEAVE_POLICY`.
- Staff can apply only for their own membership and authorised workplace.
- Business owners may view/configure company benefits above the statutory floor, but cannot activate statutory packs.
- Explicit activation is reserved for a platform statutory administrator after independent human sign-off.

## 7. UI behaviour

### HR / manager

- View pack version, status, effective date, source title/URL/hash, category rules, validation result, and sign-off checklist.
- Install the official Sabah candidate as `DRAFT`.
- Submit it for independent review and mark it `READY_FOR_HUMAN_SIGN_OFF` after evidence checks.
- No `Activate` control is rendered in the business workspace.

### Staff

- Existing simple Leave application and balance experience remains.
- Statutory/event leave does not expose legal-engine internals.
- Missing maternity/paternity evidence is shown as requiring human review.

## 8. Migrations

| Migration | Purpose |
| --- | --- |
| `20260817223000_leave_management_phase2a` | statutory foundation and automatic entitlement |
| `20260817233000_leave_management_phase2b` | balance buckets and carry-forward evidence |
| `20260817235900_leave_management_phase2c_sabah_statutory_rule_pack` | Sabah evidence pack, sign-off lifecycle, exact jurisdiction, event/non-accrual rules, immutable request snapshots |

The Phase 2C migration is additive. Legacy rows without a recognised exact jurisdiction stay unconfigured; they are not silently relabelled as Sabah.

## 9. Verification record (18 Aug 2026)

| Verification | Result |
| --- | --- |
| Full unit tests | `970 / 970 PASS` |
| Full integration tests | `176 / 176 PASS` |
| Total automated tests | `1,146 PASS` |
| TypeScript | `PASS` |
| ESLint | `PASS` (no errors; unrelated pre-existing warnings remain) |
| Prisma validate / generate | `PASS` |
| Migration status | `191 migrations; database schema up to date` |
| Fresh migration rebuild | `PASS` |
| Local production-mode build | `PASS` (`137 / 137` static pages generated) |
| Canonical workspace / secret scan / `git diff --check` | `PASS` |
| Browser acceptance | `PENDING` — the in-app browser URL policy blocked reloading the self-signed `https://localhost:3000` page; no alternate or bypass was used |

The automated engineering gates above do not replace the required independent legal review. Browser acceptance must be completed against the same build before the overall phase is closed as fully ready.

## 10. Deferred items

- Authorised Sabah employment-law specialist review and explicit activation.
- Production configuration and Production validation.
- Government-source update monitoring/crawling.
- Statutory monetary allowance calculation and advanced Payroll settlement.
- Early-return maternity workflows and complex legal edge-case adjudication.
- Production document repository, malware/privacy review, and retention controls.

## 11. Required final matrix

| Gate | Result target |
| --- | --- |
| Leave Core regression | READY |
| Automatic entitlement | READY |
| Carry-forward foundation | READY |
| Exact jurisdiction | READY |
| Sabah source evidence and hash verification | READY |
| Rule-pack engineering validation | READY |
| Business-side activation absent | READY |
| Sabah rule pack legal state | `READY_FOR_HUMAN_SIGN_OFF` |
| ACTIVE / Production | **NOT PERFORMED** |

## 12. Legal and environment statement

This implementation is an engineering evidence pack, not legal advice and not a legal-compliance certification. `READY_FOR_HUMAN_SIGN_OFF` must not be described as `ACTIVE` or Production-ready statutory law until an authorised human reviewer explicitly signs off and activates it.

```text
LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT MODIFIED
PRODUCTION NOT VALIDATED
```

## 13. Phase 2C final-closure addendum (18 Aug 2026)

- Manager browser acceptance completed against the dedicated local QA business.
- The manager workspace exposed the candidate version, effective date, official source evidence, rule matrix and `READY_FOR_HUMAN_SIGN_OFF` state without an activation action.
- Staff Leave acceptance completed against a dedicated local QA employee. The Staff UI retained the simple balance/application workflow and exposed no UUID, source hash, rule-pack identifier or legal-engine internals.
- Desktop browser measurements reported zero root/body horizontal overflow and zero console, hydration or runtime errors.
- The available in-app browser runtime did not expose a real viewport-resize API; the required 390px responsive run therefore remains explicitly recorded in the final closure matrix rather than being inferred from desktop results.
- The formal reviewer artifact is `docs/sabah-statutory-leave-human-sign-off-pack.md`.
- No authorised human reviewer was available. Human sign-off remains `PENDING`; activation was not performed and the active-rule smoke test was not run.
