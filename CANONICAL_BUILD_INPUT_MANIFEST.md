# Phase 2.6 — Canonical Build input manifest（仅输入决议；不 build）

本表替代 Phase 2.5 的粗粒度输入表。状态为 `APPLY | MERGE_SEMANTICALLY | REIMPLEMENT | SUPERSEDED | DROP_OBSOLETE | MANUAL_RESOLUTION | DEFERRED_POST_ALIGNMENT_FEATURE`。`APPLY` 表示选定来源，不等于已合入。完整 SHA/文件/测试见 `LATER_WORK_SOURCE_PROVENANCE_FINAL.md`，逐 SQL 见 `CANONICAL_MIGRATION_MANIFEST_222.md`。

| Feature / module | 精确来源（branch/SHA/迁移） | 决议 | 语义优先级 / 未决 |
|---|---|---|---|
| 共同 lineage 与 Testing 5 unique commits | Testing-Recovered `5f9b5b5f350d6ee3670f4d989b203776e6527544` | `APPLY` | 用于 Git 共同基准；不等于容器运行版源码。 |
| Local 8 unique commits 与 UAT/fixture | Local `c5a84d04932d4371fccd40a66bf8dd7c1fadb4f9`；Phase 1 lineage | `MERGE_SEMANTICALLY` | 只保留有独立测试/工具价值的项；避免覆盖后续安全合同。 |
| 222 条 verified migration SQL | `canonical-migration-reconstruction/prisma/migrations/*`；213 Git + 6 runtime + 3 Performance，checksum/replay/schema equivalent | `APPLY` | **原字节、原顺序**；6+3 已包含，禁止重复追加/改写。 |
| Prisma target | Runtime `schema.prisma` SHA-256 `F040834D...` + `schema.canonical-probe.prisma` + fresh DB catalog | `REIMPLEMENT` | DB truth 优先；同名 FK/index Prisma limitation 以 catalog 断言，不改 verified SQL。 |
| Runtime auth/backoffice session、密码/MFA | R `src/lib/auth/{session,password-login,mfa-*}.ts`；与 P `b2a4bc1...` 对应核心文件同 hash | `APPLY` | 保留 DB-backed session、JWT、MFA、logout/revocation；SERVICE login 策略单独审核。 |
| Runtime Staff PWA session | R `src/lib/attendance/employee-auth/session.ts`；P/RC 后续版本与之不同 | `MANUAL_RESOLUTION` | R 保留 attendance-disabled 非撤销及滑动 `expiresAt`；P/RC 更严格但会改变自助会话行为。须裁决并写负测，不能 take latest。 |
| People 目录/权限 | `553156352a3c6b5d47eddb776d9da82f3236b65b` + `f7917672da656994c2bdd82f93227a140e3c4a36`；222 内 `20260915090000...`；R `TEAM_READ` | `MERGE_SEMANTICALLY` | 保留账户分类与 tenant scope；P core-pilot 少了 TEAM_READ/例外路由逻辑，不能直接 supersede R。 |
| HR Payroll/exception/Attendance 输入 | HR preview `aa86e91a1438d94d5ed1cc75ba8c5b0d3a7da4a3`、`954e1b32efc2417b55d571b074a142c1a7f49803`，后续 RC-r2 | `MERGE_SEMANTICALLY` | 保留审核链、whole-business guard；与 P pilot frozen domain 合同整合。 |
| Manual PCB / published correction / version / settlement | RC-r2 `0170cdc2ed1450e23f64bce82e258aa69406e5fc` 至 `eed66c60a251aa9a77e2bd3077a65cc85df58fdb`；`20260920000100_controlled_manual_pcb_source`、`20260920000200_published_pcb_correction` | `DEFERRED_POST_ALIGNMENT_FEATURE` | 两条 migration 不在 222 baseline，本轮不复制、不改 DB，也不纳入依赖代码。以后按正常新功能开发新增经 Testing 验证的 migration；222 内现有 Payroll/PCB 内部计算与保存不受影响。 |
| Production image security | `release/tetamu-pos-production-20260921` `c48fb152631646da4a7f98dca16e5f8fbc93c40a` | `APPLY` | 只含图像/依赖补丁；不是最终 canonical source。 |
| Payroll/official export/government/bank execution hard freeze | core-pilot `3dbc37535e563d2a8aec12738b681c1eff1e94e7`、`804863964839c7e2b42364c86a16e2dfa30de779`、HEAD `b2a4bc1cb737fa776065d9211a2133c050d65af3`；`pos-pilot-contract.ts` | `APPLY` | 代码硬拒绝 + Production/Testing env contract + 47/47 单测；不得被 HR/RC 功能覆盖。 |
| Payment Export 环境显式 false | RC staging `0d0bbda3567540ac65bb666899be6969c50930ee` `production-contract.mjs`；P pilot hard deny | `MERGE_SEMANTICALLY` | 可采用 `PAYMENT_EXPORT_ENABLED=false` 作为额外合同，但不可用 flag 取代 P 的 code hard deny；范围分别核对。 |
| Singapore DB/RC staging identity | `696336bb624e6dc533372c3164fb993d18119313`、`0d0bbda3567540ac65bb666899be6969c50930ee` | `MERGE_SEMANTICALLY` | 数据库 fingerprint/地域与 synthetic-only staging policy 保留；不得把 staging 的环境身份借给 Production。 |
| WhatsApp 非生产直发旁路修复 | `6ea16d3c6c9bef3035e72962b4a6a2d57156ee23` | `APPLY` | 只关闭非 Production 旁路；**不是** Production 全禁用。 |
| Production REAL SMS/WhatsApp/Email disabled | P validator 当前要求 live SMS OTP/WhatsApp；staging 禁用仅适用于 staging；Email 无完整 provider guard/负测 | `MANUAL_RESOLUTION` | 当前与目标合同冲突，不能选择“最新”；Release Owner 先决定 OTP 与获批例外，再建各 channel 默认拒绝及负测。 |
| 591 runtime 差异文件 | R `testing-runtime/source-tree/`；34 Git exact blob、557 未在 Git DB | `MANUAL_RESOLUTION` | 按关键模块选择 `APPLY` / `REIMPLEMENT` / `SUPERSEDED`，不能整目录覆盖。Performance 写侧及认证 HTTP 仍 critical。 |
| 原 Railway CLI ZIP | `NOT_FOUND` | `DROP_OBSOLETE`（仅对字节复原目标） | 不要求恢复原包；但关键行为等价与安全验证 Gate 未过，不能据此宣称 ready。 |

Phase 3 输入依赖顺序：冻结 222 SQL/DB catalog → 解决 Staff session/People route 语义冲突 → 采用 P hard-freeze + RC 显式环境合同（不混淆 staging/Production）→ 针对 SMS/WhatsApp/Email 各自重建禁用策略 → 同一候选跑认证、支付、消息负测。当前有 `MANUAL_RESOLUTION`，本表**不是**可执行 merge 列表。
