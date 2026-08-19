# Sabah Statutory Work-Pay — Human Sign-Off Pack

Engineering status: **READY**
Legal review status: **PENDING**
Candidate status: `READY_FOR_HUMAN_SIGN_OFF`
Activation: **NOT PERFORMED**

## Candidate identity

- Jurisdiction: `MY-SABAH`
- Rule version: `MY-SABAH-WORK-PAY-2025-05-CANDIDATE-1`
- Represented effective date: `2025-05-01`
- Calculator version: `P6C-1`
- Primary authority: Sabah State Attorney-General's Chambers / Jabatan Tenaga Kerja Sabah

## Official source evidence

1. [Labour Ordinance (Sabah Cap. 67), consolidated text](https://sagc.sabah.gov.my/sites/default/files/law/Labour%20Ordinance%20%28Sabah%20Cap.%2067%29.pdf): sections 2(3), 103, 104, 104C and First Schedule.
2. [Labour Ordinance of Sabah (Amendment) Act 2025, Act A1753](https://www.jtksabah.gov.my/web/images/warta_2025/A1753_-Labour_Ordinance_of_Sabah_Amendment_Act_2025.pdf): commencement and coverage amendments.

The reviewer must verify the authoritative text and commencement applicable to the payroll period. URLs are evidence pointers, not a substitute for legal sign-off.

## Rule review cards

### Rule 1 — Monthly ordinary and hourly rate

- Official source: Sabah Labour Ordinance Cap. 67
- Legal section: 2(3)
- Engineering interpretation: monthly ORP is monthly wage divided by 26; hourly rate is ORP divided by normal daily working hours.
- Formula: `ORP = monthly wage / 26`; `hourly = ORP / normal daily hours`.
- Example: RM2,600 monthly and 8 normal hours gives RM100 ORP and RM12.50 hourly.
- Boundary tests: positive normal minutes; safe integer input; final component rounding only.
- Open legal questions: confirm included/excluded wage elements feeding the frozen base rate.
- Reviewer checklist:
  - [ ] Interpretation matches section 2(3).
  - [ ] Frozen compensation base contains the legally correct wage elements.
  - [ ] Divisor and normal-hours source are approved.

### Rule 2 — Normal overtime

- Official source: Sabah Labour Ordinance Cap. 67
- Legal section: 104
- Engineering interpretation: approved work beyond normal hours on an ordinary day is paid at 1.5 times hourly rate.
- Formula: `approved OT minutes / 60 × hourly rate × 1.5`.
- Example: RM12.50 hourly and 60 minutes gives RM18.75.
- Boundary tests: date-level classification, approved minutes only, no raw-clock derivation.
- Open legal questions: none recorded for the represented monthly case.
- Reviewer checklist:
  - [ ] Multiplier is correct.
  - [ ] Approved OT is the correct canonical input.
  - [ ] Rounding policy is acceptable.

### Rule 3 — Rest-day work and overtime

- Official source: Sabah Labour Ordinance Cap. 67
- Legal section: 104C
- Engineering interpretation: for monthly/weekly employees, work up to half normal daily hours pays 0.5 ORP; over half up to normal hours pays 1 ORP; time beyond normal hours pays 2 times hourly rate.
- Formula: `0.5 ORP` or `1 ORP`, plus `rest-day OT hours × hourly × 2`.
- Example: with RM100 ORP, 4 hours of an 8-hour day gives RM50; one approved overtime hour gives RM25.
- Boundary tests: exact half day; over-half band; beyond-normal minutes separated by P6B.
- Open legal questions: confirm treatment when the same date is also a public holiday.
- Reviewer checklist:
  - [ ] Half-day boundary is inclusive as represented.
  - [ ] Monthly/weekly employee branch is correct.
  - [ ] Daily/hourly branch remains blocked pending required facts.

### Rule 4 — Public-holiday work and overtime

- Official source: Sabah Labour Ordinance Cap. 67
- Legal section: 103
- Engineering interpretation: monthly holiday base is already included and is not duplicated; work on the paid holiday adds 2 ORP; work beyond normal hours adds 3 times hourly rate.
- Formula: `2 ORP + public-holiday OT hours × hourly × 3` when worked.
- Example: RM100 ORP, full normal day plus 1 OT hour gives RM200 + RM37.50.
- Boundary tests: no-work holiday emits no extra monthly base; holiday work and holiday OT are separate trace lines.
- Open legal questions: confirm substituted-holiday and rest-day overlap precedence.
- Reviewer checklist:
  - [ ] No monthly-base double counting.
  - [ ] Additional work multiplier is correct.
  - [ ] Overtime multiplier is correct.

### Rule 5 — Coverage gate

- Official source: First Schedule to Sabah Labour Ordinance as amended by Act A1753.
- Legal section: First Schedule / coverage amendments.
- Engineering interpretation: represented provisions apply at or below RM4,000 monthly; above RM4,000 requires explicit evidence of a covered occupational category such as manual labour.
- Formula: eligibility gate only; it does not change the rate.
- Example: RM4,000 monthly is eligible; RM4,000.01 without a legal category is `REVIEW_REQUIRED`.
- Boundary tests: threshold, above-threshold unknown, above-threshold verified manual labour.
- Open legal questions: approve the complete list and evidence standard for covered occupational categories.
- Reviewer checklist:
  - [ ] Threshold and inclusive boundary are correct.
  - [ ] Covered-category list is complete.
  - [ ] Evidence ownership and change audit are defined before activation.

## Deferred inputs and legal questions

- Daily/hourly prior wage-period wages and actual days are not frozen in Payroll; those pay bases must not calculate automatically.
- Above-RM4,000 legal occupation/category is not yet a canonical employee fact.
- Rest-day/public-holiday overlap and substituted-holiday precedence are intentionally blocked.
- Any answer that changes a formula requires a new candidate version and fresh tests; do not edit an already reviewed version in place.

## Reviewer decision record

Reviewer name: ______________________________
Role / authority: ___________________________
Review date: ________________________________

Decision:

- [ ] Approved exactly as represented
- [ ] Approved with non-formula clarification
- [ ] Changes required — create a new candidate version
- [ ] Rejected

Comments / legal opinion reference:

__________________________________________________________________

__________________________________________________________________

Signature / approval reference: __________________________________

## Final activation checklist

- [ ] Every rule card is reviewed.
- [ ] Official text and effective date are confirmed.
- [ ] Open questions are either resolved or remain hard blockers.
- [ ] Candidate source digest matches the reviewed artifact.
- [ ] Unit and integration verification evidence is attached.
- [ ] Candidate is moved to `HUMAN_SIGNED_OFF` by an authorized actor.
- [ ] A separate authorized action activates the exact signed version.
- [ ] No Production action is bundled into engineering sign-off.

Recommendation at engineering handoff: **READY FOR HUMAN SIGN-OFF; DO NOT ACTIVATE YET.**
