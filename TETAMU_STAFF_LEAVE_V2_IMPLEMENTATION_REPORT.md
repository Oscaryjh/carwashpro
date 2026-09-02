# TETAMU STAFF 3000 — LEAVE V2 IMPLEMENTATION REPORT

## 1. FINAL VERDICT

**READY FOR OWNER REVIEW**

- Scope completed: Staff 3000 `Leave V2` only.
- Environment: **LOCAL / RAILWAY TESTING ONLY**.
- Railway Testing deployment is successful and the required smoke routes return HTTP 200.
- Leave decision is now the primary request fact; supporting-evidence verification is a separate secondary fact.
- No Leave engine, entitlement, approval, evidence, Attendance, Timesheet, Payroll, RBAC, session, API contract, Prisma schema, or migration behavior was changed.
- Claims V2, Attendance Corrections archive V2, Approval Center visual normalization, Pay V2, and Profile V2 were not started.

## 2. PAGE STRUCTURE

`/staff/leave` now uses the approved Staff V2 hierarchy:

1. Page header — `Leave` and concise support copy.
2. Compact `New leave request` action.
3. Compact Balances section.
4. Recent requests list.
5. Inline, progressively disclosed request detail.
6. Existing fixed bottom navigation: Home / Time / Requests / Pay / Profile.

The former card-heavy presentation has been flattened. No giant green hero, giant balance wall, or nested mega-card was introduced.

## 3. BALANCES

Landing balance rows show only employee-safe, immediately useful facts: leave type, paid/unpaid classification where supplied, and available amount. Full balance disclosure uses only canonical read-model values: available, entitlement, carry forward, used, pending, manual adjustment, and expiry where present. No entitlement calculation occurs in the UI.

## 4. BALANCE DENSITY

At most two compact balance rows are shown before disclosure. Valid/usable and positive-available policies are presentation-sorted without changing entitlement priority. Large per-policy cards were removed from the landing experience.

## 5. VIEW ALL BALANCES

`View all balances` is a native expandable detail on the existing route. It preserves route/session ownership and avoids inventing a child route. Internal bucket IDs, ledger IDs, rule-pack names, and calculation codes are not exposed.

## 6. RECENT REQUESTS

The landing list shows three compact recent rows by default. Each row contains only date/range, leave type, duration, one primary request status, and disclosure affordance. Because the current API is limited to `take: 50`, the control is deliberately labelled `Show more recent requests`, not `All leave history`.

## 7. LEAVE STATUS SYSTEM

Canonical states are translated to employee-facing copy:

- Submitted/Pending → `Waiting for manager`
- Approved → `Approved`
- Rejected → `Rejected`
- Cancelled/Withdrawn → `Cancelled` or `Withdrawn` as canonically supplied
- Evidence requiring employee work → row may show `Action needed`, while detail still preserves the Leave decision

There is never more than one equal-weight primary Leave status on a request row.

## 8. DECISION VS EVIDENCE

Decision and evidence are rendered as separate detail sections. Evidence state never mutates or replaces the canonical Leave decision. The regression matrix covers waiting, approved, rejected, cancelled/withdrawn, evidence awaiting review, verified, and needs-follow-up combinations.

## 9. APPROVED + EVIDENCE PENDING

Verified behavior:

- Leave decision: `Approved`
- Supporting document: `Awaiting review`

The request is not labelled `Waiting for manager`. Visual evidence: `artifacts/staff-leave-v2/leave-approved-evidence-awaiting-review-390x844.png`.

## 10. EVIDENCE NEEDS FOLLOW-UP

When canonical evidence state genuinely requires employee action, the compact row may show `Action needed`. Expanded detail remains explicit:

- Decision: `Approved`
- Evidence status: `Needs follow-up`
- Canonical employee-facing review note is shown

Visual evidence: `artifacts/staff-leave-v2/leave-approved-evidence-review-bottom-390x844.png`.

## 11. LEAVE DETAIL

Current inline expansion was retained as the safest route architecture. Flat Detail Sections show Request, Decision, Supporting documents, and Evidence status. Decision date is omitted because the current API does not expose `reviewedAt`. Normal approved requests do not show a noisy `Next action / No action needed` section.

## 12. NEW LEAVE FORM

`/staff/leave/new` remains the canonical destination and preserves task-mode navigation. The form is organized into V2 Form Sections for Leave type, Dates, Duration, Reason, and Supporting documents, with a sticky `Submit request` action. No new required field was invented.

## 13. HALF DAY

Half-day selection uses labelled, accessible segmented controls. AM/PM controls appear only when Half day is selected. Selected state is conveyed by text/semantics as well as color, and controls meet the 44px touch-target contract.

## 14. MULTI-DAY

From/To dates remain native mobile-friendly controls. Multi-day selection is supported without asking the employee to manually count days. Canonical server calculation remains authoritative; no working-day, rest-day, or public-holiday engine was duplicated in the browser.

## 15. DURATION

Single-day and half-day selections show `1 day` and `0.5 day`. For WEEKDAYS multi-day requests the UI states `Confirmed after submission`, because the canonical server—not the client—must determine excluded working days. A pre-submit server duration preview would require read-model/query enrichment.

## 16. SUPPORTING DOCUMENTS

A reusable `StaffV2AttachmentRow` pattern now presents file name, safe status copy, metadata, and accessible action in a compact row. Existing documents and newly selected files use the same visual language. Long names ellipsize visually while retaining the complete accessible/title value.

## 17. ATTACHMENT LIMITS

Canonical limits are unchanged and enforced:

- Maximum 5 attachments
- Maximum 10 MB per attachment

No accepted file-type, upload validation, or backend storage rule was changed.

## 18. WITHDRAW / CANCEL

Existing canonical withdraw eligibility is preserved. Withdraw is rendered only for states the current backend/read model marks as withdrawable, retains confirmation behavior, and is absent from final/non-withdrawable requests. Pending-only add/remove/replace document actions remain state-gated.

## 19. EMPTY

The empty request state reads `No leave requests yet` and keeps both balances and `New leave request` available. It uses the compact shared Empty State and no giant illustration.

## 20. LOADING

`/staff/leave/loading.tsx` provides stable, compact geometry for page header, action, balance rows, and recent request rows. It avoids giant skeleton cards and large layout jumps.

## 21. ERROR

`/staff/leave/error.tsx` provides employee-safe copy and a `Try again` action. Prisma, HTTP diagnostics, database details, rule-pack names, and stack traces are not exposed. Form errors remain associated with the applicable action/field where the current flow supports it.

## 22. MOBILE 360

- Tested 360×800 class.
- Browser measurement: `scrollWidth === innerWidth` (backend reported 361/361 physical CSS pixels).
- Compact balances and request rows remain readable.
- Long names wrap/ellipsize safely.
- Final content scrolls clear of the bottom navigation.
- Evidence: `artifacts/staff-leave-v2/leave-landing-states-360x800.png`.

## 23. MOBILE 390

- Tested 390×844 class.
- Browser measurement: 391/391; no horizontal overflow.
- First viewport contains page title, new-request entry, compact balance, Recent requests, and request content without a balance wall.
- Form, half-day, attachment, long-filename, status, and sticky-action states captured.
- Evidence: `artifacts/staff-leave-v2/leave-statuses-390x844.png`, `leave-new-390x844.png`, and `leave-new-bottom-390x844.png`.

## 24. MOBILE 412

- Tested 412×915.
- Browser measurement: 412/412; no horizontal overflow.
- Same information architecture and control density as 390; extra height exposes more content instead of enlarging cards.
- Evidence: `artifacts/staff-leave-v2/leave-landing-states-412x915.png`.

## 25. KEYBOARD / SAFE AREA

The task route uses a sticky action bar with iPhone/Android safe-area padding. The scroll container reserves sufficient bottom clearance, and at the bottom of the 390 form the last fields and Submit action are fully reachable. The fixed landing bottom navigation does not cover the last row. Native date and file controls remain usable.

## 26. ACCESSIBILITY

- One page `h1` and logical section headings.
- Grouped list semantics and descriptive request summaries.
- Status is always text, never color-only.
- Permanently visible form labels.
- Accessible radio/segmented semantics for Full/Half and AM/PM.
- Accessible attachment labels including full long filename.
- Focus-visible behavior, reduced-motion support, text reflow, and 44px interactive targets retained.
- Destructive withdrawal remains confirmed.

## 27. REQUESTS HUB REGRESSION

PASS. Requests Hub architecture and `/staff/leave` destination are unchanged. Leave balances/history were not duplicated into Requests Hub. Focused regression includes Requests Hub V2 tests.

## 28. APPROVAL CENTER REGRESSION

PASS. Approval Center code, Leave decision workflow, capability/business/branch scope, self-review prevention, and manager history were not changed. Focused regression includes Approval Center V2 tests.

## 29. HOME / TIME REGRESSION

PASS. Home, Time Hub, Schedule, Attendance History, and their navigation were not modified by this implementation. Shared-primitives compatibility was restored and validated against the approved newer primitive surface before final commit.

## 30. TIMESHEET / PAYROLL REGRESSION

PASS. Leave-to-Attendance/Timesheet/Payroll behavior remains on the existing canonical services. No direct Payroll mapping or derived Timesheet state was added to Leave UI.

## 31. FILES CHANGED

1. `src/components/staff-pwa/staff-leave.tsx`
2. `src/components/staff-pwa/staff-leave.module.css`
3. `src/components/staff-pwa/staff-v2-primitives.tsx`
4. `src/components/staff-pwa/staff-v2.module.css`
5. `src/lib/staff-pwa/leave-v2.ts`
6. `src/app/staff/leave/loading.tsx`
7. `src/app/staff/leave/error.tsx`
8. `tests/unit/staff-leave-v2.test.ts`

Changes were prepared in clean controlled worktree `C:\CodexTetamuP0-leave-v2`, branch `codex/staff-leave-v2`, from approved Requests V2 base `daae682`.

## 32. TEST RESULTS

- TypeScript (`npx tsc --noEmit`): PASS
- Targeted ESLint: PASS
- Focused Leave/entitlement/evidence/approval/Requests/Approval Center/Home/Time/Staff PWA regression: **175/175 PASS**
- Git diff/check: PASS
- Production build (Next.js 16.3.0, 144 pages/routes): PASS
- Required Railway Testing smoke routes: 7/7 HTTP 200

The initial clean worktree required normal `prisma generate` after dependency installation. No product test was weakened. A build attempt in the busy canonical root encountered a local Prisma DLL lock; the clean controlled worktree production build passed.

## 33. FULL UNIT STATUS

- Clean controlled source: **1315/1315 PASS**
- Canonical local root, including additional unrelated in-progress tests: **1405/1405 PASS**

No regression was classified as outstanding.

## 34. READ MODEL ENRICHMENT STATUS

**READ MODEL ENRICHMENT REQUIRED** for these future capabilities; none blocks owner review:

1. Balances and requests currently arrive through one `/api/employee-leave` GET, so a genuine `balances failed / requests still usable` partial response requires an API/read-model split.
2. Requests use `take: 50` without complete server pagination; UI correctly says `Recent requests`, not `All history`.
3. The API does not expose `reviewedAt`; decision date is therefore not guessed.
4. Canonical multi-day WEEKDAYS duration cannot be promised before submit without a server preview endpoint/query.
5. Upload currently occurs with submission, so a real pre-submit per-file `Uploading / Retry` lifecycle would require upload-flow enrichment. Current real states—Selected, submission failure, Awaiting review, Verified, and Needs follow-up—are presented safely.

## 35. CSS DEBT STATUS

No `staff-leave-v2-overrides.css` or third giant override layer was created. The implementation reuses Staff V2 primitives and a narrow `staff-leave.module.css`. Shared additions are limited to attachment row, sticky action bar, and small Form Section capabilities. Claims/Pay/Profile CSS was not cleaned or changed.

## 36. NO BACKEND CHANGE

Confirmed. No change to Leave entitlement, calculation, carry forward, expiry, adjustment, approval state machine, evidence verification, Attendance, Timesheet, Payroll, Approval Center, Claims, RBAC, session/device, or API contracts. This is a presentation/read-model mapping implementation only.

## 37. NO NEW MIGRATION

**NO NEW MIGRATION.** Prisma schema and migration history were not changed by Leave V2.

## 38. TESTING DEPLOYMENT

- Commit: `e3f9d08b59db8ccff16cd831ed08e0bccd208c7b`
- Deployment ID: `86f06845-4b9a-4887-a5a3-3de0d30d300e`
- Railway service: `tetamu-staff-app`
- Environment: `testing`
- Status: **SUCCESS**
- Image digest: `sha256:6da5959d4de332212a3b323202c52fd183fa6ca3a322f402b226c813a92de6fb`

Post-deploy HTTP 200 smoke:

- `/api/health`
- `/staff/login`
- `/staff/requests`
- `/staff/leave`
- `/staff/leave/new`
- `/staff/approvals`
- `/staff/timesheet`

Local visual fixtures are tagged `[LEAVE_V2_VISUAL_UAT]` and exist only in the local canonical development database. The canonical history trigger correctly prevented destructive cleanup because Leave request history is immutable; no trigger was bypassed. They were not transferred to Railway Testing or Production.

## 39. PRODUCTION STATUS

**TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

Implementation stops at Leave V2 and is ready for owner physical-device review. No Claims V2, Attendance Corrections archive V2, Approval Center visual normalization, Pay V2, or Profile V2 work has been started.
