# EIS Human Review Pack

Status: `ENGINEERING_READY / EVIDENCE_PACK_COMPLETE / CANONICAL_REGISTERED / HUMAN_REVIEW_PENDING / NOT_ACTIVE`

This pack is engineering evidence only. It is not human approval or government certification.

## Rule identity

- Scheme: EIS
- Candidate version: `MALAYSIA_STATUTORY_CLASSIFICATION_2026_SOCSO_EIS_SIGNOFF_CANDIDATE_1`
- Effective from: `2024-10-01`
- Canonical database RuleSet ID: `8995e03c-4928-4326-95d6-98d07fcc5d94` (Local; `READY_FOR_HUMAN_SIGN_OFF`, review revision 0)
- Official publisher: PERKESO
- Artifact ID: `perkeso-act800-2024-10`
- Manifest SHA-256: `3499fec4271b45ae3e3055b2071075f96f65dc451775ed23adf39f9deec5376a`
- Manifest bytes: 933,164
- Manifest retainedPath: `statutory/official/artifacts/perkeso-act800-contribution-schedule-2024-10.pdf`
- Official retained binary: VERIFIED; HTTP 200 from the registered PERKESO source URL, `application/pdf`, 933,164 bytes, one readable image-table page, exact manifest SHA-256 match.

## Dataset and calculator

- Parser: `perkeso-act800-image-table/1.0.0`
- Dataset: `perkeso-act800-2024-10-review-v1`
- Rows: 65; independent review: 65; mismatches: 0
- Dataset digest: `ca14f3decb605af4df4c837f281666a6816699947d1658614bbd336f809ae08e`
- Review digest: `19c788ec2019853fa99a49e173f234f3a71be9732eee65f36bf042b2f271e565`
- Calculator: `statutory-p2c-calculators/1.0.0`
- Calculator test digest: `3dbed2c04746e0863d00473f8a281cee401cda574fb19d4882fa07c689742c9b`
- Fixtures: 11 `OFFICIAL_BACKED`, all pass
- Fixture provenance count: `OFFICIAL_BACKED=11`, `INDEPENDENT_DERIVED=0`, `ENGINEERING_REGRESSION=0`, `MISSING=0`
- Fixture digest: `1f021e40a3da7db41f16b2ad9a1e175f790b5b458d12e2e878994586fc7f7086`
- Certification digest: `fb8a33c405d865009b266dfee649d25dcb0002589b4bc16f380b79280329b117`

## Eligibility and calculation summary

EIS eligibility is independent from SOCSO amount treatment. Missing nationality/age/contribution-history facts fail closed; legitimate ineligibility is recorded separately. The calculator uses the exact official equal-share row and never a generic percentage fallback.

## Component classification

- Candidate rows: 30, scheme-specific EIS treatment
- Classification/candidate digests are shared with the SOCSO/EIS candidate: `d59d280d59880810f55f88117fbd103b16cceaf83cb63db2454eb58acae12d3a` / `b1640aad1a5a4d7ad35de44166e51332efaf32107f4d6e68bd9c6b95104573be`
- UNKNOWN: `ARREARS`, `BONUS`, `CUSTOM_UNKNOWN_EARNING`, `FIXED_ALLOWANCE`, `MANUAL_ADJUSTMENT`, `ONE_OFF_EARNING`, `PHONE_ALLOWANCE`, `RECURRING_ALLOWANCE`, `SALARY_ARREARS`, `TRANSPORT_ALLOWANCE`

## Evidence digest and blockers

- Candidate evidence digest: `b1640aad1a5a4d7ad35de44166e51332efaf32107f4d6e68bd9c6b95104573be`
- Official evidence-pack digest: `40beb12567fd72fb543a2a8fb95d13d4236dcb6fb9412a5380fd31abc70f86b5`
- Engineering/evidence blockers: none; the previously missing official binary is now retained and digest-bound to the existing dataset/review/fixtures.
- Human actions: review the image-table artifact and resolve/accept all conditional component decisions in a new immutable revision.
- Controlled activation: `BLOCKED_HUMAN_SIGNOFF`; canonical registration is complete, while Human review/sign-off and any later activation remain separate controlled actions.

## Human review checklist

- [ ] Official source identity reviewed
- [ ] Official artifact retained and hash reviewed
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
