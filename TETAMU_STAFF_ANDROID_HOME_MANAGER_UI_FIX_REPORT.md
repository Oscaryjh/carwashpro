# TETAMU STAFF 3000 — Android Home Bottom Navigation / Manager Priority UX Fix Report

Date: 2026-08-30  
Canonical workspace: `C:\CodexTetamuP0`  
Scope: **LOCAL / TESTING ONLY**  
Canonical Staff runtime: **3000 only**

## ROOT CAUSE:

1. The mobile (`max-width: 430px`) Staff shell overrode the general bottom clearance with only `72px + safe-area-inset-bottom`, while the fixed navigation itself occupies about 64–65px. This left only about 7–8px of effective clearance, so the final Home card could remain visually underneath or too close to the navigation on Android browser viewports.
2. The manager approval entry was rendered by `StaffHomeOverview` after Quick Access. Although the data was capability-scoped, the placement did not reflect the urgency of actionable approvals.
3. The Home reader returned an `EMPTY` upcoming-schedule state and the UI always rendered it. Together with the separate empty Today schedule card, this produced two repetitive large empty blocks.
4. Attendance and Today schedule were inside the same `StaffToday` component with no insertion point, preventing the required order without redesigning the Home navigation.

## BOTTOM NAV FIX:

- Kept the existing bottom navigation fixed; no tab or navigation architecture was changed.
- Mobile Staff shell now reserves:
  - `padding-bottom: calc(96px + env(safe-area-inset-bottom))`
  - `scroll-padding-bottom: calc(96px + env(safe-area-inset-bottom))`
- This covers the fixed navigation height, iOS/Android safe-area inset where supplied, and approximately 31px of comfortable scroll clearance in the tested Android-class layouts.
- Bottom-navigation links retain a minimum 52px interactive height, exceeding the required 44px touch target.

## MANAGER PRIORITY FIX:

- Added a compact `Needs My Approval` entry between Attendance and Schedule.
- It is rendered only when the capability-derived canonical approval summary has `total > 0`.
- Home order is now:
  1. Today / Attendance
  2. Needs My Approval — pending count and Review CTA (manager with actionable work only)
  3. Today's Schedule / useful Upcoming Schedule
  4. Quick Access
- The full approval queue remains in Approval Center; Home contains only the compact entry.
- Normal employees do not receive the manager entry.
- Existing capability checks and canonical Attendance / Leave / Claims / Overtime approval readers remain unchanged.

## EMPTY SCHEDULE FIX:

- Empty Today's Schedule is now a compact, low-density presentation:
  - `No schedule yet`
  - `Check with your manager for today's shift. This is not shown as a rest day.`
- An `EMPTY` Upcoming Schedule is omitted instead of rendering a second large repetitive empty card.
- Useful upcoming states (`READY` and `UNAVAILABLE`) remain supported and visible.
- No rest day is inferred, and Schedule / Attendance canonical logic was not changed.

## 390 RESULT:

Browser viewport requested: `390 × 844` (browser-reported inner width: 391px due to device rounding/scrollbar).

- Document width equals inner width: PASS
- Staff shell `scrollWidth === clientWidth` (`376 === 376`): PASS
- Horizontal overflow: NONE
- Shell bottom reservation: 96px plus safe-area inset
- Final Quick Access card bottom: 748.02px
- Fixed navigation top: 779.36px
- Final-card clearance above navigation: 31.34px
- Minimum measured navigation touch target: 50px
- Manager CTA reachable: PASS
- Last card fully visible above navigation: PASS

## 412 RESULT:

Browser viewport: `412 × 915`.

- Document width equals inner width (`412 === 412`): PASS
- Staff shell `scrollWidth === clientWidth` (`397 === 397`): PASS
- Horizontal overflow: NONE
- Shell bottom reservation: 96px plus safe-area inset
- Final Quick Access card bottom: 819.37px
- Fixed navigation top: 850.20px
- Final-card clearance above navigation: 30.82px
- Minimum measured navigation touch target: 50px
- Manager CTA reachable: PASS
- Last card fully visible above navigation: PASS

Additional Android-class verification at requested `360 × 800` (browser-reported `361 × 801`):

- Document width equals inner width: PASS
- Staff shell `scrollWidth === clientWidth` (`346 === 346`): PASS
- Final-card clearance above navigation: 31.00px
- Minimum measured navigation touch target: 50px
- No bottom-navigation overlap: PASS

## NORMAL STAFF RESULT:

- Physical-layout browser verification at `390 × 844`: PASS
- `Needs My Approval` is absent: PASS
- Home order remains Attendance → compact Schedule → Quick Access: PASS
- Empty Upcoming Schedule is absent: PASS
- Final-card clearance above fixed navigation: 31.48px
- No horizontal overflow: PASS

## MANAGER RESULT:

- Manager with 1 pending approval: compact `Needs My Approval / 1 pending / Review` appears directly after Attendance: PASS
- Manager pending count of 0: component and page condition both return/render nothing; automated source contract: PASS
- Manager entry uses the existing capability-derived canonical approval summary: PASS
- Full approval queue was not duplicated on Home: PASS
- Quick Access remains Appointments, Schedule and Leave only: PASS
- Empty Today + empty Upcoming: one compact Today state, no duplicate Upcoming card: PASS
- Useful upcoming schedule states remain renderable: PASS

## TESTS:

- `npx tsc --noEmit`: PASS
- `npm run lint`: PASS with 0 errors; 3 pre-existing unrelated warnings
- `npx tsx --test tests/unit/staff*.test.ts`: PASS, 89/89
- Focused Android Home / manager UX contracts include:
  - manager approval priority and pending-only visibility
  - empty Upcoming omission and useful-state preservation
  - fixed-nav/safe-area/scroll clearance
  - Quick Access limited to Appointments / Schedule / Leave
- `npm run build`: PASS (Next.js 16.3.0 production build)
- Local `/api/health`: PASS; database ready
- Browser UAT: manager > 0 and normal employee layouts verified at required sizes. Manager = 0 and useful schedule variants are additionally protected by focused automated contracts; the current local browser fixture did not provide every combination as a separate physical persona.

## NO NEW MIGRATION:

**YES — no new migration was created or modified by this fix.**

The repository already contains unrelated migration work in the dirty worktree; this task did not touch it.

## PRODUCTION STATUS:

- **LOCAL / TESTING ONLY**
- **PRODUCTION NOT ACCESSED**
- **PRODUCTION NOT MODIFIED**
- Railway Testing was not deployed or mutated during this fix.
- Staff 3100 was not accessed, restored, or reintroduced.

