# Payroll High-Risk MFA Integration — Final Closure

## A. Objective

本阶段只把现有 Payroll 高风险动作接入已存在的 Sensitive Action / True MFA 基础，不重做 TOTP、Recovery Code、AuthSession 或授权模型。

执行链固定为：认证、tenant/resource ownership、module entitlement、capability、scope、Payroll lifecycle precondition、MFA、同事务一次性消费、业务 mutation、audit。

## B. Existing Security Foundation

- Generic Sensitive Action：复用既有 registry、短 TTL、token hash、session/user/business/action/resource binding。
- True MFA：复用现有 password + TOTP / one-time Recovery Code verifier。
- Authorization：五分钟、一次性、数据库 source of truth。
- MFA 不提供 capability，也不绕过 module、tenant、scope 或 lifecycle。

## C. Payroll Risk Audit

| Action | Current capability | Previous effective MFA | Required MFA | Resource | Closure |
| --- | --- | --- | --- | --- | --- |
| Payroll Finalize | `APPROVE_PAYROLL` | registry only / action not integrated | MFA | Payroll Run | READY |
| Payroll Reopen | `REOPEN_PAYROLL` | registry only / action not integrated | MFA | Payroll Run | READY |
| Payment File Export | `EXPORT_PAYMENT_FILE` | registry only / test artifact not integrated | MFA + reason | Payment Batch | READY; provider blocked |
| Bank Account Edit | `EDIT_BANK_ACCOUNT` / `VERIFY_BANK_ACCOUNT` | not consumed by mutation | MFA + reason | Employee membership/bank resource | READY |
| Statutory Export | `EXPORT_STATUTORY` | route not protected by scoped MFA | MFA | Statutory submission identity | READY |
| Statutory Submit | `SUBMIT_STATUTORY` | MFA policy existed without mutation consumption | MFA + reason | Statutory submission | READY for current status transition |
| Payment Process | `PROCESS_PAYMENT` | no implemented process action | MFA | Payment Batch | POLICY READY / ACTION NOT IMPLEMENTED |
| Payslip Publish | `PUBLISH_PAYSLIP` | capability + audit | Current policy | Payroll Run / entries | CURRENT POLICY |
| Compensation Edit | `EDIT_COMPENSATION` | capability + canonical command audit | Current policy | Employee membership | CURRENT POLICY |
| Statutory Profile Edit | `EDIT_STATUTORY_PROFILE` | capability + canonical command audit | Current policy | Employee membership | CURRENT POLICY |

## D. Sensitive Action Policy

Canonical keys：

- `PAYROLL_FINALIZE`
- `PAYROLL_REOPEN`
- `PAYMENT_FILE_EXPORT`
- `BANK_ACCOUNT_EDIT`
- `STATUTORY_EXPORT`
- `STATUTORY_SUBMIT`
- `PAYROLL_PAYMENT_PROCESS`

以上均要求 `MFA`；Payment File Export、Finalize、Reopen、Bank Edit、Statutory Submit 与 Payment Process 要求审计原因。策略不使用 action-local boolean。

## E. Finalize

- resource 绑定具体 `payrollRunId`。
- ownership、PAYROLL entitlement、`APPROVE_PAYROLL`、REVIEW lifecycle、locked/current Timesheet、non-empty entry、readiness 均在 MFA 前检查。
- authorization 在 Serializable transaction 内、状态更新前消费。
- owner self-approval 继续要求 override reason。
- audit 保存 Sensitive Action authorization ID、assurance 与 verification method。

## F. Reopen

- `REOPEN_PAYROLL`、原因、MFA、run binding 均为 mandatory。
- payment batch/artifact、statutory record、published payslip blocker 在 MFA consumption 前检查。
- MFA 不会绕过 downstream immutable history。
- mutation 与 authorization consumption 同一 transaction。

## G. Payment Export

现有可执行路径只有 `NODE_ENV=test` 的内部固定 bytes integrity artifact。它现在要求：

- `EXPORT_PAYMENT_FILE`
- PAYROLL entitlement
- Payment Batch ownership
- `PAYMENT_FILE_EXPORT` MFA
- audit reason
- batch-scoped one-time consumption
- audit linkage

没有 public download route、真实 bank adapter、组织代码或真实付款。Public Bank 仍为 `PUBLIC_BANK_SPEC_NOT_READY`。

## H. Bank Account Edit

Create、manual verify、deactivate 都复用 `BANK_ACCOUNT_EDIT`，先检查 employee/business ownership，再挑战 MFA；mutation 内再次检查资源和 optimistic revision，并在 transaction 内消费授权。

完整账号继续 AES-256-GCM 加密；security event 与 audit 不保存完整账号、ciphertext、IV、tag、fingerprint 或 raw holder payload。Local browser E2E 首次暴露本机缺少 payment keyring，已增加 `npm run payroll:setup-local-payment-key` 只生成 ignored `.env.local` Local key，不包含固定 secret。

## I. Statutory Export

- route 现在要求 `EXPORT_STATUTORY`，而不是仅 view capability。
- UI 先执行 MFA action，再以 HttpOnly one-time cookie 继续原 download/create intent。
- retained download 与 new artifact 都在 Serializable transaction 内消费 `STATUTORY_EXPORT`。
- cookie 在 route completion/failure 后删除。

## J. Statutory Submit

当前系统没有外部政府网站提交 integration。现有 `SUBMITTED` 只是一项 Local portal-status transition；该边界现在要求 `SUBMIT_STATUTORY`、STATUTORY entitlement、artifact/finalized/latest precondition、原因与 `STATUTORY_SUBMIT` MFA，并在同一 transaction 消费和 audit。

## K. Payment Processing

Registry 已有 `PAYROLL_PAYMENT_PROCESS`，要求 `PROCESS_PAYMENT`、PAYROLL entitlement、Payment Batch binding、MFA 与 reason。Repository 当前没有真实 payment execution mutation，因此没有伪造 success，也没有进入 Payment P3B。

## L. Other Payroll Actions

View Payroll、View Readiness、View Payslip 保持 normal，不要求 step-up。Payslip Publish、Compensation Edit、Statutory Profile Edit 继续沿用当前 capability + immutable/canonical audit policy；本阶段没有无依据地把所有 Payroll action 升到 MFA。

## M. Assurance Levels

所有核心高风险 Payroll keys 明确为 `MFA`。Password re-auth 只是 MFA verification composition 的一部分，单独的 REAUTH authorization 不能满足这些策略。

## N. Action / Resource Scope

授权绑定 user、AuthSession、business、action、resource type、resource ID，TTL 300 秒且 one-time。Wrong action、wrong resource、wrong business、consumed token 与 revoked session 均 fail closed。

## O. Tenant / RBAC / Entitlement

Business Owner 也必须完成 MFA。Staff、缺 capability、PAYROLL/STATUTORY disabled、cross-business resource 均在 MFA challenge 前 deny。Group Manager 或 Platform Admin 不因 MFA 自动获得 Business Payroll 权限。

## P. MFA UX

Finalize、Reopen、Bank Create/Verify/Deactivate、Statutory Export/Submit 表单显示清楚的 `MFA required`、action intent、五分钟、一次性与 `/security/mfa` enrollment link。成功验证后原 action 直接继续，不要求用户重新寻找页面。

## Q. Session / Revocation

消费阶段重新验证 active AuthSession；revoked/expired session、disabled user、revoked authorization 均 deny。密码或 MFA credential lifecycle 继续使用既有 foundation 的 outstanding-authorization revocation 规则。

## R. Audit

Finalize、Reopen、Bank version、Payment test artifact、Statutory export/download/submit audit 均可关联 Sensitive Action authorization ID、assurance 与 verification method。Browser verifier 确认 security events 不含完整测试账号或 account-holder name。

## S. Concurrency

Canonical authorization consumption 使用 conditional update / transaction；同一 token 并发只有一个 winner。Payroll lifecycle、optimistic revision、Serializable transaction 与 append-only database guards 保持不变。

## T. Idempotency

MFA 只是外层 gate。Payment command replay 会先读取 canonical command result；lost response 不会重复业务 mutation。Finalize/Reopen 仍由 lifecycle state 判断真实结果，MFA 不重新计算 payroll money。

## U. Browser E2E

Dedicated Local QA fixture：`qa-commission-browser-salon`，Business Owner QA，真实 generated QA TOTP；不是 human credential。

| Flow | Result | Evidence |
| --- | --- | --- |
| Login | PASS | Local session created |
| Payroll Finalize | PASS | REVIEW → FINALIZED；authorization consumed；audit linked |
| Payroll Reopen | PASS | FINALIZED → DRAFT；reason + MFA；audit linked |
| Bank Account Edit | PASS | encrypted revision 1 saved，only last4 returned |

Next.js runtime dialog count = 0，runtime issue marker count = 0，visible hydration/runtime error = 0。没有错误 overlay；页面导航与 server-action hydration 正常。

QA credential 明确保留为 isolated Local fixture；outstanding unconsumed QA authorization = 0。

## V. Commission / Claims Regression

- Approved Commission RM8.00 → Payroll Variable Pay RM8.00，Finalize/Reopen 后不变。
- Payroll gross/net 都保持 RM3,008.00；MFA layer 没有重新计算金额。
- Claims core tests 通过；Claims Payroll Bridge 继续 fail closed / BLOCKED，本阶段未进入 bridge。
- Locked Timesheet provenance 仍被 Finalize readiness 消费；Attendance/Leave 未重做。

## W. Statutory Boundary

本任务没有执行 Human Review、classification decision、sign-off 或 activation，也没有修改 PCB。

Local 当前实际数据库（读取结果，不是本任务创建）：

| Scheme | Human decisions | Existing sign-off rows | Active RuleSets |
| --- | ---: | ---: | ---: |
| EPF | 0 | 14 | 0 |
| SOCSO | 0 | 14 | 0 |
| EIS | 0 | 14 | 0 |
| LINDUNG24 | 0 | 0 | 0 |

这些既有 sign-off rows 被保留；本轮新增 sign-off = 0，activation = NOT ACTIVE。

## X. Tests / Build

- Targeted Payroll/Sensitive Action unit：10/10 PASS。
- Targeted modified Payroll/Payment/Statutory integration：PASS。
- Full unit：785/785 PASS。
- Full integration：117/117 PASS（Local PostgreSQL）。
- Browser E2E：Finalize、Reopen、Bank Account Edit PASS。
- TypeScript：PASS。
- Lint：PASS；仅既有 WhatsApp `<img>` warning。
- Local production-mode build：PASS；仅既有 lint/autoprefixer warnings。
- Prisma validate：PASS。
- Prisma generate：PASS。
- Migration status：156 migrations，up to date。
- 本任务没有 schema/migration 变更，因此没有增加 migration。

## Y. Remaining Risks

- Public Bank provider specification 尚未到达，不能实现或验证 provider-specific artifact。
- External statutory submission 与 real payment process 尚未实现；registry 已 fail-closed 预留 MFA policy。
- Local bank-data flow 必须先配置独立 payment keyring；helper 只写 ignored `.env.local`，Production variables 不在本任务范围。
- Browser QA TOTP 是 isolated Local fixture，不可用于 Production。
- PCB 继续保持原状态，本任务未验证或修改。

## Z. Final Status

```text
GENERIC STEP-UP
→ READY

TRUE MFA / TOTP
→ READY

PAYROLL FINALIZE MFA
→ READY

PAYROLL REOPEN MFA
→ READY

PAYMENT FILE EXPORT MFA
→ READY / BLOCKED_PROVIDER_SPEC

BANK ACCOUNT EDIT MFA
→ READY

STATUTORY EXPORT MFA
→ READY

STATUTORY SUBMIT MFA
→ READY (CURRENT STATUS TRANSITION ONLY)

PAYMENT PROCESS MFA
→ PARTIAL (POLICY READY / ACTION NOT IMPLEMENTED)

ACTION-SCOPED AUTH
→ PASS

RESOURCE-SCOPED AUTH
→ PASS

BUSINESS-SCOPED AUTH
→ PASS

ONE-TIME CONSUMPTION
→ PASS

SESSION REVOCATION
→ PASS

RBAC / ENTITLEMENT
→ PASS

AUTH REGRESSION
→ PASS

PAYROLL REGRESSION
→ PASS

COMMISSION REGRESSION
→ PASS
```

```text
PAYROLL HIGH-RISK MFA INTEGRATION
→ READY

PUBLIC BANK EXPORT
→ BLOCKED_PROVIDER_SPEC

LOCAL / TESTING ONLY
PRODUCTION NOT ACCESSED
PRODUCTION NOT VALIDATED
```
