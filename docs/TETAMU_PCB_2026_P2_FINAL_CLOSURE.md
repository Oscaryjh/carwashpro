# TETAMU PCB 2026 P2 — FINAL CLOSURE

## 1. Executive Summary

PCB 2026 P2 Formula & Profile Certification is **READY**. Q1–Q5 are certified against a separate independent verifier with RM0.00 final and intermediate differences. Q5 was resumed only after written HASiL clarification resolved the housing-loan-interest allocation ambiguity. This closure is local and disposable; Testing business data and Production were not accessed.

## 2. Prior P2 Partial State

P2 previously remained **PARTIAL** because Q5 stated RM6,000 annual first-home housing-loan interest but did not state the claim-month allocation. Q1–Q4 were already certified. That historical decision remains retained in the earlier certification report and build/clarification closure rather than being rewritten.

## 3. HASiL Q5 Clarification

Written clarification was received on 28 August 2026 from NURSAIDATUL AIN BINTI MD ISA, HASiL:

> The loan interest relief should be claimed and
> proportionately allocated across 12 months
> (January - December 2026).

This resolves input timing only. It is not represented as an official expected PCB answer or software approval.

## 4. Evidence Provenance

- Official testing questions: `statutory/official/artifacts/hasil-mtd-testing-questions-2026.pdf`
- Official testing-question SHA-256: `d6523266b8b23daca956be0f61ec52879eab364736a9feb5668d7f039ae33517`
- Clarification record: `statutory/official/certifications/pcb-2026-p2/q5/hasil-clarification-resolution.json`
- Clarification SHA-256: `cecef469dd30e0abd6bc42d17254ab82ac03d476a486dde612ed1d0b5cd675cf`
- Fixture SHA-256: `a2846ca0adc8d5a16e871ecc1611432243ed0193d3ae3ed9619a29f9f6ef5b53`
- Q5 input digest: `dd9c42b5b943a1a3e027476193d1b72e4bda7653900551b7bcf33d33645dfdb8`
- Calculator source SHA-256: `d885da7ddd35795e679df0579d9274442e12d04fb7e5b3b12c34105a271d3487`
- Independent verifier source SHA-256: `3f5667d4aadab13fc9e1f147575dc91e5e8716e92d5ea2ec28e286d8bfa52d19`

## 5. Housing-Loan-Interest Allocation

The annual RM6,000 relief is represented as 600,000 integer sen and allocated as exactly 50,000 sen (RM500) for each month from January through December 2026. The 12-month sum is exactly 600,000 sen. Allocation digest: `2f360a17d5480176b5691eb32736a3ae1a27b6ad5ff20180701dbe083ba12868`. No lump sum, duplicate claim, missing month, front-loading or floating-point allocation exists.

## 6. January Tetamu Calculation

Tetamu PCB is **RM2,508.50**. Normal remuneration is RM18,000; current EPF input is RM1,980; current allowable deductions are RM2,320, including RM500 housing-loan interest. Chargeable income is RM200,680.07, annual tax is RM30,102.01, and the final five-sen-rounded PCB is RM2,508.50.

## 7. January Independent Calculation

The independently implemented verifier produces **RM2,508.50** from the same governed inputs. It does not import or invoke the Tetamu production calculator. Its projected EPF, total relief, chargeable income, annual tax, pre-round amount and final PCB independently match.

## 8. January Reconciliation

- Tetamu: **RM2,508.50**
- Independent: **RM2,508.50**
- Final difference: **RM0.00**
- Intermediate reconciliation: **PASS**

## 9. February Tetamu Calculation

Tetamu PCB is **RM2,487.80**. Prior gross is RM18,000, prior EPF is RM1,980 and prior PCB is RM2,508.50. Current allowable deductions are RM1,520, including RM500 housing-loan interest; accumulated allowable deductions are RM2,320. Residential CCTV is included, while business-premise CCTV is excluded. The pre-round result of RM2,487.77 rounds to RM2,487.80.

## 10. February Independent Calculation

The independent verifier produces **RM2,487.80** and independently reproduces the YTD inputs, total relief, chargeable income, annual tax, division and five-sen rounding. It remains source-independent from the Tetamu calculator.

## 11. February Reconciliation

- Tetamu: **RM2,487.80**
- Independent: **RM2,487.80**
- Final difference: **RM0.00**
- YTD/intermediate reconciliation: **PASS**

## 12. Full-Year/YTD Consistency

All 12 sequential Q5 months reconcile at RM0.00: January RM2,508.50; February RM2,487.80; March RM2,463.50; April RM2,449.80; May RM2,434.45; June RM2,421.15; July RM2,405.65; August RM2,387.05; September RM2,363.80; October RM2,332.80; November RM2,286.25; December RM2,193.25. Full-year PCB is RM28,734.00 in both engines. December accumulated allowable deductions are RM11,440, including exactly RM6,000 housing-loan interest. No duplicated or missing YTD relief was found.

## 13. Q1 Certification

**CERTIFIED**. The previously frozen Q1 results and input mapping remain unchanged. Production and independent results reconcile at RM0.00.

## 14. Q2 Certification

**CERTIFIED**. The previously frozen Q2 results and input mapping remain unchanged. Production and independent results reconcile at RM0.00.

## 15. Q3 Certification

**CERTIFIED**. The previously frozen Q3 results and input mapping remain unchanged. Production and independent results reconcile at RM0.00.

## 16. Q4 Certification

**CERTIFIED**. The previously frozen Q4 results and input mapping remain unchanged. Production and independent results reconcile at RM0.00.

## 17. Q5 Certification

**CERTIFIED**. The written clarification removes the only open Q5 ambiguity. January, February and the complete January–December YTD sequence reconcile at RM0.00. All other Q5 facts are preserved, including the January food-waste grinder, February residential CCTV, excluded business-premise CCTV, March parent medical expense, gym C6 cap and monthly internet subscription.

## 18. Formula Integrity

Formula Changed: **NO**. The resolution changes governed Q5 input allocation only. No Q5-specific branch, official artifact mutation, expected-answer hardcoding or production calculator override was introduced. The independent verifier remains structurally separate.

## 19. Certification Tests

- P2 certification tests: **16/16 PASS**
- P1/P1A plus P2 focused run: **44/44 PASS**
- Full PCB-focused unit run: **86/86 PASS**
- Relevant integration: **NOT REQUIRED** — no runtime integration, database or schema behavior changed for Q5 closure
- Main unit suite: **NOT REQUIRED** — change is isolated to governed fixtures, certification evidence, generator, independent verifier and documentation
- Build: **NOT REQUIRED** — no deployable runtime behavior changed
- Prisma: **NOT REQUIRED** — no schema or migration changed
- TypeScript: **PASS**
- ESLint: **PASS** with 0 errors and 3 pre-existing warnings
- `git diff --check`: **PASS**

## 20. Remaining Broader Limitations

The broader C-Suite path below the retained Table 4 band remains uncertified. It is outside the official Q1–Q5 certification scope and does not block P2 closure. Formal HASiL software approval remains pending. No certification result is represented as an official expected answer supplied by HASiL.

## 21. Final P2 Verdict

**PCB 2026 P2 → READY**

Q1–Q5 are certified, Q5 has no open ambiguity, the independent reconciliation difference is RM0.00, and formula integrity is preserved. HASiL submission: **NO**. HASiL approval: **PENDING**. Production touched: **NO**.

## 22. Next Phase

P3 may proceed after explicit authorization, using this P2 closure as its frozen input boundary. P3 has **not** been started in this task. No Testing or Production deployment, business-data mutation, statutory submission or payment was performed.
