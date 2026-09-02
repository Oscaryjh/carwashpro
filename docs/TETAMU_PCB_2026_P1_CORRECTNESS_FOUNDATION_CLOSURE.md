# TETAMU PCB 2026 P1 — Correctness Foundation Closure

## 1. Closure status

**Final verdict: READY**

This closure is limited to the PCB 2026 P1 correctness foundation. It does not claim HASiL approval, does not activate PCB in Production, and does not change the retained PCB 2026 calculation formula.

Environment used for implementation and verification: **LOCAL**, including a newly created disposable PostgreSQL database for all migrations and integration tests. Production was not accessed or changed.

## 2. Official-source boundary

The retained official sources remain unchanged:

- `statutory/official/artifacts/hasil-pcb-computerised-spec-2026.pdf`
- `statutory/official/classifications/malaysia-pcb-2026-signoff-candidate-v1.json`

The implementation preserves these source-backed rules:

- BIK and VOLA are included in PCB normal remuneration for the applicable month.
- BIK and VOLA are PCB-only values and do not increase cash salary, payroll wage base or payslip gross pay.
- An annual BIK/VOLA value is allocated across the remaining working months, including the effective month, and truncated to whole ringgit.
- Exempt allowances, perquisites and benefits retain evidence but contribute zero taxable remuneration.
- Monthly commission can be normal remuneration; non-monthly commission can be additional remuneration; unknown frequency remains blocked.
- Arrears retain the original earning nature and original payment period; a generic arrears label is not enough to classify the amount.
- An ambiguous allowance remains blocked until its meaning and evidence are reviewed.

`src/lib/payroll/pcb-2026.ts` was not changed.

## 3. Implemented foundation

### 3.1 Effective-dated tax status and special regimes

Implemented in:

- `src/lib/payroll/pcb-correctness-foundation.ts`
- `src/lib/payroll/pcb-profile.ts`
- `src/app/(business)/team/people/[personId]/payroll/actions.ts`
- `src/components/employee-profile-payroll.tsx`

PCB profile version 4 now retains an effective-dated tax-regime timeline. Each period freezes the regime, effective dates, official source, evidence, approval provenance, approved company/activity/position, confirmation time and revision.

The resolver fails closed for:

- missing coverage for the payroll month;
- overlapping periods;
- a transition inside the same payroll month;
- REP, knowledge-worker or C-suite treatment without confirmed supporting provenance.

Legacy version 3 profiles remain readable. Only full-year resident and non-resident version 3 profiles are bridged; a legacy special regime does not silently pass.

### 3.2 TP3 facts

PCB profile version 4 separately retains:

- C1 gross remuneration;
- C2 exempt income items, category, description, amount and source reference;
- C3 EPF;
- C4(i) zakat;
- C4(ii) religious-travel levy with a distinct source reference;
- C5 PCB;
- previous-employment start/end period, employer reference and evidence revision.

C2 is retained as exempt evidence and is not converted into taxable remuneration. A financial TP3 declaration without a previous-employment period fails readiness. C4(ii) cannot reuse an implicit C4(i) fact without its own evidence reference.

### 3.3 BIK, VOLA and exempt-benefit semantics

Effective-dated non-cash remuneration facts now retain:

- BIK, VOLA, exempt allowance, exempt perquisite or exempt benefit kind;
- monthly or annual input basis;
- source value and effective period;
- official/evidence references;
- review status and revision.

At calculation time, BIK and VOLA increase only the PCB formula's normal-remuneration input. They remain zero in cash salary, payroll wage base and payslip gross pay. Exempt facts remain evidence-only and taxable at zero. The exact resolved facts and revisions are frozen in the statutory calculation metadata.

### 3.4 Payroll-component classification

The existing governed statutory classification infrastructure was extended rather than duplicated:

- Prisma model `StatutoryComponentClassification`
- Prisma model `StatutoryComponentReviewDecision`
- `src/lib/payroll/statutory-governance-service.ts`
- `src/lib/payroll/pcb-correctness-foundation.ts`

The classification now retains PCB nature, effective period, evidence status/reference, semantic metadata and revision. The separate profile fact supports director fee, commission, allowance, arrears and other pay-item semantics, including recurrence and original earning/period provenance.

Unknown, unreviewed or incomplete classifications fail closed. The established external payroll readiness code `STATUTORY_CLASSIFICATION_REQUIRED` remains stable for cross-scheme consumers; the PCB profile readiness surface provides the more specific P1 issue.

### 3.5 Readiness and immutable snapshot

Implemented in:

- `src/lib/payroll/pcb-profile.ts`
- `src/lib/payroll/statutory-p2.ts`

The readiness layer now distinguishes timeline, overlap, same-month transition, special-regime approval, TP3 C2, TP3 C4(ii), previous-employment period, BIK/VOLA and component-classification failures.

The statutory runtime freezes:

- resolved tax regime, effective period and revision;
- cash normal remuneration versus PCB-only BIK/VOLA;
- exempt-benefit evidence total;
- TP3 C2 and C4(ii) values and source reference;
- previous-employment periods and profile revision;
- component-classification facts;
- the existing calculation input digest and rule provenance.

Finalized historical snapshots are not re-resolved from a later profile revision.

## 4. Database change

Additive migration:

- `prisma/migrations/20260827153000_pcb_2026_p1_correctness_foundation/migration.sql`

Schema additions:

- `PcbStatutoryComponentNature`
- `PcbStatutoryClassificationReviewStatus`
- effective-dated, evidence-backed PCB fields on `StatutoryComponentClassification`

The migration was applied successfully with all 210 migrations in a new disposable PostgreSQL database. `prisma validate` passed.

## 5. Official Questions 1–5 representability

All five official scenario shapes are representable without direct database edits or ungoverned JSON entry:

| Scenario | Result | Foundation used |
| --- | --- | --- |
| Q1 | YES | effective tax status, TP3 facts, normal/additional remuneration, relief declarations |
| Q2 | YES | special-regime provenance and effective period |
| Q3 | YES | BIK/VOLA, exempt benefit facts and historical TP3 period |
| Q4 | YES | component frequency/original-nature classification and C4(ii) evidence |
| Q5 | YES | effective-dated transitions, fail-closed unknown classification and frozen revisions |

This means the inputs can be represented and governed. It does not certify the five final expected answers; that belongs to P2.

### Q1-Q5 Mapping Verification addendum (27 August 2026)

The later source-to-fixture verification in
`docs/TETAMU_PCB_2026_Q1_Q5_FIXTURE_MAPPING_VERIFICATION.md` found that the
table above was not a question-accurate proof matrix. It remains here as the
historical P1 closure statement, but the blanket `Q1-Q5 = YES` conclusion is
superseded by the verification below:

| Official question | Verified result | Verification finding |
| --- | --- | --- |
| Q1 - Employee A / C-Suite | Representable, current fixture mismatch | The model can encode C-Suite provenance, TP3 period/C1-C5 and family facts, but the P1 fixture used an unsupported non-resident period, started C-Suite in July instead of June and did not exercise TP3/family facts. |
| Q2 - Employee B / Director | Representable, fixture coverage partial | Quarterly director-fee identity is correct; voluntary EPF, family and relief facts were not asserted in the P1 fixture. |
| Q3 - Employee C / REP + BIK | Representable, current fixture mismatch | REP identity is correct, but the fixture encoded RM25,000 annual BIK instead of the official RM2,000 and omitted adoptive-child/relief facts. |
| Q4 - Employee D / Expatriate + VOLA transition | **Not fully representable** | Tax-status, compensation and VOLA transitions can be represented. The employee statutory profile has no effective-dated EPF commencement fact, so the canonical model cannot pre-encode EPF disabled for August-October and enabled from November. |
| Q5 - Employee E / Knowledge Worker | Representable, fixture coverage partial | Knowledge Worker provenance is correct; the existing fixture does not assert the retained TP1 relief structures for the official facts. |

Accordingly, P2 formula certification must not start until the Q4
effective-dated EPF applicability gap is closed and the official Q1-Q5 fixtures
are corrected. No PCB formula or Production path was changed by this addendum.

## 6. Tests and verification

### PCB focused tests

- 69/69 passed across the P1 foundation, profile, runtime, formula boundary, YTD, CP38 and statutory-submission suites.
- New P1 unit coverage includes tax transitions, overlaps and missing periods; special-regime provenance; TP3 C2/C4(ii)/employment period; BIK/VOLA/exempt semantics; director fee, commission, arrears and allowance classification; fail-closed unknowns; immutability; and Q1–Q5 representability.

### Runtime and integration

- Runtime proof confirms annual BIK plus monthly VOLA enter PCB normal remuneration but stay outside cash wage base and payslip gross.
- Disposable integration: **185/185 passed**.
- Employee Attendance route integration executed by the disposable runner: **1/1 passed**.
- The new migration was applied in the disposable database before the suites ran.

### Main unit and static verification

- Main unit: **1180/1180 passed**.
- TypeScript: **PASS** (`tsc --noEmit`).
- ESLint: **PASS** with zero errors; three pre-existing unrelated warnings remain.
- Next.js production build: **PASS**; compilation, TypeScript, page-data collection and 142 static pages completed.
- Prisma schema validation: **PASS**.
- Formula changed: **NO**.

## 7. Remaining P0 gaps after P1

P1 closes the correctness representation and provenance foundation. The following remain outside this phase:

1. Independently reconciled expected answers and calculation-detail artifacts for official Questions 1–5.
2. Formal EA and PCB 2(II) outputs.
3. Final agreed Calculation Detail document format.
4. Question-specific CP39 text artifacts and frozen submission manifest.
5. Written resolution of the PDF versus raw Text File submission ambiguity.
6. Genuine HASiL approval naming the exact Tetamu software/calculator version.
7. CP39 portal acceptance evidence.
8. Controlled Production activation after those evidence gates pass.

## 8. Closure decision

PCB 2026 P1 is closed as **READY** for its stated scope. The recommended next phase is:

**PCB 2026 P2 — Formula and Profile Certification**

HASiL submission: **NO**  
HASiL approval: **PENDING**  
Production touched: **NO**

## P1A addendum — effective-dated statutory participation (27 August 2026)

The Q1–Q5 source verification identified a genuine historical-representation
gap after the original P1 closure: Q4 changes EPF participation between
August–October and November–December, while the legacy employee profile stores
only the mutable current `epfEnabled` boolean. P1A closes that gap without
changing `src/lib/payroll/pcb-2026.ts`.

P1A adds the governed `EmployeeStatutoryParticipationPeriod` timeline and a
payroll-period resolver. EPF uses the canonical timeline whenever one exists;
employees without a timeline continue through the legacy static bridge. A gap,
overlap or ambiguous legacy state fails closed rather than choosing the latest
row. The immutable payroll statutory snapshot now retains the resolved period
identifier, status, effective boundaries, revision and evidence/source
reference, so a later participation change cannot rewrite finalized history.

The official question fixtures were replaced with five named canonical
fixtures sourced from the retained HASiL Testing Questions 2026 input pack:

- Q1 removes the unsupported non-resident assumption and records C-Suite from
  June, TP3 previous-employment, allowance, spouse/children and relief facts;
- Q2 records Director fees, voluntary EPF facts, spouse/children, zakat and
  medical/vaccination/journal relief structures;
- Q3 corrects annual BIK from RM25,000 to RM2,000 and records REP from
  September, adoptive-child and relief facts;
- Q4 records salary/VOLA transitions and EPF OFF for August–October, then EPF
  ON from November;
- Q5 records Knowledge Worker provenance and the retained parent medical,
  first-home, green/security and lifestyle facts.

All five fixtures are now canonically representable. They remain input
fixtures, not official expected-answer artifacts. P2 calculation certification
and HASiL approval remain separate gates. The detailed P1A evidence is retained
in `docs/TETAMU_PCB_2026_P1A_EFFECTIVE_DATED_STATUTORY_PARTICIPATION_CLOSURE.md`.
