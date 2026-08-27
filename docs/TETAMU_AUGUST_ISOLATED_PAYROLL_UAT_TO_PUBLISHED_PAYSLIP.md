# TETAMU — August 2026 Isolated Payroll UAT → Published Payslip

执行日期：2026-08-26（Asia/Singapore）  
执行环境：Railway `testing`  
最终结论：**BLOCKED AT PAYROLL READINESS — NO PAYSLIP PUBLISHED**

本报告记录 `Payroll UAT Business` 内 `UAT-PAYROLL-001` 的 canonical Testing fixture 执行结果。流程已完成 Roster、Expected Days、Attendance、P2、Monthly Timesheet Lock 和 Payroll Draft；在 Payroll Readiness 遇到真实 blocker `LINDUNG24_PROFILE_INCOMPLETE` 后依照安全规则停止。没有启用法定规则、虚构员工法定身份或绕过 Finalize gate。

## 0. Absolute safety boundary

- Environment：`testing`
- Desktop：`https://tetamu-pos-web-testing.up.railway.app`
- Staff App：`https://tetamu-staff-app-testing.up.railway.app`
- Database：Railway Testing Postgres（通过短期只读/fixture 执行连接）
- Temporary TCP proxy：执行后已删除（ID `2c0335d2-adff-465c-8653-a82945c19987`）
- Production access/deploy：NO
- Real payment / bank export / mark paid：NO
- Statutory submission/export：NO
- OTP/SMS：NO

## 1. Other-business isolation

- 所有业务 mutation 均绑定 Business ID `b87aaa12-b41d-44b5-908e-72d04e6a08a0`。
- 执行 actor：`Payroll UAT Owner`，User ID `74589e3d-bd90-49a9-8ecb-1d1b2ffe422c`。
- 从本轮首条 isolated audit 起，该 actor 在其他 Business 的 write audit 数：`0`。
- `Royal Salon`、`salon online`、`TWILIO-OTP-QA`、Real Device UAT Manager 未被修改。

## 2. Product development boundary

- 没有修改 Payroll formula、Attendance engine、Timesheet readiness、statutory rule、permission model 或 Staff App UI。
- 执行只使用现有 canonical services；临时执行/检查脚本不保留为产品代码。
- 遇到真实 Payroll Readiness blocker 后停止，没有为了产出 Payslip 修改业务逻辑。

## 3. August period

- Payroll month：`2026-08`
- Canonical period：`2026-08-01` inclusive → `2026-09-01` exclusive
- Current-month Timesheet：已成功 materialize、approve、lock。
- 27–31 Aug 均有显式 `REST_DAY` Expected Day，并非依赖缺失资料通过。

## 4. Simplest valid August roster

- Employee：`UAT-PAYROLL-001`
- 仅 `2026-08-26` 为 `WORK_SHIFT`，20:00–23:00（Asia/Kuching）。
- 其余 30 日为显式 `REST_DAY`。
- 无 Leave、Claim、Commission、Public Holiday work、Rest Day work、cross-midnight fixture。
- Roster assignments：`31`。

## 5. Future-day evidence

| Date | Expected Kind | Source |
|---|---|---|
| 2026-08-27 | REST_DAY | ROSTER |
| 2026-08-28 | REST_DAY | ROSTER |
| 2026-08-29 | REST_DAY | ROSTER |
| 2026-08-30 | REST_DAY | ROSTER |
| 2026-08-31 | REST_DAY | ROSTER |

Future dates explicit：**YES**。Future workday missing punches：`0`。

## 6. Published roster

共 6 个 weekly Roster Period，全部 `PUBLISHED`，revision `1`：

| Week start | Period ID | Publication ID | Rows |
|---|---|---|---:|
| 2026-07-27 | `7946a4e8-c99a-4411-add2-b160a556134b` | `f42e1600-ce64-451a-ac25-071084c98de4` | 2 |
| 2026-08-03 | `8b2e65c5-7779-40cc-8384-90f8c3f9811c` | `96474e0d-6885-4884-9139-e67a2d4cf45f` | 7 |
| 2026-08-10 | `6c7220b8-9bb0-4b41-bf65-0d16bfdeba65` | `4c30b376-6154-4efc-9be4-ad44cb2f40f4` | 7 |
| 2026-08-17 | `8d60bf98-d62c-42de-8ac4-efa3ed9fff85` | `fa0742f0-0329-4e56-9e9e-3f8a1642bfd7` | 7 |
| 2026-08-24 | `e6556df8-e286-44af-bd7e-3a2ccb9c5076` | `2ca3099d-5aea-4552-a43a-0ad9ab0b834b` | 7 |
| 2026-08-31 | `b2ad482e-2cee-4abb-915d-fafa0e6e9786` | `1a58783d-6990-43cc-8523-86a01c96d7eb` | 1 |

Fixture publication timestamp：`2026-07-26T00:00:00.000Z`。这是隔离 Testing historical fixture 的 canonical service test seam；实际执行 audit 时间为 2026-08-26。没有直接 insert Expected Days。

## 7. Expected Day projection

- Current Expected Days：`31`
- Source：全部 `ROSTER`
- Revision：全部 `1`
- 2026-08-26：`WORKDAY`，Expected Day ID `b18b1bfd-64dc-4e4a-a183-ffac9c5dea7f`
- 其余日期：`REST_DAY`
- Roster reconciliation：consistent
- Full-month coverage：**PASS**

## 8. Required attendance

- Attendance Session ID：`c29d70a4-99ff-46be-b11e-e8ad36dc2bb7`
- Work date：`2026-08-26`
- Clock In：20:00 Asia/Kuching (`2026-08-26T12:00:00Z`)
- Clock Out：23:00 Asia/Kuching (`2026-08-26T15:00:00Z`)
- Status：`COMPLETED`
- Requires approval：`false`

## 9. Hours

- Worked minutes：`180`
- Break minutes：`0`
- Attendance warnings：`0`
- Payroll component result later contained only `BASIC_SALARY`; no OT component was generated.

## 10. Attendance P2 / final results

- Final Result ID：`83d50b8b-35c0-4098-a1b1-01ab3f100bd2`
- Disposition：`INCLUDED`
- Monthly P2 final days：`31`
- Blockers：`0`
- Warnings：`0`

Three earlier `ATTENDANCE_PUNCH_REJECTED` audit rows came from a fixture harness rate-limit configuration error; those rejected attempts wrote no Attendance Session. The successful canonical Clock In/Out and Final Result above are the only included attendance records.

## 11. Monthly Timesheet materialization

- Timesheet ID：`d8de1f65-1220-4efd-a445-a7ec8fe4fdd5`
- Period start：`2026-08-01`
- Sessions：`1`
- Included：`1`
- Worked minutes：`180`
- Blockers：`0`

## 12. Branch ready

- Branch readiness ID：`3130b07c-ed15-47d8-90ab-22efdbb7afa8`
- Branch：`Payroll UAT Branch`
- Status：`READY`
- Ready at：`2026-08-26T12:45:43.883Z`
- All branches ready：`true`

## 13. Timesheet approval

- Status transition：Ready → `APPROVED`
- Approved at：`2026-08-26T12:45:45.895Z`
- Approved by：`Payroll UAT Owner`
- Audit action：`ATTENDANCE_TIMESHEET_APPROVED`

## 14. Timesheet lock

- Final status：`LOCKED`
- Revision ID：`44978f4c-e537-4148-8fcc-500710fa994f`
- Revision：`1`
- Locked at：`2026-08-26T12:45:48.241Z`
- Source digest：`7483dbab33b3c5fbe6365e01e881e32c7427b2f4f16917a6286dcf25e7e2a6a8`

## 15. Post-lock verification

- Current revision points to revision `1`.
- Timesheet source is immutable through the locked revision relationship.
- Payroll Draft references the locked Timesheet revision.
- Timesheet blockers after lock：`0`。

## 16. Payroll Run generation

- Payroll Run ID：`2972941a-8067-4076-bf3b-24ddf08b308a`
- Status：`DRAFT`
- Employee entries：`1`
- Employee Entry ID：`09a34a1a-fc19-40f6-bede-7ce2956b84eb`
- Population isolation：only `UAT-PAYROLL-001`

## 17. Payroll input trace

- Active employment：PASS
- Active Compensation Version：PASS
- Compensation effective month：`2026-08-01`
- Locked Attendance Timesheet revision：PASS
- Payroll attendance snapshot：created by canonical generation path
- Component：`BASIC_SALARY` / `EARNING` / RM 3,000.00
- Leave/Claim/Commission/OT components：none

## 18. Basic pay expectation

| Amount | Result |
|---|---:|
| Basic Pay | RM 3,000.00 |
| Gross Pay | RM 3,000.00 |
| Net Pay (Draft, before configured statutory deductions) | RM 3,000.00 |

Expected Basic：**PASS**。没有 proration。

## 19. Statutory safety

- Statutory schemes were not enabled or invented.
- Employee statutory status in Draft：`REVIEW_REQUIRED`
- Blocking issue：`LINDUNG24_PROFILE_INCOMPLETE`
- Review-only issue：`STATUTORY_PROFILE_INCOMPLETE`
- No EPF/SOCSO/EIS/PCB/LINDUNG 24 submission or export created.

## 20. Bank / payment

- Bank account missing：review warning only。
- Payment batch：`0`
- Payment instruction/execution：`0`
- Mark paid：NO
- `MISSING_BANK_ACCOUNT` did not itself block payroll finalization; LINDUNG 24 did.

## 21. Payroll readiness

- Status：`BLOCKED`
- Ready employees：`0`
- Blocked employees：`1`
- Blocking code：`LINDUNG24_PROFILE_INCOMPLETE`
- Resolution hint：complete the employee’s genuine LINDUNG 24 participation details, then refresh the Draft.
- `canProceed`：`false`

## 22. Reconciliation

- Payroll Run contains exactly one employee entry.
- Basic/Gross/Net values reconcile at RM 3,000.00.
- Attendance and Timesheet gates reconcile.
- Final readiness reconciliation cannot pass because LINDUNG 24 profile evidence is incomplete.

## 23. Submit Payroll for review

**NOT EXECUTED.** The Draft was not submitted because readiness `canProceed=false`.

## 24. Separation of duties

- Owner self-approval override was not invoked.
- No override reason was recorded because the workflow stopped before Finalize.
- MFA/second verification was not consumed.

## 25. Finalize Payroll

**NOT EXECUTED / BLOCKED.** No statutory bypass, direct status update, or owner override was used.

## 26. Finalized immutability

Not applicable: Payroll Run remains `DRAFT` and was not finalized.

## 27. Publish Payslip

**NOT EXECUTED.** Payslip publication count：`0`。

## 28. Document validation

Not applicable: no Payslip PDF/document was created.

## 29. Staff App projection

Not available because there is no `PUBLISHED` Payslip. Staff App must continue to show no published August payslip for this employee.

## 30. Multi-business isolation

- Isolated Business ID：`b87aaa12-b41d-44b5-908e-72d04e6a08a0`
- Isolated Branch ID：`552e3d2d-f355-43d6-8e51-bafc1d724377`
- Membership ID：`091ba7be-ced0-418b-8cf9-526921f10866`
- Foreign-business writes by the isolated owner during the recorded audit window：`0`
- Royal Salon/TWILIO fixture was not used as Payroll population.

## 31. Payslip ownership security

Not executable without a publication ID. No cross-business or wrong-membership Payslip can be retrieved because none exists.

## 32. Payment safety final check

- Payment batches：`0`
- Payslip publications：`0`
- No payment artifacts, bank files, or paid state were created.

## 33. Statutory safety final check

- Statutory submissions：`0`
- No rule pack activation。
- No fabricated statutory identity/profile。
- No export artifact or submission operation。

## 34. Production safety

- Production touched：NO
- Production deployed：NO
- Testing deployed：NO
- Product code deployed：NO

## 35. Duplicate check

- Payroll UAT Business membership count remained isolated to one target employee.
- Payroll Run count for the isolated business/month：`1`
- Payroll Entry count：`1`
- Attendance Session count：`1`
- Timesheet count：`1`
- Payslip count：`0`

## 36. Audit lineage

Canonical success lineage:

1. `ROSTER_ASSIGNMENT_BULK_UPDATED` × 6
2. `ROSTER_PUBLISHED` × 6
3. `ATTENDANCE_CLOCK_IN`
4. `ATTENDANCE_CLOCK_OUT`
5. `ATTENDANCE_FINAL_RESULT_CREATED`
6. `ATTENDANCE_TIMESHEET_BRANCH_READY`
7. `ATTENDANCE_TIMESHEET_APPROVED`
8. `ATTENDANCE_TIMESHEET_LOCKED`
9. `PAYROLL_RUN_CREATED`
10. `PAYROLL_LEAVE_SNAPSHOT_CREATED`

No `PAYROLL_RUN_SUBMITTED`, `PAYROLL_RUN_FINALIZED`, `PAYSLIP_PUBLISHED`, payment, or statutory-submission audit exists.

## 37. Blocker handling

The exact blocker is:

```text
LINDUNG24_PROFILE_INCOMPLETE
Complete the employee's LINDUNG 24 participation details, then refresh this Draft.
```

The system classified this as `BLOCKING`, not a warning. Per the task’s statutory-safety rule, execution stopped. No fake participation status, selected employer, profile data, rule activation, or direct DB override was introduced.

## 38. Code change rule

- Product/business code changed：NO
- Schema/migration changed：NO
- Temporary fixture/inspection helpers：removed after verification
- Durable artifact added：this report only

## 39. Tests and verification

- Canonical service smoke：Roster publish, Expected Day reconciliation, Attendance punch/final result, P2 materialization, Timesheet ready/approve/lock, Payroll generation all executed against Testing DB.
- Timesheet post-lock read verification：PASS
- Payroll amount assertion：PASS (RM 3,000.00)
- Payroll Readiness：expected failure at genuine LINDUNG 24 blocker
- No unit-test suite was required because product code was not modified.

## 40. Artifact inventory

| Artifact | ID / Result |
|---|---|
| Business | `b87aaa12-b41d-44b5-908e-72d04e6a08a0` |
| Branch | `552e3d2d-f355-43d6-8e51-bafc1d724377` |
| Membership | `091ba7be-ced0-418b-8cf9-526921f10866` |
| Attendance Session | `c29d70a4-99ff-46be-b11e-e8ad36dc2bb7` |
| Attendance Final Result | `83d50b8b-35c0-4098-a1b1-01ab3f100bd2` |
| Monthly Timesheet | `d8de1f65-1220-4efd-a445-a7ec8fe4fdd5` |
| Locked Timesheet Revision | `44978f4c-e537-4148-8fcc-500710fa994f` |
| Payroll Run | `2972941a-8067-4076-bf3b-24ddf08b308a` |
| Payroll Entry | `09a34a1a-fc19-40f6-bede-7ce2956b84eb` |
| Payslip Publication | NONE |

## 41. Final verdict

```text
BLOCKED
```

The target `PUBLISHED` Payslip was not produced. Workflow stopped correctly at Payroll Readiness because LINDUNG 24 participation evidence is incomplete.

## 42. Exact human next step

Using the existing canonical employee statutory workflow in **Testing only**:

1. Review the employee’s genuine LINDUNG 24 participation applicability/details.
2. Record only real participation evidence; do not guess or enable a rule pack merely for UAT.
3. Refresh/regenerate the existing August Draft through the canonical Payroll workflow.
4. Re-run Readiness. Only when `canProceed=true` may the owner submit, apply the documented owner self-approval override if still permitted, finalize, and publish the Payslip.

No action is required for bank details to finalize payroll; bank/payment readiness is a separate later concern.

## 43. Final response status

```text
AUGUST ISOLATED PAYROLL UAT PAYSLIP

Environment:
TESTING

Business:
Payroll UAT Business

Branch:
Payroll UAT Branch

Employee:
Real Device Payroll UAT Staff

Employee ID:
UAT-PAYROLL-001

Payroll Month:
August 2026

Roster Published:
YES

Future Days Explicit:
YES

Expected Days Complete:
YES

Attendance Final:
YES

Timesheet Status:
LOCKED

Payroll Run ID:
2972941a-8067-4076-bf3b-24ddf08b308a

Payroll Status:
DRAFT

Basic Pay:
RM 3000.00

Gross Pay:
RM 3000.00

Net Pay:
RM 3000.00 (Draft)

Statutory Status:
REVIEW_REQUIRED / BLOCKED BY LINDUNG24_PROFILE_INCOMPLETE

Payroll Finalized:
NO

Payslip Published:
NO

Payslip Publication ID:
NONE

Staff App Payslip Visible:
NO

Payment Created:
NO

Statutory Submission Created:
NO

Other Businesses Modified:
NO

Production Touched:
NO

Final Verdict:
BLOCKED

Blocker:
LINDUNG24_PROFILE_INCOMPLETE
```

Execution stopped here as required.
