# TETAMU PCB 2026 - Q1-Q5 Fixture Mapping Verification

## 1. Executive Summary

Verdict: **P1 REPRESENTABILITY GAP FOUND**.

This verification compared the retained seven-page official HASiL Testing
Questions 2026 PDF directly with the P1 representability test and closure
report. The problem is not documentation-only:

- the P1 closure table maps foundation areas to the wrong question identities;
- Q1 and Q3 contain fixture-data errors;
- Q2, Q4 and Q5 have assertion-coverage gaps; and
- Q4 exposes a production representability gap: employee EPF participation is
  a current mutable boolean/revision and has no effective-from month.

No PCB formula, official input, Production code or Production data was changed.

## 2. Official Question Source Map

Authoritative retained source:

- `statutory/official/artifacts/hasil-mtd-testing-questions-2026.pdf`
- seven pages; retained SHA-256 recorded in the official audit as
  `d6523266b8b23daca956be0f61ec52879eab364736a9feb5668d7f039ae33517`

Directly verified official identities:

| Question | Employee | Official core scenario |
| --- | --- | --- |
| Q1 | Employee A | Approved-company C-Suite effective June; previous employment January-June; travel allowance; spouse and disabled higher-education child; current relief facts. |
| Q2 | Employee B | Director; RM400,000 director fees paid quarterly; voluntary EPF; employed spouse; child claims; zakat and relief facts. |
| Q3 | Employee C | REP commencing September; RM2,000 annual BIK for household servant; adoptive child; monthly remuneration and relief facts. |
| Q4 | Employee D | Australian expatriate; August-October initial contract; November status/contract/salary/VOLA transition; EPF starts in November. |
| Q5 | Employee E | Knowledge Worker in IRDA effective 1 January; parent medical, first-home interest, green/security and lifestyle facts. |

No official expected PCB answers are published in this question pack. This
round verifies representability only.

## 3. Current Test/Fixture Inventory

Repository search found one P1 question-labelled test and no separate official
Q1-Q5 fixture file, scenario builder or expected-answer artifact:

- `tests/unit/payroll-pcb-p1-correctness-foundation.test.ts`
  - test: `HASiL Q1-Q5 facts are representable by generic governed models`
  - Q1-Q5 are inline object keys, not named canonical fixtures;
  - the assertion only compares five booleans with `true`.
- `docs/TETAMU_PCB_2026_P1_CORRECTNESS_FOUNDATION_CLOSURE.md`
  - section: `Official Questions 1-5 representability`;
  - its original foundation-to-question summary is historically retained but
    corrected by an addendum.

Source-of-truth comparison:

| Question | Official Employee | Official Core Scenario | Current Test/Fixture Name | Current Encoded Scenario | Match |
| --- | --- | --- | --- | --- | --- |
| Q1 | Employee A | C-Suite effective June; TP3 previous employment; allowance; family/reliefs | Inline `Q1` in the single P1 representability test | Non-resident January-June, C-Suite July-December only | **MISMATCH** |
| Q2 | Employee B | Director fees quarterly; voluntary EPF; spouse/children/reliefs | Inline `Q2` | Quarterly director fee classified as additional taxable | **PARTIAL** |
| Q3 | Employee C | REP September; RM2,000 annual BIK; adoptive child/reliefs | Inline `Q3` | REP September plus annual BIK RM25,000 | **MISMATCH** |
| Q4 | Employee D | Expatriate transition; VOLA; salary and EPF start November | Inline `Q4` | Non-resident/resident transition plus RM1,000/RM1,500 VOLA | **PARTIAL** |
| Q5 | Employee E | Knowledge Worker; parent/home/green/security/lifestyle reliefs | Inline `Q5` | Knowledge Worker provenance only | **PARTIAL** |

## 4. Q1 Verification

Classification: **FIXTURE DATA ERROR + ASSERTION COVERAGE GAP**.

The current test incorrectly infers a `NON_RESIDENT` period for January-June
and starts the C-Suite period on 1 July. The official question says C-Suite is
effective June and does not say the previous Kuala Lumpur engineer period is
non-resident.

The production foundation can represent the missing semantics:

- C-Suite effective period and approved company/position provenance;
- TP3 previous-employment period;
- TP3 gross remuneration, EPF, PCB, C2 exempt allowance and review references;
- spouse and child counts, including disabled higher-education child facts;
- TP1 relief declarations and allowance classification evidence.

Therefore Q1 remains representable, but the current P1 fixture is not valid Q1
evidence.

## 5. Q2 Verification

Classification: **ASSERTION COVERAGE GAP**.

The inline Q2 body correctly identifies quarterly director fees and their
governed component classification. It does not assert voluntary EPF-relevant
profile/declaration facts, employed-spouse category, claimed children, zakat or
medical/vaccination/journal relief structures.

Those facts are representable through the existing statutory profile, child
counts and TP1 entries. Q2 is representable, but the current assertion is only
partial proof.

## 6. Q3 Verification

Classification: **FIXTURE DATA ERROR + ASSERTION COVERAGE GAP**.

The REP period begins in September as required. However, the test passes
`2_500_000` cents to the annual BIK helper, which is RM25,000. The official
question specifies RM2,000 annual BIK, which is `200_000` cents. The test also
does not assert the adoptive child or relief facts.

REP provenance, the correct annual BIK amount and child/relief structures are
representable. Q3 remains representable, but the current fixture is not valid
Q3 evidence.

## 7. Q4 Verification

Classification: **REPRESENTABILITY GAP**.

Representable portions:

- PCB tax-status transition through `taxRegimeTimeline`;
- salary transition through effective-dated compensation versions;
- RM1,000 August-October and RM1,500 November-December VOLA through
  effective-dated non-cash remuneration facts;
- spouse/child and TP1 relief facts.

Missing canonical fact:

- `EmployeeBusinessMembership.epfEnabled` is a current boolean;
- `EmployeeStatutoryProfileVersion` freezes the current boolean/revision but
  has no effective-from month;
- Payroll generation selects the current membership `epfEnabled` and passes it
  to statutory materialisation for the requested payroll period;
- consequently one governed fixture cannot pre-encode EPF disabled for
  August-October and enabled from November without timing mutable profile
  changes around payroll generation.

This is not an acceptable effective-dated EPF commencement model for an
official multi-month scenario. The gap must be closed generically before the
Q4 fixture can be corrected. No question-specific branch is permitted.

## 8. Q5 Verification

Classification: **ASSERTION COVERAGE GAP**.

The current Q5 body correctly uses Knowledge Worker provenance and a full-year
effective period. It does not assert the retained TP1 category structures and
source references for parent medical, first-home interest, eligible
green/security equipment, gym/internet/lifestyle facts.

The existing governed TP1 entry schema can encode those claimed amounts and
evidence references. Q5 is representable, but the current assertion is partial.

## 9. Documentation Mismatch

The original P1 closure table was question-inaccurate:

- Q2 was described as special-regime provenance instead of Director;
- Q3 combined BIK/VOLA and historical TP3 instead of REP + BIK;
- Q4 described component frequency/C4(ii) instead of expatriate + VOLA + EPF
  transition;
- Q5 described generic transitions rather than Knowledge Worker relief facts.

An addendum was appended to the P1 closure. The historical table was not
deleted or rewritten.

## 10. Test/Fixture Corrections

No test fixture was changed in this round because correcting Q4 to the minimum
required official shape exposes a missing generic production capability. The
scope rule requires stopping rather than patching around that gap.

Required future corrections after the model gap is closed:

1. Replace the single boolean object with five named, canonical fixtures.
2. Correct Q1 status dates and add its TP3/family facts.
3. Extend Q2 with voluntary EPF, family, zakat and relief facts.
4. Correct Q3 annual BIK from RM25,000 to RM2,000 and add adoptive-child facts.
5. Add Q4 compensation, VOLA and effective-dated EPF transition evidence.
6. Add Q5 TP1 relief facts and source references.

## 11. Representability Results

| Question | Representable now | Reason |
| --- | --- | --- |
| Q1 | YES | Generic effective tax, TP3, family and relief models can encode the official facts. |
| Q2 | YES | Director-fee classification and existing statutory/TP1/family facts cover the scenario. |
| Q3 | YES | REP, annual BIK and family/TP1 structures exist; the test amount is wrong. |
| Q4 | **NO** | Effective-dated EPF commencement is not representable canonically. |
| Q5 | YES | Knowledge Worker provenance and TP1 relief structures exist. |

## 12. Tests

The existing P1 test is expected to remain green because its assertions are too
narrow; a green result does not cure the mapping/coverage issue. Verification
results for this round:

- PCB-focused and representability tests: **69/69 PASS**;
- TypeScript (`tsc --noEmit`): **PASS**;
- `git diff --check`: **PASS**.

## 13. Final Verdict

**P1 REPRESENTABILITY GAP FOUND**.

Do not proceed to PCB P2. First add a generic, governed, effective-dated
statutory-participation model that can resolve EPF applicability by payroll
month and preserve historical revisions. Then correct the official Q1-Q5
fixtures and rerun mapping verification. No PCB formula change is called for by
this finding.

## 14. P1A closure addendum (27 August 2026)

The blocker documented above is closed by the additive P1A implementation:

- `EmployeeStatutoryParticipationPeriod` stores governed, revisioned EPF
  participation intervals with retained evidence provenance;
- payroll resolves the interval from the remuneration month, not the current
  date or latest row;
- the legacy `epfEnabled` field remains a static compatibility bridge only when
  no governed timeline exists;
- gaps, overlaps and ambiguous legacy history fail closed;
- payroll statutory snapshots retain the resolved participation period and are
  immutable after finalization.

The weak inline Q1–Q5 boolean proof was replaced by five named canonical
fixtures in `tests/fixtures/hasil-2026-testing-question-fixtures.ts`. Their
provenance is the retained HASiL Testing Questions 2026 input pack (pages 3–7,
SHA-256 `d6523266b8b23daca956be0f61ec52879eab364736a9feb5668d7f039ae33517`),
not an official expected-answer artifact.

| Question | P1A fixture status | Representable | Closure evidence |
| --- | --- | --- | --- |
| Q1 | Corrected | **YES** | C-Suite June, TP3 Jan–Jun, travel, family and TP1 facts |
| Q2 | Expanded | **YES** | Director fees, voluntary EPF, spouse/children, zakat and reliefs |
| Q3 | Corrected | **YES** | REP September, annual BIK RM2,000, adoptive child and reliefs |
| Q4 | Complete | **YES** | salary/VOLA transitions plus EPF OFF Aug–Oct and ON Nov–Dec |
| Q5 | Expanded | **YES** | Knowledge Worker provenance and retained TP1 categories |

The prior `P1 REPRESENTABILITY GAP FOUND` verdict is historically retained but
superseded for representability by P1A. This does not certify official PCB
answers, authorize HASiL submission or start P2 automatically.
