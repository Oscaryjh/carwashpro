# TETAMU PCB 2026 P2 — Build Gate and Q5 Clarification Closure

## 1. Executive Summary

The local clean-build gate is closed. The port 3000 process was proven to be the Tetamu repository's Next.js development tree, stopped, and followed by successful Prisma generation and `pnpm build`. The minimum static gates also pass.

PCB 2026 P2 remains **PARTIAL**. Q1–Q4 remain certified at RM0.00 independent difference. Q5 remains blocked because its RM6,000 first-home housing-loan interest has no stated Form PCB/TP1 claim/approval month. No month was inferred and no Q5 result was frozen.

Production touched: **NO**. Formula changed: **NO**. HASiL email sent: **NO**.

## 2. Build Failure Root Cause

The earlier build failure was environmental, not a PCB source error. The local development supervisor was running Next.js from `C:\CodexTetamuP0`; its child process listened on port 3000 and held generated Prisma binaries on Windows. The repository build guard correctly refused concurrent build activity, and the DLL lock initially prevented clean Prisma regeneration.

After the Tetamu dev process tree was stopped, `pnpm exec prisma generate` and the canonical `pnpm build` both completed successfully. No source change was needed to make the build pass.

## 3. Port 3000 Process

Ownership was established from process command lines before termination:

- Supervisor PID 40988: `node scripts\dev-supervisor.mjs`, working tree `C:\CodexTetamuP0`.
- Next.js dev PID 40816: `C:\CodexTetamuP0\node_modules\next\dist\bin\next dev ...`.
- Port 3000 server PID 42532: Next.js `start-server`, child of the Tetamu dev process.

PostgreSQL, Railway tooling and unrelated workers were not intentionally stopped. Port 3000 was free before the clean build.

## 4. Clean Build Result

| Gate | Result | Evidence |
|---|---|---|
| Prisma Client generation | PASS | Prisma Client 6.19.3 generated successfully |
| Canonical build | PASS | `pnpm build` exit code 0 |
| Next.js compilation | PASS | Next.js 16.3.0 route build completed |

Clean Build: **PASS**.

## 5. Static Verification

| Check | Result | Notes |
|---|---|---|
| TypeScript | PASS | `pnpm exec tsc --noEmit`, exit code 0 |
| ESLint | PASS | 0 errors; 3 pre-existing warnings |
| Prisma validate | PASS | `prisma/schema.prisma` is valid; Prisma 7 configuration deprecation warning only |
| `git diff --check` | PASS | Exit code 0 |

No full unit or integration rerun was required because this closure changes only documentation and a clarification evidence record; PCB runtime source was not changed.

## 6. Q5 Official Ambiguity

Retained official evidence confirms:

- Question: Q5, Employee E.
- Tax year: year of assessment 2026.
- First-home SPA date: 10 May 2025.
- Purchase price: RM480,000.
- Housing-loan interest paid: RM6,000 for January–December 2026.
- Required Calculation Detail months in the official question pack's submission requirements: January and February 2026.

Source: `statutory/official/artifacts/hasil-mtd-testing-questions-2026.pdf`, submission requirements page 2 and Q5 page 7, SHA-256 `D6523266B8B23DACA956BE0F61EC52879EAB364736A9FEB5668D7F039AE33517`.

The question supplies an annual amount but no month in which Employee E submits the claim or the employer approves/processes it under Form PCB/TP1. Form PCB/TP1 has explicit deduction month/year and employer-agreed deduction month/year fields. The TP1 explanatory note states that an employee submits TP1 when wishing to claim deductions and rebates “dalam bulan berkenaan” (in the relevant month). Therefore the missing month changes the January/February YTD calculation sequence and is a certification blocker.

## 7. No-Assumption Decision

Tetamu will not choose January, February, March, spread the amount monthly, or apply any other default. The certification scenario keeps `months: []`, requires months `[1, 2]`, and remains fail-closed.

Q5 calculation status: **BLOCKED**.  
Assumption used: **NONE**.  
Formula changed: **NO**.

## 8. HASiL Clarification Draft

Prepared draft:

`docs/TETAMU_PCB_2026_Q5_HASIL_CLARIFICATION_EMAIL.md`

The draft asks only when the RM6,000 relief should first be included for January and February 2026 MTD/PCB calculations. It does not suggest a preferred answer. Codex did not send the email or contact HASiL.

## 9. Q5 Evidence Record

Machine-readable record:

`statutory/official/certifications/pcb-2026-p2/q5/hasil-clarification-request.json`

Issue ID: `PCB2026-Q5-TP1-HOUSING-INTEREST-CLAIM-MONTH`  
Status: `AWAITING_HASIL_CLARIFICATION`  
Current calculation status: `BLOCKED`  
Impact: January/February PCB cannot be frozen as certified results.  
Assumption used: `NONE`.

## 10. P2 Updated Status

| Question | Status |
|---|---|
| Q1 | CERTIFIED |
| Q2 | CERTIFIED |
| Q3 | CERTIFIED |
| Q4 | CERTIFIED |
| Q5 | BLOCKED — AWAITING HASiL CLARIFICATION |

P2 remains **PARTIAL**. The clean build closes the technical gate only; it does not supply the missing official input timing.

## 11. Exact Next Step

1. A human sends the prepared Q5 clarification email to HASiL.
2. Retain the written reply as governed evidence.
3. Encode only the clarified Q5 TP1 claim month.
4. Run the Q5 Tetamu calculation and independent verifier.
5. Reconcile every intermediate value and require final difference RM0.00.
6. Upgrade P2 only if Q5 and all remaining gates pass.

Do not start P3, generate EA or PCB 2(II), generate final PDFs, or submit a HASiL package before written clarification is received.

## 12. Final Verdict

**PARTIAL — AWAITING HASiL Q5 CLARIFICATION**

Build: **PASS**.  
Q1–Q4: **CERTIFIED**.  
Q5: **BLOCKED**.  
Production touched: **NO**.  
HASiL email sent: **NO**.
