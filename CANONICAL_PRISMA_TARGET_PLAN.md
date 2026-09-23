# Canonical Prisma target plan（只规划，不改正式 schema）

目标：未来 `schema.prisma` 准确描述已由 222 条 SQL 重建并与 Testing 等价的 DB；不得通过 `db push`、`migrate resolve` 或生成“修正 migration”反向改 verified DB。临时材料在 `.reconciliation-evidence/phase2_5/`，正式 runtime/reconstruction `schema.prisma` 未改。

1. 从 `schema.from-222-replay.enriched.prisma` 建立 Phase 3 的待审核模型候选，保留现有业务友好的 model/field 名与已确认的 `@@map`/`@map`；仅在 DB catalog 一致时采用 introspection 产生的 `@db`、`@default`、`@id`、`@@unique`、`@@index(map:)`、外键 `@relation(map:, onDelete:, onUpdate:)`。不要用 `raw.prisma` 的机械重命名覆盖应用 API。
2. 增加六个 Performance model 与 `FinancialOperationType` 两值；来源是三条已验证 Performance SQL，不是猜测出的产品范围。核对 `business-performance/read-model.ts` 的 raw SQL 与 Prisma 模型是否需要并存。
3. 修复 75 处默认值、1 处原生类型、291 处索引事件、410 处外键/关系事件；逐条以 `prisma-drift-events.csv` 与 catalog/SQL 对照。特别是 `gen_random_uuid()` 不能因为客户端 `uuid()` 而丢掉 DB default。字段 nullability、列映射、复合键、enum 序位均以 DB truth 检验，不能只因 migrate diff 没显示就跳过 codegen/API 兼容审核。
4. 九个 introspection 自动猜错的反向关系改成数组：Attendance P2 resolution 1、Expense integration category 3、Payroll claim reimbursement 1、Leave entitlement/rollover/allocation/expiry 4。定义端 FK 不具备 Prisma 要求的复合唯一性；不要补造 unique。
5. 保留 DB 原生触发器、函数、check/特殊约束、extension 在 222 SQL 下管理；Prisma schema 不承诺表示这些对象。`_prisma_migrations` 不作为业务模型。单独的 catalog snapshot/replay 回归必须继续验证这些不受 Prisma 管理的对象。
6. `attendance_timesheet_p2_segment_snapshots_source_day_snapshot_i` 的 FK 与 unique index 同名，Prisma 不能在同一 model 表达两个同名约束。隔离探针采用短暂替代 `@relation(map:)`，使 validate/generate 通过；只读 diff 剩一条“重命名 FK”。该名称不应触发任何 migration。Phase 3 需在目标 schema 中写明该受限映射及只读 catalog 断言；如要求完全零 diff，须另案评审真正 DB schema rename，**不属于本阶段**。

验证记录：`prisma validate` PASS；`prisma generate --no-engine` PASS，输出仅在 `.reconciliation-evidence/phase2_5/generated-client-probe`；对 fresh replay DB 的 `migrate diff --from-url --to-schema-datamodel` 只读运行，exit 1 仅一项 FK name mismatch。最初直接 `db pull` 得到的 schema P1012，不可自动部署。生成时以临时 junction 让隔离探针只读解析原有 `@prisma/client`，且显式 output 在 forensic workspace；没有 npm install。尚未把候选 schema 接入项目源码，故**没有** TypeScript/schema-dependent 项目测试可宣称通过；Phase 3 需在独立候选树上验证代码调用兼容、Prisma Client 类型和端到端读写合同。

完成定义：经逐对象审查的正式候选 schema `validate`、`generate`、schema-dependent 测试通过；与 fresh DB 的差异为零或仅上述已记录且不会生成 DB 变更的 Prisma limitation；trigger/check 等由独立 DB catalog 断言覆盖；Release Owner 审核。这里没有建立该正式候选，也没有执行 Phase 3。
