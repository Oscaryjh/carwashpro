# TETAMU STAFF 3000 — LEAVE V2 NEW LEAVE FORM FINAL POLISH REPORT

## 1. FINAL VERDICT

**READY FOR OWNER REVIEW**

- Scope completed: `/staff/leave/new` presentation and interaction polish only.
- Environment: **LOCAL / RAILWAY TESTING ONLY**.
- The form now reads as one continuous task: Supporting Documents is the final content section and Submit request is a separate global form footer.
- Leave business logic, submission workflow, evidence rules, APIs, RBAC, session/device behavior, schema, and migrations are unchanged.
- Work stops at New Leave form final polish.

## 2. SUBMIT REQUEST FIX

Root cause: the shared action bar used `position: sticky; bottom: 0`. Although its DOM position was after Supporting Documents, CSS pulled it upward into the viewport before its natural position, covering the Document type and upload controls. This made the primary action look like a divider inside the form.

Fix:

- Supporting Documents remains before Submit request in semantic and DOM order.
- Form content is grouped inside a dedicated `formBody` flow.
- Submit request is rendered once, after the complete form content.
- The action is moved to an independent fixed footer surface instead of participating in the form-section grid.
- The task page owns an explicit 82px plus safe-area bottom reserve.

## 3. STICKY ACTION BAR

The shared Staff V2 Sticky Action Bar now behaves as a true fixed form footer:

- `position: fixed`
- `bottom: 0`
- solid Staff V2 canvas surface
- subtle top border and upward shadow
- safe left/right inset
- safe bottom inset
- one constrained 560px content column
- 50px primary touch target
- z-index isolated above task content

Runtime verification at 390×844 showed the Supporting Documents section ending at approximately 666px and the Submit button starting at approximately 784px, leaving clear visual and interaction separation.

## 4. SUPPORTING DOCUMENTS HIERARCHY

Supporting Documents is now a complete first-class final section:

1. Supporting documents heading
2. Concise format/limit helper text
3. Document type label and selector
4. Secondary Take photo / Upload files actions
5. Selected attachment rows
6. Private-file note
7. Reserved bottom spacing
8. Fixed Submit request footer

All document controls are fully visible above the footer when scrolled to the bottom. Long filenames continue to use the shared safe attachment row.

## 5. VISUAL POLISH

- The page uses one calm Staff V2 canvas.
- Each form step has a subtle white surface, fine border, 17px radius, and restrained shadow.
- Section gaps are reduced to a consistent 13px rhythm.
- Inputs use a coherent soft-white editable surface.
- The Reason textarea is increased to a comfortable 112px minimum height.
- Policy context and calculated duration use quieter secondary surfaces.
- No giant card wall or one-off override stylesheet was created.

## 6. BUTTON HIERARCHY

- Submit request is the only primary green CTA.
- Take photo uses a soft brand surface and restrained border.
- Upload files uses a neutral white secondary surface.
- Supporting actions remain 44px+ and accessible without competing visually with submission.
- Submission text, disabled state, and existing submission handler are unchanged.

## 7. HEADER POLISH

- Back control remains clearly separated and is increased to a 38px circular header control within its 44px interaction context.
- `New leave request` uses stronger 20–24px responsive hierarchy.
- Helper copy remains `Complete the details for your manager to review.` and is constrained for comfortable line length.
- Header spacing and alignment now match the calm section rhythm.

## 8. DATES / DURATION / REASON

Dates:

- From and To remain aligned two-column controls at 390/412.
- They stack at the 360 narrow breakpoint to prevent crowding.
- Native mobile-friendly date picker behavior is unchanged.

Duration:

- Full day / Half day remains an accessible radiogroup.
- Selected state has improved border, contrast, and inset emphasis.
- AM/PM appears only for Half day; interactive validation confirmed PM selection and `0.5 day` preview.
- Calculated duration is visibly secondary but complete.

Reason:

- Label remains permanent.
- Textarea has stronger breathing room and readable placeholder treatment.
- Transition into Supporting Documents is a normal section-to-section sequence.

## 9. SAFE AREA / KEYBOARD

- Fixed footer uses `env(safe-area-inset-left/right/bottom)`.
- Page content reserves `calc(82px + safe-area-bottom)` independently of the shell.
- A CSS ordering issue discovered during runtime QA was corrected with the explicit `.page.requestPage` selector, ensuring shared `.scope` padding cannot override the task reserve after Next.js CSS chunk merging.
- At the bottom of the 390 viewport, Supporting Documents and every control sit fully above the footer.
- The form remains scrollable when the viewport contracts for a mobile keyboard; no final field depends on space behind the CTA.

## 10. MOBILE 360

- Validated at 360×800 class.
- Browser measurement: `scrollWidth === innerWidth` (361/361 physical CSS pixels reported by the browser backend).
- Dates stack to one column.
- No clipped heading, horizontal overflow, or competing upload CTA.
- Fixed footer remains inside the viewport and the page retains full scroll clearance.
- Evidence: `artifacts/staff-leave-new-form-polish/new-leave-360x800.png`.

## 11. MOBILE 390

- Validated at 390×844 class.
- Browser measurement: 391/391; no horizontal overflow.
- Captured top, middle, and bottom states.
- Supporting Documents is fully visible above the fixed footer at maximum scroll.
- Page bottom reserve computed at runtime as 82px with zero simulated safe-area inset.
- Evidence: `new-leave-390-top.png`, `new-leave-390-mid.png`, `new-leave-390-bottom.png`.

## 12. MOBILE 412

- Validated at 412×915.
- Browser measurement: 412/412; no horizontal overflow.
- Two-column dates remain readable and aligned.
- Extra height exposes the beginning of Supporting Documents instead of enlarging cards.
- Evidence: `artifacts/staff-leave-new-form-polish/new-leave-412x915.png`.

## 13. ACCESSIBILITY

- One `h1`.
- Logical DOM and reading order: Leave type → Dates → Duration → Reason → Supporting documents → Submit request.
- Permanent labels for selects, dates, textarea, document type, and uploads.
- Full/Half and AM/PM remain labelled radiogroups.
- Status and selection are not color-only.
- 44px+ interactive controls and visible focus states are retained.
- Long filenames retain the complete accessible/title value.
- Fixed CTA remains keyboard reachable and does not replace native form submission semantics.

## 14. REGRESSIONS

PASS:

- Leave landing and detail
- Approved + evidence Awaiting review hierarchy
- 5-file / 10 MB attachment limits
- Half day and AM/PM
- Leave submission flow
- Requests Hub
- Approval Center
- Home
- Time
- Timesheet / Payroll Leave interaction
- Staff bottom navigation outside the task route

The focused regression selection completed **176/176 PASS**.

## 15. FILES CHANGED

1. `src/components/staff-pwa/staff-leave.tsx`
2. `src/components/staff-pwa/staff-leave.module.css`
3. `src/components/staff-pwa/staff-v2.module.css`
4. `tests/unit/staff-leave-v2.test.ts`

Clean controlled source:

- Worktree: `C:\CodexTetamuP0-leave-v2`
- Branch: `codex/staff-leave-new-form-polish`
- Base: Leave V2 commit `e3f9d08`
- Commit: `81ba6c0e668c28541567128238309611819b8412`

## 16. TEST RESULTS

- Focused Leave/form and cross-module regression: **176/176 PASS**
- Full unit suite: **1317/1317 PASS**
- TypeScript (`npx tsc --noEmit`): PASS
- Targeted ESLint: PASS
- `git diff --check`: PASS
- Next.js 16.3.0 production build: PASS
- Production build generated 144 application pages/routes successfully
- Railway Testing smoke: 7/7 HTTP 200

The first clean build invocation was intentionally stopped by the repository's active-local-server guard because another worktree was serving local QA. The production build was then run in the isolated clean worktree with a non-listening guard port; compilation, TypeScript, static generation, and trace collection all completed successfully. No guard or application rule was disabled in source.

## 17. NO BACKEND CHANGE

**NO BACKEND CHANGE.** No change to Leave type, entitlement, balance, half day, AM/PM, multi-day, evidence requirement, document validation, submission, approval, Timesheet/Payroll, APIs, RBAC, or session/device behavior.

## 18. NO NEW MIGRATION

**NO NEW MIGRATION.** Prisma schema and migration history were not modified.

## 19. TESTING DEPLOYMENT

- Railway project: `Tetamu-POS`
- Environment: `testing`
- Service: `tetamu-staff-app`
- Commit: `81ba6c0e668c28541567128238309611819b8412`
- Deployment ID: `146ab1ad-d5ec-4641-9ced-7fd331592e69`
- Status: **SUCCESS**
- Image digest: `sha256:47e165cbf6c685b09f072db952bbf4567608e5ec0e2291d23bba3d8a374b5c21`

Post-deploy HTTP 200 smoke:

- `/api/health`
- `/staff/login`
- `/staff/requests`
- `/staff/leave`
- `/staff/leave/new`
- `/staff/approvals`
- `/staff/timesheet`

## 20. PRODUCTION STATUS

**TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

The task stops after New Leave form final polish. Claims V2, Attendance Corrections V2, Pay V2, and Profile V2 were not started.
