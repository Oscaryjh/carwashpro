# TETAMU Database Backup and Restore Policy

## 1. Scope

本政策覆盖 TETAMU PostgreSQL 中的全部业务资料，包括身份、员工 PII、银行资料、Attendance、Leave、Claims、Timesheet、Payroll、Payslip metadata、statutory snapshots、audit logs 与 Prisma migration history。备份不得只选择 HR 表。

工程实现：

```text
scripts/db-backup.mjs
scripts/db-restore-verify.mjs
scripts/lib/database-backup-core.mjs
Dockerfile.database-ops
```

## 2. Data Classification

数据库备份属于 `Restricted / Payroll & PII`。禁止公开 URL、禁止写入 Git、禁止发送到聊天或工单，只允许受授权的 System Administrator / Release Owner 读取。

## 3. Backup Schedule

| 类型 | Asia/Kuching | Railway UTC cron | 目的 |
| --- | --- | --- | --- |
| Daily | 每日 02:30 | `30 18 * * *` | RPO 24 小时以内 |
| Monthly restore verification | 每月 2 日 03:30 | `30 19 1 * *` | Railway 以 UTC 于每月 1 日 19:30 执行；Asia/Kuching 为次日，验证最新 healthy backup 可还原 |
| Pre-deploy | 高风险 migration / major release 前 | 手动 gate | 保留发布前恢复点 |

执行者是独立 Railway Cron services：`tetamu-db-backup` 与 `tetamu-db-restore-verify`。Testing 已配置；Production 尚未启用。

## 4. Retention

最低保留 30 天。删除前必须找出所有 `HEALTHY` manifest，并保留 latest successful、`predeploy` protected、当前 restore drill 使用中的 backup 及至少一个 healthy backup。Retention 先列 candidates，支持 `--dry-run-retention`，再删除成对 archive/manifest。

Railway Bucket 当前没有 lifecycle、object versioning 或 object lock，因此 retention 由 Tetamu script 执行。

## 5. Backup Format

使用 PostgreSQL custom format：

```text
pg_dump --format=custom --compress=9 --no-owner --no-privileges
```

命名：

```text
tetamu-<environment>-postgres-YYYYMMDD-HHMMSS.dump
tetamu-<environment>-postgres-YYYYMMDD-HHMMSS.dump.enc
tetamu-<environment>-postgres-YYYYMMDD-HHMMSS.manifest.json
```

Archive 包含 schema、data、indexes、constraints、triggers、migration history 与所有业务表。

## 6. Backup Storage

Testing 使用 PostgreSQL volume 之外的 private Railway S3-compatible Bucket，保存于非公开 prefix：

```text
database-backups/testing/archives/
database-backups/testing/manifests/
database-backups/testing/restore-verifications/
```

它是独立 storage resource，不是容器临时盘、repository 或开发电脑。Production 激活前必须建立 Production 专用 private prefix 或 Bucket。

## 7. Encryption

- Transport：provider private network 或 TLS；
- At rest：上传前 AES-256-GCM 客户端加密；
- Integrity：记录 plaintext 与 encrypted object SHA-256；
- Key：`BACKUP_ENCRYPTION_KEY` 只存在 Railway secret，manifest 只记录 key version；
- Rotation：旧 key 保留到对应备份过期或经验证迁移完成。

Railway Bucket 当前不声明 server-side encryption，因此客户端加密是强制 gate。

## 8. Access

Backup job 只需读取数据库并写指定 private prefix；Restore verifier 只读取 backup、写 verification result，并只创建容器内 disposable PostgreSQL。普通 Web/Staff 用户无访问权。DB、Bucket 与 encryption credentials 必须来自 Railway secrets，禁止 hardcode、tracked `.env`、Markdown 或运行日志。

## 9. Backup Validation

只有以下全部通过，manifest 才以 `HEALTHY` 最后写入：

```text
pg_dump exit 0
file size > 0
pg_restore --list exit 0
catalog entries > 0
plaintext SHA-256 generated
AES-256-GCM encryption completed
encrypted SHA-256 generated
archive upload and remote HEAD completed
manifest uploaded last
```

任何失败均非零退出并产生 `database_backup_failed`。若 archive 已上传但 manifest 未完成，job 删除 partial archive；没有 healthy manifest 的对象不得被 restore 或 retention 当作成功备份。

## 10. Pre-deploy Backup

任何 Production schema migration、major release 或 payroll/statutory migration 前必须运行 verified `--predeploy` backup。Release gate 必须确认 status `HEALTHY`、latest success age `< 24h`、environment/release commit 正确、catalog > 0 且 SHA 已记录；否则 `GO-LIVE BLOCKED`。

## 11. Restore Verification

`scripts/db-restore-verify.mjs` 强制 `--disposable`、拒绝 Production environment，且不接受 live target URL。流程为：download → encrypted SHA → decrypt → plaintext SHA → catalog → disposable PostgreSQL 18 → restore `--exit-on-error` → integrity checks → upload result → stop/cleanup。

## 12. Monthly Restore Drill

每月选择 latest healthy backup，验证 migration head、Businesses、EmployeeAccounts、Memberships、Attendance、Leave、Claims、Timesheets、Payroll、Payslips、Audit、known immutable Payroll/Payslip artifacts、FK/unique/check constraints 与 user triggers。失败产生 `database_restore_verification_failed`。Backup success 不等于可还原。

## 13. RPO

目标 RPO：`24 hours maximum`。Pre-deploy backup 可在高风险变更前进一步缩短恢复点差距。

## 14. RTO

RTO 必须引用 Testing E2E 实测 restore duration。初始 Production operational RTO 建议 `4 hours`，包含冻结 writes、授权、forensic backup、disposable rehearsal、目标恢复与应用验证；不得承诺未经验证的 15 分钟。

## 15. Failure Alert

立即告警事件为 `database_backup_failed` 与 `database_restore_verification_failed`。Payload 包含 environment、timestamp、event/stage、status/error、backup/manifest identifier，不含 DB URL、password、token、API key 或 encryption key。

配置 `BACKUP_ALERT_WEBHOOK_URL` 后发送真实 webhook；未配置时只有结构化失败日志，必须标 `PARTIAL`。Success 只写 structured operational event。Railway deployment notification 可作为第二通道，但不能替代应用级告警。

## 16. Recovery Owner

- Initiate：System Administrator / Release Owner；
- Approve Production restore：Business Owner + Payroll Owner；
- Execute：System Administrator / Database Operator；
- Verify：Engineering Owner + Payroll Owner；
- Resume writes：Release Owner 在 reconciliation 全部通过后批准。

## 17. Production Restore Approval

Production restore 只能通过独立 emergency procedure：停止 writes/workers → forensic backup → 核对 manifest/hash → disposable rehearsal → Business Owner + Payroll Owner 批准 → restore → migration/data/artifact/guard reconciliation → compatible app health/smoke → 恢复 writes。Monthly verifier 永远不得还原 Production。

## 18. Cleanup

Backup/restore scripts 在 `finally` 中删除容器临时目录。Disposable PostgreSQL 必须先停止再删除。Upload 失败的 partial archive 必须删除；无 healthy manifest 的对象不得保留为成功证据。

## 19. Incident Handling

失败时确认 event/job status，不伪造 manifest；修复后受控触发一次 Testing backup 并完成 restore verification。Latest healthy age 达 24 小时时阻止 Production release；连续失败升级给 Release Owner 与 System Administrator。不得在工单/聊天粘贴 secrets 或 backup artifact。

## 20. Testing Evidence

Testing E2E 只记录 backup timestamp、encrypted bytes、SHA-256、catalog count、manifest key、restore duration、关键资料与 constraint/trigger checks，不公开 artifact。详细证据位于 `docs/TETAMU_SCHEDULED_BACKUP_RESTORE_READINESS.md`。

2026-08-27 latest Testing evidence：3,195,059 encrypted bytes、3,075 catalog entries、SHA-256 `746af99838625974ad0012f35d5c99db45845ad88bfb8ba65261bf853e73168b`，disposable restore 与 Payroll/Payslip/guards reconciliation PASS，实测约 11.7 秒。

## 21. Production Activation

只有 Testing backup/restore E2E、30 天 retention、真实 alert destination、Production private storage/secrets、recovery ownership 与 Runbook 均通过后，才可另行授权启用 Production schedule。

当前边界：

```text
TESTING VERIFIED（以 Readiness 报告最终结果为准）
PRODUCTION CONFIG READY
PRODUCTION ACTIVATION PENDING
```
