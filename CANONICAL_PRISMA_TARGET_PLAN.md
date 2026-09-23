# Canonical Prisma target — 222 baseline implementation record

目标：正式 `prisma/schema.prisma` 描述由 222 条 SQL 重建并与 Testing 等价的 DB；不得通过 `db push`、`migrate resolve` 或生成“修正 migration”反向改 verified DB。Phase 2.5 的 `.reconciliation-evidence/phase2_5/schema.canonical-probe.prisma` 是只读输入；Task 9 在独立候选树内完成业务命名保留与映射。

1. 从 `schema.from-222-replay.enriched.prisma` 建立 Phase 3 的待审核模型候选，保留现有业务友好的 model/field 名与已确认的 `@@map`/`@map`；仅在 DB catalog 一致时采用 introspection 产生的 `@db`、`@default`、`@id`、`@@unique`、`@@index(map:)`、外键 `@relation(map:, onDelete:, onUpdate:)`。不要用 `raw.prisma` 的机械重命名覆盖应用 API。
2. 增加六个 Performance model 与 `FinancialOperationType` 两值；来源是三条已验证 Performance SQL，不是猜测出的产品范围。核对 `business-performance/read-model.ts` 的 raw SQL 与 Prisma 模型是否需要并存。
3. 修复 75 处默认值、1 处原生类型、291 处索引事件、410 处外键/关系事件；逐条以 `prisma-drift-events.csv` 与 catalog/SQL 对照。特别是 `gen_random_uuid()` 不能因为客户端 `uuid()` 而丢掉 DB default。字段 nullability、列映射、复合键、enum 序位均以 DB truth 检验，不能只因 migrate diff 没显示就跳过 codegen/API 兼容审核。
4. 九个 introspection 自动猜错的反向关系改成数组：Attendance P2 resolution 1、Expense integration category 3、Payroll claim reimbursement 1、Leave entitlement/rollover/allocation/expiry 4。定义端 FK 不具备 Prisma 要求的复合唯一性；不要补造 unique。
5. 保留 DB 原生触发器、函数、check/特殊约束、extension 在 222 SQL 下管理；Prisma schema 不承诺表示这些对象。`_prisma_migrations` 不作为业务模型。单独的 catalog snapshot/replay 回归必须继续验证这些不受 Prisma 管理的对象。
6. `attendance_timesheet_p2_segment_snapshots_source_day_snapshot_i` 的 FK 与 unique index 同名，Prisma 不能在同一 model 表达两个同名约束。隔离探针采用短暂替代 `@relation(map:)`，使 validate/generate 通过；只读 diff 剩一条“重命名 FK”。该名称不应触发任何 migration。Phase 3 需在目标 schema 中写明该受限映射及只读 catalog 断言；如要求完全零 diff，须另案评审真正 DB schema rename，**不属于本阶段**。

Phase 2.5 原探针验证记录：`prisma validate`、`prisma generate --no-engine` 通过；对 fresh replay DB 的只读 diff 仅一项 FK 名称差异。原始 `db pull` 输出 P1012，不可自动部署。Task 9 已将经校对的候选接入正式 schema，并重新运行 Client 类型与应用测试；上述探针验证不被误作本轮最终门槛。

Task 9 结果：正式 schema 已采用 introspected/native DB 定义，同时保留原应用的 model/field 命名，尤其六个 Performance model；新增 DB 中已有而旧 schema 缺少的五个模型。`prisma validate`、`prisma generate`、TypeScript 及 1670 条 unit 均通过。222 migration fresh replay 与只读 `prisma migrate diff` 的唯一差异，是上文已记录的同名 FK/index 表达限制；没有生成或执行任何修正 migration。独立 catalog 断言在 `scripts/verify-fresh-migrations.mjs --schema-diff`：247 表、3869 列、1186 索引、835 FK、291 用户触发器、六个 Performance 表及同名 FK/index 均逐项核对。旧静态测试调整为断言 introspected DB 原名（更严格），不是删除断言。Production 和 Testing DB 未被写入。最终放行仍取决于 Task 10/11 全量门槛。
