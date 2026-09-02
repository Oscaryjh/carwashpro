# TETAMU STAFF 3000 — LOCAL DB AND UAT CLOSURE REPORT

日期：2026-08-29  
范围：`C:\CodexTetamuP0`，Local / Testing only  
Canonical Staff runtime：3000 only

## 1. FINAL VERDICT

**BLOCKED**

本轮没有满足 READY 的前置条件，原因如下：

1. 旧库完整 logical backup 已成功建立并可读取 catalog，但 strict isolated restore 在重建 FK 时失败。
2. 只排除 68 条可明确归类为 disposable 的 orphan `auth_sessions` 后，restore 仍在 statutory/domain record 上失败；不能继续自动删除。
3. Read-only public FK audit 共检查 801 个 FK constraints，其中 62 个存在 orphan rows，涉及 Attendance、Leave、Claims/Expenses、Roster、Payroll、Payslip、statutory participation、Appointments 等业务域。
4. 因 Phase A backup restore verification 不通过，依照安全规则，本轮没有创建 active canonical DB、没有转移数据、没有切换 `DATABASE_URL`。
5. 源库冻结后不能为了 authenticated UAT 写入 session、fixture 或 audit state，因此 Employee/Manager authenticated browser UAT 没有执行。
6. 最新 full unit run 为 1,318 / 1,322 PASS、4 FAIL；除数据库阻塞外，当前 source tree 还有 4 个 contract regression 需要另行处理。

旧数据库没有被修改，Production 没有被访问或修改。当前状态适合继续诊断和 owner review，不适合宣告 consolidation closure。

## 2. 3000 CANONICAL STATUS

| Item | Status |
| --- | --- |
| Runtime | `C:\CodexTetamuP0` on port 3000；HTTPS `/staff/login` = HTTP 200 |
| Backend | `C:\CodexTetamuP0` only canonical backend |
| Schema | `C:\CodexTetamuP0\prisma\schema.prisma` only canonical schema |
| Migration owner | `C:\CodexTetamuP0\prisma\migrations` only canonical migration owner；212 folders |

Additional checks：

- `20260829110000_canonical_staff_app_appearance` 存在于 canonical migration directory。
- Active source/config 未发现 `STAFF_APP_ORIGIN`、`localhost:3100`、`127.0.0.1:3100` 或 `:3100/staff` runtime reference；旧报告和历史 UAT docs 内仍有文字记录，不是 active dependency。
- 当前只启动 Next.js 3000 HTTPS runtime，没有启动 notification/WhatsApp/analytics worker supervisors。
- Port 3100 未监听。

## 3. OLD DB BACKUP

| Item | Result |
| --- | --- |
| Source database | `car_wash_crm_pos` on `localhost:5432` |
| PostgreSQL | 18.4 x86_64 Windows |
| Source DB size | 414,357,183 bytes |
| Backup | `artifacts/local-db-baseline/20260829/car_wash_crm_pos_20260829.dump`；40,497,386 bytes |
| Backup SHA-256 | `CAD9E2D6C31512320DBD840B47B7005B29EFC663AD2D9B8A04F8A4982CDE56D9` |
| Schema SHA-256 | `90ED9D8EF05E6556C15D4F5D25DEE86B402534A3BC064C039A85FD830319F3C5` |
| Migration table digest | `4623A476A8379BFAD671DC64C5305064E5A9C729F6D81BFFBBDC8FB0C9B904E8` |
| Backup catalog SHA-256 | `4217F18F1DD39C8D2AE083989B9B9001DA60D4897ED8D25EEE1209525FED6D41` |
| Catalog read | PASS |
| Restore verification | **FAIL** |
| Restore target | `tetamu_restore_verify_20260829_1235`；diagnostic only，not active |
| Old DB preserved | **YES — source untouched** |

Strict restore first failed at `auth_sessions_user_id_fkey` because 68 sessions reference missing users。These session rows are disposable。After deleting only those rows in the disposable restore target, post-data restore next failed at `employee_lindung24_participation_versions_business_fkey` because 68 statutory/domain rows reference missing Businesses。

Broader read-only audit：801 public FK constraints checked；62 contain orphan rows。Evidence：

- `artifacts/local-db-baseline/20260829/RESTORE_VERIFICATION_RESULT.md`
- `artifacts/local-db-baseline/20260829/public-fk-orphan-audit.txt`
- `artifacts/local-db-baseline/20260829/public-fk-orphan-audit.sql`
- `artifacts/local-db-baseline/20260829/SHA256SUMS.txt`

因为 restore verification 失败，没有进行 source-vs-restored critical table count PASS 声明。

## 4. DATA CLASSIFICATION

完整 manifest：`TETAMU_STAFF_3000_LOCAL_DATA_CLASSIFICATION_MANIFEST.md`。当前状态：**OWNER REVIEW REQUIRED**。

### RETAIN_AS_EVIDENCE

- Explicit UAT Business：`d917554b-9cff-4fff-8d81-898397f05cda`，`Tetamu HR Acceptance Test`。
- Linked evidence inventory：1 Business、1 Branch、6 Memberships、1 Roster period、6 Published assignments、2 Leave requests、1 Claim、1 Payroll run、6 Payroll entries、6 Payslips。
- 其他 Payroll/Payslip/statutory evidence 只有在 owner 提供明确 Business/Run/Entry/Publication IDs 后才可进入 transfer allowlist。

### RECREATE_FROM_CANONICAL_FIXTURE

- Standard Employee/Manager/HR/Owner actors。
- HR Payroll core/five-role/fresh E2E、Commission、Roster、POS core fixture scenarios。
- 本轮没有运行 fixture script 写入 source 或新 DB。

### ARCHIVE_ONLY

- 4,634 个 Businesses 中，除 explicit allowlist 外全部默认 archive-only；不能推断它们都属于 active development data。
- 62 个 FK constraints 下的 orphan business/domain data。
- Historical non-public schemas，例如 `attendance_phase1c_*`、`team_people_*`、`legacy_restore_backup`。
- `notification_queue`、`stock_count_sessions` 在没有 owner 决策前也保持 archive-only。

### DISPOSABLE

- `auth_sessions`：868 rows。
- `employee_sessions`：158 rows。
- `employee_otp_challenges`：194 rows。
- `attendance_request_idempotency`：16 rows。
- Login/session tokens、rate limits、ephemeral idempotency、worker leases/locks、development concurrency state、old `_prisma_migrations`。

## 5. NEW CANONICAL DB

| Item | Result |
| --- | --- |
| Database | **NOT CREATED — Phase A safety gate failed** |
| Migration count | Canonical directory = 212 |
| Migration deployment | Prior disposable zero-to-latest run = 212 / 212 PASS；not a new active DB in this turn |
| Migration status | **NOT EXECUTED for a new canonical DB** |
| Prisma validate | PASS on current canonical schema |
| Prisma generate | Not required/executed after a new DB because no new DB was created |

旧库 migration history 仍有 3100-only records，并缺少 current canonical appearance migration；本轮没有手工编辑 `_prisma_migrations`，也没有复制 3100 migrations。

## 6. DATA TRANSFER

| Item | Result |
| --- | --- |
| Transferred domains | **NONE** |
| Excluded ephemeral data | Classification completed，but no transfer executed |
| Count reconciliation | **NOT EXECUTED** |
| Money reconciliation | **NOT EXECUTED** |
| Document reconciliation | **NOT EXECUTED** |
| Exceptions | 62 orphaned FK constraints；owner decisions required |

没有 blind `pg_dump --data-only`，没有 silent remapping，没有 dual-write，没有在源库删除 records。

继续前必须由 data owner：

1. 批准 explicit UAT Business allowlist。
2. 提供其他必须迁移的 Business/Payroll/Payslip/statutory IDs。
3. 对 orphaned domain rows 决定 parent repair、archive-only 或明确排除。
4. 批准 reconciliation exception policy。

## 7. CUTOVER

| Item | Result |
| --- | --- |
| `DATABASE_URL` | **UNCHANGED — still old local DB** |
| 3000 runtime | PASS；`https://localhost:3000/staff/login` returned HTTP 200 |
| 3100 runtime | NOT RUNNING；port 3100 not listening |
| Migration status after startup | Old DB remains drifted；no clean new DB exists |

No cutover occurred。Old DB remains the rollback/source database and is unchanged。Diagnostic restore DB is retained only for investigation。

## 8. EMPLOYEE AUTHENTICATED UAT

Phase A failed before cutover。Running authenticated UAT on the frozen old DB would update session/activity/audit state, so the available local helper/token was deliberately not used。

| Flow | Result |
| --- | --- |
| Login | NOT EXECUTED — database safety gate |
| Multi-employer | NOT EXECUTED — database safety gate |
| Home | NOT EXECUTED — database safety gate |
| Attendance | NOT EXECUTED — database safety gate |
| Roster | NOT EXECUTED — database safety gate |
| Timesheet | NOT EXECUTED — database safety gate |
| Leave | NOT EXECUTED — database safety gate |
| Claims | NOT EXECUTED — database safety gate |
| Pay | NOT EXECUTED — database safety gate |
| Profile | NOT EXECUTED — database safety gate |
| Appointments | NOT EXECUTED — database safety gate |

Prior automated focused suites remain useful regression evidence, but are not represented as authenticated browser PASS。

## 9. MANAGER AUTHENTICATED UAT

No existing manager Staff session artifact was available。Creating a fixture/session would write to the frozen old DB, so it was not done。

| Flow | Result |
| --- | --- |
| Approval Center | NOT EXECUTED — database safety gate |
| Leave | NOT EXECUTED — database safety gate |
| Claims | NOT EXECUTED — database safety gate |
| Attendance | NOT EXECUTED — database safety gate |
| OT | NOT EXECUTED — database safety gate |

No duplicate approval table or record was created in this turn。

## 10. SECURITY NEGATIVE TESTS

Manual authenticated browser negatives were not executed because authenticated sessions were blocked by the database safety gate。Prior protected disposable integration and focused capability tests passed and remain evidence, but do not replace this missing manual closure。

| Area | Result |
| --- | --- |
| Tenant isolation | Automated evidence PASS；authenticated browser NOT EXECUTED |
| Branch isolation | Automated evidence PASS；authenticated browser NOT EXECUTED |
| Self-review | Automated evidence PASS；authenticated browser NOT EXECUTED |
| Payslip privacy | Automated evidence PASS；authenticated browser NOT EXECUTED |
| Leave evidence | Automated evidence PASS；authenticated browser NOT EXECUTED |
| Claim attachment | Automated evidence PASS；authenticated browser NOT EXECUTED |
| Appointments | Automated evidence PASS；authenticated browser NOT EXECUTED |
| Client ID override | Automated evidence PASS；authenticated browser NOT EXECUTED |

## 11. MOBILE

| Target | Result |
| --- | --- |
| 390 × 844 | Prior anonymous/login automated viewport smoke PASS；logged-in authenticated walkthrough NOT EXECUTED |
| 412 × 915 | Prior anonymous/login automated viewport smoke PASS；logged-in authenticated walkthrough NOT EXECUTED |
| Real Android | NOT EXECUTED |
| Real iPhone | NOT EXECUTED |

因此没有对 logged-in safe area、keyboard、date picker、file upload、Approval Center 或长内容状态做本轮 manual PASS 声明。

## 12. REGRESSION

| Check | Result |
| --- | --- |
| Full unit run (`npm run test`) | **FAIL — 1,318 / 1,322 PASS；4 FAIL** |
| Staff-focused unit baseline | Prior evidence：83 / 83 PASS |
| Attendance / unified approval baseline | Prior evidence：22 / 22 PASS |
| Protected disposable integration baseline | Prior evidence：199 / 199 PASS + isolated route flow 1 / 1 PASS |
| TypeScript (`npx tsc --noEmit`) | PASS |
| ESLint project source | PASS — 0 errors，3 pre-existing warnings |
| Prisma validate | PASS |
| Canonical zero-to-latest migration baseline | Prior disposable evidence：212 / 212 PASS |
| Build | Prior current-tree evidence：PASS，144 static pages |
| Runtime smoke | PASS — HTTPS 3000 `/staff/login` = 200 |

The four current unit failures are：

1. `Payroll truthfully distinguishes locked calculations from payment completion`。
2. `deployed sensitive entry points use dedicated capabilities and immutable statutory artifacts`。
3. `Shift-based roster contract uses default schedules plus weekly exceptions`。
4. `Roster contract keeps Draft, published history, Staff visibility and Attendance boundaries explicit`。

Roster failures include a source/test terminology mismatch：current UI uses `No schedule yet`，while a test still requires `No effective schedule available`。This task did not modify code to resolve the contract disagreement。

ESLint note：initial `npm run lint` also scanned the temporary extracted PostgreSQL/pgAdmin tooling under `.tmp` and therefore reported third-party errors。The project-source check was rerun with only those audit-tool directories excluded and completed with 0 project errors / 3 existing warnings。

## 13. 3100 STATUS

**REFERENCE ONLY**

- `C:\CodexTetamuP0-staff-ui` exists only as reference。
- Port 3100 is not listening。
- No active `STAFF_APP_ORIGIN` or 3100 URL runtime dependency。
- No migration ownership。
- No development or migration was performed there。
- Normal 3000 runtime does not depend on it。

Because DB/UAT closure is blocked, it is **not yet marked READY TO RETIRE**。Do not delete the reference worktree in this state。

## 14. PRODUCTION STATUS

**LOCAL / TESTING ONLY**  
**PRODUCTION NOT ACCESSED**  
**PRODUCTION NOT MODIFIED**

No production credential, production database, production deployment, or real production SMS was used。

## Required next closure sequence

1. Data owner reviews and approves `TETAMU_STAFF_3000_LOCAL_DATA_CLASSIFICATION_MANIFEST.md`。
2. Resolve or explicitly archive/exclude all domain orphan groups needed for strict restore/canonical transfer。
3. Re-run strict isolated restore until PASS and compare critical counts。
4. Only then create a clean canonical DB and run 212 migrations from zero。
5. Perform FK-aware allowlisted transfer and count/money/document reconciliation。
6. Cut over local `DATABASE_URL` only after zero unexplained differences。
7. Run authenticated Employee, Manager, security-negative and logged-in mobile UAT。
8. Resolve the four current unit regressions and rerun final regression。

Until all above gates pass, the correct closure status remains **BLOCKED**。
