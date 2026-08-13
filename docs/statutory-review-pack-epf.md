# EPF Human Review Pack

Status: `ENGINEERING_READY / EVIDENCE_PACK_COMPLETE / CANONICAL_REGISTERED / HUMAN_REVIEW_PENDING / NOT_ACTIVE`

This pack is engineering evidence only. It is not human approval or government certification.

## Rule identity

- Scheme: EPF
- Candidate ID/version: `MALAYSIA_EPF_2025_10_SIGNOFF_CANDIDATE_1`
- Effective period: `2025-10-01` to open-ended
- Canonical database RuleSet ID: `676640e4-8f0e-45f5-97da-d0c9d8d676ab` (Local; `READY_FOR_HUMAN_SIGN_OFF`, review revision 0)
- Official publisher: KWSP
- Official document: EPF Act 1991 Third Schedule, effective 1 October 2025
- Retained file: `statutory/official/artifacts/kwsp-third-schedule-2025-10.pdf`
- Bytes/pages: 761,109 bytes / 55 pages
- SHA-256: `c4904e44f0cb15a251a59e4f34c11a1ededa0868b962b2ebd9b81270285358b1`

## Dataset and calculator

- Parser: `kwsp-third-schedule/2.0.0`
- Dataset: `kwsp-third-schedule-2025-10-normalized-v1`
- Dataset digest: `17c6787a8b28fb0e1b30f9c350a70491a0f882e833b7cf17a3d1251acc45a4b3`
- Physical boundary rows: 401
- Independently reviewed category rows: 1,203 (Parts A/C/E), mismatches: 0
- Review digest: `6d2edcf0deaa0af863715d33d95b1c6f252abb23d20624265e977e5c81bab541`
- Calculator: `statutory-p2c-epf-calculator/1.0.0`
- Calculator test digest: `7130f1f87b1a6879d50186a1c09456a3e9d1be9d0da4a81e52e886152151fa14`
- Fixtures: 21 `OFFICIAL_BACKED`, all pass
- Fixture provenance count: `OFFICIAL_BACKED=21`, `INDEPENDENT_DERIVED=0`, `ENGINEERING_REGRESSION=0`, `MISSING=0`
- Fixture digest: `c087a139b15eed9eadcba55ad99c3131eb67230acb81712744ee9f4c99487860`
- Golden certification digest: `313a5094a6ff36301668ecc26093ff329ae4a80d820194f6f3b87aa25061ef72`

## Eligibility and calculation summary

Category resolution uses frozen date of birth, statutory nationality/PR status, pre-August-1998 election facts and payroll effective date. Missing material facts fail closed. Parts A/C/E use exact integer-sen table boundaries through RM20,000; applicable high-wage and Part F formula paths use independently rounded employee/employer shares.

Formula provenance: retained Third Schedule PDF page 20 (Part A: employee 11%, employer 12% above RM20,000), page 37 (Part C: employee 5.5%, employer 6%), page 53 (Part E: employee 0%, employer 4%), and page 55 (Part F: 2% each). Each side containing cents rounds upward to the next ringgit. Calculator evidence is `statutory-p2c-epf-calculator/1.0.0` / `7130f1f87b1a6879d50186a1c09456a3e9d1be9d0da4a81e52e886152151fa14`.

## Component classification

- Candidate rows: 30
- Classification digest: `4c225701bb96f096516ec8f48a858672a890a8a264fc454252217fa08dfccafc`
- Candidate digest: `b74b00797be8dd641e47ac685fc6ffbe96d2695498698a4224f79aaf5cf0a3af`
- UNKNOWN: `REST_DAY_PAY`, `PUBLIC_HOLIDAY_PAY`, `ONE_OFF_EARNING`, `ARREARS`, `TRANSPORT_ALLOWANCE`, `PHONE_ALLOWANCE`, `FIXED_ALLOWANCE`, `RECURRING_ALLOWANCE`, `MANUAL_ADJUSTMENT`, `CUSTOM_UNKNOWN_EARNING`

UNKNOWN is not treated as excluded or zero. Arrears require original source nature; allowance labels do not imply reimbursement.

## Evidence digest and blockers

- Candidate evidence digest: `b74b00797be8dd641e47ac685fc6ffbe96d2695498698a4224f79aaf5cf0a3af`
- Official evidence-pack digest: `b7679073dab4ebce9c08162b06c658c273a626e742b2260c1cd801d4f0958cee`
- Engineering/evidence blockers: none.
- Human actions: review the retained evidence and resolve/accept all conditional component decisions in a new immutable revision.
- Controlled activation: `BLOCKED_HUMAN_SIGNOFF`; canonical registration is complete, while Human review/sign-off and any later activation remain separate controlled actions.

## Human review checklist

- [ ] Official source identity reviewed
- [ ] Artifact hash reviewed
- [ ] Effective period reviewed
- [ ] Dataset reviewed
- [ ] Calculator reviewed
- [ ] Boundary cases reviewed
- [ ] Fixture provenance reviewed
- [ ] Eligibility logic reviewed
- [ ] Component classifications reviewed
- [ ] UNKNOWN list reviewed and resolved in a new immutable revision
- [ ] Known limitations accepted
- [ ] Activation effective date approved
