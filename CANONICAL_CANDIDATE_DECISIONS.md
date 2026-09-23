# Testing canonical candidate — source decisions

Branch: `codex/testing-canonical-20260923`. Base: `0c2b8d13aac620368e8d2d1c191c8e59efee9169`. A decision means selected input, **not yet integrated or passing**. The machine-readable companion is `canonical-candidate-sources.json`; `node scripts/verify-canonical-source-ledger.mjs` checks source refs and duplicate SQL claims. The immutable 222-SQL inventory remains `CANONICAL_MIGRATION_MANIFEST_222.md`.

## Local 8 unique commits

| Commit | Distinct files/behavior | Decision | Integration gate |
|---|---|---|---|
| `e2d86adf8e1164aef0cc0f34864684af27694546` | UAT seed/audit/verify, shared guard, tests, package scripts | `MERGE_SEMANTICALLY` | Keep synthetic-only tooling; verify no live Testing data reset. |
| `7b63031ffe6a0cb927ed6a1ad754a68212967e8e` | bounded branch state in UAT fixture | `APPLY` as part of final UAT module | Unit test for branch state. |
| `b853324f697e69f71ca8c55590cad2de508154c1` | core implicit UAT scope | `APPLY` as part of final UAT module | Core UAT route remains available. |
| `fe8d77d633d233eae1426910c774535024c195f1` | E164 membership phone fixture | `MERGE_SEMANTICALLY` | OTP still intercept-only; never send to fixture number. |
| `ed69a2de2ad8cf1036e0c2de79099c47df829925` | geofence fixture alignment | `APPLY` as part of final UAT module | Attendance fixture test. |
| `69bb46368343f08859096526f78cee0e4d811684` | compensation provenance fixture | `APPLY` as part of final UAT module | Payroll provenance test. |
| `663896420eaa983c2d1e6beb81c7f126e2e80744` | canonical payroll component key | `APPLY` as part of final UAT module | Component-key test. |
| `c5a84d04932d4371fccd40a66bf8dd7c1fadb4f9` | final audit/repair/verify UAT tooling | `MERGE_SEMANTICALLY` | Preserve guarded read-only audit; any repair must target disposable synthetic data. |

## Testing 5 unique commits

| Commit | Distinct files/behavior | Decision | Integration gate |
|---|---|---|---|
| `fc88f44c4a0329c4bb663c0a18dd4faae1d32da1` | package browserslist security dependency | `APPLY` | lockfile/package scripts coherent; unit/build pass. |
| `1702e1f279ea62727abc7e5b436ea9af00c793c6` | sanitized Postgres startup diagnostics | `APPLY` | No connection secret in logs. |
| `9c5b7e5a6cea1cea6d5061a29e682beb6ff0880b` | portable restore helper/test | `APPLY` | restore verification test. |
| `71f4786c828239d4270d93afa9253e8400a8b6ad` | database-ops package helper | `APPLY` | Docker database-ops test/build. |
| `5f9b5b5f350d6ee3670f4d989b203776e6527544` | Staff PWA session/date picker, `me` route, tests | `MERGE_SEMANTICALLY` | No sliding expiry; disabled/revoked/logout/biz switch contract first. UI fix separately retained. |

## Additional feature lines

| Source | Decision | Integration gate |
|---|---|---|
| People `553156352a3c6b5d47eddb776d9da82f3236b65b` + `f7917672da656994c2bdd82f93227a140e3c4a36` | `MERGE_SEMANTICALLY` | HUMAN/SERVICE and `TEAM_READ`, with server-side business/branch/own-data; no implied payroll/bank rights. |
| HR `aa86e91a1438d94d5ed1cc75ba8c5b0d3a7da4a3` + `954e1b32efc2417b55d571b074a142c1a7f49803` | `MERGE_SEMANTICALLY` | Internal synthetic payroll calculation/save and auth/approval tests; external output blocked. |
| PCB `0170cdc2ed1450e23f64bce82e258aa69406e5fc` through `eed66c60a251aa9a77e2bd3077a65cc85df58fdb` | `MERGE_SEMANTICALLY` | Immutable/idempotent internal ledger; RC-r2 uncommitted files excluded; official submission/export denied. |
| Payment/official hard deny `b2a4bc1cb737fa776065d9211a2133c050d65af3` | `MERGE_SEMANTICALLY` | Keep provider/route hard-deny without importing entire global pilot freeze that blocks permitted Testing internal saves. |
| RC staging intercept `0d0bbda3567540ac65bb666899be6969c50930ee` | `REIMPLEMENT` | Explicit Testing-only identity and synthetic OTP; no Production policy copy. |
| Image security `c48fb152631646da4a7f98dca16e5f8fbc93c40a` | `APPLY` | Preserve image security patch, build/test. |
| Performance `5f2662946275bd0a8832705bbd2d3c757044d6e5` | `MERGE_SEMANTICALLY` | Read/write Auth/RBAC; 3 Performance SQL already in 222, never append again. |
| Later pilot authorization/appointments/closing `d0913e49b6d45168662edf84eedc3ee28e95c0e0`, `41852774d639775cd9f95526367db7b29b9456dd`, `3cb78acab2e690fb06b0cd53add84de20366d695`, `3335e98ae175eb6b23076345b460cd5611ca5d0e`, `c3d9b664a17242910406022bdbf66de85d463866` | `MERGE_SEMANTICALLY` | Preserve server-side authorization and bug fixes where compatible; do not re-enable forbidden Testing exports. |

## Forensic boundary

The existing untracked `.reconciliation-evidence/`, `canonical-migration-reconstruction/` and Phase 2/2.5/2.6 matrices/reports stay on disk as evidence. They are not wholesale source inputs or eligible for `git add .`. Required canonical SQL is selected from `canonical-migration-reconstruction/prisma/migrations` with original bytes. Any local Git exclude used to obtain a clean candidate must list exact forensic paths and remain documented; it must not conceal unfinished product files.
