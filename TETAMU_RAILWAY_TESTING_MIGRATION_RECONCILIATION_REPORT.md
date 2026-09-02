# TETAMU — RAILWAY TESTING MIGRATION HISTORY RECONCILIATION REPORT

审计日期：2026-08-30（Asia/Singapore）  
Canonical workspace：`C:\CodexTetamuP0`  
目标环境：Railway `testing` / `tetamu-staff-app` / `Postgres-Singapore`  
操作性质：只读审计、可恢复备份、临时数据库重建验证；**未执行 migration history mutation**

> **TESTING ONLY**  
> **PRODUCTION NOT ACCESSED**  
> **PRODUCTION NOT MODIFIED**

## 1. Executive Result

当前 Railway TESTING 数据库可以正常服务 Staff runtime，但它的实际 schema 与本地 canonical migration lineage **并不完全一致**。

- 本地与 TESTING 都有 212 条已知 migration，但双方各有 3 条对方没有的 migration 名称。
- `staff_app_logo_url` 与 `staff_app_appearance` 的 TESTING 实际结构，和本地 canonical appearance migration 的最终效果完全相同。
- TESTING 还保留两条旧 OTP migration 带来的实质对象：`provider_message_code`、额外 check constraint，以及不同版本的 OTP lifecycle / invalidation functions。
- 从当前本地 212 migrations 从零建立的 canonical 数据库没有上述旧 OTP 对象，但会包含 PCB correctness 与 effective-dated statutory participation 两组新结构。
- 因此，只对 `20260829110000_canonical_staff_app_appearance` 执行 `prisma migrate resolve --applied`，只能解释 appearance 一项，不能让整套 history 与实际 schema 变得真实、可重建。

**最终判定：RECONCILIATION BLOCKED / REVIEW REQUIRED。**

本轮没有执行 `prisma migrate resolve`、没有手动编辑 `_prisma_migrations`、没有应用 PCB/statutory migrations，也没有部署 Staff App。

## 2. Testing Database Identity

| 项目 | 结果 |
|---|---|
| Railway project | `Tetamu-POS` |
| Environment | `testing` |
| Database service | `Postgres-Singapore` |
| Database | `railway` |
| Schema | `public` |
| PostgreSQL | PostgreSQL 18.4 (Debian) |
| Connected database role | `postgres` |
| `_prisma_migrations` rows | 212 |
| Finished / active rows | 212 |
| Unfinished rows | 0 |
| Rolled-back rows | 0 |

完整 `_prisma_migrations` 名称、checksum、started/finished/rollback 状态已导出到：

`C:\Users\oscar\.codex\backups\tetamu-railway-testing\20260830T182528\testing-prisma-migration-history.tsv`

该文件是本次报告的完整 migration-history evidence；不是根据旧文档推断。

## 3. Backup and Restore Verification

任何潜在 history mutation 之前已经完成备份；最终虽未执行 mutation，备份仍保留。

| Artifact | Size | SHA-256 |
|---|---:|---|
| `railway-testing-full.custom` | 4,372,236 bytes | `E9E34FB03D04219DE85200CFEB09F7D6C780F0A444F008AFAE119944E443C169` |
| `testing-prisma-migration-history.tsv` | 36,504 bytes | `2B5A3B7BEC31A9700061FA48D9B5D06F279217E83480275A37105947E773769C` |
| `testing-staff-appearance-schema.tsv` | 86 bytes | `E35D59A7B2EBE98217CF06E455BA3937C3A2ECF97038D554E176B2C00CBCC361` |

备份目录：

`C:\Users\oscar\.codex\backups\tetamu-railway-testing\20260830T182528`

验证结果：

- `pg_restore --list` 可读取，共 3,075 个 objects。
- 完整 custom dump 已恢复到独立临时验证数据库。
- 恢复后 businesses = 8；appearance logo rows = 0；appearance JSON rows = 0。
- 恢复后的 appearance data digest 与 TESTING 相同：`b0e7c5d9940be2a4998b40cfbe01e866`。
- 恢复后的 migration rows = 212，全部 finished。
- 临时 restore verification database 已删除；备份可用于重新恢复。

**BACKUP STATUS: PASS**  
**RESTORE READ VERIFICATION: PASS**

## 4. Staff Appearance Schema Audit

TESTING 实际定义：

| Column | Type | Nullable | Default | Related index |
|---|---|---|---|---|
| `businesses.staff_app_appearance` | `jsonb` | YES | none | none |
| `businesses.staff_app_logo_url` | `text` | YES | none | none |

数据状态：

- businesses total：8
- non-null `staff_app_logo_url`：0
- non-null `staff_app_appearance`：0

Canonical migration `20260829110000_canonical_staff_app_appearance`：

```sql
BEGIN;
ALTER TABLE "businesses"
    ADD COLUMN IF NOT EXISTS "staff_app_logo_url" TEXT,
    ADD COLUMN IF NOT EXISTS "staff_app_appearance" JSONB;
COMMIT;
```

历史 TESTING migration `20260822010000_staff_app_appearance` 的原始 SQL 已从 Git 历史恢复并核对：它增加相同的两个 nullable columns，区别只在于没有 `IF NOT EXISTS` 与显式 transaction wrapper。

**APPEARANCE SCHEMA EQUIVALENCE: EXACT FINAL-SCHEMA MATCH**

单独看 appearance，这是一项可考虑用官方 `prisma migrate resolve --applied` 表达的 B 类等价情况；但整体 migration lineage 仍存在 OTP 实质冲突，所以本轮没有独立 resolve。

## 5. Migration Drift

`prisma migrate status` 的真实结果：

最后共同 migration：

`20260826173000_non_production_statutory_fixture_evidence_facility`

### Local canonical but not applied in TESTING

1. `20260827153000_pcb_2026_p1_correctness_foundation`
2. `20260827170000_effective_dated_statutory_participation`
3. `20260829110000_canonical_staff_app_appearance`

### Present in TESTING history but absent locally

1. `20260822010000_staff_app_appearance`
2. `20260822023000_development_concurrent_otp_challenges`
3. `20260824130000_staff_app_sms123_otp`

### Relevant TESTING history evidence

| Migration | TESTING checksum | State |
|---|---|---|
| `20260822010000_staff_app_appearance` | `ea406f...` | finished, not rolled back |
| `20260822023000_development_concurrent_otp_challenges` | `fa2b79...` | finished, not rolled back |
| `20260824130000_staff_app_sms123_otp` | `02ed6f...` | finished, not rolled back |
| `20260824190000_staff_app_sms123_otp` | `959425...` | finished, not rolled back |

完整 64-character checksums 与时间戳保存在本报告第 2 节所列 TSV evidence，避免在摘要表截断后被误作完整值。

## 6. OTP Schema and Runtime Object Audit

TESTING 实际存在：

- `employee_otp_challenges.provider_message_code`：`text`, nullable, no default。
- constraint `employee_otp_challenges_provider_message_code_check`。
- 旧版 `invalidate_previous_employee_otp_challenges()`。
- 旧版 `enforce_employee_otp_challenge_lifecycle()`。

TESTING function definition hashes：

| Function | TESTING MD5 |
|---|---|
| `invalidate_previous_employee_otp_challenges` | `8f2d05850fbb15ae6b37c99615fb48a9` |
| `enforce_employee_otp_challenge_lifecycle` | `17991cf144f8943e5e71d42f6050788b` |

当前 canonical 212 migrations 从零建立后的结果：

| Object | Canonical fresh DB |
|---|---|
| `provider_message_code` | absent |
| `employee_otp_challenges_provider_message_code_check` | absent |
| invalidation function MD5 | `7db40d00887ac889bf5c4d2db98dc9d8` |
| lifecycle function MD5 | `bb8028466279274c17292bf0eb5b961b` |

旧 `20260822023000_development_concurrent_otp_challenges` 会改变并发 OTP invalidation 行为：mock provider 以 device fingerprint 区分，real providers 则 phone-wide invalidation。旧 `20260824130000_staff_app_sms123_otp` 会增加 `provider_message_code`、对应约束，并重写 lifecycle function。

这些不是 migration 名称差异而已，而是 **actual schema / runtime semantics 差异**。

## 7. PCB and Statutory Objects Audit

TESTING 尚不存在：

- `employee_statutory_participation_periods`
- type `PcbStatutoryComponentNature`
- `statutory_component_classifications.pcb_nature`
- `payroll_entry_statutory_snapshots.statutory_participation_period_id`

Canonical fresh DB 从零应用 212 migrations 后，这些结构存在。

`20260827153000_pcb_2026_p1_correctness_foundation` 与 `20260827170000_effective_dated_statutory_participation` 包含非平凡的 PCB classification provenance、effective-dated participation、foreign keys、guards/triggers 与 payroll snapshot linkage。它们不能因为 `migrate status` 显示 pending 就在本次 Staff reconciliation 中自动应用。

**PCB/STATUTORY DATA SEMANTICS: NOT MUTATED IN THIS TASK**

## 8. Classification Matrix

分类定义：

- **A — CANONICAL AND NEEDS APPLY**：属于当前 canonical lineage，但需要独立业务/发布决策后应用。
- **B — SCHEMA-EQUIVALENT RESOLUTION CANDIDATE**：实际效果与 canonical migration 完全相同，原则上可用官方 resolve 表达。
- **C — LEGACY HISTORY / SUPERSEDED NAME**：历史名称已不在 canonical 目录；需要被保留在证据中，不能手工删除。
- **D — MATERIAL CONFLICT / REVIEW REQUIRED**：实际 schema 或 runtime behavior 与 canonical lineage 有实质差异。

| Migration / pair | Class | Decision |
|---|---|---|
| `20260827153000_pcb_2026_p1_correctness_foundation` | A | canonical，但本任务不得自动 apply；需独立 PCB release decision |
| `20260827170000_effective_dated_statutory_participation` | A | canonical，但本任务不得自动 apply；需独立 statutory/data decision |
| TESTING `20260822010000_staff_app_appearance` + local `20260829110000_canonical_staff_app_appearance` | B + C | final schema exact match；旧名保留为历史证据；resolve 暂缓 |
| `20260822023000_development_concurrent_otp_challenges` | D | function semantics 与 canonical fresh DB 不同 |
| `20260824130000_staff_app_sms123_otp` | D | extra column/constraint/functions 与 canonical fresh DB 不同 |

## 9. Why No `prisma migrate resolve` Was Run

满足 appearance 等价的条件，不代表满足整体 history reconciliation 条件。

若现在只执行：

```text
prisma migrate resolve --applied 20260829110000_canonical_staff_app_appearance
```

仍会留下：

- 2 条 canonical migrations pending（PCB / statutory）。
- 3 条 TESTING-only migration records。
- 2 组 TESTING-only OTP schema/runtime effects。
- canonical fresh DB 与 TESTING 无法从同一 lineage 重建成相同对象。

这会制造“appearance 已 resolve”的局部表象，却不能诚实表达数据库完整历史。根据本任务 stop conditions，官方 resolve **不能单独代表当前整体 history**，因此必须停止而非强行 reconciliation。

**MIGRATE RESOLVE: NOT RUN**  
**MANUAL `_prisma_migrations` EDIT: NOT RUN**  
**TESTING SCHEMA MUTATION: NONE**

## 10. Fresh Canonical Database Verification

在独立临时数据库中从零应用当前 migration tree：

- migrations discovered：212
- migrations applied：212
- unfinished migrations：0
- appearance columns：正确
- `provider_message_code`：absent
- old OTP provider-message constraint：absent
- statutory participation table：present
- PCB nature column：present
- migration deploy：PASS
- 临时数据库：已删除

这证明当前 local canonical lineage 本身可以从零建立，但也直接证明它与 TESTING 的 actual objects 不同。

## 11. Protected Integration and Runtime Verification

### Local disposable protected integration

- current 212 migrations from zero：PASS
- integration tests：199 passed, 0 failed
- complete Staff Attendance route flow：1 passed, 0 failed
- disposable database cleanup：completed

测试中出现的 Prisma error logs 是负向 guard / concurrency assertions 的预期日志；最终 test runner 结果为 0 failures。

### Railway TESTING read-only runtime checks

| URL | Result |
|---|---|
| `/api/health` | HTTP 200 |
| `/staff/login` | HTTP 200 |
| `/staff` | HTTP 200 |

### Prisma checks

- `prisma validate`：PASS（使用无连接的 validation URL，仅供 schema parser）。
- `prisma migrate status` against TESTING：DIFFERENT HISTORY，明确列出 3 pending + 3 database-only migrations。

## 12. Required Follow-up Decision

在继续 Staff controlled deployment 前，需要一个独立的 database reconciliation 变更方案，至少明确：

1. 旧 OTP `provider_message_code` 是否仍是 SMS123 production-like runtime contract，还是应由新的 canonical migration 安全移除/迁移。
2. 两个 OTP functions 应保留 TESTING 语义、回归 canonical 语义，或由新的 forward-only migration 建立统一语义。
3. PCB correctness 与 effective-dated statutory participation 何时、以什么数据前置检查应用到 TESTING。
4. 上述 forward migration 完成并验证后，才重新评估 appearance migration 是否可用官方 `prisma migrate resolve --applied` 记录等价历史。

禁止方案：

- 不得删除 TESTING-only migration rows。
- 不得直接 UPDATE/INSERT `_prisma_migrations`。
- 不得为了让 status 变绿而伪造 checksums。
- 不得在没有 forward schema plan 的情况下删除 OTP objects。
- 不得把本次 TESTING 结论外推为 Production 状态。

## 13. Final Status

**ROOT CAUSE:** TESTING 曾应用三条已从 local canonical tree 移除/改名的历史 migrations，其中两条 OTP migrations 留下 canonical fresh DB 不具备的实质 schema 与 function semantics；同时 TESTING 尚未应用两项非平凡 PCB/statutory canonical migrations。  
**BACKUP:** PASS；full custom dump、migration TSV、appearance schema TSV 均已校验 SHA-256，并完成 restore/read verification。  
**APPEARANCE EQUIVALENCE:** PASS；两个 appearance columns 的 type/null/default/index/final effect 与 canonical migration 相同。  
**HISTORY RECONCILIATION:** NOT PERFORMED；整体 history 不能由单一 resolve 诚实表达。  
**FRESH CANONICAL DB:** PASS；212/212 migrations 从零成功。  
**PROTECTED INTEGRATION:** PASS；199 + 1 tests，0 failures。  
**RUNTIME READ CHECK:** PASS；Testing health/login/staff 均 HTTP 200。  
**NEW MIGRATION:** NONE。  
**STAFF DEPLOYMENT:** NOT PERFORMED。  
**CONTROLLED STAFF DEPLOYMENT:** **BLOCKED — migration reconciliation decision required**。  
**PRODUCTION STATUS:** **PRODUCTION NOT ACCESSED / PRODUCTION NOT MODIFIED**。

> **TESTING ONLY**  
> **PRODUCTION NOT ACCESSED**  
> **PRODUCTION NOT MODIFIED**

