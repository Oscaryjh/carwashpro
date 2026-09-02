# TETAMU STAFF 3000 — LOCAL DATA CLASSIFICATION MANIFEST

日期：2026-08-29  
范围：`car_wash_crm_pos`（Local / Testing only）  
原则：无法明确判断的数据一律 `ARCHIVE_ONLY`，不删除、不自动迁入新 active DB。

## Classification status

**OWNER REVIEW REQUIRED**

这是一份保守的 machine-assisted classification manifest，不代表业务 owner 已批准迁移。旧库完整逻辑备份已保存，所有原始 records 仍在旧库及 backup 中。

## 1. RETAIN_AS_EVIDENCE

### Explicit Staff / HR / Payroll UAT set

Business：

- ID：`d917554b-9cff-4fff-8d81-898397f05cda`
- Name：`Tetamu HR Acceptance Test`
- 来源：`.tmp/hr-payroll-core-acceptance.json` 与 `.tmp/hr-payroll-five-role-uat.json`

Linked record inventory：

| Domain | Count |
| --- | ---: |
| Business | 1 |
| Branch | 1 |
| Employee memberships | 6 |
| Roster periods | 1 |
| Published roster assignments | 6 |
| Leave requests | 2 |
| Claims | 1 |
| Payroll runs | 1 |
| Payroll entries | 6 |
| Payslip publications | 6 |

这些 records 与现存 authenticated Staff UAT artifact 明确关联，默认 `RETAIN_AS_EVIDENCE`。迁移时必须从 Business → Branch → identity/membership → configuration → domain records 做 FK-aware allowlist transfer，并核对 Payroll money totals 与 Payslip publications。

### Statutory / Payroll evidence outside the explicit UAT set

旧库存在大量 Payroll、Payslip、statutory participation、bank/payment 与 certification-related records。因为其中部分记录出现 orphaned FKs，无法安全地把整个 domain 自动分类为可迁移。

处理：

- 原始记录：完整保留在 old DB 与 full logical backup。
- Active DB transfer：只有 data owner 明确列出的 Business/Payroll run/entry/publication IDs 才可进入 allowlist。
- 未明确列出的记录：暂列 `ARCHIVE_ONLY`。

## 2. RECREATE_FROM_CANONICAL_FIXTURE

以下场景已有 canonical fixture/UAT scripts，可以在新 clean DB 重新创建，不应 blind-copy 历史随机 residue：

- Standard employee / manager / HR / owner actors。
- HR Payroll core acceptance/five-role scenarios。
- Fresh E2E roster/payroll/leave scenarios。
- Commission browser fixture。
- Roster browser fixture。
- POS core UAT fixtures。

Relevant canonical scripts include：

- `scripts/prepare-hr-payroll-five-role-uat.ts`
- `scripts/prepare-hr-payroll-core-acceptance.ts`
- `scripts/prepare-hr-payroll-fresh-e2e.ts`
- `scripts/prepare-commission-browser-fixture.mjs`
- `scripts/prepare-roster-browser-fixture.ts`
- `scripts/prepare-pos-core-uat-fixtures.ts`

在 backup restore blocker 未关闭前，本轮没有运行这些 scripts 写入旧库或新库。

## 3. ARCHIVE_ONLY

### Unclassified public Business data

- Total public Businesses：4,634
- Name pattern clearly containing UAT/test/fixture/demo/QA/pilot/acceptance/certification/disposable/sandbox/sample/seed/phase：95
- Other/unclassified：4,539

不能从名称推断 4,539 个 Businesses 都应该迁入 active development DB。除 explicit allowlist 外，默认全部 `ARCHIVE_ONLY`。

### Orphaned business/domain data

Public schema FK audit：

- FK constraints audited：801
- Constraints with orphan rows：62

Examples：

- 68 `employee_lindung24_participation_versions` rows reference missing Businesses、Memberships 或 Users。
- Payroll entry/snapshot/component records contain missing Membership、Run、Entry、statutory participation or Business parents。
- Leave ledgers/buckets/events contain missing entitlement、request、rule or membership parents。
- Expense、inventory、payment、roster and attendance P2 records also contain missing parents。

这些记录不能静默删除，也不能迁入一个 FK-clean canonical DB。原始版本留在 backup；在 owner 逐项确认前归类为 `ARCHIVE_ONLY / RECONCILIATION REQUIRED`。

Evidence：

- `artifacts/local-db-baseline/20260829/public-fk-orphan-audit.txt`
- `artifacts/local-db-baseline/20260829/public-fk-orphan-audit.sql`

### Non-public historical test schemas

Old DB contains historical integration/test schemas such as：

- `attendance_phase1c_*`
- `attendance_phase1c_api_*`
- `team_people_*`
- `legacy_restore_backup`

这些 schemas 不属于 canonical active `public` schema。完整 backup 中继续保留；新 active DB 不导入，默认 `ARCHIVE_ONLY`，待 owner 确认后可改为 disposable。

## 4. DISPOSABLE

以下是明确不迁入新 active local DB 的 authentication/runtime ephemeral state：

| Table/state | Old count | Transfer |
| --- | ---: | --- |
| `auth_sessions` | 868 | EXCLUDE |
| `employee_sessions` | 158 | EXCLUDE |
| `employee_otp_challenges` | 194 | EXCLUDE |
| `attendance_request_idempotency` | 16 | EXCLUDE |

另外排除：

- Login sessions/tokens。
- Rate-limit rows。
- Temporary idempotency state。
- Worker leases/locks。
- Development-only concurrency state。
- `_prisma_migrations` from the old DB。

`notification_queue` 与 `stock_count_sessions` 没有自动标为 disposable；它们可能包含业务/审计意义，当前保守归入 `ARCHIVE_ONLY`。

## 5. Restore blocker discovered

Full custom-format backup was created successfully, but strict isolated restore failed while recreating FKs：

1. `auth_sessions_user_id_fkey`：68 orphan sessions；这批可明确归为 disposable。
2. `employee_lindung24_participation_versions_business_fkey`：68 orphan domain rows；这批不能自动删除。
3. Broader read-only audit found 62 public FK constraints with orphan rows。

因此不能声明 backup strict restore PASS，也不能继续 canonical DB cutover。

## 6. Owner decisions required

1. 批准 `Tetamu HR Acceptance Test` Business 及 linked records 进入 transfer allowlist。
2. 提供必须长期保留/迁移的其他 Business IDs、Payroll Run IDs、Payslip Publication IDs 与 statutory evidence IDs。
3. 决定 orphaned domain rows：修复 parent mapping、archive-only，或明确批准在新 DB 排除。
4. 决定 historical non-public test schemas 是 archive-only 还是 disposable。
5. 批准 reconciliation exceptions 后，才能建立和切换新 canonical active DB。

当前分类结论：**MANIFEST COMPLETE FOR REVIEW — CUTOVER BLOCKED**。
