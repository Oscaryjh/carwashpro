# TETAMU HR & Payroll Release Runbook

## 1. 适用范围

本 Runbook 只适用于 TETAMU HR & Payroll 的受控发布。当前认证边界为：

```text
Payroll Calculation: READY EXCEPT PCB
PCB: DEFERRED / application and configuration pending
```

未计算的 PCB 必须显示为 `Pending configuration` 与 `Not included in net pay`，不得显示为 `PCB RM0.00`。

## 2. 环境边界

发布前必须逐项确认：

```text
Railway project: Tetamu-POS
Environment: testing（生产演练前）或明确获批的 production（正式发布时）
Desktop: 对应环境的 tetamu-pos-web
Staff: 对应环境的独立 tetamu-staff-app（canonical 3100 app）
```

禁止把 main repository 内旧 `/staff` surface 当作独立 Staff release source。禁止在未明确确认环境时执行数据库、部署或变量变更。

## 3. Pre-deploy

1. 冻结 branch、commit SHA、migration head、source digest。
2. `git status --short` 必须为空，或逐项分类为 `RC_REQUIRED / UNRELATED / UNKNOWN`。
3. 运行并保留结果：
   - unit tests；
   - disposable integration tests；
   - TypeScript；
   - ESLint；
   - `git diff --check`；
   - official evidence pack verification；
   - P2C retained dataset/calculator verification；
   - statutory targeted regression。
4. 检查 Testing/Production variables 时不得打印 secrets。
5. 核对 `APP_RELEASE_SHA`、`APP_RELEASE_SOURCE_DIGEST`、environment contract。
6. 记录 Desktop、Staff、Worker 当前 known-good deployment ID。

## 4. Backup

1. 使用独立 `tetamu-db-backup` Railway Cron service 与服务器主版本兼容的 PostgreSQL client。
2. Daily schedule 为 `30 18 * * *` UTC（02:30 Asia/Kuching）；Production 必须另行批准后才启用。
3. 对目标数据库执行 custom-format backup：

```powershell
npm run db:backup
```

4. Job 执行 `pg_dump -Fc`、catalog validation、SHA-256、AES-256-GCM、private object upload、manifest-last commit 与 retention。
5. Backup 必须保存于数据库 volume 之外的 private durable object storage，不得只保存于容器 disk、repository 或开发电脑。
6. Credentials 只能来自 Railway secrets；不得打印 DB URL、Bucket secret 或 encryption key。
7. 记录 UTC timestamp、environment、release commit、migration head、tool version、encrypted bytes、SHA-256、catalog entries 与 manifest key。
8. 重叠 job 由 private bucket lock 阻止；command timeout 默认 30 分钟。

## 5. Backup verification

必须同时满足：

```text
file exists
file size > 0
SHA-256 recorded
pg_restore --list succeeds
catalog entry count > 0
AES-256-GCM encryption succeeds
encrypted SHA-256 recorded
remote object HEAD succeeds
healthy manifest uploaded last
```

建议命令：

```powershell
pg_restore --list <backup.pgdump>
Get-FileHash -Algorithm SHA256 <backup.pgdump>
```

任何 gate 失败均非零退出并触发 `database_backup_failed`。只有 archive 没有 healthy manifest 时不得算成功；upload failure 必须清理 partial remote object。

### Retention

1. 最低保留 30 天；
2. 删除前列出 candidates；
3. 保留 latest healthy、pre-deploy protected、当前 restore 使用中的 backup；
4. 支持 `--dry-run-retention`；
5. Retention 结束写 structured `database_backup_retention_completed` event。

### Pre-deploy gate

高风险 migration、major release、payroll/statutory migration 前必须执行 `npm run db:backup -- --predeploy`。Production release 必须确认 latest healthy backup age `< 24h`，否则 `GO-LIVE BLOCKED`。

## 6. Disposable restore

1. 使用 `npm run db:restore-verify`；脚本强制 `--disposable` 并拒绝 Production environment。
2. 下载 latest healthy manifest/archive，先验证 encrypted SHA，再解密并验证 plaintext SHA 与 catalog。
3. 创建隔离 PostgreSQL，不得覆盖 Testing live DB / Production。
4. Restore custom archive；要求 `--exit-on-error` 且 0 fatal errors。
5. 核对 Businesses、Branches、Employees、Memberships、Roster、Attendance、Leave、Claims、Commission、Timesheets、Payroll Runs、Payroll Entries、statutory snapshots、Payslip publications、Audit Logs。
6. 核对 known immutable Payroll/Payslip artifact IDs 与 `FINALIZED` / `PUBLISHED` 状态。
7. 检查 FK、tenant composite keys、unique/check constraints、append-only/immutable guards、synthetic statutory evidence/export guards。
8. 上传非敏感 restore verification result；停止隔离 PostgreSQL 后删除 disposable data、download 与 decrypted dump。
9. Monthly schedule 为 `30 19 1 * *` UTC（每月 2 日 03:30 Asia/Kuching）。失败触发 `database_restore_verification_failed`。

## 7. Migration

### Testing/target status

```powershell
npx prisma migrate status
```

要求：schema up to date、无 failed migration、无 unexpected pending migration。

### Fresh migration

对空 disposable PostgreSQL 执行：

```powershell
npx prisma migrate deploy
```

记录 migration count、duration、head 与 failures。

### Upgrade migration

只有在能重现 previous-release schema/backup 时才可标为 `PASS`。否则诚实记录为 `PARTIAL`。

## 8. Migration recovery

Prisma 没有自动 down migration。Migration 失败时：

1. 停止新 writes。
2. 停止或回滚 application deployment。
3. 检查 `_prisma_migrations` 与实际 schema 状态。
4. 判断是 forward-fix，还是从 pre-deploy backup 还原数据库。
5. 部署 schema-compatible known-good application。
6. 重新运行 migration status、health 与 read-only smoke。
7. 在数据/约束完成核对前禁止恢复 writes。

## 9. Deploy

1. 从冻结的 local source 或已验证 remote commit 部署 Desktop 与独立 Staff。
2. 如 worker code 未变，不要求无意义重部署；记录其当前 deployment。
3. 每项记录 deployment ID、commit/source、image digest、build/start status。
4. Pipeline 必须包含 dependency install、Prisma generate、migration/predeploy、TypeScript/Next build、startup。
5. 禁止依赖未验证的 connected GitHub branch 自动部署。CLI source 与 connected repository source 必须一致。

## 10. Health

Desktop `/api/health` 必须确认：

```text
HTTP 200
application alive
database ready
environment correct
deployment ID present
commit SHA/source digest matches RC
```

Staff `/staff/login` 必须 HTTP 200。建议 Railway deployment healthcheck 明确配置为 Desktop `/api/health`；缺少 provider healthcheck gate 属于 go-live blocker。

## 11. Read-only smoke

### Desktop

检查 Login、Dashboard、People、Roster、Attendance、Leave、Claims、Commission、Timesheet、Payroll、Payroll Run detail、Payslip read。未登录时 protected route 返回登录重定向属于正常授权边界；不得出现 500。

### Staff

检查 Login、Home、Roster/Time、Timesheet、Requests、Pay、Payslips、Profile。若避免发送 SMS，只验证 route/auth boundary，并引用此前已通过的 real-device auth UAT；不得伪造本轮 OTP 结果。

## 12. Payroll statutory regression

使用 frozen automated fixtures，不创建真实 Payroll transaction。RM3,000 baseline 必须保持：

| 项目 | Employee | Employer |
| --- | ---: | ---: |
| EPF | RM330.00 | RM390.00 |
| SOCSO | RM14.75 | RM51.65 |
| EIS | RM5.90 | RM5.90 |
| LINDUNG 24 | RM0.00（valid local voluntary opt-out） | RM0.00 |

```text
Employee deductions excluding PCB: RM350.65
Net excluding PCB: RM2649.35
Employer statutory cost: RM447.55
PCB: Pending configuration; not included in net pay
```

任何数值 drift 均为 release blocker。

## 13. Monitoring and alerting

必须分别核对：

- Logging：结构化运行日志、stable error code、audit record；
- Monitoring：deployment status、HTTP/DB health、worker/provider failures；
- Alerting：service down、health/DB failure、5xx spike、deployment/worker/OTP provider failure 的主动通知。

只有 logs 不等于 alerting。若无 notification rules，必须标为 `ALERTING INCOMPLETE`。

Backup/restore 必须配置真实 `BACKUP_ALERT_WEBHOOK_URL` 接收端；只有 hook code 或 structured error log 只能标 `PARTIAL`。告警 payload 必须包含 environment、timestamp、event/stage 与 error，且必须脱敏 DB URL、password、token、API key 与 encryption key。

### Backup failure response

1. 查看 `database_backup_failed` 与 Railway cron status；
2. 不创建或修改 healthy manifest；
3. 修复后手动触发一次 Testing equivalent；
4. 对新 backup 运行 disposable restore；
5. latest healthy age 达 24 小时时阻止 release；
6. 连续失败升级至 System Administrator / Release Owner。

### Restore verification failure response

1. 查看 `database_restore_verification_failed`；
2. 保留相关 healthy backup，不执行 retention 删除；
3. 检查 hash、encryption key version、PostgreSQL tool version、catalog 与 restore error；
4. 使用隔离环境重演，不得 restore live Testing/Production；
5. 在新的 restore verification PASS 前不得声称 backup policy ready。

## 14. Rollback triggers

以下任一情况触发 application rollback 或 release stop：

- `/api/health` 非 200 或 DB 非 ready；
- release SHA/digest 不匹配；
- migration failure；
- 500/authorization regression；
- statutory baseline drift；
- PCB 被错误显示为 RM0；
- synthetic evidence 可写入 Production/官方导出；
- Staff canonical routes不可用；
- source/image drift。

## 15. Application rollback

1. 先确认 previous known-good image 能读取 current schema。
2. 记录 from/to deployment、开始时间。
3. 使用 Railway deployment rollback 恢复 known-good image；不回滚 DB。
4. 等待 Desktop/Staff deployment `SUCCESS`。
5. 执行 health、route smoke 与 known Payroll/Payslip artifact read-only verification。
6. 若 schema 不兼容，停止 blind rollback，改走 migration recovery。

## 16. DB restore triggers and steps

只有在 schema/data 已发生不可安全 forward-fix 的破坏时才还原 DB：

1. 停止 writes 与所有写入 worker。
2. 保存事故后 forensic backup。
3. 确认 pre-deploy backup hash 与 catalog。
4. 在 disposable DB 重演 restore。
5. 经 owner 批准后还原目标 DB。
6. 核对 migration history、关键 counts、Payroll/Payslip artifacts、constraints/triggers。
7. 部署 schema-compatible known-good app。
8. health、smoke、审计后再恢复 writes。

Production restore ownership：System Administrator / Release Owner 发起；Business Owner + Payroll Owner 批准；System Administrator / Database Operator 执行；Engineering Owner + Payroll Owner 复核；Release Owner 批准恢复 writes。Monthly verifier 无 Production restore 权限。

## 17. Post-release verification

1. `/api/health` 200、DB ready、environment 与 deployment identity 正确。
2. Desktop/Staff final smoke 无 500。
3. Statutory targeted regression全部通过。
4. Existing Finalized Payroll、Published Payslip、statutory snapshots保持不变。
5. 无 payment、bank export、mark-paid 或 statutory submission。

## 18. Incident escalation

发布负责人必须保留：deployment IDs、timestamps、health response、backup hash、migration status、route/error code、rollback result。涉及 Production、财务、statutory、身份或 private attachment 泄漏时立即停止 writes 并升级至 Business Owner、Payroll Owner、Security/Engineering Owner；不得在工单或聊天粘贴 secrets。

## Monitoring and alert response

Testing and future Production use the structured operational event contract documented in
`TETAMU_MONITORING_AND_ALERTING_POLICY.md`. The receiver is configured only through the
server-side `OPS_ALERT_WEBHOOK_URL`; never place its value in source, documentation, tickets,
screenshots or shell output. Production activation is a separate approved change.

| Severity | Meaning | Initial owner | Expected response |
| --- | --- | --- | --- |
| INFO | Audit/recovery/expected security control | System Administrator | Review during normal operations |
| WARNING | External provider rejection or degraded path | System Administrator | Triage during the operating window |
| ERROR | Repeated request/job failure | Release Owner | Investigate promptly and stop the affected release if needed |
| CRITICAL | Backup, restore, database or service availability failure | Release Owner | Immediate triage and Technical Owner escalation |

### Backup failure

Confirm `BACKUP_JOB_FAILED`, job time, stage and deployment/job ID in the receiver and Railway
logs. Do not delete the latest healthy backup. Check credentials by presence only, storage
availability, lock state and archive validation. Re-run only after the cause is fixed, then prove a
new `HEALTHY` manifest and record recovery in the release evidence.

### Restore verification failure

Confirm `RESTORE_VERIFICATION_FAILED`. Preserve the source backup and the last successful restore
report. Inspect checksum, decryption, disposable PostgreSQL startup, migration head and immutable
Payroll/Payslip verification. Never restore over Testing or Production as part of triage.

### Service or database failure

For `SERVICE_HEALTH_FAILED`, check Railway deployment state, `/api/health` for Desktop and
`/staff/login` reachability for Staff. For `DATABASE_UNAVAILABLE`, check PostgreSQL deployment and
private connectivity without restarting or mutating Production. A recovery alert requires two
consecutive successful probes.

### HTTP 5xx response

`HTTP_5XX_THRESHOLD_EXCEEDED` means five captured request errors within five minutes. Inspect the
safe route and service metadata, then correlate with Railway logs and deployment ID. One isolated
500 does not page the receiver.

### SMS123 response

`SMS123_PROVIDER_ERROR` distinguishes rejection, timeout, unavailability and invalid response.
Provider acceptance followed by handset non-delivery is not classified as an application outage.
Never include phone numbers, OTP values or API keys in the alert.

### Alert delivery failure

If webhook delivery fails after three bounded attempts, search Railway logs for
`ALERT_DELIVERY_FAILED`. Treat this as an observability incident: verify receiver availability and
secret presence, then use the Testing-only alert tool. Do not print or rotate Production secrets as
part of Testing triage.
