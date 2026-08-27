# TETAMU LINDUNG 24 Testing Persona → Payroll Readiness

## 1. Executive Summary

Final verdict: **BLOCKED — NO SAFE SYNTHETIC STATUTORY EVIDENCE PATH**.

The current canonical LINDUNG 24 participation model cannot explicitly distinguish a Testing-only synthetic statutory persona from real employee/PERKESO evidence. No employee profile, participation version, Payroll Draft, readiness state, payment, payslip or statutory submission was changed.

## 2. Testing Boundary

Railway project inspection confirms an environment named `testing` with the Testing Desktop service at `https://tetamu-pos-web-testing.up.railway.app` and the Testing Staff App at `https://tetamu-staff-app-testing.up.railway.app`. This audit targeted the supplied Testing fixture only:

- Business: `Payroll UAT Business`;
- Membership: `091ba7be-ced0-418b-8cf9-526921f10866`;
- Employee: `UAT-PAYROLL-001`;
- Payroll Run: `2972941a-8067-4076-bf3b-24ddf08b308a`;
- Payroll Entry: `09a34a1a-fc19-40f6-bede-7ce2956b84eb`.

Production was not queried, deployed or mutated.

## 3. Rule Pack Status

Rule version `PERKESO_LINDUNG24_CURRENT_POLICY_ALIGNMENT_2026_08_V1` remains `READY_FOR_HUMAN_SIGN_OFF`. Human legal sign-off is required and Production activation remains `NOT_ACTIVE`. A Testing persona must not change these governance states.

## 4. Synthetic Evidence Capability Audit

`EmployeeLindung24ParticipationVersion` is an effective-dated, append-only statutory evidence model. Its source enum is limited to:

- `OFFICIAL_TRANSITION`;
- `EMPLOYEE_OPT_IN`;
- `EMPLOYEE_OPT_OUT`;
- `PERKESO_EMPLOYER_SELECTION`;
- `EMPLOYMENT_CHANGE`;
- `LEGACY_REVIEW`.

There is no `TESTING_FIXTURE`, `SYNTHETIC_TEST`, `INTERNAL_UAT`, environment marker, evidence-nature field or equivalent non-production source.

## 5. Evidence Source Semantics

The canonical write service accepts only the six source values above. For `VOLUNTARY_OPT_OUT`, validation specifically requires `sourceType = EMPLOYEE_OPT_OUT` and a non-null `officialSubmittedAt`. These fields represent a real employee opt-out submission, not a synthetic UAT fact.

Repository tests and fixture scripts sometimes insert LINDUNG 24 rows directly using official-looking source types and references. Those helpers are database-isolated test setup, bypass `recordEmployeeLindung24Participation()`, and do not provide a safe canonical Testing evidence channel for a persistent Railway Testing employee.

## 6. Persona Definition

Requested synthetic persona:

- Malaysian local employee;
- Act 4 covered;
- current-policy August 2026;
- voluntary opt-out;
- single employer/current business;
- purpose: Real Device Payroll/Payslip UAT.

This persona was **not created**, because the model cannot label it unambiguously as synthetic and non-official.

## 7. Nationality

Requested value: `MALAYSIAN`. It was not written. `EmployeeBusinessMembership.statutoryNationality` contains no provenance/evidence-nature field capable of distinguishing a synthetic Testing value from a declared statutory fact.

## 8. Act 4 Coverage

Requested value: `true`. It was not written. `act4Covered` is a required fact on the participation version but has no Testing-only provenance marker.

## 9. Participation Status

Requested value: `VOLUNTARY_OPT_OUT`. It was not written. Creating it would require presenting a synthetic timestamp as `officialSubmittedAt` and a synthetic record as `EMPLOYEE_OPT_OUT`, which violates the stated governance boundary.

## 10. Employer Context

The requested `SINGLE_EMPLOYER` + `CURRENT_BUSINESS` pair exists in the canonical enum model. It was not written because employer context alone does not make the overall evidence safe.

## 11. Effective Dating

The model supports an append-only version effective from `2026-08-01` with revision checks, supersession and overlap protection. No version was created, so no history was opened or superseded.

## 12. Evidence Safety

There is no field that can persist all three required safety facts:

- environment = Testing;
- evidence nature = synthetic fixture;
- official export eligibility = false.

Using `PERKESO-UAT-*`, a fabricated acknowledgement, an invented opt-out notice, or a fabricated official timestamp would be indistinguishable from real statutory evidence downstream and is prohibited.

## 13. Canonical Write

`recordEmployeeLindung24Participation()` and `recordEmployeeLindung24ParticipationAndRefreshDrafts()` were inspected but not invoked. Direct SQL/Prisma writes were not used. No participation version ID, revision or digest was created.

## 14. Resolver Result

The resolver was not re-run with fabricated inputs. The known current fixture remains fail-closed because canonical nationality/applicability/participation evidence is missing. Its aligned blocker remains `LINDUNG24_APPLICABILITY_INCOMPLETE`; no `NO_CONTRIBUTION` result was manufactured.

## 15. Draft Refresh

Payroll Run `2972941a-8067-4076-bf3b-24ddf08b308a` was not refreshed or regenerated. No second August Payroll Run was created.

## 16. Locked Timesheet Link

The supplied frozen Timesheet revision `44978f4c-e537-4148-8fcc-500710fa994f` was not changed or replaced. Because Draft refresh was not allowed after the hard stop, no new snapshot-link assertion was performed.

## 17. Payroll Components

No component was recalculated. The known basic pay remains RM3,000.00 in the supplied fixture, but this audit does not claim a fresh amount projection. No LINDUNG 24 zero line was added.

## 18. LINDUNG 24 Snapshot

No new statutory snapshot was generated. In particular, the system was not forced to store `NOT_APPLICABLE` or `NO_CONTRIBUTION` without canonical evidence.

## 19. Payroll Readiness

Readiness was not manually mutated. The LINDUNG 24 blocker cannot be cleared safely in the current model, therefore `canProceed` remains false for the requested readiness objective.

## 20. Remaining Blockers

Confirmed blocker:

- `LINDUNG24_APPLICABILITY_INCOMPLETE` — no safe canonical Testing-only statutory persona exists to resolve it.

Other EPF, SOCSO, EIS, PCB, bank, Timesheet or segregation-of-duties blockers were not re-evaluated because the mandatory evidence hard stop occurred before any Draft refresh/readiness run. They must not be reported as cleared.

## 21. Tenant Isolation

The participation table has composite membership/business relations and the canonical service validates `membershipId` within `context.businessId`. These controls provide tenant scoping for real evidence. No synthetic record was written to `Payroll UAT Business`, `Royal Salon` or any other tenant.

## 22. Export Safety

The current participation model has no synthetic evidence classification that an export/submission flow can reject, exclude or mark non-exportable. Therefore persisting the requested persona would not prove export safety. The safest result is to create nothing; consequently no official PERKESO artifact can be produced from this audit.

## 23. Production Safety

Production rule activation remains off. No Production database, deployment, payment, bank export, payslip publication or statutory submission was touched. No OTP was sent and no Staff App login was attempted.

## 24. Final Verdict

**BLOCKED — NO SAFE SYNTHETIC STATUTORY EVIDENCE PATH**.

The requested synthetic local/Act 4/opt-out persona cannot be represented truthfully with the current schema and canonical service. The hard-stop condition applies.

## 25. Exact Next Step

Open a separate engineering task: **Add explicit non-production statutory fixture source**. It should introduce an unambiguous synthetic evidence nature/source, persist Testing environment and purpose, forbid Production use, reject official export/submission, prevent Production rule activation, require canonical service writes, preserve append-only history and add resolver/readiness/export-isolation tests. Do not resume this Payroll Draft until that facility is implemented, reviewed and verified.
