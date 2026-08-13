# SOCSO Human Review Pack

Status: `ENGINEERING_READY / EVIDENCE_PACK_COMPLETE / CANONICAL_REGISTERED / HUMAN_REVIEW_PENDING / NOT_ACTIVE`

This pack is engineering evidence only. It is not human approval or government certification.

## Rule identity

- Scheme: SOCSO
- Candidate version: `MALAYSIA_STATUTORY_CLASSIFICATION_2026_SOCSO_EIS_SIGNOFF_CANDIDATE_1`
- Effective from: `2026-06-01`
- Canonical database RuleSet ID: `cd7591b0-9c60-4241-8955-72bbc39b31eb` (Local; `READY_FOR_HUMAN_SIGN_OFF`, review revision 0)
- Official publisher: PERKESO
- Artifact ID: `perkeso-act4-lindung24-2026-06`
- Manifest SHA-256: `e76b2a03740f6da4a305919c677d4935a05e9166502e5f06afe1030b7407caa1`
- Manifest bytes: 219,851
- Manifest retainedPath: `statutory/official/artifacts/perkeso-lindung24-amount-schedule-2026-06.pdf` (resolved; the official Act 4/SKBBK schedule is intentionally shared with the LINDUNG24 amount schedule).

## Dataset and calculator

- Parser: `perkeso-act4-skbbk-table/1.0.0`
- Dataset: `perkeso-act4-lindung24-2026-06-v1`
- Rows: 65; independent review: 65; mismatches: 0
- Dataset digest: `1e1b17a332e2b596b1efa85c075428c54b16d059730726e3f67cef710f334460`
- Review digest: `57c10c6042fbd539e36279bafbd9f20eabb4d140a984eb1db052c287ee14209c`
- Calculator: `statutory-p2c-calculators/1.0.0`
- Calculator test digest: `acd13f53032c299fee02ee5a9e9b11bae87d8ac5ce0a313fce05655ea79a53b3`
- Fixtures: 20 `OFFICIAL_BACKED`, all pass
- Fixture provenance count: `OFFICIAL_BACKED=20`, `INDEPENDENT_DERIVED=0`, `ENGINEERING_REGRESSION=0`, `MISSING=0`
- Fixture digest: `d5108d72795b60067d2f1e1e408715f27c2b87f1290e79edccb3db561e5bfca5`
- Certification digest: `098b2f145516aaa3f0e21779dae3362ff1b480f5bf9a2f415c16e1b1a0c1d0ba`

## Eligibility and calculation summary

The calculator selects exact first/second-category official rows and separately retains employee and employer amounts. Employee category and material profile facts are mandatory; no category is inferred from wage, identifier or tenant.

## Component classification

- Candidate rows: 30, scheme-specific SOCSO treatment
- Classification digest: `d59d280d59880810f55f88117fbd103b16cceaf83cb63db2454eb58acae12d3a`
- Candidate digest: `b1640aad1a5a4d7ad35de44166e51332efaf32107f4d6e68bd9c6b95104573be`
- UNKNOWN: `ARREARS`, `BONUS`, `CUSTOM_UNKNOWN_EARNING`, `FIXED_ALLOWANCE`, `MANUAL_ADJUSTMENT`, `ONE_OFF_EARNING`, `PHONE_ALLOWANCE`, `RECURRING_ALLOWANCE`, `SALARY_ARREARS`, `TRANSPORT_ALLOWANCE`

## Evidence digest and blockers

- Candidate evidence digest: `b1640aad1a5a4d7ad35de44166e51332efaf32107f4d6e68bd9c6b95104573be`
- Official evidence-pack digest: `aab60305d122387381bba6ade2e4586975600762258cd6f59c2348c93a09b1df`
- Engineering/evidence blockers: none; retainedPath, hash, content, dataset, review, fixtures and calculator trace are complete.
- Human actions: review the evidence and resolve/accept all conditional component decisions in a new immutable revision.
- Controlled activation: `BLOCKED_HUMAN_SIGNOFF`; canonical registration is complete, while Human review/sign-off and any later activation remain separate controlled actions.

## Human review checklist

- [ ] Official source identity reviewed
- [ ] Artifact retainedPath/hash binding reviewed
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
