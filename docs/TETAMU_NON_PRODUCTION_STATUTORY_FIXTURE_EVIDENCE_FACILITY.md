# TETAMU — Non-Production Statutory Fixture Evidence Facility

## 1. Executive Summary

本工程建立了一个可审计、append-only、tenant-bound、明确不可用于官方输出的 non-production statutory evidence facility。通用 provenance contract 可供其他 statutory evidence adapter 复用；LINDUNG 24 是本轮接入的第一个 canonical adapter。

`SYNTHETIC_TESTING` evidence 只允许在 `LOCAL` 或 `TESTING` runtime 写入及解析。Production 对 synthetic canonical write/read fail closed。任何含 synthetic 或 `officialExportEligible = false` frozen statutory snapshot 的 Payroll Run 都不能产生官方 statutory export、artifact、correction submission 或 submission status transition。

本轮没有给现有员工创建 synthetic persona，没有刷新现有 Payroll Draft，没有 Finalize Payroll，没有发布 Payslip，也没有部署 Testing 或 Production。

## 2. Problem Statement

原模型只能表达带 source type/reference 的真实 participation evidence，不能安全表达专为 Payroll/Payslip UAT 使用的 synthetic statutory facts。若复用 official source enum、伪造 acknowledgement/reference 或根据员工当前资料反推历史事实，synthetic evidence 会看起来像真实官方证据，并可能进入 export/submission。

本设施必须同时满足：synthetic 明确可辨、环境与用途持久化、Production hard deny、official export/submission hard deny、canonical write、immutable history、tenant isolation、Testing Payroll/Payslip 可用，以及 REAL evidence regression 不变。

## 3. Existing Evidence Model

复用现有：

- `EmployeeLindung24ParticipationVersion` effective-dated append-only revisions；
- statutory capability 与 whole-business scope；
- canonical Audit Log；
- LINDUNG 24 resolver 与 policy chronology；
- `PayrollEntryStatutorySnapshot` frozen boundary；
- Payroll readiness、Payslip renderer、statutory artifact/submission lifecycle。

没有创建 synthetic employee table，没有建立 direct fixture Payroll writer，也没有绕过 canonical service。

## 4. Design Decision

在 statutory evidence domain 增加通用 provenance contract，并由具体 adapter 映射到现有 evidence model：

- `evidenceNature`: `REAL | SYNTHETIC_TESTING`
- `evidenceEnvironment`: `LOCAL | TESTING | null`
- `fixturePurpose`: `PAYROLL_PAYSLIP_UAT | null`
- `officialExportEligible`: boolean
- `statutoryNationalitySnapshot`: explicit nationality provenance

通用 validation/guard 位于 `src/lib/payroll/statutory-evidence.ts`。LINDUNG 24 canonical service 是首个 adapter。字段参与 write、resolver、snapshot、Payslip、export/submission 和 audit，因而不是针对某位 UAT Employee 的 schema bloat。

## 5. Schema

`prisma/schema.prisma` 新增：

- `StatutoryEvidenceNature`
- `StatutoryEvidenceEnvironment`
- `StatutoryFixturePurpose`

`EmployeeLindung24ParticipationVersion` 与 `PayrollEntryStatutorySnapshot` 新增完整 provenance fields。LINDUNG 24 的 `sourceType`、`sourceReference` 调整为 nullable，使 synthetic evidence 可以如实表示“没有 official source”，而不是伪造一条。

正式 migration：

`prisma/migrations/20260826173000_non_production_statutory_fixture_evidence_facility/migration.sql`

## 6. Evidence Nature

REAL 与 SYNTHETIC_TESTING 使用互斥 contract。

REAL：environment/purpose 必须为 null、必须 official export eligible、必须有真实 source type/reference。

SYNTHETIC_TESTING：必须有 environment/purpose/nationality snapshot、必须 `officialExportEligible = false`，并且 `sourceType`、`sourceReference`、`officialSubmittedAt` 必须为 null。

Validation 同时存在于 TypeScript canonical service 与 PostgreSQL CHECK constraint。

## 7. Environment Provenance

Synthetic environment 只能是 `LOCAL` 或 `TESTING`，并被持久化到 participation history 和 frozen Payroll snapshot。`assertStatutoryEvidenceWriteAllowed()` 与 `assertStatutoryEvidenceReadAllowed()` 通过 runtime environment fail closed；Production 在任何 synthetic DB write/read 前拒绝。

## 8. Canonical Write

唯一 canonical adapter write 为：

`recordEmployeeLindung24Participation()` in `src/lib/payroll/lindung24-participation-service.ts`

它在 DB access 前执行 environment deny，并继续执行 `VIEW_STATUTORY_PROFILE`、`EDIT_STATUTORY_PROFILE`、whole-business scope、membership/business ownership、expected revision、provenance validation、supersession、digest 与 Audit Log。

没有 direct SQL fixture writer，也没有把 current Draft refresh 纳入本轮。

## 9. Nationality Provenance

Synthetic evidence 必须显式提供 `statutoryNationalitySnapshot`，resolver 使用该 frozen value。它不会从 source reference 猜测，也不会读取未来变化后的员工 current profile 来改写历史语义。

REAL write 仍从 canonical employee statutory profile 取 nationality。Historical legacy rows 不进行推断式 backfill。

## 10. Act 4 Provenance

`act4Covered` 继续作为 participation evidence 中明确、可摘要、可审计的事实，并被包含在 validation、source digest 与 audit metadata。它不会仅凭 nationality、age、member number 或 synthetic purpose 自动推导。

现有 LINDUNG 24 current-policy alignment、foreign/local applicability、selected employer 与 participation status validation 保持不变。

## 11. Effective Dating

Participation history 保持 effective-dated revisions。新 revision 关闭上一 revision 的 effective window，并通过 `supersedesVersionId` 建立链。旧 row 不被覆盖。

PostgreSQL trigger 禁止 UPDATE/DELETE immutable evidence fields，并对 nullable source fields 与全部新 provenance fields 使用 null-safe comparison。Integration test 已验证第二版 supersedes 第一版且第一版保持不可变。

## 12. Tenant Binding

Participation record 继续绑定 business + membership，使用现有 composite foreign keys 与 canonical tenant lookup。Cross-business membership write 被 canonical service 拒绝，数据库约束继续保护最终一致性。

没有 global synthetic evidence，也没有跨 tenant fixture resolver。

## 13. Audit

Synthetic canonical write 使用独立 action：

`STATUTORY_TEST_FIXTURE_CREATED`

Audit metadata 保留 membership、revision、effective month、evidence nature/environment/purpose、official export eligibility、nationality snapshot、Act 4 coverage、status、employer context、selected employer 与 source digest。不会记录 sensitive statutory identifier 或伪造 official reference。

Export deny、Production deny 通过明确 domain error code 提供 observability：

- `SYNTHETIC_STATUTORY_EVIDENCE_FORBIDDEN_IN_PRODUCTION`
- `SYNTHETIC_STATUTORY_EVIDENCE_NOT_EXPORTABLE`
- `STATUTORY_EVIDENCE_CONTRACT_INVALID`

## 14. Resolver Integration

`resolveLindung24Participation()` 接受 runtime environment，并在解析 synthetic row 前执行 read guard。Synthetic nationality 使用 frozen snapshot；LINDUNG 24 policy chronology、Act 4、employment context、selected employer 与 participation status 仍走现有 canonical resolver。

Testing 可计算不代表 rule pack 被 Production activated；本轮没有改变任何 statutory rule governance state。

## 15. Payroll Snapshot

`src/lib/payroll/statutory-p2.ts` 将 evidence nature/environment/purpose、official export eligibility、nationality snapshot、evidence revision/digest 冻结进 `PayrollEntryStatutorySnapshot`。

Snapshot digest 包含新 provenance，任何 nature/environment/purpose/exportability/nationality 变化都会改变 digest，避免 mutable profile 或 UI label 改变已冻结 Payroll truth。

## 16. Payslip Behavior

LOCAL/TESTING Payslip renderer 遇到 synthetic snapshot 时显示：

`TESTING / NON-PRODUCTION STATUTORY FIXTURE`

并显示 environment 与 purpose。Production Payslip renderer 遇到 synthetic snapshot 会拒绝生成。

本轮仅以纯 renderer test 验证此行为，没有 Publish Payslip。

## 17. Export Guards

`src/lib/payroll/statutory-export-eligibility.ts` 提供统一 run-level guard：

`assertPayrollRunOfficialStatutoryExportEligible()`

Statutory CSV/export、artifact create/download 与 correction revision 均已接入。任一 entry snapshot 为 synthetic 或不可 export，整个 run 的 official statutory export fail closed。

## 18. Submission Guards

Statutory submission step-up、事务内 status transition 与 `SUBMITTED` 状态变更均在执行前调用同一个 official eligibility guard。Synthetic snapshot 无法通过提交工作流，也不能通过先创建 artifact 再转换状态来绕过。

## 19. Production Guards

Production deny 为多层 server-side boundary：

1. canonical write before DB access；
2. resolver read；
3. Production Payslip generation；
4. official statutory export；
5. artifact/correction/submission；
6. database provenance constraints。

UI 隐藏不是唯一防线。Production 尝试 synthetic canonical write 的 unit test 已验证 DB 完全不被访问。

## 20. UI

Employee Statutory Profile 会明确显示：

- REAL 或 Synthetic testing fixture；
- environment 与 purpose；
- official export eligible / not eligible；
- synthetic source/reference “not applicable”。

Payroll Run detail 在存在 synthetic snapshot 时显示醒目的 Testing/non-production warning。Synthetic creation option 只在 non-production runtime 可见；server guard 仍为最终 authority。

## 21. Permissions

Synthetic 与 real evidence 使用同一 statutory edit authorization，不因 Testing purpose 放宽。必须具备 `VIEW_STATUTORY_PROFILE` 与 `EDIT_STATUTORY_PROFILE`，并拥有 whole-business scope。Branch-only Staff 不能创建 fixture；cross-business membership 不能被写入。

## 22. Migration

Migration 是 additive/compatible change，并增加 participation/snapshot CHECK constraints、查询 indexes 与更新后的 append-only trigger。

Fresh disposable migration：全部 209 migrations 从空 PostgreSQL 完整应用并销毁，PASS。

Recovery：application 先停止写新字段；确认不存在 synthetic rows 后，才可逆向移除 constraints/columns/enums。不得把 synthetic rows 转成 REAL 作为 rollback。

## 23. Historical Data Treatment

旧 participation rows 在旧 schema 下必须具有 source type/reference，因此 migration 将其安全归类为 REAL，并保留 `officialExportEligible = true`。

旧 snapshot 的 nationality provenance 保持 nullable；没有根据 current employee profile 推断历史 nationality。Missing legacy provenance 必须在未来审计/迁移中明确处理，不能猜测。

## 24. Testing Matrix

已验证：

- LOCAL/TESTING synthetic allow；
- Production write/read deny；
- REAL/SYNTHETIC disjoint contract；
- Testing Payslip marker；
- official export/submission deny；
- canonical write + audit；
- cross-tenant deny；
- supersession + immutable history；
- REAL LINDUNG 24 policy regression；
- fresh migration 与 disposable integration。

所有 synthetic database rows 只存在于 disposable integration transaction 并 rollback；没有写 Railway Testing。

## 25. Security Tests

- Focused facility/LINDUNG 24 unit：18/18 PASS。
- Employee Profile controlled isolation：13/13 PASS（Phase 3B + Phase 4B）。
- Production synthetic write before DB access：PASS。
- Official export deny：PASS。
- Cross-business membership deny：PASS。
- Append-only DB trigger、overlap、cross-tenant FK：PASS。
- TypeScript：PASS。
- ESLint：0 errors（3 个与本设施无关的既有 warnings）。
- `git diff --check`：PASS。

## 26. Regression

Full unit suite：1138/1138 PASS。

Disposable integration：main 185/185 PASS；Attendance route 1/1 PASS。新增 synthetic canonical write/audit/tenant/supersession integration test PASS。

日志内 Prisma 对预期并发冲突/唯一约束场景输出 error-level diagnostics，但 test runner 最终 0 failures。Existing REAL LINDUNG 24 evidence、policy chronology、calculation 与 Payroll paths 保持通过。

## 27. Testing Deployment

**NOT DEPLOYED / NOT EXECUTED**。

本任务禁止部署与修改当前 UAT data，因此没有使用 Railway Testing mutation 作验证。已完成 repository engineering、Prisma generate、fresh migration 与 disposable PostgreSQL verification。

## 28. Known Limitations

- 通用 provenance/guard 已建立；本轮只有 LINDUNG 24 participation adapter 接入。
- Railway Testing 尚未部署和 smoke-test。
- 尚未为 UAT-PAYROLL-001 创建 synthetic statutory persona。
- 尚未 refresh Draft、验证真实 Testing readiness 或发布 Testing Payslip。
- Legacy snapshot nationality 仍可为 null；系统不会猜测。

这些是明确 deferred scope，不是通过 direct DB backfill 解决的事项。

## 29. Production Activation Status

Production activation：**NO**。

没有部署 Production、没有 activate rule pack、没有提交 statutory file、没有执行 payment/bank export。Production 对 synthetic write/read/Payslip/export/submission 的 hard deny 已在代码和测试中建立，但本报告不声明 Production deployment 已发生。

## 30. Final Verdict

**ENGINEERING READY**（repository + disposable PostgreSQL）。

Facility 的 schema、migration、canonical write、audit、effective dating、immutability、tenant/branch isolation、resolver、snapshot、Testing Payslip visibility、Production deny 与 official export/submission deny 已实现并通过验证。

这不等于 Railway Testing deployed、Production ready 或 Payroll UAT completed。当前 UAT Employee 未修改；当前 Payroll Run 未修改且未 refresh/finalize；没有 Payslip publish。

下一步必须另行授权：部署已审核 migration/application 到 Railway Testing，再通过 canonical service 为 UAT-PAYROLL-001 创建 synthetic persona，随后才可 refresh 指定 Draft 与检查 readiness。

安全结论：

- SYNTHETIC MUST NEVER LOOK REAL。
- TESTING EVIDENCE MUST NEVER BECOME OFFICIAL EVIDENCE。
- PRODUCTION REJECTS SYNTHETIC WRITES/READS。
- OFFICIAL EXPORT/SUBMISSION REJECTS SYNTHETIC SNAPSHOTS。
- CANONICAL SERVICES ONLY；HISTORY IMMUTABLE；TENANTS ISOLATED。
