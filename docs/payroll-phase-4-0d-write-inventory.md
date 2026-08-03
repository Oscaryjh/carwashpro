# Payroll Phase 4.0D — Mandatory Write Inventory

本清单以 `ccd59305d6926db741a4dcd987ede4b1101aeaa5` 为审查基线，范围只包括员工长期 Payroll Profile。Business Payroll Settings、Payroll Entry 月度调整、Payroll Run、Statutory Artifact 和 Submission workflow 不属于长期员工 Profile 写入。

| 入口 | 基线写入 / 调用者 | 基线 Capability / Scope | 基线 Audit / Transaction / Validation | Phase 4.0D 处理 |
|---|---|---|---|---|
| `src/app/(business)/team/actions.ts` → `createStaffAction` / `updateStaffAction` | Team create/edit 经 People Service 写薪资、Pay Basis、Work Target | `MODIFY_ATTENDANCE_EMPLOYEES` + `EDIT_COMPENSATION`；People whole-business scope | People/Attendance transaction；Compensation Version 有安全 Audit；Work Target 只有通用 Employee Audit | 保留旧 UI，作为 compatibility caller；由 Attendance Employee Service 调用 Compensation 与 Work Target canonical commands |
| `src/lib/team/people-service.ts` → `createTeamMember` / `updateTeamMember` | Team actions 的 orchestration；调用 Attendance Employee Service | 上游传入 resolved access、allowed branches、whole-business flag | 单一 outer transaction；通用 Team/Employee Audit | 保留 orchestration，不直接写 Payroll Profile；向下游 canonical wrapper 传 trusted access |
| `src/lib/attendance/employee-service.ts` → create/update | 基线 create 直接写 `payBasis`、`baseSalary`、work target；update 直接写 work target，并调用 Phase 4.0C Compensation Version | 基线薪资要求 Compensation authorization；普通 Employee action 仅 Attendance capability 仍可能写 Work Target | 单 transaction；Compensation safe Audit；通用 Employee Audit | create 先建立空 projection，再在同 transaction 执行 canonical commands；update 移除 direct payroll field update；无 Compensation capability 的 Attendance action强制保留或清空 Payroll fields |
| `src/app/(business)/team/employees/actions.ts` | 独立 Attendance employee form 提交 Work Target | `MODIFY_ATTENDANCE_EMPLOYEES`；branch/people scope | Attendance Employee Service transaction 与通用 Audit | block write：该入口不具 Payroll capability，create 写 null、update 保留现值；不再接收 Work Target 作为可信修改 |
| `src/app/(business)/team/payroll/actions.ts` → `saveEmployeeStatutoryProfileAction` | 直接写 statutory enrollment、eligibility、category，同时曾写 DOB | `EDIT_STATUTORY_PROFILE` + whole-business payroll scope | 手写 sensitive Audit；单 transaction；页面 schema + action validation | compatibility wrapper 调用 `updateEmployeeStatutoryProfile()`；DOB 改为只读且不由 Statutory command 修改 |
| `src/app/(business)/team/payroll/statutory/actions.ts` → `saveEmployeeSubmissionProfileAction` | 直接写 Identity、Country、EPF/SOCSO member number、TIN | 基线同时要求 `EDIT_STATUTORY_PROFILE`、`EDIT_TAX_PROFILE` + whole-business scope | 手写 sensitive Audit；单 transaction；最小字段长度/格式 | compatibility wrapper 调用 `updateEmployeeTaxProfile()`；只要求 Tax View+Edit；返回/审计只保留 masked identifier |
| `src/lib/payroll/compensation-version.ts` | 建立/supersede immutable monthly version，并同步 Membership compatibility projection | 自身验证 View+Edit Compensation + whole-business | Serializable caller transaction；Phase 4.0A safe Audit；month/rate/tenant validation | approved internal primitive；只由 Compensation canonical command或 Payroll projection repair 调用；projection update启用 transaction-local DB guard |
| Payroll Generate / Refresh (`src/lib/payroll/service.ts`) | 读取 applicable Compensation Version，建立 Payroll Entry snapshots | Payroll Run capabilities由 action boundary验证 | Payroll transaction + Audit；Version resolver fail-closed | 保留只读 resolver；不成为 Profile write；不自动由 canonical save 触发 |
| API routes / AI Agent | 基线未发现长期 Employee Payroll Profile 写入口 | 无 | 无 | 未来必须建立 trusted `PayrollProfileWriteContext` 并调用四个 domain command；禁止 direct Prisma |
| seeds / imports | `prisma/seed.ts` 未发现这些员工敏感字段的运行时更新入口 | development fixture | seed boundary | test/development fixture exception；不得作为 runtime mutation path |
| unit/integration fixture | 测试直接 create/update Membership 以构造 fixture 或验证 guard | test process only | embedded PostgreSQL transaction/cleanup | test-only exception；受保护字段 update 必须显式启用 approved maintenance/canonical transaction setting |
| raw SQL | 基线 runtime source 未发现修改这些字段的 raw SQL | 无 | 无 | Migration 增加 DB trigger；未设置 canonical/maintenance transaction flag 的 direct UPDATE fail-closed |

## Canonical ownership

- Compensation：`scheduleEmployeeCompensationChange()`
- Payroll Work Target：`updateEmployeePayrollWorkTarget()`
- Statutory enrollment / eligibility：`updateEmployeeStatutoryProfile()`
- Tax / submission identity：`updateEmployeeTaxProfile()`

每个 command 均独立执行 capability、tenant、whole-business scope、domain revision、idempotency、draft impact、safe Audit 和 serializable transaction。不存在 mass-update `updateEmployeePayrollProfile()`。

## Approved direct-write boundaries after Phase 4.0D

1. `employee-profile-write/*` 内部 domain write。
2. `compensation-version.ts` 的 immutable version primitive 与 current projection synchronization。
3. Membership 首次建立时的空/default Payroll projection；实际 Payroll 配置随后由同一 outer transaction 内的 canonical command建立。
4. Test fixture create 与显式 maintenance cleanup。

其余 runtime direct updates 均由数据库 trigger拒绝，并由 source-guard regression test持续检查。
