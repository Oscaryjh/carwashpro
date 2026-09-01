+# TETAMU EMPLOYEE ATTENDANCE CORRECTION UNIFIED READ MODEL PHASE 1 REPORT

## 1. FINAL VERDICT

**REVIEW REQUIRED**

统一只读 archive、GET API、显式三源归一化、关联去重、employee scope、cursor pagination、单元/整合/回归与 Railway Testing 部署均已完成。唯一未闭环项是部署后的 **authenticated HTTP GET**：可用浏览器没有预先存在的 Staff Testing session；为避免发送真实 OTP 或为 smoke 新建/修改认证数据，本轮没有制造 session。线上 health、未认证拒绝与非 GET 拒绝均已验证。

**TESTING ONLY。**

## 2. CANONICAL SOURCE MAP

| Archive source | Canonical ownership | Actual linkage | Archive ownership |
|---|---|---|---|
| Attendance Resolution | `AttendanceResolutionCase` + `AttendanceResolutionEvent` + `AttendanceFinalResult` | Case 以唯一 `attendanceSessionId` 关联 `EmployeeAttendance`；session 拥有 exceptions；case 通过 `currentFinalResultId` 指向当前 immutable result | 一个 `RESOLUTION_CASE` item，包含其 session 下明确关联的 exceptions 作为证据 |
| Standalone exception | `AttendanceException` | 可选 `attendanceSessionId`；若 session 已有 ResolutionCase，则不再独立展示 | 仅未被 ResolutionCase aggregate 表示的 exception 成为一个 `STANDALONE_EXCEPTION` item |
| P2 correction | `AttendanceCorrectionRequest` + `AttendanceP2Exception` + `AttendanceP2Resolution` + `AttendanceP2FinalResult` | Request 的 `exceptionId` 指向 P2 exception；exception 的 `currentResolutionId` 指向当前 resolution；final result 以 business/membership/workDate/version 取最新版本 | 一个 `P2_CORRECTION_REQUEST` item；不拆成 request/exception/result 三项 |

现有写入仍由 `exception-service.ts`、`resolution-workflow-service.ts`、`p2-service.ts` 及其既有 endpoint 所有。新服务不接管写入。

## 3. READ MODEL CONTRACT

新增 `EmployeeCorrectionArchiveItem`，包含：

- typed identity：`sourceKey`、`sourceType`
- scope：`businessId`、`employeeMembershipId`、`branchId`、`branchName`
- attendance fact：`workDate`、`correctionType`
- lifecycle：`employeeStatus`、四类 nullable timestamps
- request evidence：requested clock-in/out、reason、manager note
- actionability：`canEmployeeAct`、`nextAction`
- source-dependent evidence：employee-safe events、current final result、final disposition

不存在证据的字段返回 `null` 或空事件数组，不返回 raw Prisma model。

## 4. SOURCE TYPES

固定三类：

- `RESOLUTION_CASE`
- `STANDALONE_EXCEPTION`
- `P2_CORRECTION_REQUEST`

没有伪造一个新的 generic canonical entity。

## 5. SOURCE KEY

稳定、确定性的 read projection key：

- `resolution:{uuid}`
- `exception:{uuid}`
- `p2-request:{uuid}`

该 key 不持久化、不替换 source primary key、不成为新的业务 ID。未来 detail read 必须重新以 authenticated business/membership scope 查询；本 phase 未实现 detail route。

## 6. STATUS MAPPING

| Source evidence | Employee status |
|---|---|
| AttendanceException PENDING / APPROVED / REJECTED / CANCELLED | 同名状态 |
| ResolutionCase OPEN | ACTION_REQUIRED |
| UNDER_REVIEW + latest EMPLOYEE_SUBMITTED | PENDING |
| RETURNED_FOR_CORRECTION 或 explicit MANAGER_RETURNED | RETURNED |
| RESOLVED + current final INCLUDED | APPROVED |
| RESOLVED + current final EXCLUDED | REJECTED |
| latest EMPLOYEE_CANCELLED | CANCELLED |
| SUPERSEDED | SUPERSEDED |
| 无足够证据 | UNKNOWN |
| P2 CorrectionRequest PENDING / APPROVED / REJECTED / CANCELLED | 同名状态 |

Guardrails 已冻结：OPEN 不是 Pending；Rejected 不是 Returned；无 current final result 不是 Approved；P2 不从 `PENDING_EMPLOYEE` 猜 Returned；排除必须由 current final disposition 证明。

## 7. RESOLUTION CASE PRECEDENCE

ResolutionCase aggregate 优先。查询 standalone exception 时明确排除：

`attendanceSession -> resolutionCase != null`

同时 projection 层以 ResolutionCase 的 `representedExceptionIds` 二次防重。整合测试证明 linked exception 不会作为第二项出现。

## 8. STANDALONE EXCEPTION

只有未被 ResolutionCase 表示的 `AttendanceException` 才独立返回。状态只读自身 canonical enum；不发明 Returned。没有 canonical resolved timestamp/final result/event stream 时返回 `null`/空数组。

无 session 的 workDate 由 requested timestamp 或 createdAt 配合 branch canonical timezone 计算，不使用 device timezone。

## 9. P2 AGGREGATE

以 `AttendanceCorrectionRequest` 为 archive anchor：

1. 批量读取其 `exceptionId` 对应、同 business/membership 的 P2 exception；
2. 批量读取明确的 `currentResolutionId`；
3. 按 business/membership/workDate 读取 final results，并按 version DESC 选择当前版本；
4. 归一成一个 item。

任何 dangling 或 scope 不一致的 P2 关联都会 fail closed，不会降级成可能泄漏的部分资料。

## 10. DEDUPLICATION

只按明确 canonical linkage 去重：

- linked AttendanceException → ResolutionCase aggregate；
- P2 request + linked P2 exception/resolution/final → 一个 P2 item；
- 相同员工、相同 workDate 但无关系的两件事 → 保留两项；
- `sourceKey` 作为相同 source 的 projection-level 唯一键。

绝不以 `employeeMembershipId + workDate` 去重。

## 11. EVENT TIMELINE

ResolutionCase 返回按 `sequence ASC, id ASC` 的完整 employee-safe timeline：

- eventType
- occurredAt
- actorType
- employeeFacingSummary

不返回 event ID、payload blob、audit payload 或 manager private metadata。Standalone 与 P2 当前 schema 没有同等事件流，因此返回空数组。

## 12. FINAL RESULT PRECEDENCE

ResolutionCase 只使用 canonical `currentFinalResult` relation，不自行以 createdAt 猜版本。P2 final result 以同 scope、同 workDate 的 `version DESC` 首项为当前结果。旧版本不会产生额外 archive item，也不会恢复 precedence。

## 13. TIMESTAMPS

只填 source-proven semantics：

- ResolutionCase `submittedAt`：explicit `EMPLOYEE_SUBMITTED.createdAt`
- ResolutionCase `reviewedAt`：最新 manager event
- ResolutionCase `resolvedAt`：case.resolvedAt
- Standalone `requestedAt`：canonical exception request row createdAt；无独立 submitted/resolved timestamp 时为 null
- P2 `submittedAt`：CorrectionRequest createdAt（该记录只由 submit workflow 创建）
- P2 `reviewedAt`：request.reviewedAt
- P2 `resolvedAt`：linked P2 exception.resolvedAt

同一个 timestamp 不再同时填入 `submittedAt` 与 `requestedAt`。

## 14. REQUESTED TIMES

仅取：

- Resolution event 的 proposedClockIn/Out；
- linked AttendanceException 的 requestedClockIn/Out；
- AttendanceCorrectionRequest 的 requestedClockIn/Out。

不会用 actual punch、final result 或 reason text 推导 requested time。

## 15. REASON / MANAGER NOTE

- Resolution reason：latest employee submission reason，fallback 到 linked exception reason；
- Resolution manager note：latest manager event reason，fallback 到 exception reviewNote；
- Standalone：reason/reviewNote；
- P2：request.reason/reviewReason。

AuditLog 不参与 current-state/status 决定。来源没有 manager note 时返回 null。

## 16. EMPLOYEE ACTIONABILITY

| Canonical state | canEmployeeAct | nextAction |
|---|---:|---|
| ResolutionCase OPEN | true | SUBMIT |
| RETURNED_FOR_CORRECTION | true | UPDATE |
| PENDING / APPROVED / REJECTED / CANCELLED / SUPERSEDED / UNKNOWN | false | NONE |
| Standalone/P2 archive item | false | NONE |

这是只读 projection；不包含 mutation，也不暴露 manager action。

## 17. PAGINATION

- default limit：20
- max limit：50
- invalid/oversized HTTP limit：validation fail closed
- opaque base64url cursor
- cursor 包含 version、scope hash、order timestamp、source type、source ID
- `hasMore` 与 `nextCursor` 明确返回
- cross-employee cursor 因 scope hash 不符而拒绝

## 18. MULTI-SOURCE ORDERING

全局 newest-first key：

1. canonical source ordering timestamp DESC
   - ResolutionCase: `openedAt`
   - Standalone Exception: `createdAt`
   - P2 CorrectionRequest: `createdAt`
2. sourceType 固定 rank
3. source canonical UUID DESC

每个 source 使用同一 cursor window 规则和 `limit + 1` bounded query，再做 deterministic merge。测试覆盖同 timestamp、三 source、多页、无重复与无跳项。

## 19. EMPLOYEE SCOPE

scope 只来自 `requireEmployeeAuthContext(request)`：

- `auth.businessId`
- `auth.membershipId`

客户端 query 仅接受 cursor 与 limit，不接受 businessId、membershipId 或 branchId。返回 branch 必须先通过同 business/membership source query。

## 20. SECURITY

已验证：

- 另一 membership candidate fail closed；
- 另一 business candidate fail closed；
- cross-employee cursor fail closed；
- P2 关联必须同 business/membership；
- branch lookup 绑定 business；
- invalid/无 session 由既有 employee auth 拒绝；
- manager capability 不扩大 employee archive ownership；
- API 不接受 arbitrary scope；
- response 不包含 raw model、audit payload 或内部关联 ID。

## 21. API

新增：

`GET /api/employee-attendance/corrections?cursor=...&limit=20`

使用既有 Staff employee session、HR module gate、employee attendance JSON/error conventions。Route 仅 export GET；线上 POST smoke 返回 405。

Response：

```json
{
  "ok": true,
  "data": {
    "items": [],
    "nextCursor": null,
    "hasMore": false
  }
}
```

## 22. PERFORMANCE

- 三个 anchor source 并行 bounded query；
- 每源最多 `limit + 1`；
- P2 exception、branch、resolution、final result 全部 batch enrichment；
- 无 per-item N+1；
- Resolution events 通过 relation 一次读取，最多覆盖 bounded 51 个 case；每个 case 返回完整 employee-safe lifecycle；
- 不读取 AuditLog；
- 只 select DTO 所需字段。

## 23. FIELD READINESS MATRIX

| Field | Status | Evidence/limitation |
|---|---|---|
| sourceKey | READY | typed canonical source ID |
| sourceType | READY | explicit three-source enum |
| business/membership/branch/workDate | READY | source-scoped canonical facts |
| status | READY | frozen evidence mapping + UNKNOWN fail-safe |
| submittedAt | PARTIAL | Resolution explicit event、P2 request creation；Standalone 无独立字段 |
| requestedAt | PARTIAL | Standalone request creation；其他 source 无独立字段 |
| reviewedAt | READY | 有 canonical evidence 时返回，否则 null |
| resolvedAt | PARTIAL | Resolution/P2 支持；Standalone 无独立字段 |
| reason | READY | canonical request/event fields |
| managerNote | PARTIAL | 有 review/event field 时返回 |
| requestedClockIn/Out | READY | 有 canonical requested/proposed value 时返回 |
| events | PARTIAL | Resolution 完整；Standalone/P2 无同等 event stream |
| final result | PARTIAL | Resolution/P2 支持；Standalone 不支持 |
| finalDisposition | PARTIAL | Resolution 支持；P2 使用 outcome，Standalone 不支持 |
| P2 lifecycle | PARTIAL | request status + current resolution/final；无 Returned/full event stream |
| canEmployeeAct | READY | Resolution lifecycle guard；其余 false |
| nextAction | READY | SUBMIT/UPDATE/NONE |
| pagination | READY | scoped deterministic multi-source cursor |

## 24. MANAGER P2 PROJECTION GAP

**MANAGER_P2_PROJECTION_GAP**

当前 Staff manager queue 仍只投影既有 ResolutionCase 与 standalone AttendanceException，未纳入 P2 AttendanceCorrectionRequest。本 phase 没有修改 `/staff/requests/attendance-corrections`。

未来应扩展既有 manager attendance projection，并继续调用 canonical P2 review service；不应创建新 manager route 或第二套 approval workflow。

## 25. FILES CHANGED

- `src/lib/attendance/employee-correction-archive.ts`
- `src/app/api/employee-attendance/corrections/route.ts`
- `tests/unit/employee-correction-archive.test.ts`
- `tests/integration/employee-correction-archive.test.ts`
- `TETAMU_EMPLOYEE_ATTENDANCE_CORRECTION_UNIFIED_READ_MODEL_PHASE1_REPORT.md`

未修改 Staff UI、manager route、schema 或 migrations。

## 26. TEST RESULTS

- New archive unit：14/14 PASS
- Embedded PostgreSQL actual relationship integration：1/1 PASS
- Focused Staff/Attendance regression：124/124 PASS
- TypeScript `tsc --noEmit`：PASS
- Target ESLint：PASS（0 errors）
- Full ESLint：PASS（0 errors；3 个既有 warnings，均不在本次文件）
- `git diff --check`：PASS
- Production build：PASS，route manifest 包含 `/api/employee-attendance/corrections`
- Testing smoke：
  - `GET /api/health` → 200
  - unauthenticated GET archive → 401
  - POST archive → 405
  - authenticated live GET → **未执行：无预存 Staff Testing session，且本轮不发送 OTP/不制造 session**

## 27. FULL UNIT STATUS

**1346 / 1346 PASS，0 fail。**

覆盖 Attendance History、Timesheet、Resolution、P2、Approval Center Attendance、Requests Hub、Home、Schedule、Leave、Claims、Payroll 相关既有 regression。

## 28. NO MUTATION CONFIRMATION

新 read service 只调用 `findMany`；没有 create、update、upsert、delete、approve、reject、return、resolve、cancel 或 AuditLog 写入。API 仅 GET；静态断言与线上 POST 405 已验证。

## 29. NO DUPLICATE WORKFLOW

没有新增 workflow、status machine、manager decision service、write API 或 frontend-owned correction state。既有三套 canonical write ownership 保持不变。

## 30. NO NEW MIGRATION

**NO NEW MIGRATION。**

Prisma schema 与 migrations 均未修改。

## 31. TESTING DEPLOYMENT

Commit: `71b21947145381c7a5fb14c68c6de42eeb68ff9c`

Deployment ID: `19e0ceb8-fe18-4207-a677-5a8009286e8a`

Status: `SUCCESS`

Post-deploy health：HTTP 200、database ready，release deployment ID 与上述 ID 一致。

Environment: Railway `Tetamu-POS / testing / tetamu-staff-app`

**TESTING ONLY**

## 32. PRODUCTION STATUS

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**
