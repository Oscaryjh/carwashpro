# LINDUNG24 Human Sign-off Package

Status: `TECHNICAL_REVIEW_COMPLETE / READY_FOR_HUMAN_SIGN_OFF`

This package is not legal advice, PERKESO approval, government certification or production activation.

## Official rules for review

- Eligibility: employees covered under Act 4; local/permanent/temporary resident and foreign employee categories are eligible; no age limit while employed; self-employed persons are outside this employer-payroll model.
- June 2026: mandatory contribution for all eligible employees; June amounts are not refundable.
- From 8 July 2026: foreign employees remain mandatory; local employees are voluntary/default-in and can use the official opt-out process.
- Participation: official opt-in after opt-out takes effect in the salary month of official submission; once participating under the official rule it must not be silently reversed.
- Multiple employment: only one selected employer remits; PERKESO evidence determines the selected employer.
- Contribution: employee-only; employer share is RM0; the employer deducts/remits on the employee's behalf.
- Phase 1: 0.75% schedule from 1 June 2026 through 31 May 2028, capped at the official RM6,000 wage band.
- Wage base: Act 4 section 2(24), with the official inclusions/exclusions recorded in the classification candidate.

## Evidence identities

| Evidence | Identity |
|---|---|
| Amount schedule SHA-256 | `e76b2a03740f6da4a305919c677d4935a05e9166502e5f06afe1030b7407caa1` |
| FAQ v2.1 SHA-256 | `a7b212187d5a66934e9dc5f0369d1bf45ff97d81adeac1031600358957b87fab` |
| Employer Circular No. 3 SHA-256 | `26e594d31266f79af14d7b69c6a7185f9e03bdfce2590435ac5a64df092cb6ab` |
| Participation form SHA-256 | `67ba5f24eb9929f0a7c7aa626c30e224d0705766e6b3063bf10f4fcb83db121f` |
| Opt-out notice v2.1 SHA-256 | `95a1ae1549eeca7ee24a9d61fb154f420fad52fdd2d5ffe88766bd3a404d303e` |
| Dataset digest | `1e1b17a332e2b596b1efa85c075428c54b16d059730726e3f67cef710f334460` |
| Amount review digest | `0f5b274c3e8b6bd13688cd319d652ebfa9435d000bae2c69b568f3d10a9a5cfa` |
| Golden certification digest | `f822ece0947a89f1f4d1b583b8453cdacd6a6099e370d0227873508d98d282e8` |
| Participation source review digest | `029983eb4003f161ee749244462d442637f79457fc6e86e764c31113564adaba` |
| Classification digest | `1e46def37c60e320a56351b309a2be4e496e228175c87c14c9a2075378ff847a` |
| Classification candidate digest | `e3c2026436e991ea11a4f5d4152c723172e6dd8495e7dbe5397681ddc1f5b06b` |

## Participation and selected-employer controls

- Confirm that `MANDATORY`, `DEFAULT_PARTICIPATING`, `VOLUNTARY_OPT_IN` and `VOLUNTARY_OPT_OUT` accurately express official payroll states.
- Confirm the month-level payroll effective date plus exact official submission timestamp treatment.
- Confirm that local transition opt-out and later new-hire opt-out evidence are not inferred.
- Confirm that foreign opt-out is rejected.
- Confirm that pending multiple-employer selection blocks and that `OTHER_EMPLOYER` creates no deduction in the current tenant.
- Confirm that PERKESO selection results are recorded, not recomputed from partial cross-tenant information.

## Transition and refund controls

- Confirm June mandatory/non-refundable treatment.
- Confirm local transition window treatment and once-in-always-in enforcement.
- Confirm original payroll remains immutable when a July-onward transition or wrong-employer refund is required.
- Confirm refund events are administrative history only; PERKESO portal/API reconciliation remains deferred.

## Wage classification exceptions

The candidate includes clear contractual earnings supported by the official Act 4 wage definition. `BONUS`, `SALARY_ARREARS`, generic allowances, one-off earnings, generic arrears, transport/phone/fixed allowances, manual adjustments and custom unknown earnings remain fail-closed until their business meaning is frozen and reviewed.

## Technical verification checklist

- [ ] Retained PDFs visually match the official documents.
- [ ] All five artifact SHA-256 values match the source register.
- [ ] Eligibility rules are accepted.
- [ ] Local/foreign participation transition is accepted.
- [ ] Selected-employer and multiple-employment semantics are accepted.
- [ ] Opt-in/opt-out and once-in-always-in controls are accepted.
- [ ] Refund/reversal boundary and government reconciliation deferral are accepted.
- [ ] Wage base and `UNKNOWN` classifications are accepted.
- [ ] Employee-only deduction and RM0 employer contribution are accepted.
- [ ] Golden boundary fixtures and payroll materialisation dry run are accepted.
- [ ] Tenant, permission, stale Draft and finalized-history controls are accepted.
- [ ] Reviewer confirms no production activation is included in this sign-off.

## Unresolved assumptions requiring explicit reviewer acceptance

Tetamu never derives an opt-out effective payroll month from the submission timestamp alone. The effective month must be recorded from official evidence. It never reconstructs PERKESO's selected employer from incomplete tenant data. A later official Phase 2/3 schedule requires a new artifact/dataset/rule revision.

## Blank approval record

```text
Decision:                 [ APPROVE / REJECT / APPROVE WITH CONDITIONS ]
Approved candidate:       MALAYSIA_LINDUNG24_2026_SIGNOFF_CANDIDATE_1
Candidate digest:         e3c2026436e991ea11a4f5d4152c723172e6dd8495e7dbe5397681ddc1f5b06b
Reviewer name:
Reviewer role:
Reviewer actor ID:
Reviewed at (ISO 8601):
Approval reason:
Conditions / exceptions:
Approval record digest:
Signature / controlled reference:
```

Until this record is completed through an authorized controlled workflow, approval remains `NOT_SIGNED_OFF`, production activation remains prohibited, and `ACTIVE LINDUNG24 RULES` must remain empty.
