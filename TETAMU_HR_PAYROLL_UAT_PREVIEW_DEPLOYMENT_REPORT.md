# TETAMU HR/PAYROLL — UAT PREVIEW DEPLOYMENT REPORT

- 日期：2026-09-17
- 目标：独立 Railway HR/Payroll UAT Preview
- 最终 verdict：`PREVIEW_DEPLOYMENT_BLOCKED`
- Stop code：`PREVIEW_EXTERNAL_INTEGRATION_GUARD_MISSING`

## 1. Executive Summary

Canonical RC 身份完整且未发生漂移，但部署在创建任何 Railway Preview 资源之前被安全 gate 阻止。原因不是 Railway 故障，而是 immutable source 尚未提供满足本轮要求的 Preview 专属安全路径：

1. `NODE_ENV=production` 时，Staff OTP 明确拒绝 `mock`；继续只能使用真实 Twilio/SMS123 provider，与本轮“不得发送真实短信”冲突。
2. 八角色 fixture 明确拒绝 `NODE_ENV=production`，并只允许 localhost 数据库；它没有可以把新 Preview environment/database ID 或连接指纹列入 allowlist、同时拒绝 Testing/Production 的机制。
3. `APP_ENVIRONMENT=uat-preview` 会在 `/api/health` 的 release identity 中被归类为 `development`，无法返回要求的 `environment=uat-preview`；同一值还会绕过 `validate-release-environment.mjs` 仅对字面值 `production` 执行的 Production contract。

因此没有 push、没有创建 Preview environment/service/database/domain、没有配置变量、没有 migration、没有 fixture、没有部署，也没有发出 UAT URL 或凭证。Testing 与 Production 的 deployment、domain 和变量指纹经前后只读比对保持不变。

## 2. Git Push Evidence

| 项目 | 结果 |
|---|---|
| 本地 branch | `codex/hr-payroll-canonical-rc-20260916` |
| 当前执行前 HEAD | `07355a2af1278d3495c92409a2defa9996cccb80`（evidence-only commit） |
| Canonical source commit | `f2553d3fcf5965b50151a52a374112ccac430417` |
| Source ancestry | PASS：canonical source 是当前 HEAD 的祖先 |
| Remote RC branch preflight | 不存在；`git ls-remote --heads` 无结果 |
| Push 执行 | **NO**；Task 3 安全 gate 失败后停止 |
| Force push / main push | **NO** |

Push 前全量 TypeScript/lint/unit/build gate 没有重跑，因为流程在允许 push 之前已按强制 stop rule 终止。不能用上一轮成功记录把本轮 push gate 写成 PASS。

## 3. Railway Read-only Baseline

Railway CLI：`5.57.5`；认证成功。未显示 token 或 credential。

| 对象 | ID / 当前部署 | Domain |
|---|---|---|
| Project `Tetamu-POS` | `ec8b25a7-4fb9-4959-8353-b4af000f4e80` | — |
| Testing environment | `ac9ef980-6805-4bf2-99f2-72dc7579d99d` | — |
| Testing Desktop | service `e967b54d-dd06-4741-be99-e6e55e70af0e`; deployment `e253e3d7-6679-4a14-aec4-8bf60e4414ef` | `tetamu-pos-web-testing.up.railway.app` |
| Testing Staff | environment service `5f4fb86d-85d6-4a30-a027-6c2d36425c93`; deployment `5b3a4171-2a75-4164-aee2-efcc2fead738` | `tetamu-staff-app-testing.up.railway.app` |
| Testing canonical SG DB | service `49c45405-1634-4292-9df3-bc27fe9a62a1`; deployment `7498c681-c14f-4f1a-ab2c-5afdb7c23412` | private only |
| Production environment | `bef43b86-32dc-486e-a1ef-bb9f9699e4f5` | — |
| Production Web | service `e967b54d-dd06-4741-be99-e6e55e70af0e`; deployment `ee8c83f4-e33a-4742-b71c-e87849abecb8` | `tetamu-pos-web-production.up.railway.app` |
| Production SG DB | service `45c5d61e-85b5-43b9-919a-0e1eaedaffa5`; deployment `5a6fd688-65f7-43c5-ba9a-d88413664ba8` | private only |

环境清单在执行前后都只有 `testing` 与 `production`。`hr-payroll-uat-preview-20260917` 没有被创建。

## 4. Preview Architecture

计划架构已写入 `docs/superpowers/plans/2026-09-17-hr-payroll-uat-preview-deployment.md`：

- 新环境：`hr-payroll-uat-preview-20260917`
- 单一 Next.js Web：`tetamu-hr-payroll-uat-web`
- 独立 PostgreSQL：`tetamu-hr-payroll-uat-db`
- `/team` 与 `/staff` 共用一个 Web deployment 和一个 Preview DB
- 不创建 worker、cron、WhatsApp connector 或第二个 Staff service

实际状态：**NOT CREATED**。在缺少安全 guard 时创建资源只会产生无用成本和不完整 Preview，因此按要求提前停止。

## 5. Environment / Service IDs

- Preview environment ID：`NOT ISSUED`
- Preview Web service ID：`NOT ISSUED`
- Preview database service ID：`NOT ISSUED`
- Preview deployment ID：`NOT ISSUED`
- Preview domain ID：`NOT ISSUED`

## 6. Database Isolation

没有建立或连接 Preview database；没有读取、迁移或写入 Testing/Production database。由于没有 Preview DB，无法声称已完成 connection fingerprint、空库或 migration-head 证明。

本轮只读取 Railway service/deployment metadata 和现有 service variables 的不可逆 SHA-256 指纹；没有输出变量值或数据库 credential。

## 7. Variable Safety Review

没有设置任何 Preview variables。Testing/Production 的 14 个现有服务均进行了两次内存内 JSON 规范化与 SHA-256 比对，变量数量和指纹完全一致；原始值没有显示或落盘。

| Environment / Service | Variables | 前后 SHA-256（相同） |
|---|---:|---|
| testing / Postgres-Canonical-Testing-SG | 26 | `edea31b03e3a39af8e7cb29d8f9bf25f28db030dea38bfa9a4f4346baa4a5716` |
| testing / tetamu-staff-app | 58 | `4c62fce407e9dcb554ac49ebbbfa1dc3650aee55c850476dbc1a31e5cb9418fd` |
| testing / Postgres-Singapore | 30 | `23107da845812396d55f567aad7b7ebcf9a936eabc97d520dce96cbe9b8259a6` |
| testing / tetamu-pos-web | 59 | `7809d98b0355a07a99c4aedd6e0d34cbac181c1a5693cc5e7890f002fc24bd9e` |
| testing / tetamu-db-backup | 23 | `6e63e2b3b92496b528d6fa3627962e6296997e3a77817ac3e65aa5a0f4ab453e` |
| testing / tetamu-db-restore-verify | 25 | `166c8fc3d5d20191f5083bf39677de0529c71f8efdfbf357fa23b6d37dd80299` |
| testing / tetamu-pos-whatsapp | 23 | `e76de8e5e5260801820e08ab5dafe673918745adb1b1308c1e44b00501120aff` |
| testing / Postgres-Canonical-Testing | 29 | `b7233646528c7c96d1a329d1520c47a0a5d767405816b910a5b6c818ea882a03` |
| testing / tetamu-pos-worker | 18 | `f6837b1befeaa05b3a39df308591143b8c052aaf8a70b1cc03176a3882b533a9` |
| production / tetamu-pos-whatsapp | 22 | `1b65670d6a09ad08a1dcd8928c39a2bc98f64cd4cdfba2a85794e3cdc10dbe25` |
| production / tetamu-pos-worker | 12 | `3e805e4bfd850b6feff06791dc49a438ad3abf281000a6907367557ff4283f5b` |
| production / Postgres-Singapore | 26 | `d20948f86153eab1fa4a7dd49ef4bed4b690d49a7f43a897b0af3c1ff14f16ce` |
| production / tetamu-pos-web | 20 | `b26d5b227ab5a6e80ba0f70a9f514e5f3b4079dbddcb959beb5f6e516d315298` |
| production / Postgres | 29 | `81eebe62eea8453babe5858b4f00a7b8ce60d351fa1d047d15c238a593da0833` |

## 8. Migration Results

- Preview migrations：`NOT RUN`
- Preview migration count/head：`NOT AVAILABLE`
- 原因：Preview database 没有创建。没有运行 `migrate reset`、`db push`、drop、force migration 或历史 migration 修改。

## 9. Synthetic Fixture

Preview fixture：`NOT RUN`

确认的 blocker：

- `scripts/hr-payroll-eight-role-uat-contract.ts:109-117` 在 `NODE_ENV=production` 时抛出 `HR_EIGHT_ROLE_UAT_FORBIDDEN_IN_PRODUCTION`，并拒绝所有非 localhost 数据库。
- 这可以保护现有本地 fixture，但不能证明目标是新的 Preview DB，也不能对 Testing/Production connection fingerprint 做 fail-closed 区分。
- focused test 明确验证这个行为；不得通过隧道伪装成 localhost 来绕过，因为那会使同一 fixture 也能误连 Testing/Production。

没有建立 UAT 用户、密码、OTP、session token 或 synthetic business，因此没有 credential artifact 需要清理或交接。

## 10. Deployment Identity

Canonical identity重新计算结果：

| 项目 | 结果 |
|---|---|
| Source SHA | `f2553d3fcf5965b50151a52a374112ccac430417` |
| Source tree | `8d8f7cc821aaf1490c746d72be418b1211302549` |
| Deterministic archive SHA-256 | `1963e5a46bec9630a0b3be7f60674b6f7bfeff060a9eb8440af1c726ed1e2c82` |
| Ordered commits | 32/32，与 Git 顺序一致 |
| Included file hashes | 91/91，无 mismatch |
| Next | `16.3.5` |
| Sharp | `0.35.4` |
| Sharp `<0.35.4` | 0 |
| Next runtime `<16.3.3` | 0 |

Railway deployed SHA/image digest/source snapshot：`NOT ISSUED`，因为没有部署。

额外身份 blocker：最小复现 `runtimeEnvironment({APP_ENVIRONMENT:"uat-preview", NODE_ENV:"production"})` 返回 `development`，所以现有 health contract 不能满足 `environment=uat-preview`。

## 11. Health and Smoke Results

Preview HTTPS、HTTP 200、health、database ready、release SHA、source digest、deployment identity、server logs、migration logs：全部 `NOT RUN`。SSR、本地 browser 或上一轮 RC smoke 没有被用来替代 Preview browser gate。

## 12. Desktop / Staff Results

- Desktop Preview smoke：`NOT RUN`
- Staff Preview smoke：`NOT RUN`

Focused safety tests新鲜运行结果：17/17 PASS，0 fail/skip/todo。这里的 PASS 证明 fail-closed blocker 确实存在，不代表 Preview smoke 通过：

- production mock OTP 被拒绝；
- Production release validator 拒绝 employee OTP mock；
- 八角色 fixture 拒绝 production 和 remote DB；
- auth cookie/route isolation 仍正常。

## 13. RBAC Results

Preview 八角色 RBAC：`NOT RUN`。没有把本地 RC 的已通过证据冒充 Preview evidence。

待未来 Preview 验证的边界仍包括 Branch Manager branch scope、Supervisor no Payroll、Group Manager no bank/statutory/mutation、Staff own-only、Payroll Read 不等于 Modify/Export/Submit，以及 deep-link denial。

## 14. Responsive Results

Preview 1440 / 834 / 390 / 360：`NOT RUN`。People、Payroll Run、Payment blocked、Staff Home、Staff Payslip 和 date picker 均等待安全 Preview 部署后验证。

## 15. Restricted Feature Results

没有 Preview runtime 可供测试，因此不能把这些功能写成已部署 PASS。由于没有创建或配置任何 Preview 服务，本轮也没有启用、调用或传送：

- 银行付款或 paid marking；
- official statutory export；
- government submission；
- PCB Production；
- SMS123/Twilio/WhatsApp/email provider；
- Production webhook/storage/cron/queue；
- AI/OCR provider。

## 16. Existing Environment Non-Mutation Proof

前后只读检查结果：

- Testing environment ID 不变；
- Testing Desktop deployment `e253e3d7-6679-4a14-aec4-8bf60e4414ef` 不变；
- Testing Staff deployment `5b3a4171-2a75-4164-aee2-efcc2fead738` 不变；
- Testing domains 不变；
- Production environment ID 不变；
- Production Web deployment `ee8c83f4-e33a-4742-b71c-e87849abecb8` 不变；
- Production domain 不变；
- 14 个现有服务 variable fingerprints 全部一致；
- 环境清单仍只有 `testing`、`production`；
- 没有 Preview environment，故没有共享 volume、database 或 deployment source。

未连接 Testing/Production database，所以没有主动读取 migration head；同时本轮没有执行任何 database command 或 service deployment，相关 deployment IDs 也未改变。

## 17. Human UAT URL

`NOT ISSUED — PREVIEW_DEPLOYMENT_BLOCKED`

不要使用现有 Testing 或 Production URL代替本次 UAT Preview。

## 18. Credential Handover Method

本轮没有创建 UAT credential，因此没有可交接内容。

未来安全 Preview 成功后，建议把随机生成的 Preview-only 密码和一次性 OTP 读取方式存入受限 password manager / macOS Keychain secure note，并通过与报告分离的安全渠道只向审核者共享。报告只记录 secret item 的名称和访问负责人，不记录值；OTP、session cookie 和 `DATABASE_URL` 不进入 Git、报告或聊天。

## 19. Human UAT Checklist

已生成 `TETAMU_HR_PAYROLL_HUMAN_UAT_CHECKLIST.md`，包含 25 项普通用户可执行流程及角色、前置条件、步骤、预期/实际结果、PASS/FAIL、截图备注、严重度和 retest 字段。

当前 checklist：0 PASS、0 FAIL、25 BLOCKED；`humanUatStatus=PENDING`。

## 20. Rollback / Delete Preview Procedure

当前没有 Preview 资源，所以不需要 rollback 或删除。

未来部署后的受控程序：

1. 先用只读 `railway status` 解析并记录 Preview environment、Web、DB、deployment 与 volume 的精确 ID。
2. App 回退只允许选择同一 Preview service 的已验证 commit-bound deployment；不回滚或修改数据库 migration history。
3. 若必须停止 UAT，先停止/隔离 Preview Web；保留只含 synthetic data 的 evidence 直至审核决定。
4. 删除必须在用户另行明确授权后，仅删除 `hr-payroll-uat-preview-20260917` 的精确 environment ID；删除会连同 Preview DB/volume 造成数据不可恢复。
5. 删除前后再次核对 Testing/Production environment IDs，绝不按模糊名称或默认 linked environment 操作。

## 21. Cost / Resource Note

本轮没有新增资源，因此没有产生新的 Preview compute、volume 或 egress 成本。

只读 usage snapshot：当前 billing period usage/bill 约 `$18.8685`，estimated bill 约 `$19.8956`，workspace 没有 hard usage limit。未来一个常驻 Next.js Web 和一个 PostgreSQL volume 会增加按量成本；Railway 当前官方说明按 CPU、RAM、volume storage 和 egress 计费，并建议用 private networking 和 usage/resource limits控制费用：

- <https://docs.railway.com/pricing>
- <https://docs.railway.com/pricing/cost-control>

具体新增金额取决于实际运行时间和资源用量，不能在部署前准确承诺。

## 22. Remaining Risks

必须通过新的、重新审核的 canonical RC 解决，不能在部署时临时绕过：

1. 增加明确的 `uat-preview` runtime environment 类型，并让 health 原样返回该身份。
2. 保持 `NODE_ENV=production` 的同时，提供仅允许指定 Preview environment/service 的 OTP intercept；不能发送真实 provider 请求，不能把验证码写进日志、Git、报告或公开 URL。
3. 让 release environment validator 对 Preview 执行 production-grade secrets/source/database contract，而不是因字符串不是 `production` 而跳过。
4. 建立 Preview-only idempotent fixture guard：绑定 Railway project/environment/database service ID 与 salted connection fingerprint；显式拒绝现有 Testing/Production IDs/fingerprints。
5. 新 RC 必须重新通过工程、安全、browser 和 source identity gates；旧 `f255...` 不能在未修改的情况下满足本轮 Preview contract。
6. Git-connected部署必须让 Railway 权威 metadata 指向新的 audited immutable source SHA，不能只依赖人工填写 `APP_RELEASE_SHA`，也不能部署 evidence-only HEAD 冒充 runtime source。

## 23. Final Verdict

`PREVIEW_DEPLOYMENT_BLOCKED`

精确 blocker：`PREVIEW_EXTERNAL_INTEGRATION_GUARD_MISSING`。

未输出 `READY_FOR_HUMAN_UAT_ON_PREVIEW`，因为没有 Preview deployment、migration、fixture、health、smoke、RBAC 或 responsive evidence。未输出 Production Ready、Production Eligible、Human UAT Passed 或 Production Deployed。

本轮已按强制停止规则结束；没有覆盖现有 Testing，也没有修改 Production。
