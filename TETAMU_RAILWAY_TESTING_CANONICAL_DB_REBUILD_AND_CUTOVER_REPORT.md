# TETAMU — RAILWAY TESTING CANONICAL DATABASE REBUILD & CUTOVER REPORT

日期：2026-08-30（Asia/Singapore）  
Canonical workspace：`C:\CodexTetamuP0`  
目标环境：Railway `testing`  
Canonical Staff runtime：**Staff 3000 only**

> **TESTING ONLY**  
> **PRODUCTION NOT ACCESSED**  
> **PRODUCTION NOT MODIFIED**

## 1. FINAL VERDICT

**CUTOVER COMPLETE**

Railway Testing 已从历史漂移的 `Postgres-Singapore` 切换到新建的 `Postgres-Canonical-Testing`。新库由当前 Staff 3000 canonical migration tree 从空库应用 **212 / 212 migrations**，仅转移经 allowlist 审核的 5 家 Business，并完成逐表 exact-row、金额、FK orphan、Staff/Auth/Attendance、30 Aug Timesheet 与两台手机 OTP 请求能力验证。

旧 `Postgres-Singapore` 未删除、未改写、仍在运行，并保留新的 cutover-time verified backup，可立即作为 rollback source。

实体手机仍须使用刚收到的真实 SMS123 OTP 完成 fresh login；本轮没有读取验证码、没有替 owner 建立登录 session，也没有代替 owner 完成最终实体 UAT。

## 2. SERVICE DEPENDENCY AUDIT

Cutover 前，以下 Testing services 共用旧 Testing 数据库；它们必须同步移动，不能只切 `tetamu-staff-app`。

| Service | 旧 DATABASE_URL dependency | 同库读写 | 是否必须同步切换 | Cutover 结果 |
|---|---|---:|---:|---|
| `tetamu-staff-app` | Testing `DATABASE_URL` → old DB | 是 | 是 | 已切新库；重新部署成功 |
| `tetamu-pos-web` | Testing `DATABASE_URL` → old DB | 是 | 是 | 已切新库；重新部署成功 |
| `tetamu-pos-worker` | Testing `DATABASE_URL` → old DB | 是 | 是 | 已切新库；重新部署成功 |
| `tetamu-db-backup` | Testing backup target → old DB | 是 | 是 | 已切新库；部署成功 |
| `tetamu-db-restore-verify` | Testing restore verification target → old DB | 是 | 是 | 已切新库；部署成功 |
| `tetamu-pos-whatsapp` | 无独立 direct `DATABASE_URL`；经 `tetamu-pos-web` 使用业务状态 | 否 | 不需直接改变量 | 未直接修改 |

切换后五个 direct database consumers 的完整 `DATABASE_URL` 值已作 secret-safe equality check，全部指向同一新 Testing DB；报告不输出 credentials。

## 3. OLD TESTING BACKUP

来源：Railway Testing `Postgres-Singapore / railway`  
PostgreSQL：**18.4 (Debian)**  
Cutover-time database size：**53,286,591 bytes**  
Backup directory：`C:\Users\oscar\.codex\backups\tetamu-railway-testing-cutover\20260830T184846`

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `old-testing-cutover-full.custom` | 4,392,529 | `5355C3E66F9FB193F6583A324F6B5CC7C6D1C68C7AC3ACF2A16AA1B031A0D792` |
| `old-testing-schema.sql` | 1,117,817 | `9732E6141B3CB1DC932ECABC419CFC3E4B67C6970021908E4EF847BD7A31E0E5` |
| `old-testing-prisma-migrations.tsv` | 37,011 | `D1748102A359B74DF4E59A1017A20F6D95CE88A4EBB593E55D1C3206C44F2DEC` |
| `old-testing-domain-counts.tsv` | 431 | `FF74CB76D75DDF9BA2EE5B38D365039D745AE429B45449C7FC5CC0C7EC98CFB0` |
| `old-testing-restore-list.txt` | 278,058 | `30DFB88DFFB054563F6A7A3C6FEFF8D34DB402C9BD0EF5CE6B9EC482F67D0CDE` |

Backup verification：

- `pg_restore --list`：PASS，3,090 restore-list entries。
- 完整 custom dump 已恢复至隔离临时数据库。
- Restore 后只读核对：Businesses 8、memberships 55、migrations 212、Staff appearance columns 2。
- 临时 restore database 验证完成后已删除。
- 旧 Railway DB 本体没有被 restore、truncate、migrate、resolve 或写入。

## 4. BUSINESS INVENTORY

旧 Testing DB 的 8 家 Business 由真实数据库只读盘点；分类并非根据旧报告推断。

| Business / ID | Branch | Enabled modules | Memberships | Leave / Claims / Attendance | Roster / Timesheet | Payroll / Payslip / Commission | Appointments | Classification |
|---|---|---|---:|---|---|---|---:|---|
| Attendance Resolution UAT `a178f744-4af9-4c4f-8e66-12b134dd29c0` | Resolution Main Branch | AUTO, HR, PAYROLL, POS, STATUTORY, WHATSAPP | 1 | 0 / 0 / 36 | 0 / 0 | 0 / 0 / 0 | 0 | **ARCHIVE_ONLY** |
| Attendance Resolution UAT `d7d87783-8043-4160-b838-99cb254e86b7` | Resolution Main Branch | AUTO, HR, PAYROLL, POS, STATUTORY, WHATSAPP | 1 | 0 / 0 / 3 | 0 / 0 | 0 / 0 / 0 | 0 | **ARCHIVE_ONLY** |
| HASiL Verification 2026 `8ed2fb4f-d6c7-44dd-ac8e-23dd11a54796` | HASiL Verification 2026 | HR, PAYROLL, STATUTORY | 9 | 0 / 0 / 0 | 0 / 1 | 1 / 0 / 0 | 0 | **RETAIN_AND_TRANSFER** |
| Oscar Salon Damai `bd884722-c72f-4c29-96ed-c957a6590c0d` | Oscar Salon Damai | BUSINESS_GROUP, HR, PAYROLL, POS, SALON, STATUTORY, WHATSAPP | 1 | 0 / 0 / 0 | 0 / 0 | 2 / 0 / 0 | 0 | **RETAIN_AND_TRANSFER** |
| Oscar Salon Lintas `801b4fa7-4208-4a1d-b63e-c34e34ee5afb` | Oscar Salon Lintas | BUSINESS_GROUP, HR, PAYROLL, POS, SALON, STATUTORY, WHATSAPP | 10 | 4 / 0 / 12 | 0 / 3 | 4 / 0 / 0 | 0 | **RETAIN_AND_TRANSFER** |
| Payment Pagination Regression `58e476cf-cf04-46d4-b3e5-3c6b48ae058c` | Main Branch | HR, PAYROLL, POS, SALON, STATUTORY, WHATSAPP | 25 | 0 / 0 / 0 | 0 / 0 | 1 / 0 / 0 | 0 | **ARCHIVE_ONLY** |
| Payroll UAT Business `b87aaa12-b41d-44b5-908e-72d04e6a08a0` | Payroll UAT Branch | HR, PAYROLL | 1 | 0 / 0 / 1 | 6 periods / 1 | 1 / 1 / 0 | 0 | **RETAIN_AND_TRANSFER** |
| Royal Salon `611b0c19-ebf7-4548-8a48-a3b6a7af8a81` | salon online | AI, AUTO, BUSINESS_GROUP, CLAIMS, COMMISSION, EXPENSE, HR, INVENTORY, LOYALTY, PAYROLL, POS, SALON, STATUTORY, WHATSAPP | 7 | 2 / 3 / 10 | 5 periods / 0 | 0 / 0 / 0 | 19 | **RETAIN_AND_TRANSFER** |

Active UAT references：

- Royal Salon / salon online：iPhone normal employee 与 Android manager 两个 physical-device personas 均保留。
- Payroll UAT Business：保留 deterministic Attendance/Payroll/Payslip fixture。
- HASiL、Damai、Lintas：保留当前 canonical Payroll/HR evidence。
- 三家 `ARCHIVE_ONLY` 未进入新库，但完整存在于旧 DB 与 backup。

## 5. DATA CLASSIFICATION

**Retain / transfer**

- 5 个审核通过的 Business root IDs。
- Branch、EmployeeAccount、Membership、branch assignments、role/capability profiles、module entitlements。
- Leave policy/balance/request/evidence、Claim category/request/attachment/event、Roster/Attendance/Timesheet、Payroll/Payslip/statutory snapshots、Royal Salon appointments。
- 为 FK 完整性直接需要的 Business Group、User、configuration/version/snapshot parent records。

**Recreate**

- 没有以 fixture 取代已审核的 retained business facts；Royal Salon 与其他 4 家均按原 canonical IDs transfer。
- Login、OTP challenge、active employee session/device authorization 由 cutover 后 fresh login 重新建立。

**Archive**

- 两家 Attendance Resolution UAT。
- Payment Pagination Regression。

**Disposable / excluded runtime state**

- `_prisma_migrations`（新库只使用 canonical migration tree）。
- OTP challenges、OTP rate limits、auth sessions、active employee sessions。
- Idempotency runtime state、worker leases/locks、temporary queues。
- Legacy Testing-only OTP columns/functions/semantics。

历史 Attendance resolution events 若含不可移除 FK，会保留仅用于 immutable audit dependency 的 session parent row，但 transfer 会 deterministic revoke；新库 cutover 后 active employee sessions 为 0。这不是保留 stale physical login。

## 6. NEW CANONICAL TESTING DB

| 项目 | 结果 |
|---|---|
| Railway service | `Postgres-Canonical-Testing` |
| Service ID | `5b5acbed-12d8-4756-929a-676aeffd1100` |
| Environment | `testing` |
| PostgreSQL | 18.4 / Railway Postgres 18 image |
| Initial DB deployment | `abe80892-29e3-4afe-a118-243b46444914` — SUCCESS / RUNNING |
| Canonical migration source | `C:\CodexTetamuP0\prisma\migrations` |
| Migrations | **212 / 212 PASS** |
| `prisma migrate status` | **Database schema is up to date** |

Canonical schema verification：

- Staff appearance fields：present。
- SMS123 canonical OTP schema：present；真实 smoke challenge provider=`sms123`、delivery channel=`sms`。
- Legacy `employee_otp_challenges.provider_message_code`：**absent**。
- Effective-dated statutory table `employee_statutory_participation_periods`：present。
- PCB correctness foundation：`statutory_component_classifications` 的 7 个 evidence/effective/revision columns 全部 present。

## 7. ALLOWLIST TRANSFER

Transfer implementation：`scripts/transfer-staff-3000-allowlist.mjs`  
Evidence：`artifacts/railway-testing-cutover/20260830/transfer-v2` 与 `final-verify`

- Transferred Businesses：5。
- New DB Businesses：5。
- New DB EmployeeAccounts：27。
- New DB Memberships：28。
- Recorded insert operations across dependency-ordered transfer：**1,358 rows**。
- Canonical IDs preserved where required。
- Dependency order由 FK graph + root Business allowlist 决定；没有 blind `pg_dump --data-only | psql`。
- Global FK orphan audit：**0**。

Transfer 预切换期间发现 Windows/Asia-Singapore process timezone 会把 PostgreSQL `timestamp without time zone` 值移动 8 小时。该问题在任何 service cutover 前被拦截：目标新库当时仍隔离且可丢弃，因此目标被清空重建、transfer process 固定为 UTC、212 migrations 重新从零应用，并对每个 common column 做 exact equality verification。旧 DB 未修改。最终 transfer evidence 全部 PASS。

## 8. RECONCILIATION

### Identity

- Source allowlist vs target：5 Businesses、5 active target branches、27 EmployeeAccounts、28 Memberships。
- Royal Salon：7 memberships；两台 UAT personas 的 account、membership、branch scope 与 canonical IDs 保留。
- Staff roles/capabilities、module entitlements 与 branch assignments 逐表 exact match。

### Leave

- Royal Salon：2 requests；相关 policy/version、entitlements、buckets、ledger、supporting evidence exact match。
- Oscar Salon Lintas：4 requests；16 balances、16 entitlements、events/day/evidence exact match。
- Retained source/target status 与 row values一致。

### Claims

- Royal Salon：3 claims，3 attachments，3 lines，6 events。
- Submitted total：MYR 38.20；approved total：MYR 38.20；source = target。

### Attendance / OT / Timesheet

- Royal Salon：10 attendance sessions、17 punches、22 expected days、5 P2 final results、2 active P2 exceptions、1 OT review。
- Oscar Salon Lintas：12 attendance sessions、17 punches、11 legacy final results、3 monthly timesheets。
- Payroll UAT：1 attendance session、2 punches、31 expected days / P2 final results、1 monthly timesheet。
- HASiL：1 monthly timesheet and its readiness/revision parents。
- Attendance adjustments, exceptions, resolutions, immutable events, snapshots and OT evidence逐表 exact match。

### Roster

- Royal Salon：5 roster periods、38 published assignments preserved。
- Payroll UAT：6 roster periods、31 assignments / 31 published assignments preserved。

### Payroll / Payslip

| Business | Runs | Entries | Gross | Net | Payslip |
|---|---:|---:|---:|---:|---|
| HASiL Verification 2026 | 1 | 3 | 49,500.00 | 49,500.00 | 0 |
| Oscar Salon Damai | 2 | 2 | 5,100.00 | 5,100.00 | 0 |
| Oscar Salon Lintas | 4 | 26 | 73,836.06 | 65,129.51 | 0 |
| Payroll UAT Business | 1 | 1 | 3,000.00 | 3,000.00 | 1 / 2,458 bytes |

所有 totals、entries、snapshots、payment/statutory evidence source = target；没有 silent money difference。

### Commission

- Retained source当前没有 commission statement rows；target 同样为 0。Royal Salon 的 COMMISSION entitlement 保留，没有虚构 statement。

### Appointments

- Royal Salon：19 appointments，以及 customer/service/staff assignment parents exact match。
- Employee privacy/branch relation仍由 canonical runtime scope控制。

### Exceptions

- 首次 Lintas exact verify 显示 1 个 historical `employee_sessions` normalized field mismatch；transfer 改为 deterministic revoked representation 后，`oscar-salon-lintas-v2` exact verify PASS。
- 所有 retained business 的最终 `verification.pass=true`；global orphan constraints空。
- 没有 unexplained difference。

## 9. CUTOVER

Old DB：`Postgres-Singapore`（service ID `45c5d61e-85b5-43b9-919a-0e1eaedaffa5`）  
New DB：`Postgres-Canonical-Testing`（service ID `5b5acbed-12d8-4756-929a-676aeffd1100`）

Services switched：

| Service | Cutover deployment | Result |
|---|---|---|
| `tetamu-staff-app` initial DB switch | `61786801-2948-451f-9cc6-c891b5301498` | SUCCESS |
| `tetamu-pos-web` | `14e7eb1b-1768-483a-926c-541f9842b8a7` | SUCCESS |
| `tetamu-pos-worker` | `7657dccd-0da1-4010-936d-8e6254d98678` | SUCCESS / RUNNING |
| `tetamu-db-backup` | `b2dae5fc-9457-45fe-8d5a-f688cf0903d3` | SUCCESS |
| `tetamu-db-restore-verify` | `7cd79dc7-7b4f-47de-8d3d-d64228f00034` | SUCCESS |

No dual-write was introduced。Old DB connection target 与 new DB target 均只以 secret-safe identity 记录，credentials 未进入报告。

## 10. POST-CUTOVER PRISMA STATUS

2026-08-30 final live check：

```text
212 migrations found in prisma/migrations
Database schema is up to date!
```

Additional live checks：

- Businesses：5。
- Memberships：28。
- Active employee sessions：0。
- Global FK orphans：0。
- Legacy OTP `provider_message_code`：0 columns。
- Statutory period table：1。
- PCB correctness columns：7。
- OTP smoke 后 open challenges：2（由本轮两台 Testing 手机请求新建，非旧库 transfer）。

## 11. CONTROLLED STAFF DEPLOYMENT

Deployment ID：`fea94f32-04b7-480c-9cea-dc80956f857d` — **SUCCESS / RUNNING**  
Image digest：`sha256:2bdd319cd5ac62aa5f6e1fee705fb32afc4ffa3420d226505ec533c390136d9e`  
Isolated source：`C:\CodexTetamuP0-staff-testing-deploy-20260830`  
Branch：`codex/staff-testing-timesheet-20260830`  
Commit：`baa0f96ff5ffa2d50ca72fcc6c51276fc6353829`

部署来源为 clean isolated worktree，不是 dirty main workspace wholesale deployment。Commit 包含 143 个审核后的 Staff 3000/runtime dependency files，包括：

- `src/lib/attendance/employee-timesheet.ts`
- `src/app/staff/timesheet/page.tsx`
- `tests/unit/employee-timesheet-projection.test.ts`
- Android Home bottom-nav clearance、manager approval priority、empty upcoming schedule simplification。
- Staff 3000 shell/auth/approval/history/appointments/profile/roster 所需的 reviewed dependencies。
- 当前 canonical 212 lineage 中已审核的 PCB、statutory、Staff appearance migrations；本部署没有再创建新 migration。

Quality gates：

| Gate | Final result |
|---|---|
| Prisma validate / generate | PASS |
| Focused Staff suite | 70 / 70 PASS |
| Full unit | 1,211 / 1,211 PASS |
| Protected disposable integration | 187 / 187 PASS |
| Attendance route flow | 1 / 1 PASS |
| TypeScript | PASS |
| ESLint | 0 errors；3 pre-existing warnings |
| Next.js 16.3 production build | PASS |

第一次 disposable gate 发现 isolated test 内 Commission fixture 使用过时的 `paidAmount/status` 前置，与 canonical service contract 不符；仅同步该 test fixture 后全绿，runtime business logic 未为测试而削弱。

Post-deploy runtime smoke：

| Route | HTTP |
|---|---:|
| `/api/health` | 200 |
| `/staff/login` | 200 |
| `/staff` | 200 |
| `/staff/roster` | 200 |
| `/staff/timesheet` | 200 |
| `/staff/manifest.webmanifest` | 200 |

PWA manifest：name=`Tetamu Staff App`、start_url=`/staff`、scope=`/staff`、display=`standalone`。Runtime port=`3000`；没有 3100 dependency。

Final health recheck：Local Staff 3000 `/api/health` = 200；Railway Testing Staff 3000 `/api/health` = 200。

## 12. TIMESHEET 30 AUG VERIFICATION

Persona：iPhone normal employee / Royal Salon / salon online / 2026-08-30。

- Attendance History：**Completed**；raw attendance session 1，punches 4（Clock In、Break Start、Break End、Clock Out）。
- Expected Attendance：current roster workday存在。
- P2 active exceptions：2（Late Arrival + Early Departure）。
- Timesheet primary card count：**1**。
- Status：**Waiting for manager**。
- Reason：Schedule difference / Late + Early equivalent。
- Employee correction CTA：**不显示**；该日不是 missing punch，不能误导为 `Send the missing time`。
- Duplicate 30 Aug cards：**0**。

Old vs new read-model audit artifacts byte-for-byte equivalent（各 18,930 bytes）：`.tmp/old-timesheet-30aug-audit.json` 与 `.tmp/new-timesheet-30aug-audit-v2.json`。

## 13. ANDROID HOME FIX

已部署的 presentation fix：

- Fixed bottom navigation保留；mobile content reservation使用 `96px + safe-area-inset-bottom`，并设置 matching scroll padding。
- Manager 有 pending work 时，compact `Needs My Approval` 排在 Schedule 与 Quick Access 前；普通员工不显示。
- Today 与 Upcoming 都空时不再出现两个大型重复 empty cards；不推断 rest day。
- Quick Access 仍只有 Appointments、Schedule、Leave。

Reviewed mobile verification：

- `390 × 844`：无 horizontal overflow；final card 可完整滚到 nav 之上；约 31.34px clearance；touch target ≥ 50px。
- `412 × 915`：无 horizontal overflow；约 30.82px clearance；touch target ≥ 50px。
- Normal employee：无 manager entry。
- Manager pending > 0：compact approval CTA reachable。

这些 contract 已进入成功部署的 isolated commit；实体 Android 最终视觉确认需在 owner 输入真实 OTP 后执行。

## 14. TWO-PHONE UAT READINESS

### iPhone — `011****2259`

- Account / membership：active。
- Persona：Real Device UAT Employee。
- Business / branch：Royal Salon / salon online。
- Primary branch active；`canClockIn=true`；Attendance enabled。
- Manager capabilities：无；Approval Center不得显示。
- Active session：0，符合 fresh-login policy。
- Real SMS123 request：最终 HTTP 202 / `CODE_REQUESTED`；DB `delivery_accepted_at` present。

观察：第一次自动 smoke request 返回 HTTP 503，安全 log 只暴露 `PrismaClientKnownRequestError`；同一号码随即重试成功且未再次复现。该 transient failure 没有产生 challenge；成功请求产生 1 个 canonical SMS123 challenge。建议实体 UAT 时留意，如重现再以 request ID 做独立 connection-pool investigation。

### Android — `012****3848`

- Account / membership：active。
- Persona：Real Device UAT Manager。
- Business / branch：Royal Salon / salon online。
- Primary branch active；`canClockIn=true`；Attendance enabled。
- Canonical branch-scoped capabilities：Leave approval、Claim review、Attendance read/manage、Roster view；OT review由 Attendance manage contract提供。
- 未授予 `ALL_BRANCHES`。
- Self-review仍受 canonical workflow阻挡。
- Active session：0，符合 fresh-login policy。
- Real SMS123 request：HTTP 202 / `CODE_REQUESTED`；DB `delivery_accepted_at` present。

### OTP / device session conclusion

- Railway Testing runtime：`OTP_PROVIDER=sms123`、send mode=`provider`、API key configured（value not printed）。
- 两台号码均已由 SMS123 gateway accepted；验证码有效 5 分钟，resend cooldown 60 秒。
- 本轮没有读取/记录 OTP value，没有 verify OTP，没有建立 device/session。
- Owner next step：在两台实体手机输入各自收到的 OTP，完成 fresh login 与最终 iPhone/Android UAT。

## 15. ROLLBACK STATUS

Rollback path已保留：

1. 暂停新 Testing DB writes。
2. 将五个 direct consumers 的 Testing `DATABASE_URL` 恢复为旧 `Postgres-Singapore` reference。
3. 重新部署/重启 Testing runtime。
4. 验证 health 与 Staff login。
5. 保留新 DB 供 diagnosis；不 dual-write。

Old DB service、volume、cutover-time backup、restore list 与 hashes均可用。未执行任何 destructive old-DB action。

## 16. OLD DB STATUS

`Postgres-Singapore`：deployment `04b6e663-4d0e-4d6c-8b33-2e0e437d147a`，**SUCCESS / RUNNING**。

Final read-only check：

- Businesses：8。
- Memberships：55。
- Migration rows：212（历史 lineage 保留原样）。

**ARCHIVE / ROLLBACK AVAILABLE**

## 17. 3100 STATUS

**REFERENCE ONLY / READY TO RETIRE**

当前 Testing deployment、PWA manifest、runtime smoke 与 canonical source均为 Staff 3000。未恢复、未部署、未依赖 3100。

## 18. PRODUCTION STATUS

**TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

没有访问 Production database、service variables、runtime logs、endpoint、credentials 或 application data；没有创建 Production deployment 或 migration。

---

Final principle achieved：

- One canonical schema。
- One 212-migration lineage。
- One Staff 3000 runtime。
- Old Testing DB remains historical archive / rollback evidence。
