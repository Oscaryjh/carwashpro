# TETAMU FULL SYSTEM DOMAIN CONFLICT INVENTORY

Date: 2 September 2026  
Candidate: `codex/tetamu-full-system-reconciliation-20260902`  
Selected base: `codex/full-system-windows-snapshot-20260902` at `587623f33bfec0a1811d74471ceb22ed9d35988f`

## Counting method

The inventory was built from `git log`, `git merge-base`, `git rev-list --left-right --count`, and path-level diffs between the selected base and:

- `origin/main` at `86ae5f4c00b63582e882ef4690d9b7b0587b0294`;
- `release/staff-v2-payslip-final-polish-20260902` at `bcb00b0b69cb568b59b4872a352aee7bde89b302`;
- `codex/pcb-p3-local-snapshot-20260902` at `9f27748bb200707627c88ccf3a6400188d2bad75`;
- the final Phase 1 candidate.

“Changed files” is the number of unique paths changed by at least one compared source relative to the selected base, assigned to one primary domain by path/function. A zero means there is no direct branch delta in that domain; it does not mean the base lacks the feature. Shared statutory files are counted under PCB or Payroll rather than duplicated under EPF/SOCSO/EIS.

An overlapping pathname is not the only form of conflict. A consumer and its provider can change in different files while still creating a business-contract conflict. Those semantic conflicts are included below.

## Lineage evidence

| Source | Merge base with selected base | Left / right commits | Conclusion |
| --- | --- | ---: | --- |
| `origin/main` | `86ae5f4` | 143 / 0 | Fully ancestral; no unique newer functionality |
| Staff V2 final | `6a5db24` | 9 / 98 | Large divergent Staff/auth/attendance/pay delta; selective integration required |
| PCB P3 | `9037025` | 4 / 1 | Narrow divergent certification package; selective integration required |

The full-system snapshot was selected because it contains the widest working full-product tree and all 212 pre-existing migrations, while `main` is an old ancestor and the two specialist branches are materially narrower. Starting from Staff or PCB would have created substantially greater silent-loss risk.

## Domain inventory

| Domain | Sources modifying it | Changed files | Conflicting files / contracts | Unique functionality and canonical choice | Risk |
| --- | --- | ---: | --- | --- | --- |
| CORE / SHARED | Staff, candidate | 7 | `package.json`, lockfiles, `next.config.mjs`, `src/middleware.ts` | Keep broad base runtime; add reviewed Staff PWA/build compatibility and preserve existing middleware behavior | MEDIUM |
| DATABASE / PRISMA | Staff, candidate | 6 | `prisma/schema.prisma`, OTP migration ledger | Base’s complete 212-migration schema plus Staff’s additive OTP hardening migration is canonical | HIGH |
| AUTH / RBAC | Staff, candidate | 8 | employee auth response/session and capability gates | Preserve base business auth; integrate Staff fail-closed session and capability-based behavior | HIGH |
| BUSINESS / BRANCH | Staff, candidate | 9 | workplace selection and branch-scoped read models | Preserve canonical business/branch IDs and Staff workplace UX without client-controlled scope | MEDIUM |
| CRM | Base only | 0 | None | Full-system CRM remains canonical and unchanged | LOW |
| POS | Staff/base semantic recovery, candidate | 3 | invoice monetary collection projection | Preserve POS; restore gross monetary, monetary-refund and net-collected contract | MEDIUM |
| APPOINTMENTS | Staff, candidate | 7 | Staff appointment entry/loading/error surfaces | Preserve canonical appointment services and compact Staff access | MEDIUM |
| PEOPLE | Staff, candidate | 8 | employee edit capability and membership identity | Permit the established team or attendance capability without weakening tenant scope | HIGH |
| ROSTER | Staff, candidate | 11 | schedule read model and Staff roster V2 | Preserve roster publication rules; use Staff V2 presentation/read model | HIGH |
| ATTENDANCE | Staff, candidate | 31 | resolution queue, exception queue, history grouping, P2 projection | Canonical Attendance records/workflows remain authoritative; Staff receives unified projections and day grouping | HIGH |
| TIMESHEET | Staff, candidate | 18 | V2 read model, lock/finalization handling | Preserve canonical Attendance-to-Timesheet projection and fail closed on locked/approved periods | HIGH |
| LEAVE | Staff, candidate | 9 | Staff request presentation | Preserve canonical Leave records/actions; integrate V2 UI only | MEDIUM |
| CLAIMS | Staff, candidate | 7 | claim presentation/read model | Preserve canonical Claim workflow; integrate Staff V2 status/presentation | MEDIUM |
| APPROVALS | Staff, candidate | 13 | approval counts, history, attendance and OT review adapters | One capability-scoped Approval Center over canonical domain records; no second approval model | HIGH |
| COMMISSION | Staff, candidate | 9 | commission V2 reader/UI | Canonical commission statements remain source; V2 is read-only projection | MEDIUM |
| PAYROLL | Staff, PCB, candidate | 13 | recurring-pay clock, export/publication/statutory boundaries | Preserve full payroll engine; add deterministic fixtures and reviewed Staff/PCB output contracts | HIGH |
| PCB | Staff, PCB P3, candidate | 93 | certification generator, identities, statutory submission | Preserve P3 certification package and existing production safeguards; external official evidence remains explicit | HIGH |
| EPF | Base/shared statutory files | 0 direct | Shared payroll/statutory calculation contracts | Base implementation retained; payslip V2 renders canonical values including valid zeroes | MEDIUM |
| SOCSO | Base/shared statutory files | 0 direct | Shared payroll/statutory calculation contracts | Base implementation retained; no separate state introduced | MEDIUM |
| EIS | Base/shared statutory files | 0 direct | Shared payroll/statutory calculation contracts | Base implementation retained; no separate state introduced | MEDIUM |
| PAYSLIP | Staff, candidate | 13 | `export.ts`, publication, V2 PDF, draft/final semantics | Use V2 PDF and protected publication while retaining fail-closed PCB and synthetic-evidence guards | HIGH |
| REPORTS | Staff/base recovery, candidate | 3 | analytics worker/report support | Preserve base reports; keep recovered worker semantics | MEDIUM |
| EXPENSES | Base only; Claims classified separately | 0 direct | None | Full-system expense functionality retained unchanged | LOW |
| INVENTORY | Base only | 0 | None | Full-system inventory retained unchanged | LOW |
| SUPPLIERS | Base only | 0 | None | Full-system supplier/AP functionality retained unchanged | LOW |
| WHATSAPP | Base only | 0 | None in source reconciliation | Existing connector retained; prior remote receipt-forward observation remains a later operational check | MEDIUM |
| SMS123 / OTP | Staff, candidate | 9 | OTP challenge lifecycle/provider result and schema hardening | Durable challenge-first lifecycle plus additive provider-message evidence; no duplicate send path | HIGH |
| WORKERS | Base/recovered shared worker | 0 direct | analytics worker is classified under Reports/Core | Existing worker entrypoints retained; no worker source deletion | MEDIUM |
| CRON / JOBS | Base only | 0 | None | Existing jobs and schedules retained unchanged | MEDIUM |
| STAFF APP | Staff, candidate | 67 | shell, routes, V2 components, CSS, PWA, error/loading states | Staff 3000 V2 is canonical; no 3100 runner reintroduced | HIGH |
| OTHER | Staff, PCB, candidate | 20 | reports, fixtures, browser/certification artifacts | Retain evidence and focused tooling where it does not override runtime contracts | MEDIUM |

## Material semantic conflict clusters

### Invoice settlement projection

- Consumers in `src/app/(business)/invoices/[invoiceId]/page.tsx` and `src/app/(business)/invoices/page.tsx` expected monetary-only collection fields.
- The snapshot helper in `src/lib/invoices/payment-summary.ts` returned only older totals.
- Canonical resolution: restore the companion monetary fields without changing invoice settlement ownership.

### Staff Attendance and approval projection

- Staff consumers expected `loadPendingAttendanceExceptionQueue` and self-exclusion parameters that the snapshot read service did not expose.
- Staff V2 also added P2 corrections and employee lifecycle history to the same Approval Center projection.
- Canonical resolution: retain AttendanceException, AttendanceResolutionCase, and P2 records as owners; enrich the read model and route actions, with tenant/branch/self-review/timesheet guards unchanged.

### Payroll, PCB and payslip

- Full-system contained the broad payroll engine and production synthetic-evidence guard.
- Staff contained the final V2 PDF, protected publication UX, draft/final wording, and OTP-hardening migration.
- PCB P3 contained certification identities/artifacts and statutory submission refinements.
- Canonical resolution: compose these layers selectively. No certification artifact is allowed to override runtime payroll calculations, and unavailable PCB stays pending rather than becoming zero.

### OTP lifecycle

- The Staff line carried a newer challenge/provider delivery lifecycle and one forward migration.
- Canonical resolution: retain durable challenge creation before external SMS side effects and add only nullable provider-message evidence. No destructive migration or duplicate workflow was introduced.

### Test contracts

- Two integration tests still assumed one flat Attendance-history item per session.
- Canonical Staff V2 contract groups sessions by work date and branch.
- Canonical resolution: assert one canonical day, exact nested session count/identity, and multi-session flag. Assertions became more specific; they were not weakened.

## Preservation conclusion

- Candidate changes versus selected base: **266 files** (`136` added, `130` modified).
- Deleted source files (`*.ts`, `*.tsx`, `*.js`, `*.mjs`, `*.cjs`) versus selected base: **0**.
- Blanket `ours`/`theirs` conflict resolution: **not used**.
- Canonical business models duplicated: **no**.
- Staff 3100 runtime reintroduced: **no**.
- Domain reconciliation status: **READY FOR FINAL CANONICAL AUDIT**.

