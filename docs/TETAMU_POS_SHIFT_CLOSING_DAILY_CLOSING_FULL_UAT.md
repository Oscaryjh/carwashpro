# TETAMU POS — SHIFT CLOSING & DAILY CLOSING FULL UAT

## Overall Status

**BLOCKED**

本轮是证据冻结，不包含 remediation。Closing 的正常单日现金流程、冻结快照、History、Group Closing 与导出基线大致稳定，但发现两项会影响冻结金额或冻结完整性的 P0：

1. 跨 02:00 cutoff 的 shift 会把整段 shift-level cash movement 归到开班营业日，而 Daily Closing report 会按每笔交易时间归日。
2. Manual Daily Close 可在同分店仍有 OPEN shift 时成功冻结；冻结后该 OPEN shift 仍能产生交易，而 frozen snapshot 不再更新。

在这两项处理并重新 UAT 前，不应把 Closing 标记为 Production Ready。

## Environment

- Local / Testing: **LOCAL**
- URL: `https://localhost:3000/closing`
- Database: Local embedded PostgreSQL
- Business: `Closing Full UAT Local Only`
- Industry: `SALON_BEAUTY`
- Branches: `Manual Control Branch`, `Cross Cutoff Branch`
- Timezone: `Asia/Kuching`
- Business Day cutoff: `02:00`
- Authenticated users:
  - `Closing UAT Owner` / `BUSINESS_OWNER`
  - `Closing UAT Cashier` / `STAFF` / `CLOSING`
- POS module state: Enabled in isolated Local fixture
- Closing capability state: Enabled
- Expense module state: No live expense provider transaction executed; calculator path covered by tests
- WhatsApp Closing automation: Disabled/no recipient in isolated browser fixture; logic covered by focused tests
- Production accessed: **NO**
- Business data changed: **YES — isolated Local UAT business only**

Created UAT records include isolated branches, users, shifts, payments, snapshots and audit logs. Existing user businesses were not mutated.

## Executive Summary

- Total scenarios: **38**
- PASS: **20**
- FAIL: **2**
- REVIEW REQUIRED: **10**
- BLOCKED: **6**
- P0 findings: **2**
- P1 findings: **4**
- P2 findings: **7**
- P3 findings: **0**

Status counts reflect browser/DB scenarios plus targeted source/test audits. Cross-cutoff refund/payout/non-cash variants, full two-cashier cash mix and a real 390px CSS viewport were not forced when a safe or supported browser fixture was unavailable.

## Scenario Register

| ID | Scenario | Functional | Financial | Permission | UI/UX | Responsive | Severity |
|---|---|---|---|---|---|---|---|
| ENV-01 | Isolated Local environment and capability check | PASS | N/A | PASS | N/A | N/A | P3 |
| SHIFT-01 | Start shift with RM50 opening float | PASS | PASS | PASS | PASS | BLOCKED | P3 |
| SHIFT-02 | Opening input precision/upper bound | REVIEW REQUIRED | REVIEW REQUIRED | N/A | REVIEW REQUIRED | N/A | P2 |
| SHIFT-03 | Existing own OPEN shift blocked | PASS | PASS | PASS | PASS | N/A | P1 |
| SHIFT-04 | New shift after frozen business day blocked | PASS | PASS | PASS | PASS | N/A | P1 |
| SHIFT-05 | Close only own shift | PASS | PASS | PASS | PASS | N/A | P1 |
| SCOPE-01 | Cross-business/cross-branch resolution | PASS | PASS | PASS | N/A | N/A | P0 |
| P0-01 | Shift spans 02:00 cutoff | FAIL | FAIL | N/A | REVIEW REQUIRED | N/A | P0 |
| CUT-02 | Cash refund crosses cutoff | BLOCKED | BLOCKED | N/A | N/A | N/A | P0 |
| CUT-03 | Drawer payout crosses cutoff | BLOCKED | BLOCKED | N/A | N/A | N/A | P0 |
| CUT-04 | Non-cash payment crosses cutoff | BLOCKED | BLOCKED | N/A | N/A | N/A | P1 |
| P0-02 | Manual close while branch shift remains OPEN | FAIL | FAIL | REVIEW REQUIRED | FAIL | N/A | P0 |
| PERM-01 | STAFF + CLOSING manual close server permission | REVIEW REQUIRED | N/A | REVIEW REQUIRED | REVIEW REQUIRED | N/A | P1 |
| MAN-01 | Future business date rejected | PASS | PASS | PASS | PASS | N/A | P1 |
| MAN-02 | Manual difference with empty note | REVIEW REQUIRED | PASS | PASS | REVIEW REQUIRED | N/A | P1 |
| AUTO-01 | Final shift automatically freezes snapshot | PASS | PASS | PASS | PASS | BLOCKED | P0 |
| AUTO-02 | Snapshot uniqueness/idempotency boundary | PASS | PASS | PASS | PASS | N/A | P0 |
| CONC-01 | Concurrent Start Shift | REVIEW REQUIRED | REVIEW REQUIRED | PASS | N/A | N/A | P1 |
| CASH-01 | Opening RM50 + cash RM20 = shift expected RM70 | PASS | PASS | PASS | PASS | N/A | P0 |
| CASH-02 | Short/over note gate in End Shift code/tests | PASS | PASS | PASS | PASS | N/A | P1 |
| MULTI-01 | Full two-cashier realistic branch sequence | BLOCKED | BLOCKED | N/A | N/A | BLOCKED | P0 |
| REAL-01 | RM100/RM500/RM20/RM30 realistic cash mix | BLOCKED | BLOCKED | N/A | N/A | BLOCKED | P0 |
| REF-01 | Cash/non-cash refund formula | PASS | PASS | N/A | N/A | N/A | P0 |
| EXP-01 | Drawer payout deducted once | PASS | PASS | N/A | N/A | N/A | P0 |
| FREEZE-01 | Later source change does not rewrite snapshot | PASS | PASS | PASS | REVIEW REQUIRED | N/A | P0 |
| TRACE-01 | Frozen summary beside live post-close activity | REVIEW REQUIRED | PASS | N/A | REVIEW REQUIRED | N/A | P2 |
| WA-01 | Recipient, template and dedupe tests | PASS | N/A | PASS | PASS | N/A | P1 |
| WA-02 | Unclosed reminder behavior tests | PASS | N/A | PASS | PASS | N/A | P1 |
| HIST-01 | History list, frozen values, branch/date filter | PASS | PASS | PASS | PASS | BLOCKED | P1 |
| GROUP-01 | Group Closing reads frozen snapshots | PASS | PASS | PASS | N/A | N/A | P0 |
| EXPORT-01 | CSV/XLSX/PDF scope and formula-injection tests | PASS | PASS | PASS | PASS | N/A | P1 |
| OPS-01 | Salon operational calculator | PASS | PASS | N/A | PASS | N/A | P2 |
| OPS-02 | Auto cancellation uses createdAt | REVIEW REQUIRED | N/A | N/A | REVIEW REQUIRED | N/A | P2 |
| STALE-01 | Stale OPEN shift resolution | REVIEW REQUIRED | REVIEW REQUIRED | REVIEW REQUIRED | REVIEW REQUIRED | N/A | P1 |
| UX-01 | Desktop cashier/manager hierarchy | REVIEW REQUIRED | N/A | N/A | REVIEW REQUIRED | N/A | P2 |
| RESP-01 | Real 390px CSS viewport | BLOCKED | N/A | N/A | N/A | BLOCKED | P1 |
| A11Y-01 | Dialog keyboard/focus behavior | REVIEW REQUIRED | N/A | N/A | REVIEW REQUIRED | BLOCKED | P2 |
| TEST-01 | Dedicated server-action coverage | REVIEW REQUIRED | N/A | N/A | N/A | N/A | P2 |

## CRITICAL CONTROLS

### Cross-Cutoff Shift

- Tested: **YES — controlled source records + canonical calculator/code-path inspection**
- Shift ID: `634eb86d-a22f-4767-995f-881ce0400541`
- Shift start: `27 Aug 2026 01:30 MYT` → business date `2026-08-26`
- Shift end: `27 Aug 2026 02:30 MYT` → business date `2026-08-27`
- Cash payment: `27 Aug 2026 02:15 MYT`, RM50 → business date `2026-08-27`
- Shift-level movement: RM50
- `2026-08-26` Daily Closing live report cash: RM0
- `2026-08-27` Daily Closing live report cash: RM50
- Automatic close code chooses snapshot business date from `shift.startedAt` and sums the whole shift movement.
- Result: **FAIL**
- Financial reconciliation: **FAIL**
- Snapshot business date if the automatic path completes: `2026-08-26`
- P0 issue: **YES**

The whole RM50 shift movement would be frozen into the prior business date while its source transaction belongs to the following business date. This violates the requirement that another business date must not contaminate the frozen reconciliation.

### Open Shift vs Manual Daily Close

- Manual close attempted while OPEN shift existed: **YES**
- OPEN shift ID: `40f9fe99-8c3d-41a7-96b5-cda41014a9b6`
- Snapshot ID: `00c3f49a-540b-438d-bb54-120dac99eb24`
- Snapshot closed at: `28 Aug 2026 12:27 MYT`
- Snapshot stored Expected/Actual: RM0/RM0
- Frozen JSON itself recorded alert: `1 cashier shift is still open.`
- Post-freeze payment: RM10, active, linked to the still-OPEN shift
- Current shift expected after post-freeze payment: RM110
- Frozen snapshot remains RM0/RM0
- Behaviour: Owner confirmation succeeded; shift stayed OPEN; later payment succeeded.
- Frozen snapshot risk: **Confirmed incomplete branch-day record**
- Result: **FAIL / P0**

Evidence: [manual close with open shift](./evidence/closing-uat/p0-manual-close-with-open-shift.png)

### Permission Separation

- Cashier Start Shift: PASS when RUN_CLOSING is available and branch is resolved
- Cashier End Own Shift: PASS; query includes `cashierId = current user`
- Cashier Confirm Daily Closing: **REVIEW REQUIRED**
- Manager/Owner Confirm Daily Closing: PASS
- No-permission user: blocked by `requireBusinessUser("RUN_CLOSING")` / `assertStaffPermission("CLOSING")`
- Branch tampering: PASS; non-owner branch is taken from the session and owner branch must belong to the current business

The page hides the manual close control for staff, but the server action accepts any user with the general `CLOSING` permission. Therefore the UI implies an owner-only control while the server permission does not implement that separation. Cross-business or unauthorized-branch freeze was not found.

## SHIFT WORKFLOW

- Start Shift: PASS
- Opening float: exact RM50 stored in live scenario
- Shift-linked payments: RM20 CASH linked to correct business/branch/shift
- Cash refunds: calculator/tests PASS; full live refund fixture not run
- Drawer expenses: calculator/tests PASS; full live expense fixture not run
- Expected cash: RM70 for RM50 opening + RM20 cash
- Counted cash: RM70 accepted
- Difference: RM0
- Short/over note: non-zero difference requires trimmed non-empty note in End Shift path
- End Shift: PASS
- Double-close: atomic `updateMany(status=OPEN)`, Serializable transaction and snapshot uniqueness are present; no dedicated action test exists

Start validation gap: `openingFloat` has a minimum of zero but no server-side maximum or two-decimal refinement. Values with more than two decimals are silently rounded through cents conversion; extremely large input can reach the database layer.

## FINAL-SHIFT AUTO CLOSE

- Multiple open shifts: source path checks all OPEN shifts for the branch
- First close waits: PASS by code path; full two-cashier browser sequence not run
- Final close creates snapshot: PASS in live Local scenario
- Duplicate protection: PASS through existing snapshot check, financial operation key, Serializable transaction and DB unique constraint
- Snapshot correctness: PASS for a normal single-day shift

Live result:

- Opening float: RM50
- Cash collection: RM20
- Shift expected / counted: RM70 / RM70
- Daily expected net movement: RM20
- Daily actual net movement: RM20
- Difference: RM0

The exclusion of opening float from the Daily Closing snapshot is the specified semantic and is financially correct. The UI label `Actual cash` is nevertheless ambiguous because it represents actual **net cash movement**, not the RM70 physical drawer count.

Evidence: [final shift automatic close](./evidence/closing-uat/final-shift-auto-close.png)

## MANUAL DAILY CLOSE

- Authorisation: Owner PASS; ordinary `CLOSING` staff remains REVIEW REQUIRED
- Future date block: PASS
- Actual cash validation: finite, non-negative, maximum and 2-decimal validation PASS
- Difference note behaviour: note remains optional even for a large difference — REVIEW REQUIRED
- Idempotency: PASS through operation key and snapshot unique key
- Immutable warning: PASS; confirmation says the report cannot be edited, reopened or recalculated
- Open-shift control: FAIL; no server-side open-shift guard

The confirmation dialog is visually explicit, but it does not show the OPEN-shift blocker because none is enforced.

## FINANCIAL RECONCILIATION

- Sales: calculator baseline PASS
- Collections: PASS
- Cash: PASS for same-business-day flow; FAIL across cutoff
- Refunds: PASS in focused tests
- Payment methods: PASS in calculator tests for CASH, CARD, DUITNOW, EWALLET, BANK_TRANSFER, FOREIGN_CURRENCY and CRYPTO
- Drawer expenses: PASS in focused tests
- Expected cash: PASS for specified same-day formula
- Actual cash: PASS for specified same-day net-movement formula
- Difference: PASS for specified same-day formula
- Opening-float exclusion: PASS

Do not equate Net Sales, Net Collections, shift physical cash and Daily Closing net cash movement. The current normal-flow numbers respect that distinction; the visible `Actual cash` wording does not make it sufficiently clear.

## FROZEN SNAPSHOT

- UI: PASS for frozen headline/figures; REVIEW REQUIRED when live post-close activity is shown on the same page without a warning
- DB: PASS; snapshot row remained unchanged
- reportDataJson: PASS and versioned (`version = 2`)
- WhatsApp text: PASS; same frozen figures included
- History: PASS; reads snapshot
- Group Closing: PASS in integration test; reads frozen snapshots and current authorized group scope
- Live-data changes do not rewrite snapshot: PASS

After adding an isolated RM5 post-freeze payment, frozen report, History and WhatsApp text remained RM20. The live `Today's Shifts` and Activity sections changed to RM25. This is correct immutability but confusing presentation because frozen and live scopes are juxtaposed without a clear late-activity notice.

## OPERATIONAL REPORTS

### Salon

- Completed: PASS in calculator tests
- Cancelled: PASS in calculator tests
- Customers: PASS, including new/returning and distinct served counts
- Top Services: PASS; completed service items only, top-three aggregation

### Auto

- Completed: calculator path covered
- Cancelled: REVIEW REQUIRED
- Cancellation date semantics: cancelled work orders use `createdAt` because no canonical cancellation timestamp exists. A work order created earlier and cancelled today can appear in the creation-day close, not the cancellation-day close.

## WHATSAPP

- Automatic report: frozen text PASS; no actual provider delivery attempted
- Reminder: focused behavior test PASS
- Deduplication: PASS
- Retry: permission/reason path inspected; no provider retry sent
- Resend: permission/reason path inspected; no provider resend sent
- Snapshot unchanged: PASS by design; sends reference the frozen snapshot

## HISTORY / GROUP

- History: PASS
- Filters: branch + from/to date PASS in live browser
- Frozen values: PASS
- Pagination: rendered; multi-page fixture not created
- Group required/completed/missing: PASS in focused unit/integration tests
- Export if tested: CSV/XLSX/PDF focused tests PASS, including authorized scope and formula-injection protection

Evidence: [Closing history desktop](./evidence/closing-uat/closing-history-desktop.png)

## UI/UX — CASHIER

- Start Shift clarity: PASS
- Current Shift clarity: PASS
- Expected vs Counted clarity: PASS at shift level
- Difference UX: PASS for sign and proximity; full visual small/large short/over matrix not run
- End Shift CTA: PASS
- Page complexity: REVIEW REQUIRED
- Overall: REVIEW REQUIRED

The cashier route still exposes a long Owner Closing Summary, shift table and activity content around the core `Start → Count → Explain → End` task. The daily action is hidden from staff, which helps, but the page remains scroll-heavy.

## UI/UX — MANAGER

- Open shift visibility: PASS; `1 cashier shift is still open` is visible
- Branch status: PASS
- Daily Close readiness: **FAIL** because an open-shift alert does not disable/block confirmation
- Difference visibility: PASS
- Snapshot warning: PASS for immutability, FAIL for open-shift safety
- Overall: REVIEW REQUIRED

A manager can identify an open shift quickly, but the main action remains enabled and permits an unsafe freeze. The UI therefore communicates attention without enforcing the control.

## 390PX

- Start Shift: BLOCKED
- Current Shift: BLOCKED
- Counted cash: BLOCKED
- End Shift: BLOCKED
- Daily Close: BLOCKED
- History: BLOCKED
- Overflow: BLOCKED
- Tap targets: BLOCKED

The available in-app browser runtime did not provide a genuine viewport-resize/device-emulation capability. Per the UAT instruction, desktop screenshots or unit tests were not substituted for a real approximately 390px CSS viewport. This must be rerun after P0 remediation with an actual device or supported emulation surface.

## ACCESSIBILITY-LEVEL CHECK

- Native form labels and button semantics: mostly PASS
- Dialog `role="dialog"`, `aria-modal` and title association: PASS
- Escape key: REVIEW REQUIRED; no Escape handler
- Initial focus/focus trap/focus restoration: REVIEW REQUIRED; not implemented in the confirmation component
- Error association: REVIEW REQUIRED; messages are visually near forms but do not consistently use field-level `aria-describedby`
- Keyboard submit/cancel: basic buttons are keyboard reachable

## CORRECTION / EXCEPTION WORKFLOW

- Mistaken closing cash: frozen after submit; no edit/reopen
- Closed Shift correction available: NO
- Operational impact: supervisor can see difference/note but cannot annotate or revise the closed shift through a controlled successor record
- Recommendation: defer design until P0 controls are fixed; then define a controlled adjustment/revision workflow rather than mutating frozen history

Absence of reopen is not by itself a bug. The operational gap is that a realistic input mistake has no governed follow-up artifact.

## Top Findings

### P0

1. **Cross-cutoff shift cash is allocated by two incompatible boundaries.** Transaction reports use the transaction timestamp/cutoff, while automatic actual cash uses the entire shift selected by `startedAt`.
2. **Manual Daily Close succeeds with an OPEN shift.** The still-open shift can subsequently record transactions, leaving the branch snapshot incomplete forever.

### P1

1. Manual branch freeze is authorized by the broad `CLOSING` permission; server behavior does not match the owner-oriented UI.
2. Manual cash difference does not require an explanation.
3. Concurrent Start Shift has no DB unique constraint or in-transaction recheck; two near-simultaneous starts can pass the pre-query.
4. Stale OPEN shift has warning visibility but no supervisor resolution path and may keep final-shift detection from completing.

### P2

1. Shift opening/closing amount schemas do not both enforce two decimals and safe upper bounds.
2. Frozen summary and live post-close shift/activity values are shown together without a late-activity explanation.
3. Auto cancelled-work-order date uses `createdAt`, not cancellation time.
4. Cashier and manager information hierarchy remains dense.
5. Visible scope text says `00:00 to next day 00:00` although the configured cutoff is `02:00`.
6. `Actual cash` in Daily Closing means actual net cash movement, while the cashier physically counted a larger drawer total including float.
7. Confirmation dialog lacks Escape/focus management.

### P3

- None frozen in this UAT.

## Automated Tests

- Closing focused tests: **58 / 58 PASS**
- Integration: **5 / 5 PASS**
  - Group Closing frozen-snapshot/scope test
  - Financial idempotency, rollback and concurrency tests
- TypeScript: **PASS** (`pnpm exec tsc --noEmit`)
- ESLint: **PASS** for Closing, Daily Closing, WhatsApp and Group Closing scope
- Diff check: **PASS** (`git diff --check`)
- Action-level coverage gap: **CONFIRMED**

There is no dedicated test importing/exercising `startShiftAction`, `endShiftAction` or `closeDailySnapshotAction`. Existing tests strongly cover calculators, snapshot payloads, exports, group reads and generic financial idempotency, but do not make the P0 open-shift rule or cross-cutoff action behavior fail automatically.

The integration run emitted expected Prisma conflict/unique logs while stressing retries; the test process completed 5/5 PASS.

## MUST FIX

1. Define and enforce a transaction-safe cross-cutoff allocation model before automatic Daily Closing can freeze a spanning shift.
2. Block manual Daily Close when any relevant branch shift remains OPEN, enforced server-side in the same transaction as snapshot creation.
3. Add action-level regression tests for both P0 cases and duplicate/race behavior.

## SHOULD FIX

1. Separate branch-freeze permission from ordinary cashier shift permission, or explicitly approve/document the broad permission.
2. Require/record an explanation for material manual cash differences.
3. Add transactional/DB protection against concurrent duplicate OPEN shifts.
4. Provide governed stale-shift and closed-shift mistake handling.
5. Correct cutoff copy and clarify physical drawer cash versus Daily net cash movement.
6. Separate frozen values from live post-close activity and clearly label late activity.
7. Complete real 390px and keyboard/focus UAT.

## CAN DEFER

- Full shift correction/revision workflow after control design
- Long-term supervisory closing analytics
- Advanced audit visualization
- Provider-level WhatsApp handset delivery in this Closing UAT

## DO NOT BUILD YET

- Accounting close
- General Ledger
- Bank reconciliation
- Payroll finalization
- Mutable/reopenable frozen snapshots

## Files Changed During UAT

- `docs/TETAMU_POS_SHIFT_CLOSING_DAILY_CLOSING_FULL_UAT.md`
- `docs/evidence/closing-uat/p0-manual-close-with-open-shift.png`
- `docs/evidence/closing-uat/final-shift-auto-close.png`
- `docs/evidence/closing-uat/closing-history-desktop.png`

No Closing business code, schema, tests or deployment configuration was changed.

## Production

**NOT ACCESSED**

## FINAL RECOMMENDATION

Keep the current frozen-snapshot architecture and normal same-day formulas, but classify this release as **BLOCKED** until the two P0 controls are remediated and rerun through action-level, concurrency and real 390px UAT. Do not deploy Closing as Production Ready on the evidence available today.

**FREEZE THE EVIDENCE. STOP.**
