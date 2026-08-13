# Unified HR Approval Center — Final Closure

## A. Objective

Tetamu now provides one manager-facing `/team/approvals` inbox for actionable Attendance, Leave, Claims, Commission, and Payroll work. This closure is Local / Testing only. It does not introduce an approval database table, a generic workflow engine, or a second source of approval truth.

## B. Existing Approval Audit

| Domain | Existing canonical surface | Audit status |
| --- | --- | --- |
| Attendance | P2 exception resolution, legacy resolution cases, immutable final results | READY |
| Missing punch / Late / Early / Absence | Attendance P2 detector and resolution service | READY |
| Leave | Submit, approve, reject, cancel, frozen policy treatment, balance ledger | READY |
| Claims | Submitted review, line-level partial approval/rejection, secure receipt endpoint | READY |
| Commission | Calculated period approval, frozen statements, future corrections | READY |
| Timesheet | `DRAFT → APPROVED → LOCKED`, whole-business readiness and revisions | READY; represented inside Attendance |
| Payroll | `DRAFT → REVIEW → FINALIZED`, readiness, return/reopen, immutable snapshots | READY |
| Payroll high-risk actions | Existing True MFA / step-up flow | READY; never mutated from the unified inbox |

No duplicated approval workflow was found or added. Statutory platform review is not a Business HR approval and is excluded.

## C. Architecture

The implemented flow is:

```text
Canonical domain state
        ↓
Capability- and entitlement-aware domain projections
        ↓
Unified ApprovalInboxItem read model
        ↓
/team/approvals
        ↓
Open the existing domain page/service
```

The Approval Center owns no canonical mutation and stores no completion status. After a domain mutation succeeds, the item naturally disappears on the next read.

## D. Unified Read Model

`ApprovalInboxItem` has stable domain-prefixed identity, tenant and optional branch scope, subject identity, safe employee display fields, title/summary, request time, pending/blocked presentation state, priority, optional amount/units, required capability, target URL, revision, and bounded metadata.

The central service resolves the trusted authenticated business context, live module entitlements, live capabilities, and authorized branches. Domain adapters run independently. A failed adapter is reported as `Partial data unavailable`; it is never silently counted as zero.

## E. Attendance

The adapter includes unresolved P2 exceptions, open legacy resolution cases, and actionable whole-business Timesheet approval/locking work. It does not list ordinary punches or completed attendance. `NO_ATTENDANCE_RECORDED` remains distinct from `SUSPECTED_NO_SHOW`; no schedule evidence is never relabeled as a no-show.

The UI opens the existing Attendance Resolution Queue or Timesheet page. Resolution continues to use the canonical revisioned Attendance service and audit trail.

## F. Leave

Only pending Leave applications in the actor's authorized branches are projected. The summary shows the frozen leave type, dates, units, and paid/unpaid treatment without exposing the private reason. Attachment is represented only as an indicator.

The target URL carries the Leave year so cross-year pending work opens the correct canonical manager view. Approval/rejection still occurs in Leave, where frozen treatment, balance checks, overlap rules, revision checks, Attendance integration, and audit remain enforced. Managers cannot change leave type or paid/unpaid treatment.

## G. Claims

Only submitted Claims are projected. The list exposes claim number, category summary, submitted amount, duplicate-warning state, and receipt presence. It never preloads receipt bytes or the private purpose.

Claims use `Open review`, not a generic quick-approve action. Line-level partial approval/rejection and secure receipt access remain in the existing Claims domain.

## H. Commission

Only calculated Commission periods that the actor is allowed to approve are projected. Eligible sales, adjustments, final commission, period, statement count, and frozen revision are displayed to authorized Commission reviewers.

Approval remains in the Commission workspace and retains calculated-versus-approved separation, independent approver rules, frozen statements, future correction behavior, and canonical audit.

## I. Payroll

Only `REVIEW` Payroll Runs are projected for actors with whole-business Payroll approval scope. The item shows employee count, gross/net review amounts, readiness state, and blocker count. A not-ready run is visibly `BLOCKED`.

The center provides only `Open Payroll review`. Finalize, reopen, statutory export, and payment export are not inbox mutations. Existing Payroll readiness and True MFA / step-up controls remain the only path for high-risk actions.

## J. Module Entitlement

The center requires HR plus at least one actionable approval capability. Attendance and Leave require HR. Claims, Commission, and Payroll additionally require their own enabled module. Claims and Commission do not require Payroll. Commission-only businesses retain their existing Commission workspace and are not forced into the HR center. No `APPROVALS` module was created.

## K. Capability / Scope

Each adapter has an explicit capability gate; role names are not used as a substitute. Live business context, module entitlement, capability, branch scope, and whole-business requirements are re-evaluated server-side. Opening the destination page after a capability or module change is therefore denied by the destination domain as well.

## L. Navigation

Eligible HR managers see `Approvals` under the existing `People & HR` group. The badge uses the same central count service and appears only when all enabled adapters return successfully. Users without an actionable HR approval capability do not see the entry. POS-only navigation remains `People`, not `People & HR`.

## M. Counts

The top total equals the sum of visible actionable category counts. Counts exclude disabled modules, unauthorized capabilities, other branches, other businesses, and self-submitted Leave/Claims/Commission work. Adapter failures are listed explicitly and excluded from any misleading success total.

## N. Filters / Pagination

The first version supports domain, authorized branch, employee, and date-range filtering. Status is intentionally pending-only. Results sort oldest first with a stable identity tie-breaker and use bounded 20/50 pagination. Completed history remains in each canonical domain.

## O. Quick Actions

No inline mutation was introduced. Actions are intentionally domain-specific:

- Attendance: Review / resolve
- Leave: Open decision
- Claims: Open review
- Commission: Review / approve
- Payroll: Open Payroll review

This preserves every domain's validation, context, and error semantics.

## P. Domain Delegation

The center contains no Prisma mutation and creates no generic approval audit. Existing Attendance, Leave, Claims, Commission, Timesheet, and Payroll actions revalidate the inbox after successful canonical mutations so counts refresh naturally.

## Q. Self-approval

Leave, Claims, and Commission queries exclude work submitted/calculated by the authenticated actor when that actor is linked to the employee. Canonical domain services continue to reject self-approval, so stale pages or guessed URLs cannot bypass governance. Payroll retains its existing independent-review governance.

## R. Branch / Tenant

Every adapter binds queries to the trusted current business. Branch-sensitive domains constrain the query itself to authorized branch IDs; they do not fetch all items and hide them later. Whole-business Timesheet and Payroll items require whole-business scope. Integration fixtures confirm zero cross-branch and cross-business leakage.

## S. Sensitive Data

List summaries contain only the minimum required to choose the correct review surface. They omit bank data, salary components, receipt bytes, medical/private reasons, leave purpose, claim purpose, MFA tokens, secrets, and recovery codes. Claim, Commission, and Payroll amounts are returned only after their explicit module and capability gates pass.

## T. Concurrency

The read model does not weaken domain concurrency. Attendance and Leave revisions, Claims transactional line decisions, Commission freeze rules, Timesheet revisions, and Payroll lifecycle/MFA transactions remain canonical. Multiple managers can see the same pending read, but only the canonical domain transition can produce the result.

## U. Stale State

Inbox items carry the current domain revision/version where available. Because there is no center-side mutation, an already-processed item either disappears after refresh or reaches the canonical domain's existing stale/revision error. There is no second idempotency layer that could diverge.

## V. Browser UX

Authenticated Local browser QA covered:

- Full Workforce: initial exact mixed counts; Leave approval; Claims line-review page; Commission approval/freeze; Attendance resolution; Payroll review/readiness page; processed items disappear.
- HR-only: only Attendance and Leave categories are shown, with the correct caught-up empty state.
- POS-only: no Approvals navigation, People and POS remain usable, and direct `/team/approvals` access returns 404.
- No visible runtime or hydration error was found; no console event was emitted on the final reload probe.

The layout is responsive and retains the current application navigation style.

## W. Performance

Adapters use bounded projections, aggregate counts where available, relation selects/batching, and bounded pagination rather than per-employee fan-out. Navigation reuses the central count service. The design avoids a `5 domains × N employees × N queries` pattern and is suitable for the stated normal 100-employee business target.

## X. Tests / Regression

- Unified targeted unit: 4/4 pass.
- Unified targeted integration: 2/2 pass.
- Related Attendance/Leave/Claims/Commission/Payroll/entitlement/auth regression: 51/51 unit and 22/22 integration pass.
- Full unit: 789/789 pass.
- Full integration: 119/119 pass.
- TypeScript: pass.
- Lint: pass with one pre-existing WhatsApp `<img>` warning.
- Local production-mode build: pass.
- Prisma validate: pass.
- Prisma generate: pass after stopping the Local workspace processes that held the Windows query-engine DLL.
- Migration status: 156 migrations, schema up to date.
- No schema change was made for this feature, so no new migration or fresh migration rebuild was required.
- Local browser fixture verification: Attendance `RESOLVED`, Leave `APPROVED`, Commission `LOCKED`, with canonical domain audit entries.

## Y. Remaining Risks

Unified completed history, delegation, multi-level generic approvals, SLA/escalation, reminder channels, bulk approval, and analytics remain deliberately deferred. Very large multi-domain inbox performance should continue to be observed with production-like Testing volumes. The pre-existing WhatsApp image lint warning and a pre-existing Attendance CSS autoprefixer warning are unrelated to this closure.

## Z. Final Status

```text
UNIFIED APPROVAL CENTER
→ READY

ATTENDANCE ADAPTER
→ READY

LEAVE ADAPTER
→ READY

CLAIMS ADAPTER
→ READY

COMMISSION ADAPTER
→ READY

PAYROLL ADAPTER
→ READY

ACTIONABLE COUNTS
→ PASS

MODULE ENTITLEMENT
→ PASS

CAPABILITY FILTERING
→ PASS

BRANCH SCOPE
→ PASS

TENANT ISOLATION
→ PASS

SELF-APPROVAL PROTECTION
→ PASS

STALE REVISION PROTECTION
→ PASS

DOMAIN DELEGATION
→ PASS

SENSITIVE DATA PROTECTION
→ PASS

PAYROLL MFA BOUNDARY
→ PASS

POS-ONLY EXPERIENCE
→ PASS

HR-ONLY EXPERIENCE
→ PASS

FULL WORKFORCE EXPERIENCE
→ PASS

HR REGRESSION
→ PASS

PAYROLL REGRESSION
→ PASS
```

```text
UNIFIED HR APPROVAL CENTER
→ READY

LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT VALIDATED
```
