# Statutory Human Review Execution

## A. Objective

Prepare an authenticated, evidence-backed review workspace for EPF, SOCSO, EIS and LINDUNG24 without treating engineering work, Codex, QA actors or chat approval as Human Sign-off.

## B. Environment

- LOCAL / TESTING ONLY
- PRODUCTION NOT ACCESSED
- PRODUCTION NOT VALIDATED
- No Production deploy, migration, account, payroll, statutory submission or activation was performed.

## C. Reviewer Governance

Codex is not the Human Reviewer. Only an authenticated `PLATFORM_ADMIN` with the dedicated `SIGN_OFF_STATUTORY_RULESET` capability can sign a canonical rule revision. Chat text cannot create a sign-off record. No authorised human decision was entered in this phase.

## D. Evidence Integrity

The review workspace derives every displayed value from the retained repository evidence pack. The evidence verifier rechecks retained bytes, SHA-256, registry metadata, effective periods, dataset digest and trace, independent review digest, fixtures and provenance, classification digest, calculator version/test digest and the final evidence digest. A mismatch makes the pack incomplete and blocks review progression.

Current result for all four schemes: `Evidence Pack COMPLETE`, `Engineering READY`, zero evidence-pack blockers.

## E. EPF Review

- Publisher: KWSP
- Effective from: 2025-10-01; open-ended in the retained candidate
- Dataset: 401 physical rows
- Independently reviewed: Part A 401 + Part C 401 + Part E 401 = 1203
- Mismatches: 0
- Official-backed fixtures: 21
- The workspace displays all retained artifact identities, hashes, parser/dataset versions, category rules, formula threshold, rounding rule, fixtures, matched rows and employee/employer results.

## F. SOCSO Review

- Publisher: PERKESO
- Effective from: 2026-06-01
- Dataset rows: 65
- Independently reviewed: 65
- Mismatches: 0
- Official-backed fixtures: 20
- Table boundaries, contribution categories, eligibility evidence, classifications and limitations are visible to the reviewer.

## G. EIS Review

- Publisher: PERKESO
- Effective from: 2024-10-01
- Official binary: VERIFIED and traced to the dataset
- Dataset rows: 65
- Independently reviewed: 65
- Mismatches: 0
- Official-backed fixtures: 11

## H. LINDUNG24 Review

- Publisher: PERKESO
- Effective period: 2026-06-01 to 2028-06-01 exclusive
- Retained pack includes the schedule and participation/eligibility materials required by the registry.
- Dataset rows: 65
- Independently reviewed: 65
- Mismatches: 0
- Official-backed fixtures: 6
- The UI prominently states that a new official schedule is required before 2028-06-01.

## I. Component Classification Inventory

The authenticated workspace displays a combined matrix with:

`Component | EPF | SOCSO | EIS | LINDUNG24 | Evidence / reason | Reviewer decision`

The values are read from the current classification candidates. Engineering interpretation is shown separately from the still-unexecuted reviewer decision.

## J. UNKNOWN Decisions

UNKNOWN remains fail-closed and is never coerced into INCLUDED or EXCLUDED. Under the current activation service, any UNKNOWN is a global activation blocker; when encountered at runtime it also blocks finalisation. Moving to conditional-only activation blocking would be a separate architecture and governance decision, not an assumption made by this phase.

Actual unresolved inventory:

| Scheme | Components | Current classification | Decision required | Blocking scope |
| --- | --- | --- | --- | --- |
| EPF | REST_DAY_PAY, PUBLIC_HOLIDAY_PAY, ONE_OFF_EARNING, ARREARS, TRANSPORT_ALLOWANCE, PHONE_ALLOWANCE, FIXED_ALLOWANCE, RECURRING_ALLOWANCE, MANUAL_ADJUSTMENT, CUSTOM_UNKNOWN_EARNING | UNKNOWN | Authorised evidence-backed review; UNKNOWN may remain | Global activation blocker; runtime fail-closed |
| SOCSO | ARREARS, BONUS, CUSTOM_UNKNOWN_EARNING, FIXED_ALLOWANCE, MANUAL_ADJUSTMENT, ONE_OFF_EARNING, PHONE_ALLOWANCE, RECURRING_ALLOWANCE, SALARY_ARREARS, TRANSPORT_ALLOWANCE | UNKNOWN | Authorised evidence-backed review; UNKNOWN may remain | Global activation blocker; runtime fail-closed |
| EIS | ARREARS, BONUS, CUSTOM_UNKNOWN_EARNING, FIXED_ALLOWANCE, MANUAL_ADJUSTMENT, ONE_OFF_EARNING, PHONE_ALLOWANCE, RECURRING_ALLOWANCE, SALARY_ARREARS, TRANSPORT_ALLOWANCE | UNKNOWN | Authorised evidence-backed review; UNKNOWN may remain | Global activation blocker; runtime fail-closed |
| LINDUNG24 | BONUS, SALARY_ARREARS, RECURRING_ALLOWANCE, ONE_OFF_EARNING, ARREARS, TRANSPORT_ALLOWANCE, PHONE_ALLOWANCE, FIXED_ALLOWANCE, MANUAL_ADJUSTMENT, CUSTOM_UNKNOWN_EARNING | UNKNOWN | Authorised evidence-backed review; UNKNOWN may remain | Global activation blocker; runtime fail-closed |

ARREARS must derive its treatment from the original source component. If that nature is unknown, the runtime remains blocked with `ARREARS_STATUTORY_SOURCE_NATURE_REQUIRED`.

## K. Reviewer Checklist

Checklist version `statutory-human-review/2.0.0` contains 17 confirmations:

1. Official publisher verified
2. Official document identity verified
3. Retained artifact verified
4. SHA-256 verified
5. Effective date verified
6. Dataset reviewed
7. Independent review result reviewed
8. Calculator reviewed
9. Boundary logic reviewed
10. Rounding reviewed
11. Fixture provenance reviewed
12. Eligibility logic reviewed
13. Component classifications reviewed
14. UNKNOWN inventory reviewed
15. Known limitations reviewed
16. Effective-period limitation reviewed
17. Evidence digest reviewed

The evidence-only page never persists or auto-ticks these boxes. The canonical RuleSet sign-off form requires every box in the browser and validates all 17 again on the server.

## L. Classification Revision

No classification was changed. A valid future change must preserve the old decision, new decision, evidence reference, reason, reviewer, timestamp, a new immutable classification revision and a recalculated evidence digest. Direct row mutation is not an accepted review path.

## M. Evidence Digest

Each displayed evidence digest binds the retained artifact identities/hashes, effective period, dataset/parser identity, independent review digest, fixture/certification digests, classification revision/digest, unresolved inventory, calculator evidence and known limitations. A later mutation makes an existing sign-off stale.

## N. Sign-off Record

No sign-off record was created. The existing governed path writes an immutable approval record containing reviewer identity, role/capabilities, timestamp, evidence digest, checklist version and reason. It only runs for a canonical RuleSet in `READY_FOR_HUMAN_SIGN_OFF` with verified calculation evidence and no UNKNOWN classifications.

## O. Step-up / Security

True TOTP/recovery-code MFA step-up is now available for this action. It remains personal, session/action/RuleSet/digest-bound, short-lived and one-time. No fake MFA is accepted. Platform role, stored active user, login eligibility and dedicated capability checks remain enforced. Business Owner, Payroll Admin without explicit platform capability, HR Manager, Branch Manager, Group Manager and Staff cannot sign platform statutory rules.

## P. Two-person Control

The sign-off reviewer and future activator must be different authenticated actors. This separation was retained and no activation was attempted.

## Q. Audit

Current governed lifecycle records calculation verification, readiness for review, review start, immutable component decisions, review completion, sign-off, stale/revoked sign-off and activation. No canonical Human review event was fabricated: all four registered candidates still have review revision 0 and zero decisions/sign-offs.

## R. Post-signoff Validation

Not applicable: Human Sign-off was not executed. A future valid sign-off must be followed by checks for `HUMAN_SIGNED_OFF`, matching immutable sign-off/evidence digest, attributable reviewer/audit and an inactive rule.

## S. Activation Readiness

All four schemes remain activation `BLOCKED`. Canonical registration is complete; the blockers are pending authorised Human review, current undecided UNKNOWN inventory and Human Sign-off not executed. Controlled Activation was not entered or executed.

## T. PCB Boundary

PCB remains `PARTIAL` and was not changed.

## U. Claims Boundary

- Claims Core: READY
- Outside Payroll: READY
- Claims Payroll Bridge: BLOCKED

No Claims code or entitlement was changed.

## V. UI

New per-scheme authenticated review routes:

- `/admin/statutory/review/epf`
- `/admin/statutory/review/socso`
- `/admin/statutory/review/eis`
- `/admin/statutory/review/lindung24`

They show actual evidence in required review order and expose no write, sign-off, bulk approval or activation action. The RuleSet sign-off page now uses the full versioned 17-item checklist with client and server enforcement.

## W. Tests

Final Local / Testing verification:

- Statutory evidence-pack verifier: PASS for EPF, SOCSO, EIS and LINDUNG24
- Statutory P2C verifier: PASS; classification remains review-required where UNKNOWN is unresolved
- Targeted Statutory unit: 72/72 PASS
- Targeted Statutory integration: 9/9 PASS
- Full unit: 754/754 PASS
- Full integration: 105/105 PASS
- TypeScript: PASS
- Lint: PASS; one existing WhatsApp `<img>` warning only
- Local production-mode build: PASS; one existing Attendance CSS autoprefixer warning only
- Prisma validate: PASS
- Prisma migrate status: 148 migrations, database up to date
- Fresh disposable migration rebuild: PASS, 148/148 applied
- Canonical guard: PASS
- `git diff --check`: PASS
- Secret scan: PASS, zero credential-pattern matches

## X. Outstanding Human Decisions

- Review each scheme separately in EPF → SOCSO → EIS → LINDUNG24 order.
- Decide whether each current technical treatment is acceptable.
- Resolve or deliberately retain each UNKNOWN based on sufficient official evidence.
- Confirm ARREARS source-nature behavior.
- Confirm eligibility and effective-period limitations, especially the LINDUNG24 2028-06-01 horizon.
- If changes are required, create a new immutable classification/canonical revision before sign-off.

## Y. Next Human Action

An authorised reviewer must use the authenticated Admin review workspace, review one currently registered scheme at a time and either return findings for engineering or personally complete the governed review, checklist and MFA-backed sign-off flow. No action should be represented as Human Sign-off until that person performs the authenticated action.

## Z. Final Status

`HUMAN REVIEW PACKAGE READY`

`STATUTORY HUMAN REVIEW → READY_FOR_AUTHORISED_REVIEWER`

All four schemes remain NOT SIGNED and NOT ACTIVE.
