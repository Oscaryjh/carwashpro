# Configurable two-level HR approvals

## Scope

This phase adds configurable approval routing to the existing canonical Leave and Employee Claims workflows. It does not create a second approval engine and does not change Attendance resolution or Payroll finalisation.

## Policy modes

Each business can configure Leave and Claims independently:

- `ONE_LEVEL`: an authorised manager decision is final.
- `TWO_LEVEL_ALWAYS`: manager approval is followed by Business Owner final approval.
- `TWO_LEVEL_THRESHOLD`: owner approval is required only when the request reaches the configured threshold.
  - Leave threshold uses requested days.
  - Claims threshold uses the submitted MYR amount.

Missing policy records safely default to `ONE_LEVEL`, preserving the existing merchant workflow.

## Separation of duties

- Level 1: an authorised manager or supervisor (`STAFF` with the domain capability).
- Level 2: `BUSINESS_OWNER` only.
- The same user cannot complete both levels for one subject revision.
- Only Business Owners can change approval workflow settings.

## Canonical effects

Manager approval for a request that requires Level 2 records an immutable Level 1 decision only:

- Leave remains `PENDING`; no Leave balance is consumed.
- Claim remains `SUBMITTED`; no reimbursement or Business Expense is created.

The existing domain service performs its canonical effects only after Business Owner final approval. Manager rejection remains final and does not require an additional rejection click from the owner.

## In-flight policy stability

The Level 1 decision stores the policy mode, threshold, subject value and decision payload as snapshots. Later policy changes apply to new decisions only. An in-flight request continues along the approval route captured when Level 1 was completed.

## User interface

Business Owners can open:

`People & HR → Approvals → Approval workflow`

The unified Approvals inbox remains a read model:

- managers see Level 1 work they are authorised to decide;
- owners see requests that passed Level 1 and require final approval;
- one-level requests retain the existing direct approval experience.

## Security and audit

- Tenant and branch scope continue to be enforced by each domain service.
- Amount, days, revision and canonical status are re-read inside the domain transaction.
- Approval decisions are unique per business, domain, subject, revision and stage.
- Decision payloads are SHA-256 digested and retained with actor and timestamp evidence.
- Policy updates emit `HR_APPROVAL_POLICY_UPDATED` audit events.

## Deferred

- Configurable multi-level routing for Attendance, Payroll, Commission or other domains.
- Three or more approval levels.
- Per-branch or per-role policy designers.
- Delegation and temporary approver substitution.

## Environment

Local / Testing only. Production was not accessed or validated during this phase.
