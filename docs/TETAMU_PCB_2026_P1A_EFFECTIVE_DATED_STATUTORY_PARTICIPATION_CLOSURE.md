# TETAMU PCB 2026 P1A — Effective-Dated Statutory Participation Closure

Date: 27 August 2026  
Environment: Local and disposable PostgreSQL only  
Production touched: **NO**  
PCB formula changed: **NO**

## 1. Executive Summary

P1A closes the Q4 representability gap with a generic, governed and
effective-dated statutory participation model. Payroll now resolves EPF status
from the remuneration month, freezes the resolved evidence in its immutable
statutory snapshot and fails closed for missing, overlapping or ambiguous
history. The five retained HASiL 2026 input scenarios are represented by named
canonical fixtures. This closure proves input representability; it does not
certify final PCB answers or authorize HASiL submission.

## 2. Original Q4 Gap

Official Q4 requires one expatriate employee to be outside EPF from August to
October and participating from November. The legacy
`EmployeeBusinessMembership.epfEnabled` value is a current mutable boolean. It
cannot prove two different historical states without mutating the employee
between payroll runs, and its `updatedAt` timestamp is not statutory evidence.

## 3. Current Legacy EPF Flow

The pre-P1A generation flow selected `epfEnabled` in
`src/lib/payroll/service.ts`, passed it to `materializeStatutoryP2` and used it
for EPF eligibility and the employee statutory profile version. The same field
is still used by legacy profile editing, readiness summaries and the legacy
statutory helper. P1A deliberately retains those consumers for compatibility;
the canonical P2 materialisation path now resolves the governed timeline
before EPF eligibility or PCB EPF inputs are determined.

## 4. New Participation Model

The additive Prisma model `EmployeeStatutoryParticipationPeriod` stores:

- tenant and employee membership scope;
- generic statutory scheme (EPF is the only newly activated consumer);
- `PARTICIPATING` or `NOT_PARTICIPATING` status;
- inclusive start month and exclusive optional end month;
- source type, retained evidence reference, reason and SHA-256 source digest;
- monotonic revision, recorded/confirmed actor and timestamp;
- supersession linkage without rewriting statutory facts.

Migration:
`prisma/migrations/20260827170000_effective_dated_statutory_participation/migration.sql`.
It is additive and does not fabricate historical periods for existing staff.

## 5. Effective-Date Resolution

`resolveStatutoryParticipationForPayrollPeriod` in
`src/lib/payroll/statutory-participation.ts` normalizes the payroll remuneration
date to its UTC month and selects the single interval where:

```text
effectiveFromMonth <= payrollMonth < effectiveToMonth
```

It never reads server current time and never applies a future interval early.
More than one match is blocked as overlap. Once a governed timeline exists, a
month with no matching row is blocked as missing evidence rather than falling
back to the mutable legacy boolean.

## 6. Legacy Compatibility

When no governed timeline exists, the resolver maps an unambiguous legacy
`epfEnabled` value through `LEGACY_STATIC_BRIDGE`. It does not infer an
effective date from creation or update timestamps. A caller that knows the
legacy history is ambiguous can set `legacyStateUnambiguous: false`, producing
`STATUTORY_PARTICIPATION_AMBIGUOUS`.

## 7. Snapshot Immutability

`PayrollEntryStatutorySnapshot` now freezes:

- participation period ID;
- resolved status;
- effective-from and effective-to months;
- participation revision;
- evidence/source reference.

EPF materialisation writes these fields for calculated, not-applicable and
blocked outcomes. The existing finalized-payroll database guard prevents a
later update. A November participation row therefore cannot change an August
snapshot that retained `NOT_PARTICIPATING`.

## 8. Readiness

Specific fail-closed outcomes are available:

- `STATUTORY_PARTICIPATION_MISSING`;
- `STATUTORY_PARTICIPATION_OVERLAP`;
- `STATUTORY_PARTICIPATION_AMBIGUOUS`;
- `STATUTORY_PARTICIPATION_INVALID`.

The PostgreSQL guard also rejects overlapping intervals and mutation/deletion
of retained participation facts. Only the controlled closure of an open prior
interval is allowed before appending its next revision.

## 9. Security and Audit

The employee statutory profile is the management surface. Recording a period
requires both statutory-profile view/edit capabilities and whole-business
branch scope. The command is tenant-scoped, revision-checked and written in a
serializable transaction. Existing Staff App users cannot self-enable EPF.
The audit entry retains actor, business, membership, scheme, before/after,
effective period, evidence, reason, digest, timestamp and revision.

## 10. Q1 Fixture Correction

`hasil2026Question1Fixture` now records Employee A with C-Suite provenance
effective June, TP3 previous-employment facts for January–June, previous travel
allowance, spouse/children (including the disabled higher-education child),
current remuneration/allowance and the retained TP1 relief facts. The
unsupported January–June non-resident assumption was removed.

## 11. Q2 Fixture Expansion

`hasil2026Question2Fixture` records Employee B as Director, quarterly director
fees as additional remuneration, voluntary EPF facts, employed spouse, the
claimed adult twins, zakat and medical/vaccination/journal relief structures.

## 12. Q3 Fixture Correction

`hasil2026Question3Fixture` records Employee C with REP effective September,
the official annual BIK of RM2,000 (not RM25,000), adoptive child, monthly EPF,
SOCSO, zakat and the retained insurance/sports/travel relief facts.

## 13. Q4 Fixture Closure

`hasil2026Question4Fixture` records Employee D, an Australian expatriate, with:

- August–October salary RM10,000 and VOLA RM1,000, EPF not participating;
- November–December salary RM15,000 and VOLA RM1,500, EPF participating;
- the contract/tax transition, unemployed spouse, two children and retained
  medical, skills, insurance and computer relief facts.

October resolves EPF OFF and November resolves EPF ON through the generic
payroll-month resolver. Production code contains no question, name or
year/month special case.

## 14. Q5 Fixture Expansion

`hasil2026Question5Fixture` records Employee E with Knowledge Worker provenance
effective 1 January, full-year salary/EPF, parent medical expenses, first-home
interest, eligible green/security facts, gym and internet/lifestyle facts.

## 15. Q1–Q5 Representability

| Official question | Fixture result | Canonically representable |
| --- | --- | --- |
| Q1 | Corrected | **YES** |
| Q2 | Complete | **YES** |
| Q3 | Corrected | **YES** |
| Q4 | Complete | **YES** |
| Q5 | Complete | **YES** |

Every fixture identifies the retained source document, page and SHA-256. The
provenance is explicitly `OFFICIAL_INPUT_QUESTIONS_NOT_EXPECTED_ANSWERS`.

## 16. Tests

Targeted unit coverage verifies full-year ON/OFF, Q4 OFF-to-ON transition,
future intervals, overlap, gaps, legacy bridge, ambiguous legacy state,
question provenance and exact Q1–Q5 facts. Disposable PostgreSQL coverage
verifies overlap rejection, statutory-fact immutability and finalized snapshot
immutability.

Final executed counts are recorded in the regression section below.

## 17. Regression

Verification status at closure:

| Gate | Result |
| --- | --- |
| Named Q1–Q5 + participation unit tests | 28/28 PASS |
| PCB/statutory focused unit tests | 166/166 PASS |
| Disposable integration | 187/187 shared + 1/1 isolated PASS |
| Main unit | 1194/1194 PASS |
| TypeScript | PASS |
| ESLint | PASS (0 errors; 3 pre-existing warnings) |
| Next.js build | PASS |
| Prisma validate | PASS |
| Fresh disposable migrations | PASS |
| `git diff --check` | PASS |

The statutory participation consumer is activated only for EPF. SOCSO, EIS
and LINDUNG24 retain their prior eligibility and calculation logic.

## 18. Remaining Gaps

P1A does not supply independently reconciled official expected answers,
Calculation Detail, EA, PCB 2(II), CP39 submission artifacts, portal acceptance
or HASiL approval naming the exact Tetamu calculator version. Those remain P2
and later controlled-release gates. No Production rule was activated.

## 19. Final Verdict

P1A is **READY**. The effective-dated participation foundation, EPF month
resolution, legacy bridge, fail-closed readiness, immutable payroll snapshot,
Q1–Q5 fixture representability and database guards all passed their specified
regression gates. The project may proceed to PCB P2 without changing the PCB
formula in this closure.

HASiL submission: **NO**  
HASiL approval: **PENDING**  
Production touched: **NO**
