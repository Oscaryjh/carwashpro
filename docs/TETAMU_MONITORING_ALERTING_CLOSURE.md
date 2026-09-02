# TETAMU Monitoring & Alerting Closure

## 1. Executive Summary

The repository now has a common structured alert contract, redaction, retry, dedupe/rate limit,
recovery, Testing-only alert tooling, health monitor, backup/restore controlled failure switches,
HTTP 5xx threshold, worker notification and SMS123 classification. Local automated verification is
PASS. Real Testing delivery is **BLOCKED** because no real receiver secret exists.

## 2. Existing State

| Signal | Detection Exists | Structured Event | Alert Exists | Real Receiver |
| --- | --- | --- | --- | --- |
| Backup failure | YES | YES | YES | NO |
| Restore failure | YES | YES | YES | NO |
| Service down / health fail | PREPARED | YES | YES | NO |
| DB unavailable | PREPARED | YES | YES | NO |
| HTTP 5xx spike | PREPARED | YES | YES | NO |
| Deployment failure | Railway | Railway | PARTIAL | NO |
| Worker/job failure | YES | YES | YES | NO |
| SMS123 failure | YES | YES | YES | NO |
| Payroll finalize event | YES | AuditLog | Audit only | Not required |
| Statutory export deny | YES | Audit/log | Audit only | Not required |

## 3. Alert Receiver

Read-only Railway Testing inspection found no `OPS_ALERT_WEBHOOK_URL`, legacy backup alert webhook,
Slack, Discord or Teams receiver on web, Staff, worker, WhatsApp, backup or restore services.
Therefore receiver configuration and human acknowledgement are FAIL.

## 4. Structured Event Contract

Events contain event, environment, severity, service, timestamp, stage, code, safe message, status,
fingerprint, optional deployment/job identifier and redacted metadata.

## 5. Secret Redaction

Unit coverage proves database URL, Authorization, Cookie, password, token, API key, six-digit OTP
and bank-keyed metadata are removed. Status: PASS.

## 6. Backup Alert

`BACKUP_JOB_FAILED` is CRITICAL and uses `OPS_ALERT_WEBHOOK_URL` with legacy fallback. Controlled
archive-validation injection is Testing-only. Real receiver verification: NOT RUN / FAIL.

## 7. Restore Alert

`RESTORE_VERIFICATION_FAILED` is CRITICAL. Controlled checksum injection is Testing-only and does
not access or alter a healthy artifact. Real receiver verification: NOT RUN / FAIL.

## 8. Service Health

The monitor probes Desktop `/api/health` and Staff `/staff/login` every two minutes. Current direct
read-only Testing probes returned HTTP 200. The new monitor is not deployed without a receiver.

## 9. DB Health

The Desktop payload currently reports `database=ready`. Three consecutive missing/unready results
would emit `DATABASE_UNAVAILABLE`; two successes emit `DATABASE_RECOVERED`.

## 10. HTTP 5xx

Next request-error instrumentation emits after five captured request errors in five minutes. An
isolated error does not alert. Local threshold test: PASS; real receiver: FAIL.

## 11. Deployment Failure

Railway Deployments exposes build/deploy failure state. Common receiver forwarding and a safe real
failed-deployment drill are not complete. Status: PARTIAL.

## 12. Worker Failure

Fatal workers, repeated analytics sweep failure, exhausted notification send and closing reminder
failure emit `SCHEDULED_JOB_FAILED`. Local classification: PASS; real receiver: FAIL.

## 13. SMS123

The provider distinguishes REJECTED, TIMEOUT, UNAVAILABLE and INVALID_RESPONSE. Accepted requests
without handset receipt remain delivery unknown. The alert path never contains phone or OTP.

## 14. Payroll Audit

Existing canonical audit logging covers high-risk Payroll actions with actor, business, timestamp
and resource. No webhook paging was added for routine audit events.

## 15. Statutory Deny

Synthetic official export/submission denial remains stable and expected. It is retained as a
security audit event, not CRITICAL alert noise.

## 16. Dedupe

Five-minute fingerprint cooldown and fifteen-minute per-event rate cap are implemented and tested.
Status: PASS.

## 17. Retry

Three bounded attempts and 100/200 ms backoff are implemented for common and database-operation
webhooks. Transient 503 → accepted receiver-ID test passes.

## 18. Recovery

Service/database recovery events and worker recovery are implemented. Local contract: PASS; real
receiver evidence: FAIL.

## 19. Alert Test Tool

`scripts/test-ops-alert.ts` supports TEST_ALERT, SERVICE, DATABASE, HTTP_5XX, WORKER, SMS123 and
RECOVERY with an explicit Testing guard. It cannot run fake Production critical alerts.

## 20. Testing Deployment

Current Testing services are healthy before this change. No monitoring code was deployed because
the required receiver secret is absent; deploying a log-only monitor would not satisfy this task.

## 21. Real Delivery Matrix

| Alert | Generated | Receiver Got It | PASS |
| --- | --- | --- | --- |
| Test alert | Local contract only | NO | FAIL |
| Backup failure | Test harness ready | NO | FAIL |
| Restore failure | Test harness ready | NO | FAIL |
| Service health failure | Test harness ready | NO | FAIL |
| DB failure | Test harness ready | NO | FAIL |
| 5xx threshold | Local generated | NO | FAIL |
| Worker/job failure | Local generated | NO | FAIL |
| SMS123 error | Local generated | NO | FAIL |

## 22. Ownership

Primary: System Administrator / Release Owner. Escalation: Business Owner / Technical Owner.

## 23. Runbook

The release runbook now includes severity, backup, restore, service/database, 5xx, SMS123 and alert
delivery failure response steps.

## 24. Backup Blocker Closure

OPEN. Backup and restore code paths are ready, but neither has receiver acceptance/human-visible
evidence. Scheduled Backup Policy remains CONDITIONAL.

## 25. Production Config

Prepare, but do not set, Production `OPS_ALERT_WEBHOOK_URL`, Desktop/Staff probe URLs, monitor
interval, failure/recovery thresholds and ownership. Production activation remains NO.

## 26. Remaining Blockers

1. Select a durable Testing operations channel and store its HTTPS webhook as a Railway secret.
2. Deploy web, Staff, worker, backup, restore and the monitor to Testing only.
3. Run all controlled events and retain receiver IDs/timestamps plus human acknowledgement.
4. Configure or document deployment-failure forwarding; otherwise retain PARTIAL.

## 27. Final Verdict

**BLOCKED**. Framework, tests and documentation are ready, but a log is not an alert and no real
Testing receiver has received any event. Production was not touched.
