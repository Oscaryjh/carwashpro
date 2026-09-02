# TETAMU PCB 2026 P2 — Formula & Profile Certification

## 1. Executive Summary

PCB 2026 P2 is **PARTIAL**. Tetamu calculator `TETAMU_PCB_2026_1.2.0` and the certification-only verifier `HASIL_2026_P2_INDEPENDENT_1.0.0` independently reconcile Q1–Q4 to RM0.00 at every calculated month and intermediate stage. Q5 is deliberately blocked: the official question gives RM6,000 annual first-home interest but does not identify the TP1 claim month, so January and February cannot be frozen without inventing a fact.

This certification does not mean HASiL approval and does not make the calculator Production Ready. No Testing or Production data, deployment, payment, statutory submission, EA, PCB 2(II), Calculation Detail PDF, or final CP39 package was created.

## 2. Scope

The work certifies calculation correctness, governed profile inputs, effective-dated participation, integer-sen safety, intermediate traces, official rounding, previous-employment/YTD handling, and Q1–Q5 scenario representation. Runtime calculation remains in `src/lib/payroll/pcb-2026.ts`; independent verification lives outside production runtime under `tests/certification/` and does not import `calculatePcb2026` or production formula helpers.

## 3. Official Sources

Only retained official evidence was normative:

- Computerised Calculation Specification 2026, 52 pages, SHA-256 `a1618051c858393d92d868c9975c183309d3d07e48f0e4f0cdef589f45f5800c`.
- HASiL Testing Questions 2026, 7 pages, SHA-256 `d6523266b8b23daca956be0f61ec52879eab364736a9feb5668d7f039ae33517`.
- PCB/TP1 1/2026, SHA-256 `28f84d9a5ce10e793885101f1df2a42f47a3952befab773687d36b85eaeb266e`.
- PCB/TP3 1/2026, SHA-256 `c00c80f0089a975e364a1374763256e5fd856612af80e3754ae173716559901b`.
- TP1 explanatory notes 2026, SHA-256 `1c6ca6778ea488c47b1fc87848e3abc9613e6d891096fe4f58cb6a1dcd07e3a6`.
- TP3 explanatory notes 2026, SHA-256 `9fb864732846e503c1560192200ff9bbd03d2f6fb54ac3120703fe8d8a1f9099`.

Official bytes and hashes did not drift. Q1/Q3/Q5 fixture corrections were proven transcription corrections against the retained question PDF; they did not alter official evidence.

## 4. Formula Integrity

The resident, non-resident, normal, additional-remuneration, EPF, zakat/levy, threshold and rounding formula results were not changed. P2 expanded trace integrity and clamped the displayed chargeable-income trace to the same non-negative `P` already used by the tax table. Calculator version is `TETAMU_PCB_2026_1.2.0`, source SHA-256 `d885da7ddd35795e679df0579d9274442e12d04fb7e5b3b12c34105a271d3487`.

Formula Changed: **NO**. No calculation line was changed after mismatch because no independently proven formula mismatch was found in the certified scope.

## 5. Independent Verification Method

`tests/certification/pcb-2026-independent-verifier.ts` independently implements the official equations in integer sen, with explicit annual projection, table selection, tax, rebate, zakat/levy, threshold, truncation and five-sen rounding stages. It does not import or call the production calculator. Its version is `HASIL_2026_P2_INDEPENDENT_1.0.0`, source SHA-256 `6165a22cb9bc3cf31d3ba7fb945b4bfc14a18c368127338e51ffe102df56f5be`.

The production and independent paths receive the same frozen, canonical facts, but calculate separately. Machine-readable reconciliations compare inputs, intermediate traces and final cents rather than deriving expected values from production output.

## 6. Rounding Certification

PASS. The trace records raw numerator/divisor, truncated sen, pre-zakat threshold result, upward five-sen rounding and final post-zakat/levy result. Tests cover exact 0/5 sen, 1–4 sen to 5, 6–9 sen to the next 10, pre-zakat PCB below RM10, a valid post-zakat result below RM10, and additional-remuneration PCB below RM10.

Money remains integer sen with safe-integer validation. No monetary result is stored as binary floating point.

## 7. Normal Remuneration

PASS for the certified resident paths. Independent tests cover zero/negative intermediates, RM10 minimum-MTD behavior, bracket boundaries, categories, spouse/children, disability arithmetic, EPF, zakat, TP1/TP3 inputs, previous employment and YTD.

## 8. Additional Remuneration

PASS. The independent path certifies projected normal remuneration, annual tax basis, tax difference, current normal plus additional pay, additional EPF allocation, prior YTD additional remuneration, threshold and rounding. Director fees not paid monthly and non-monthly commission are source-backed additional remuneration. No question-specific production branch was added.

## 9. Resident

PASS for `RESIDENT_STANDARD`, including previous employer/current employer, family reliefs, TP1, TP3, zakat, EPF and additional remuneration.

## 10. Non-Resident

PASS for the official 30% remuneration path. Resident reliefs are excluded, exempt remuneration is not added, rounding is certified, and effective-dated profile/participation records select the applicable month without mutating historical state.

## 11. C-Suite

PARTIAL. Q1's approved C-Suite 15% path, June effective date, previous-employer ledger, reliefs, allowance facts and rebates reconcile for every current-employer month. The broader low-income edge outside the retained Q1 facts is not declared generally certified because the retained Table 4 wording does not provide a second, unambiguous C-Suite rule below its stated band.

## 12. REP

PASS for Q3's September-effective Returning Expert Programme path. The 15% rate, RM2,000 annual BIK, remaining-month allocation, EPF, family facts, deductions, zakat and rebate stages reconcile independently.

## 13. Knowledge Worker

PARTIAL. The generic 15% Knowledge Worker formula and provenance model pass. Q5 cannot be finalized because the official question omits the month of the annual first-home-interest TP1 claim; the verifier refuses to manufacture that timing.

## 14. Director Fee

PASS. Specification pages 10–13 classify remuneration not paid monthly, including director fees, under additional remuneration. Q2 quarterly RM400,000 payments in March, June, September and December use that treatment and reconcile independently.

## 15. Commission

PASS for classification behavior: monthly recurring commission follows normal remuneration, irregular/non-monthly commission follows additional remuneration, and unknown frequency fails closed. No live Commission transaction was run.

## 16. Arrears

PASS. Governed classification preserves original earning nature, original earning period and payment period. Normal and additional origins are supported; unknown origin remains blocked.

## 17. Allowances

PASS. Taxable normal and additional allowances follow their governed treatments; exempt allowances retain evidence with zero PCB remuneration; unknown treatment blocks. Exempt evidence remains available for later statutory artifacts.

## 18. BIK

PASS. Annual BIK is allocated from its effective month over remaining working months with the specified whole-ringgit behavior, included only in PCB remuneration, and excluded from cash salary/payroll wage base/cash payslip gross. Q3 uses the official RM2,000 annual household-servant BIK.

## 19. VOLA

PASS. Q4 applies RM1,000 for August–October and RM1,500 for November–December by effective date. VOLA enters PCB remuneration but not cash salary or payslip gross, and is frozen in historical evidence.

## 20. Exempt Benefits

PASS. Exempt allowances, perquisites and benefits retain source evidence, contribute zero taxable PCB remuneration, do not enter cash gross, and remain available for later EA/output work.

## 21. EPF Interaction

PASS in the certified scope. Tests distinguish qualifying current normal/additional EPF, no EPF, November commencement, voluntary TP1 EPF and the annual PCB EPF cap. Q2 voluntary EPF remains a governed TP1 declaration rather than being silently copied from statutory EPF. Q4 proves EPF OFF through October and ON from November.

## 22. Zakat

PASS. Prior-employer zakat, accumulated/current zakat, self-paid TP1 zakat and C4(ii) religious-travel levy remain distinct. C4(ii) does not merge into zakat, and self-paid TP1 zakat is not labelled as payroll-deducted zakat.

## 23. TP1

PARTIAL. Supported categories are limit-capped and reviewed declarations are calculation inputs, not automatic legal-eligibility decisions. Q1–Q4 supported deductions reconcile. Q5 first-home interest is supported structurally but needs human/HASiL clarification of claim-month timing before January/February can be certified.

## 24. TP3

PASS for C1, C2, C3, C4(i), C4(ii), C5, D1–D17 and previous-employment period handling. C2 is not made taxable, C4(ii) remains distinct, and prior-employer facts enter the proper YTD projection without duplication.

## 25. Child/Spouse

PASS for arithmetic covering employed/not-employed spouse, under-18, 18+, higher education, disabled, disabled plus higher education, full/half claims and adopted-child facts where arithmetic is identical. Relationship legality remains a governed reviewed fact, not an engine inference.

## 26. YTD Ledger

PASS. Finalized prior months and TP3 prior-employer facts combine without duplicate counting. Historical snapshots remain immutable when a live profile/declaration revision changes; the next valid month uses the new revision and source digest.

## 27. Q1 Certification

Status: **CERTIFIED**. Source page 3. Required months reverified: July, October and December. Sequential current-employer months July–December reconcile with independent PCB of RM2,112.50, RM2,097.50, RM2,078.75, RM1,949.75, RM1,927.25 and RM1,762.25. Every monthly and intermediate difference is RM0.00.

## 28. Q2 Certification

Status: **CERTIFIED**. Source page 4. Required months reverified: March and September (with the quarterly sequence maintained through June and December). Independent PCB is RM15,985.00, RM34,927.50, RM36,662.50 and RM36,750.00 respectively. Every difference is RM0.00.

## 29. Q3 Certification

Status: **CERTIFIED**. Source page 5. Required months reverified: September and November. September–December independent PCB is RM960.20, RM923.80, RM869.20 and RM727.00. Every difference is RM0.00.

## 30. Q4 Certification

Status: **CERTIFIED**. Source page 6. Required months reverified: August, October, November and December. August–December independent PCB is RM3,300.00, RM3,300.00, RM3,300.00, RM0.00 and RM0.00. Every difference is RM0.00.

## 31. Q5 Certification

Status: **BLOCKED BY OFFICIAL INTERPRETATION**. Source page 7. Required months are January and February. No Tetamu or independent result is frozen. The official pack gives RM6,000 annual first-home housing-loan interest but no TP1 claim month; applying it in January, February, spread monthly, or later would produce different YTD outcomes. Human/HASiL clarification is required.

## 32. Formula Changes

Formula Changed: **NO**. P2 added explicit trace fields and corrected trace representation only. It corrected source transcriptions in certification fixtures: Q1 sports evidence is RM1,350 but governed TP1 C6 input is capped at RM1,000; Q3 life insurance is RM2,200 and domestic-tourism admission is RM220; Q5 parent medical is RM800. None changed official bytes or introduced a question-specific runtime rule.

## 33. Boundary Tests

PASS for resident bracket boundaries, zero/negative chargeable income, RM10 threshold, five-sen boundaries, relief maximum application, qualifying EPF allocation/cap, special-regime paths, safe integer bounds and invalid negative money. Certification-only tests: 14/14. PCB focused suite: 38/38.

## 34. Regression

- Main unit: 1208/1208 PASS.
- Disposable integration: 187/187 PASS, plus Staff Attendance route 1/1 PASS.
- TypeScript: PASS.
- ESLint: PASS with 0 errors and 3 pre-existing warnings.
- Prisma schema: PASS.
- Fresh disposable migrations: PASS.
- `git diff --check`: PASS.
- Next.js build: not completed because the repository build guard correctly refused to build while the user's local server on port 3000 was active; the initial Prisma generate also encountered the same running process's Windows DLL lock. The server was not stopped automatically. This is recorded as a regression gate gap, not a formula mismatch.

The disposable suite covers payroll finalization, frozen statutory snapshots, payslip and database-backed CP39 paths. EPF, SOCSO, EIS, LINDUNG24, Attendance, OT, Leave, Claims, Timesheet and Payroll were not rewritten.

## 35. Open Ambiguities

1. Q5 TP1 claim-month timing for RM6,000 first-home interest requires human/HASiL clarification.
2. The C-Suite path is certified for retained Q1 facts, not generalized below the explicitly stated Table 4 band.

No locally calculated value is described as an official expected answer.

## 36. Remaining Gaps

- Resolve Q5 claim-month timing and rerun January/February sequential reconciliation.
- Complete a clean Next.js build after the local development server is intentionally stopped.
- Formal HASiL software verification remains pending.
- P3 official-question artifacts, EA, PCB 2(II), Calculation Detail PDF and final CP39 package have not started.

## 37. Final Verdict

**PCB 2026 P2 → PARTIAL**

Q1–Q4 are independently certified at RM0.00 difference. Q5 is safely blocked instead of receiving a fabricated answer. P3 Official Question Artifact Preparation must not begin until the Q5 interpretation and clean build gate are closed.

Machine-readable evidence is under `statutory/official/certifications/pcb-2026-p2/`, including per-question reconciliations, combined reconciliation and manifest. Production touched: NO. HASiL approval: PENDING.

## Addendum — Build Gate Closure and Q5 Clarification Preparation (27 August 2026)

This addendum closes the technical build gap recorded in section 34 without rewriting the earlier execution history.

- Clean Build: **PASS**. The Tetamu Next.js development supervisor and its port 3000 child were identified from their repository-rooted command lines and stopped. `pnpm build` then completed successfully after `prisma generate`.
- TypeScript: **PASS** (`pnpm exec tsc --noEmit`).
- ESLint: **PASS** with 0 errors and the same 3 pre-existing warnings.
- Prisma schema: **PASS** (`pnpm exec prisma validate`).
- `git diff --check`: **PASS**.
- Q1: **CERTIFIED**.
- Q2: **CERTIFIED**.
- Q3: **CERTIFIED**.
- Q4: **CERTIFIED**.
- Q5: **BLOCKED — AWAITING HASiL CLARIFICATION**. The retained question gives SPA date 10 May 2025, purchase price RM480,000, YA 2026 and annual housing-loan interest RM6,000, but it does not state the Form PCB/TP1 claim/approval month. The retained TP1 form and explanatory notes make that month material. No month has been assumed.
- Clarification draft: `docs/TETAMU_PCB_2026_Q5_HASIL_CLARIFICATION_EMAIL.md`.
- Machine-readable issue record: `statutory/official/certifications/pcb-2026-p2/q5/hasil-clarification-request.json`.
- P2: **PARTIAL**. A clean build does not upgrade P2 while Q5 remains unresolved.

No formula, expected result, official artifact, Testing data or Production data was changed. No email was sent. The next permitted step is for a human to send the prepared clarification request and retain HASiL's written response as evidence.
