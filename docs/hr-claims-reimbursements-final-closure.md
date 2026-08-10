# TETAMU HR — Claims & Reimbursements Final Closure

## A. Objective

This phase adds a business-scoped Claims domain without repurposing POS payments, Payroll earnings, Leave, or Attendance. It covers employee submission, policy snapshots, evidence, review, reimbursement, and a fail-closed Payroll bridge.

## B. Existing Audit

The existing Claim C0/C0.1 attachment architecture, MIME/magic-byte validation, SHA-256 evidence digest, private storage abstraction, audit sanitizer, employee self-service identity, module entitlement resolver, and Payroll component engine were retained and extended. No parallel legacy Claim model was introduced.

## C. Claims Module

`CLAIMS` is an operational WORKFORCE module with an explicit `HR` dependency. Module entitlement remains separate from user permissions. Disabled or ineffective entitlement hides navigation and blocks server access; owner role does not bypass a disabled module.

## D. Claim Categories

Business-scoped categories support stable code/name identity and General or Mileage expense nature. Optional starters install General reimbursement, Meals, Mileage, and Travel categories without asserting tax treatment.

## E. Policy Versioning

Policies are effective-dated immutable revisions. A Claim line freezes the selected policy revision, limits, receipt/description requirements, mileage rate, and statutory-treatment status. The management UI cannot self-certify non-wage treatment; new revisions remain `REVIEW_REQUIRED`.

## F. Claim Application

An authenticated employee may submit only for their own active membership and business. The service accepts one or more lines, derives totals in integer cents, assigns an atomic business Claim number, and supports a client request key for replay-safe submission.

## G. Claim Lines

Each line stores expense date, description, claimed amount, category/policy provenance, review decision, approved amount, reviewer reason, and revision. Mileage amounts are derived server-side from frozen distance and rate rather than trusting a client total.

## H. Receipt / Evidence

Evidence is quarantined in private storage, never exposed by a public URL, and checked for bounded size, allowed MIME, file signature, and SHA-256 digest. Reads require employee ownership or manager authorization and return `private, no-store`, `nosniff`, and sandbox headers. Database failure triggers stored-object compensation cleanup.

## I. Duplicate Detection

A stable fingerprint over tenant, employee, category, expense date, amount, merchant/reference, and evidence digest produces a duplicate warning. It does not silently reject a legitimate Claim, and reviewers can see the warning.

## J. Approval

Managers with `REVIEW_CLAIM` and authorized branch scope can approve or reject a submitted Claim. Every line requires an explicit decision. Self-approval is denied when the reviewer is linked to the claimant.

## K. Partial Approval

Partial approval stores each approved amount independently and requires a reason for reduced or rejected lines. The aggregate approved amount is derived from line decisions; the original claimed facts remain unchanged.

## L. Cancellation

Employees may withdraw a submitted Claim. An authorized manager may cancel an approved but unpaid Claim with a reason. Cancellation reverses the single pending reimbursement obligation and any non-settled Payroll bridge snapshot exactly once; paid Claims cannot be cancelled.

## M. Reimbursement

Approval creates exactly one reimbursement obligation, but does not mark it paid. Channel choice and payment are separate state transitions guarded by optimistic revision, idempotency keys, and serializable transactions.

## N. Outside Payroll

An authorized verifier may choose `OUTSIDE_PAYROLL` and record the external payment reference/date once. This flow does not create a POS Payment or imply Public Bank execution.

## O. Payroll Bridge

The bridge links an approved reimbursement to a Draft Payroll entry through a dedicated `PayrollClaimReimbursementSnapshot`; it never creates a generic earning. The bridge requires both Claims and Payroll entitlements and prevents channel races and double settlement.

## P. Gross Pay Boundary

Only a `READY` or `SETTLED` verified Claim reimbursement snapshot can increase net pay. It is rendered in a separate non-wage reimbursement section and never increases Payroll earnings or gross pay.

## Q. Statutory Boundary

Payroll inclusion is fail-closed unless every frozen Claim line is `VERIFIED_NON_WAGE`. Current starter and UI-created policies are `REVIEW_REQUIRED`, so the bridge records `CLAIM_STATUTORY_TREATMENT_NOT_READY`, leaves net/gross unchanged, and blocks readiness rather than guessing PCB, EPF, SOCSO, or EIS treatment.

## R. Employee Self-Service

The Staff PWA exposes My Claims, own-history, category/policy choices, submission, evidence upload, status, line decisions, duplicate warning, and withdrawal. Claims authentication is decoupled from Attendance enablement while retaining the same protected employee session boundary.

## S. Manager / HR Workflow

`/team/claims` provides the review queue, employee/status filtering, receipt access, full/partial/reject decisions, cancellation, outside-Payroll settlement, Payroll bridge action, starter installation, and immutable policy revision creation.

## T. Permissions

`VIEW_CLAIM`, `REVIEW_CLAIM`, `VERIFY_CLAIM`, `MANAGE_CLAIM_SETTINGS`, and `LINK_CLAIM_TO_PAYROLL` remain distinct. Server actions enforce both module entitlement and capability; employee APIs never accept a client-supplied business or membership scope.

## U. Tenant / Branch / Group Scope

Claims, policies, evidence, events, reimbursements, and Payroll snapshots are business-scoped. Branch and membership references use composite tenant constraints, service queries bind trusted scope, and group access is limited to currently authorized businesses/branches.

## V. Audit / Historical Integrity

Claim events and policy revisions are append-only at the database layer. Submission, review, cancellation, channel selection, payment, and bridge operations emit auditable events while sensitive identifiers, receipt bytes, payment references, and monetary details are excluded from generic audit payloads.

## W. Concurrency / Idempotency

Submission request keys, channel keys, payment operation keys, optimistic revisions, unique reimbursement/snapshot constraints, and serializable transactions provide one canonical winner under retry or concurrency. Tests verify one review winner and one reimbursement obligation.

## X. Tests / Build / Migration

- Unit: 735/735 passed.
- Integration: 105/105 passed, including six Claims integration scenarios.
- TypeScript: passed.
- Lint: passed with one existing WhatsApp `<img>` warning.
- Next production-mode build executed locally: passed; existing autoprefixer warnings remain.
- Prisma validate: passed.
- Fresh migration rebuild: all 147 migrations passed on a disposable local database.
- Browser E2E: Local entitlement, navigation, policy starter, non-Attendance employee OTP/session, evidence upload, Claim submission, RM12.50 → RM10.00 partial approval, Outside-Payroll selection, and exactly-once paid status verified in the Local QA business.
- Canonical guard and `git diff --check`: required again at final handoff.

## Y. Remaining Risks

- No malware scanning service is configured. Evidence remains quarantined/private and is never publicly released, but authorized Local/Testing preview of unscanned evidence is a known residual risk.
- No policy revision can currently be certified as `VERIFIED_NON_WAGE` through the UI. Payroll reimbursement inclusion therefore remains intentionally blocked until a controlled statutory/tax sign-off path exists.
- Public Bank remains `PUBLIC_BANK_SPEC_NOT_READY`; Claims does not introduce a bank adapter or bank-file shortcut.
- This phase was validated only in Local/Testing. Production is out of scope and was not accessed or validated.

## Z. Final Status

The Claims foundation, employee/manager workflow, outside-Payroll reimbursement, private evidence boundary, and double-reimbursement controls are implemented. Payroll reimbursement remains fail-closed at the statutory classification gate.

**CLAIMS & REIMBURSEMENTS — PARTIAL**

**LOCAL / TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT VALIDATED**
