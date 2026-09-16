# HR/Payroll Canonical RC Source Ledger

This ledger bounds the selective replay from the preserved detached workspace into the clean-root RC. It does not approve every file classified `YES`; admission still depends on RED/GREEN tests, compile-time dependencies, and restricted-boundary review.

## Authority and provenance

- Canonical base: `71f4786c828239d4270d93afa9253e8400a8b6ad`.
- Detached source workspace: `/Users/innovdia/Documents/Codex/2026-09-04/wo-2/work/pcb-p3a` (read-only).
- Preserved reconciliation evidence: `HR_PAYROLL_RC_RECONCILIATION_REPORT.md`, `file-classification.csv`, `preservation/tracked-unstaged.patch`, and `preservation/untracked-inventory.csv`.
- Source hashes below are SHA-256 of the candidate file as preserved in the detached workspace. For `prisma/schema.prisma` and other tracked files, admission is hunk-level rather than whole-file.
- Exact Staff compatibility source is immutable Git commit `5f9b5b5f350d6ee3670f4d989b203776e6527544`, whose parent is the clean root. Its eight paths remain a separate bounded replay.

## Admitted-to-test candidate set

“Admitted-to-test” means a test or dependency may prove the file belongs in the RC; it is not automatic inclusion.

| Path | Source kind | Domain | Candidate SHA-256 | Admission reason |
|---|---|---|---|---|
| `prisma/schema.prisma` | partial tracked diff | schema | `f040834d094939d8d3f0364ec21febb1e011ca750842d29c0ffa65588629506a` | Only People classification fields and indexes |
| `prisma/migrations/20260915090000_people_workbench_account_classification/migration.sql` | untracked | schema | `15f6e9943b068ab2e8ff71a7231f2f0786ff0957aa2a3a1463e85c808caf134f` | Explicit HUMAN/SERVICE and test-account classification |
| `src/lib/team/people-status.ts` | tracked diff | people | `620538c30d13a5600b552483a6efc797215264815c9adfa847eca3123b304335` | Employment/readiness state |
| `src/lib/team/people-presentation.ts` | untracked | people | `0f262d797f7f1974b284ac302b2d4b9a7fb91bf445d71fd821d5a73b271bdebd` | Pure filtering, copy and safe-return behavior |
| `src/lib/team/people-directory-read.ts` | untracked | people | `7f86b16e2c8ee08bf4535421fee969cd1496037babc4dd663945e4312efac289` | Employee-only, scoped directory read |
| `src/lib/team/people-service.ts` | tracked diff | people | `3172e46a4dc63327e9459a727707033e41e8d41f88bc35bb5a7094a19d9996e6` | Scoped operations; conditional on dependency review |
| `src/components/people-directory.tsx` | untracked | people UI | `b20c85aaeedac1ae5853ac0062908f09492a7b1ec8801d6b0d14b98438760b3e` | Accessible employee directory |
| `src/components/people-directory.module.css` | untracked | people UI | `d0523a59b5132ac925881b8b163b67f31f4958972640aafb9ae423c214aa1e60` | Responsive directory layout |
| `tests/helpers/people-directory-render.ts` | untracked | people tests | `d364c84e418d0654293e364447f81bceda3a345166bf8ce89586bf3e2cf6e858` | Server-render helper |
| `tests/unit/people-directory-uiux.test.ts` | untracked | people tests | `f0952e8d07025d6b174ce8206a6dcc0207d69bf9b0d5be5934594755e3a16f0a` | Rendered UI behavior |
| `tests/unit/people-workbench-security.test.ts` | untracked | people tests | `3b62b1126590cfd5bdff3781681d8dd5eeff1425322a9bfe22d7e46db43b52ad` | Security and pure behavior |
| `tests/unit/team-read-permission.test.ts` | untracked | RBAC tests | `a628969b45802d3043fe3e3582c318f92a77cc10f225e90bd47c3858062978f2` | Role and route permission matrix |
| `src/lib/auth/staff-permissions.ts` | tracked diff | RBAC | `1f101ee9745737de957bfcde7604738f7036d2035e90522998705df1748ff62e` | Only People/Payroll route permission hunks |
| `src/lib/business-groups/capabilities.ts` | tracked diff | RBAC | `0d37da2bd9aec03031214da8f95e2aa42c60492e38c68be27f0c4eae585782d3` | Required to map `TEAM_READ` to directory read without mutation rights |
| `src/app/(business)/team/page.tsx` | tracked diff | people UI | `dbf824ac8c3e535b23d5dc5aa54320b01a977ac3797dbfd3df0993662ceae335` | Mounts the scoped directory and blocks read-only users from legacy admin panels |
| `src/lib/hr-calendar-month.ts` | untracked dependency override | people UI | `48a7ab394724d0ce98033faa90a9f542c22cf95b4354adc14cf4765a1fb3b94e` | Small pure UTC month formatter directly imported by admitted People presentation/UI; automated `NO` classification is overridden by the demonstrated module-not-found test failure |
| `src/components/staff-create-modal.tsx` | tracked diff | people UI | `5e159077ea426fa663938486095e10c9b68a84801a3d4e2b88f0a66479ea54eb` | Required for filter-preserving create/close navigation and employee terminology used by the admitted team page |
| `src/lib/attendance/effective-session.ts` | untracked | attendance | `03ea468a43b66c1ab0c624670ef982ee0edb30e16406b9aa17626c097963dd3f` | Effective corrected session selection |
| `src/lib/attendance/business-attendance-projection.ts` | untracked | attendance | `c81ba648875f9e61407de804ea406c486415b747d2fc1492a242863591ddb6fb` | Business attendance projection |
| `src/lib/attendance/review-presentation.ts` | untracked | attendance | `6dff12894a430e4651f81bf2a24d3b48d6dbce3a86a0ff0a97ae5f81e59c01c1` | Human review copy |
| `tests/unit/attendance-effective-session.test.ts` | untracked | attendance tests | `f066abd1726aac656fe72ee65a08b3d89a40cf8e033887dcdedc857bab9a16d0` | Behavioral session tests |
| `tests/unit/business-attendance-projection.test.ts` | untracked | attendance tests | `f42eb2d0a5ad9a8f4feb12cc567d6159b0aa57818ecb5cdad9cd27d8ddc0395a` | Behavioral projection tests |
| `src/lib/payroll/exception-center-access.ts` | untracked | payroll exceptions | `ba1ea498a87c8c57c2b99ca7f499ab4924f017fb444a1a5dc0fa1abba89e3524` | Capability projection |
| `src/lib/payroll/exception-center-types.ts` | untracked | payroll exceptions | `3946d855a425eda65a310325df397415aa5c4b998e02e2c221510c3270ce5ab7` | Safe DTO contract |
| `src/lib/payroll/exception-center-projection.ts` | untracked | payroll exceptions | `443c2b8ec88b52167ac40e7a96eef45cc2db70f97499ccc0a3d6d1ffeac93486` | Pure issue prioritization and filtering |
| `src/lib/payroll/exception-center-read.ts` | untracked | payroll exceptions | `e54d765355cf5381304530b2441b864d155c8e381dd6833e175c1dffaa81bd3d` | Bounded read-only aggregation; conditional |
| `src/lib/payroll/correction-context.ts` | untracked | payroll corrections | `244cd885155380a38fe1616a92e64b16fcba36b2913df59d45498ad2192df3f1` | Safe correction navigation context |
| `src/lib/payroll/stale-presentation.ts` | untracked | payroll corrections | `7c52af6e820c17a6195a2bb33775b7ec47a5a1aa983b6085c4d797803e2dd02c` | Stale snapshot/readiness presentation |
| `src/lib/payroll/leave-conflict-read.ts` | untracked | leave/payroll | `06f61a3e37343888993299b06e2125333bde12eb636485f438d50144d2248001` | Read-only conflict resolver |
| `tests/unit/payroll-exception-center.test.ts` | untracked | payroll tests | `1ec8c373ae6a16c4f14181d2af0758e2f35d72f48582f4f47054f91e75a6c619` | Behavioral projection and access tests |
| `tests/unit/payroll-stale-presentation.test.ts` | untracked | payroll tests | `1a4ea6e418cf33c905ef0592f13aa65049420f694ee20db6d16a415370b6fc26` | Pure stale/readiness behavior |
| `tests/unit/payroll-leave-conflict-resolver.test.ts` | untracked | leave/payroll tests | `11f74393539f3114425d2bb6989b05cd8dcf57233defc6215d36dced1f79e2c3` | Behavioral conflict and privacy tests |
| `src/app/(business)/team/payroll/exceptions/page.tsx` | untracked | payroll UI | `c32ce382db04fcd15f2ee1cf24796d090195f12b81352ebe721d8596673ef918` | Read-only exception list; conditional |
| `src/app/(business)/team/payroll/exceptions/[membershipId]/page.tsx` | untracked | payroll UI | `af33069c6bc16f8ad6586e9b5a25dd8bc370e1cb9c623117cd2a8e3d3bdd9ece` | Read-only employee exception detail |
| `src/app/(business)/team/payroll/exceptions/payroll-exceptions.module.css` | untracked | payroll UI | `3ccdc83181606bbfc833fc75d2b928be9c7c4ce208fe938313c33ea7256bcda6` | Responsive exception layout |
| `src/components/payroll-correction-context.tsx` | untracked | payroll UI | `1f36f61e01ea1d9ff0238574f1329c4161f9c783c2800637140dfa729841825c` | Context banner/navigation |
| `src/lib/payroll/company-work-pay.ts` | tracked diff | OT/Sabah | `fcdd0b3a6e2e31e59b855ab53461788f81cb955443a33bc833c92cc4a8745de7` | Company-configured work-pay calculation |
| `tests/unit/payroll-company-work-pay.test.ts` | tracked diff | OT/Sabah tests | `8778f1a08a51885263dc927bad61c09b154a3475bbcaaf51552be1be7e24fddd` | Behavioral rate and validation tests |

## Explicitly rejected candidates

| Path or exact family | Decision | Evidence/reason |
|---|---|---|
| `src/app/(business)/team/payroll/payments/page.tsx` | reject | Payment execution is outside this RC. |
| `src/app/(business)/team/payroll/payments/new/page.tsx` | reject | Payment creation is outside this RC. |
| `src/app/(business)/team/payroll/payments/[batchId]/page.tsx` | reject | Payment approval/execution is outside this RC. |
| `src/app/(business)/team/payroll/payments/payments.module.css` | reject | No admitted payment UI consumes it. |
| `src/app/(business)/team/payroll/statutory/export/route.ts` | reject | Government/statutory export boundary is restricted. |
| `src/lib/payroll/statutory-submission.ts` | reject | Real submission orchestration is restricted. |
| `src/lib/payroll/statutory-submission-readiness.ts` | reject | Coupled to excluded submission workflow. |
| `src/lib/payroll/submission-spec-registry.ts` | reject | Coupled to excluded submission specifications. |
| `src/lib/payroll/readiness-runtime.ts` | reject | Wraps canonical readiness with Testing-only statutory engineering rules; the admitted People read uses `src/lib/payroll/readiness.ts` directly instead. |
| `statutory/official/submission-specifications/perkeso-v2.1-layout.json` | reject | Unapproved official-export specification. |
| `statutory/official/submission-specifications/registry-phase2-initial.json` | reject | Unapproved official-export specification. |
| `statutory/official/submission-specifications/registry.json` | reject | Unapproved official-export specification. |
| `statutory/official/submission-specifications/sources/provenance.json` | reject | Unapproved official-export provenance. |
| `prisma/migrations/20260907160000_employee_pcb_profile_workflow/migration.sql` | reject | PCB workflow is not source-certified for this RC. |
| `prisma/migrations/20260908110000_statutory_testing_engineering_activation/migration.sql` | reject | Testing engineering activation must not become canonical runtime state. |
| `prisma/migrations/20260912160000_tp1_finalized_evidence_archive/migration.sql` | reject | Evidence archive/PCB scope is outside this RC. |
| `prisma/migrations/20260912190000_epf_authoritative_contribution_input/migration.sql` | reject | Regulatory input requires separate finance/legal approval. |
| `prisma/migrations/20260912193000_epf_employee_only_pcb_verification/migration.sql` | reject | PCB verification is not source-certified for this RC. |
| `src/lib/payroll/pcb-2026.ts; pcb-certification-identity.ts; pcb-declarations.ts; pcb-profile.ts` | reject | PCB V4/certification changes are outside the approved replay. |
| `scripts containing pcb, hasil, or statutory operations` | reject | Local evidence, certification, deployment, or government-bound scripts are not runtime inputs. |
| `work; .next; node_modules; screenshots; browser traces; generated reports` | reject | Generated/build/evidence copies are non-authoritative. |
| `credentials, dumps, environment files, database snapshots and absolute-machine-path artifacts` | reject | Sensitive or non-reproducible material. |
| `all remaining YES or REVIEW rows not listed above` | reject | Rejected by default: classification is not approval; dependency admission requires a ledger update. |

## Admission gates

1. A test is copied first and must fail for the missing or old behavior, not for a broken harness.
2. Only the smallest source set needed to make that behavior pass is admitted.
3. Every newly discovered dependency is added to this ledger with its preserved SHA-256 before copying.
4. Source-contract/string assertions supplement but never replace behavioral tests where a pure or integration boundary is available.
5. Any dependency on a rejected restricted boundary blocks that feature; it does not authorize expanding the RC.
