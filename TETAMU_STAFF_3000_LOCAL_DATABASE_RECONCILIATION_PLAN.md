# TETAMU STAFF 3000 LOCAL DATABASE RECONCILIATION PLAN

日期：2026-08-29  
范围：Local / Testing only  
Production：未访问、未修改

## 1. Stop decision

当前共享本地数据库不是可直接丢弃的空数据库。纯读取盘点得到：

| Canonical domain | Records |
| --- | ---: |
| Businesses | 4,634 |
| Employee accounts | 1,770 |
| Employee memberships | 1,771 |
| Attendance sessions | 6 |
| Attendance punches | 18 |
| Roster periods | 15 |
| Published roster assignments | 73 |
| Leave requests | 738 |
| Employee claims | 747 |
| Payroll runs | 811 |
| Payslip publications | 71 |
| Appointments | 9 |
| OT reviews | 4 |
| Attendance resolution cases | 6 |

这些数据包含命名明确的 UAT businesses、Employee/Leave/Claims/Payroll/Payslip evidence；在没有数据 owner 分类前，不能假设它们全部可删除。

因此本轮遵守 STOP condition：

- 不重置旧数据库。
- 不删除旧数据库。
- 不手动编辑 `_prisma_migrations`。
- 不复制 3100 migration folders。
- 不把 development database drift 带到 Production。

## 2. Known lineage difference

Canonical 3000 migration directory：212 migrations，fresh disposable apply PASS。

当前旧本地数据库额外记录了 3100-only migration names：

- `20260822010000_staff_app_appearance`
- `20260822023000_development_concurrent_otp_challenges`
- `20260824130000_staff_app_sms123_otp`（旧库记录中出现重复名称）

Canonical 3000 则拥有：

- `20260824190000_staff_app_sms123_otp`
- `20260829110000_canonical_staff_app_appearance`

旧库 migration table 与 canonical directory 不一致；这不是通过复制旧 migration folder 或直接改 table 可以安全解决的问题。

## 3. Required owner decision

在建立新 active local database 前，数据 owner 必须把旧库内容分为：

1. **RETAIN AS EVIDENCE**：必须长期保留的 UAT/payroll/statutory evidence。
2. **RECREATE FROM CANONICAL FIXTURE**：可由 seed/UAT scripts 在新库重建的测试数据。
3. **ARCHIVE ONLY**：只需保留在旧库备份，不需要迁入新 active local database。
4. **DISPOSABLE**：确认可删除的并发/随机化测试残留。

未完成此分类前，不执行 data copy 或 active database switch。

## 4. Safe migration sequence

### Gate A — Freeze and backup

1. 暂停对旧 local database 的写入窗口。
2. 记录旧 database name、PostgreSQL version、schema digest、migration rows digest 与关键 domain counts。
3. 创建完整 logical backup，并生成 SHA-256。
4. 在独立临时 database 执行 restore verification。
5. 旧 database 保持原名且不删除，直到新库 UAT closure 完成。

### Gate B — Create canonical database

1. 创建一个新、明确命名的 local database，例如 `tetamu_canonical_local_20260829`。
2. 从空库执行 3000 canonical `prisma migrate deploy`。
3. 确认 212/212 migrations，`prisma validate` 与 `prisma generate` PASS。
4. 不导入旧 `_prisma_migrations`。

### Gate C — Data transfer design

禁止直接对全库执行 blind `pg_dump --data-only | psql`。应使用 allowlist、foreign-key aware 的 domain transfer：

1. 先迁 core identity：Business、Branch、User、EmployeeAccount、Membership、Assignments。
2. 再迁 configuration/versioned policy records。
3. 再按 domain 迁 immutable history：Attendance、Roster、Leave、Claims、Payroll、Payslip、Commission、Appointments。
4. 排除 auth challenge、session、rate-limit、idempotency、worker lease、temporary queue 与 `_prisma_migrations` 等 ephemeral state。
5. 所有 transfer 必须保留 tenant/branch/membership IDs 与 canonical foreign keys。
6. 对 3100-only appearance 数据，仅映射到 canonical `staff_app_logo_url` / `staff_app_appearance` columns。
7. OTP challenge/provider history不迁入新 active local DB；重新登录产生 canonical session。

### Gate D — Reconciliation evidence

迁移前后比较：

- 每个 allowlisted table 的 row count。
- Business/Branch/Membership tenant joins。
- Leave ledger totals。
- Claims submitted/approved/reimbursement totals。
- Attendance punch/final result/session counts。
- Roster publication/version counts。
- Payroll run/entry/snapshot/payslip publication counts和 money totals。
- Attachment/document object existence与 digest。

任何差异必须有 allowlisted exception record，不允许静默跳过。

### Gate E — Local cutover

1. 仅修改 local development `DATABASE_URL` 指向新 canonical DB。
2. 启动 3000；3100 继续停止。
3. 执行 Staff employee、manager、security、mobile UAT。
4. 连续验证 migration status clean、runtime health 和 canonical writes。
5. 旧数据库继续只读保留至少一个确认周期。

## 5. Rollback

如果新库出现 identity、tenant、money、document 或 migration 差异：

1. 停止新库写入。
2. 将 local `DATABASE_URL` 切回未修改的旧数据库。
3. 保留新库作诊断，不覆盖旧库。
4. 不在两个库之间做双写。

## 6. Exit criteria

只有以下全部满足，local baseline 才能关闭：

- 旧库已完成可恢复 backup。
- 数据 owner 完成四类数据分类。
- 新库 212/212 canonical migrations clean。
- allowlisted data reconciliation 0 个未解释差异。
- Staff 3000 employee/manager/multi-business UAT PASS。
- security negative tests PASS。
- 真实设备结果如实记录。
- 旧库仍可回滚。

当前状态：**PLAN COMPLETE — EXECUTION REQUIRES DATA OWNER CLASSIFICATION / REVIEW**。
