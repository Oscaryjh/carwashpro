# TETAMU Scheduled Backup & Restore Readiness

## 1. Executive Summary

Testing 已完成真实 `pg_dump → encrypt → upload → manifest → retention → download → decrypt → disposable restore → reconciliation → cleanup` 演练。自动备份、30 天 retention、可还原性、Payroll/Payslip 与数据库 guards 均通过；但实际告警接收端尚未配置，因此最终结论为 `CONDITIONAL`，不得启用 Production schedule。

## 2. Existing Capability Audit

Railway PostgreSQL 提供 volume 与可选 provider backup/PITR 能力，但 provider capability 不替代 Tetamu-managed portable logical backup。当前项目此前没有 Tetamu 定时 backup job、30 天 script retention、独立 restore verifier 或 application-level failure alert destination。

本轮采用双层策略：

- Provider layer：Railway PostgreSQL volume / provider recovery capability；
- Tetamu layer：PostgreSQL custom dump、异故障域 private Bucket、客户端加密、manifest、retention 与 disposable restore verification。

## 3. Target Policy

```text
Daily backup: 02:30 Asia/Kuching
Retention: minimum 30 days
Monthly restore verification: day 2, 03:30 Asia/Kuching (`30 19 1 * *` UTC)
Pre-deploy verified backup: required
Failure alert: immediate
RPO: 24 hours maximum
Operational RTO: 4 hours
```

## 4. Backup Implementation

实现：

```text
scripts/db-backup.mjs
scripts/lib/database-backup-core.mjs
scripts/db-backup-status.mjs
Dockerfile.database-ops
```

流程 fail closed，任何 stage 失败均 non-zero exit。Archive 使用 deterministic name `tetamu-<environment>-postgres-YYYYMMDD-HHMMSS.dump.enc`；manifest 最后写入，未完成 manifest 的 archive 不算 healthy backup。

## 5. Scheduler

Testing Railway Cron service：`tetamu-db-backup`。

```text
UTC cron: 30 18 * * *
Asia/Kuching: daily 02:30
Restart policy: NEVER
Overlap: Railway cron overlap protection + private Bucket conditional lock
Timeout: bounded command timeout
```

Web deployment restart 不会取消独立 Cron service。Production schedule 未创建或启用。

## 6. Storage

Testing backup 位于 private Railway S3-compatible Bucket 的 `database-backups/testing/` prefix。Bucket 是数据库 volume 之外的 durable storage resource，不是 container disk、repository 或开发电脑；无 public URL。Production 必须使用另行授权的 Production private prefix/Bucket。

## 7. Encryption

- Client-side AES-256-GCM before upload；
- TLS / Railway private network in transit；
- plaintext 与 encrypted SHA-256 均写入 manifest；
- key 只来自 Railway secret，manifest 只记录 key version；
- archive 不以 plaintext 形式留在 remote storage。

结论：`PASS`。

## 8. Credentials

DB、Bucket 与 encryption credentials 通过 Railway secret/reference 注入。源码、Git、manifest、结构化事件与本文均不含 secret。命令调用不把 password 放进 CLI arguments，错误文字经过 redaction。

## 9. Validation

Backup healthy gate：file size、`pg_restore --list`、catalog count、plaintext SHA、AES encryption、encrypted SHA、remote upload、manifest-last 全部通过。Testing 最新 backup：

```text
Created: 2026-08-27T01:35:24.758Z
Encrypted bytes: 3,195,059
Encrypted SHA-256: 746af99838625974ad0012f35d5c99db45845ad88bfb8ba65261bf853e73168b
Catalog entries: 3,075
Status: HEALTHY
```

## 10. Manifest

Manifest 记录 environment、mode、timestamp、database identity、application release、migration head、source/encrypted bytes 与 SHA、catalog entries、pg_dump version、encryption key version 与 protected flag。它不记录 URL、password、tokens 或 encryption material。

## 11. Retention

`planRetention` 实施 30 天窗口并保护 latest healthy、predeploy、当前 restore 与 minimum healthy。删除前先列 candidates；支持 `--dry-run-retention`。Testing 临时 schedule 产生的 3 个 healthy backups 均处于 30 天窗口；latest healthy 被明确保护，删除 candidates 为 0。Partial archive 会在 manifest commit 失败时清理。

## 12. Alerts

Backup 与 restore failure 均产生脱敏 structured events，并会向 `BACKUP_ALERT_WEBHOOK_URL` 发送 immediate alert。测试已验证未配置 destination 时明确回报 `ALERT_DESTINATION_NOT_CONFIGURED`，而不是静默成功。

当前实际 destination 缺失，因此：

```text
Failure alert implementation: PASS
Actual alert delivery: PARTIAL
Release impact: Production activation blocker
```

## 13. Restore Implementation

实现：`scripts/db-restore-verify.mjs --disposable`。流程为 download、encrypted SHA、decrypt、plaintext SHA、catalog、isolated PostgreSQL 18、`pg_restore --exit-on-error`、data/guard reconciliation、verification result upload、stop 与 cleanup。

## 14. Restore Safety

Verifier 强制显式 `--disposable`，拒绝 Production environment，不接受 live target connection string，也不会连接或覆盖 Testing live database。Production restore 必须走独立 emergency Runbook 与多人批准。

## 15. Data Integrity

Testing restore 后检查：

```text
Migration head: 20260826173000_non_production_statutory_fixture_evidence_facility
Businesses: 7
Employee Accounts: 47
Memberships: 46
Attendance Punches: 25
Leave Requests: 5
Claim Lines: 2
Timesheets: 4
Payroll Runs: 8
Payroll Entries: 54
Payslip Publications: 1
Audit Logs: 1,043
Unique constraints: 100
Check constraints: 393
User triggers: 269
```

所有核心表可访问且 migration history 存在。

## 16. Payroll Restore Verification

Known Testing immutable artifacts 均存在且关系/状态保留：

```text
Payroll Run 2972941a-8067-4076-bf3b-24ddf08b308a: FINALIZED
Payroll Entry 09a34a1a-fc19-40f6-bede-7ce2956b84eb: PRESENT
Payslip Publication 34993730-8dfb-4754-a32a-9594123f11a3: PRESENT / PUBLISHED artifact retained
```

结论：Payroll `PASS`，Payslip `PASS`。

## 17. Constraints

Restore 后确认 foreign-key catalog、unique/check constraints 与 user triggers 存在，并明确验证：

```text
payroll_runs_finalized_lock
payroll_entries_non_draft_guard_update
payroll_payslip_publication_immutable_guard
payroll_entry_statutory_snapshots_immutable
```

结论：`PASS`。

## 18. Monthly Restore

Testing Railway Cron service：`tetamu-db-restore-verify`。

```text
UTC cron: 30 19 1 * *
Asia/Kuching: monthly day 2, 03:30
Source: latest HEALTHY manifest
Target: disposable PostgreSQL only
Failure event: database_restore_verification_failed
```

机制及 Testing-equivalent manual execution 均通过；首个自然月度 scheduled run 尚待日历触发，不影响机制验证。

## 19. RPO

`24 hours maximum`。Daily schedule 形成每日恢复点；高风险 release 前 verified predeploy backup 提供额外恢复点。

## 20. RTO

Testing 完整 download、decrypt、restore 与 reconciliation 实测约 `11.7 seconds`（约 3.20 MB archive）。Production 不能以此小型 fixture 承诺 15 分钟；初始建议 operational RTO 为 `4 hours`，包括停止 writes、审批、forensic backup、rehearsal、restore 与 application verification。

## 21. Testing E2E

```text
New backup: PASS
Archive upload: PASS
Manifest: PASS
Retention: PASS
Download: PASS
Encrypted/plaintext SHA reconciliation: PASS
Disposable restore: PASS
Core data reconciliation: PASS
Payroll/Payslip artifacts: PASS
Constraints/triggers: PASS
Cleanup: PASS
```

一次 Windows disposable runner 兼容问题（`pg_ctl` handle wait）在演练中被发现并修复；最终执行成功。最终脚本已重新部署到两个 Testing Cron services。

## 22. Security

Backup 属于 Restricted Payroll/PII。Bucket private、archive client-encrypted、secrets server-only、无 public URL、无 artifact commit/share。普通 Desktop/Staff 用户没有 backup access。Operational report 只公开 size、hash 与 status。

## 23. Production Config

Production-ready config contract 已定义：dedicated secrets/storage prefix、daily/monthly schedules、alert webhook、30-day retention、predeploy flag 与 recovery ownership。未创建 Production secret、未部署/激活 Production cron、未 restore Production。

```text
TESTING VERIFIED
PRODUCTION CONFIG READY
PRODUCTION ACTIVATION PENDING
```

## 24. Runbook

`docs/TETAMU_HR_PAYROLL_RELEASE_RUNBOOK.md` 已加入 scheduled backup、backup validation、retention、predeploy/backup-age gate、disposable/monthly restore、failure response、Production restore authorization、RPO/RTO 与 recovery roles。

## 25. Remaining Blockers

1. 配置一个实际且受控的 `BACKUP_ALERT_WEBHOOK_URL` destination，并完成真实 Testing failure-delivery test；
2. Production 专用 private storage prefix/Bucket 与 least-privilege secrets 需另行审批配置；
3. Production schedule activation 需用户单独授权；
4. 自然月度 cron 首次执行后应保留 provider run evidence。

## 26. Final Verdict

```text
Automated backup implementation: PASS
Backup validation: PASS
Durable storage: PASS
Retention: PASS
Failure alert hook: PASS
Actual alert destination: PARTIAL
Disposable restore: PASS
Critical data verification: PASS
Constraints restore: PASS
Monthly restore mechanism: PASS
Runbook: PASS
Testing E2E: PASS

FINAL: CONDITIONAL
```

原因只有一个当前必需 blocker：没有实际告警 destination，因此 backup/restore failure 仍不能主动通知负责人。`READY FOR PRODUCTION ACTIVATION` 尚未达成。
