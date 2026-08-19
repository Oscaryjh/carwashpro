# SABAH STATUTORY LEAVE HUMAN SIGN-OFF PACK

> Pack status: **READY_FOR_HUMAN_SIGN_OFF**
> Human reviewer: **PENDING**
> Activation: **NOT PERFORMED**
> Environment: **LOCAL / TESTING ONLY**

## 1. Purpose and boundary

This is the pre-sign-off engineering interpretation of the official Sabah statutory Leave sources. It is not legal advice, a legal-compliance certification, or authority to activate the rules.

```text
DRAFT
  -> READY_FOR_REVIEW
  -> READY_FOR_HUMAN_SIGN_OFF
  -> ACTIVE       (authorised human action only)
  -> SUPERSEDED
```

The candidate must remain `READY_FOR_HUMAN_SIGN_OFF`. No reviewer identity has been fabricated, no activation has been performed, and no Production environment was accessed.

## 2. Candidate identity

| Field | Value |
| --- | --- |
| Rule-pack version | `MY-SABAH-LEAVE-2025-05` |
| Exact jurisdiction | `MY-SABAH` |
| Pack coverage from | `2025-05-01` |
| Engineering state | `READY_FOR_HUMAN_SIGN_OFF` |
| Human decision | `PENDING` |
| Runtime activation | `NOT PERFORMED` |

`2025-05-01` is the commencement date used for the A1753-era candidate. Section 104D existed before Act A1753; the pack date must not be represented as the historical commencement date of section 104D.

## 3. Official source evidence

| Official source | Sections / scope used | Retrieved | SHA-256 |
| --- | --- | --- | --- |
| Labour Ordinance of Sabah (Amendment) Act 2025, Act A1753 | Sections 1(2), 2 and 83; paragraph 104E(1)(ab); section 104EA | 17 Aug 2026 | `0393FB6576935DBF339ECFB260DF04F372EDD37CF0DF4934A907297BABAC053F` |
| JTK Sabah FAQ for Act A1753 | Commencement, Sabah coverage, maternity, sick, hospitalisation and paternity implementation guidance | 17 Aug 2026 | `6DF898040DDD0867A67DED10083396C5AD4B9C628A1360E4BA8BF91669A52299` |
| Labour Ordinance, Sabah Cap. 67 | Sections 83, 84 [deleted], 87, 104D and 104E, read with Act A1753 | 17 Aug 2026 | `9A31CB6DE91A2858B86EAAF382A30A7B7BCFAD3DCBFA929CB61E0757F21A8150` |

Official URLs and hashes are encoded in `src/lib/leave/sabah-statutory-rule-pack.ts`. A matching hash proves file identity, not legal correctness.

## 4. Source-to-system pre-sign-off matrix

Only `PASS`, `PASS WITH FIX`, `REVIEW REQUIRED`, and `FAIL` are valid results in this matrix.

| Category | Official source / section | Effective date | Verified rule | System mapping and tests | Open issue | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Annual leave | Sabah Cap. 67, §104D | Pack coverage 1 May 2025; provision predates A1753 | 8/12/16 days by completed service tier; service-year basis; termination proration by completed months; fraction below 0.5 dropped and 0.5 or above rounded up; rest day/public holiday additional; >10% unauthorised absence requires review | `PERIOD_BALANCE`, `SERVICE_ANNIVERSARY`, statutory rounding; tier/boundary/proration tests | Human reviewer should confirm the wording distinguishing pack coverage from the older provision's historical commencement | PASS WITH FIX |
| Sick leave | Sabah Cap. 67, §104E, read with A1753 | 1 May 2025 candidate | 14/18/22 days per calendar year; medical certification and notification requirements | Separate `PERIOD_BALANCE`; tier/evidence tests | None identified in this engineering scope | PASS |
| Hospitalisation leave | Sabah Cap. 67, §104E(1)(ab), amended by A1753 | 1 May 2025 | 60 days per calendar year, separate from ordinary sick leave, with medical certification | Separate `PERIOD_BALANCE`; never merged into sick; separation tests | None identified in this engineering scope | PASS |
| Maternity leave | Sabah Cap. 67, §83(1)-(4), amended by A1753; §87 notice; §84 is deleted | 1 May 2025 | 98 consecutive days; leave entitlement and commencement handled separately from allowance eligibility; notice evidence retained | `EVENT_BASED`, no annual bucket; source/no-bucket/separation tests | Early-return and complex adjudication remain deferred | PASS WITH FIX |
| Maternity allowance eligibility | Sabah Cap. 67, §83(5)-(6) and §87 | 1 May 2025 | Employment in the preceding 4 months; at least 90 days in the preceding 9 months; no allowance where five or more surviving children; notice rules | Evidence is `REVIEW_REQUIRED` until complete; `paid=true` never proves allowance eligibility; no RM calculation in Leave | Final legal eligibility adjudication and monetary calculation remain outside this phase | REVIEW REQUIRED |
| Paternity leave | Sabah Cap. 67, §104EA inserted by A1753; JTK Sabah FAQ | 1 May 2025 | 7 consecutive days from confinement; includes rest days/public holidays; married male employee; same-employer 12-month service; maximum five confinements; 30-day/as-soon-as-possible notice; qualifying confinement from 22 weeks | `EVENT_BASED`, no annual bucket; eligibility/evidence/no-bucket tests | Unknown or incomplete event evidence stays `REVIEW_REQUIRED` | PASS |
| Unpaid leave | Company policy; no statutory paid-leave entitlement encoded | Not applicable | Unpaid non-accrual absence | `NON_ACCRUAL`, no balance bucket | Company policy remains authoritative | PASS |

## 5. Semantics and policy-overlay verification

- Annual, sick, and hospitalisation leave use balance-based entitlement semantics.
- Maternity and paternity leave are event-based and never create annual entitlement buckets.
- Unpaid leave is non-accrual.
- Maternity, paternity, and hospitalisation do not carry forward automatically.
- Company policy may improve the statutory result. The entitlement engine chooses the higher statutory/company entitlement and rejects a company policy below the statutory floor.
- Exact workplace jurisdiction is required. Business name, home address, employee address, or a generic Malaysia fallback cannot infer `MY-SABAH`.

## 6. Human review required

The authorised reviewer must explicitly decide the following before activation:

- [ ] The three official files and SHA-256 digests match the documents reviewed.
- [ ] The distinction between pack coverage date and §104D historical commencement is acceptable.
- [ ] Annual leave boundaries, period, proration, rounding, rest/public-holiday treatment and absence rule are correct.
- [ ] Sick and hospitalisation leave remain separate categories.
- [ ] Maternity leave maps to §83 and §87 and does not cite deleted §84 as an active rule.
- [ ] Maternity leave eligibility and maternity allowance eligibility remain separate decisions.
- [ ] Paternity evidence and qualifying-confinement interpretation are correct.
- [ ] Deferred payroll monetary calculations are acceptable for this phase boundary.

## 7. Legal uncertainty register

| Item | Engineering treatment | Result |
| --- | --- | --- |
| Historical commencement of pre-existing §104D | Do not attribute §104D to A1753; retain 1 May 2025 only as candidate pack coverage date | REVIEW REQUIRED |
| Maternity allowance final eligibility | Capture statutory evidence and return review status; do not infer eligibility from a paid flag | REVIEW REQUIRED |
| Maternity allowance RM calculation | Deferred to Payroll; Leave stores no monetary conclusion | REVIEW REQUIRED |
| Missing maternity/paternity evidence | Never silently approve or reject; route to human review | PASS |

## 8. Reviewer decision record

| Field | Required value |
| --- | --- |
| Reviewer name | Pending |
| Reviewer authority | Pending |
| Organisation | Pending |
| Review timestamp / timezone | Pending |
| Source versions reviewed | Pending |
| Decision | `APPROVE` / `APPROVE_WITH_CONDITIONS` / `REJECT` / `PENDING` |
| Conditions / corrections | Pending |
| Authenticated approval reference | Pending |

Current decision: **PENDING — no authorised human reviewer has completed this review.**

## 9. Engineering evidence

- Rule constants, official-source hashes and validation: `src/lib/leave/sabah-statutory-rule-pack.ts`
- Lifecycle and activation controls: `src/lib/leave/statutory-service.ts`
- Entitlement and company-overlay engine: `src/lib/leave/entitlement-engine.ts`
- Database guards: `prisma/migrations/20260817235900_leave_management_phase2c_sabah_statutory_rule_pack/`
- Unit coverage: `tests/unit/leave-management-phase2c.test.ts`
- Integration coverage: `tests/integration/leave-management-phase2c.test.ts`
- Phase report: `docs/hr-leave-management-phase2.md`

Verification results for this pre-sign-off run are recorded in the final execution report after the quality gates complete.

## 10. Pre-sign-off recommendation

```text
SUITABLE_FOR_HUMAN_APPROVAL
```

This recommendation means the corrected engineering candidate can be reviewed by an authorised human. It does not mean legally approved, active, or Production validated.

```text
PHASE 2C ENGINEERING              READY
SABAH STATUTORY RULE PACK         READY_FOR_HUMAN_SIGN_OFF
HUMAN SIGN-OFF                    PENDING
RULE PACK ACTIVATION              NOT PERFORMED
PRODUCTION                        NOT ACCESSED / NOT MODIFIED / NOT VALIDATED
```
