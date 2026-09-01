# TETAMU STAFF 3000 — COMMISSION V2 IMPLEMENTATION REPORT

## 1. FINAL VERDICT

**READY FOR OWNER REVIEW**

Staff 3000 `/staff/commission` 已完成 V2 presentation-only 实施，并从 clean controlled source 部署到 Railway **Testing**。页面继续读取 canonical Commission statement/accrual records；没有建立第二套 Commission workflow，也没有改变 calculation、approval、payroll 或 settlement 规则。

## 2. PAGE STRUCTURE

页面已统一为 Staff V2 结构：`StaffV2PageHeader` → period navigator → compact total/status summary → grouped commission breakdown → adjustments（仅非零时）→ payroll-scope说明。旧的厚重卡片层级已移除，主要信息只保留一个清晰的视觉主线。

## 3. PERIOD NAVIGATION

Period navigation 只使用 scoped employee read model 返回的 canonical Commission period ID，并通过 `/staff/commission?period=<period-id>` 切换。不存在自由日期输入，也不会构造数据库中不存在的月份。第一/最后一期的上一期或下一期控制以 `aria-disabled="true"` 安全呈现。

## 4. PERIOD LABEL

完整月份显示为自然月份标签；partial period 明确显示真实起止日期，不伪装为整月。标签由 canonical `earnedPeriodStart` / `earnedPeriodEnd` 生成。

## 5. CURRENT REVISION

Employee read model 的 statement join 强制满足：

`statement.calculation_revision = period.current_revision`

同时维持 business 与 employee membership scope。测试 fixture 包含旧 revision 与 current revision，页面只投影 current revision。

## 6. TOTAL COMMISSION

顶部总额只来自 canonical `finalCommissionCents`。金额使用安全货币格式化；没有在前端重新计算 commission，也没有把 breakdown 行重新相加当作 authoritative total。

## 7. STATUS SYSTEM

只映射 canonical statement lifecycle：

- `CALCULATED` → `Awaiting review`
- `APPROVED` → `Approved`
- `APPLIED_TO_PAYROLL` → `Added to payroll`

未知状态 fail closed，不推断工资已支付。

## 8. AWAITING REVIEW

`CALCULATED` statement 显示 `Awaiting review`，文案说明金额仍在 review 阶段，不暗示 employee 可自行批准，也不暗示金额已进入 payroll。

## 9. APPROVED

`APPROVED` statement 显示 `Approved`，仅表达 Commission statement 已获批准；不延伸为 payslip 已发布或薪资已结算。

## 10. ADDED TO PAYROLL

`APPLIED_TO_PAYROLL` 显示 `Added to payroll`，明确这是 payroll linkage 状态。页面 footer 同时说明：payroll linkage 不证明 payslip publication 或 salary settlement。

## 11. NO PAID STATUS

页面没有 `Paid` badge、`Paid on` 日期或其他结清语义。当前 canonical Commission read model 没有可证明实际付款完成的 employee-safe payment status。

## 12. BREAKDOWN

Breakdown 使用 compact grouped rows；每一行可展开安全细节，包括日期、source type、gross、net、eligible amount 与 commission amount。没有 raw JSON、rule snapshot、calculation trace 或内部 ID 泄漏。

## 13. SOURCE TYPE

展示 schema 已定义的 source type：`SERVICE`、`PRODUCT`、`PACKAGE_PURCHASE`、`PACKAGE_REDEMPTION`。UI 使用员工可理解的标签，不把 enum 原文直接当成业务标题。

## 14. ITEM TITLE GAP

**READ MODEL ENRICHMENT REQUIRED**

现有 canonical accrual read model 没有稳定、employee-safe 的 item/service title。V2 没有根据 source ID 猜名称，也没有显示内部 UUID。未来若要显示项目名，应由 canonical read model 提供受 scope 保护的 display title。

## 15. COMMISSION RATE GAP

**READ MODEL ENRICHMENT REQUIRED**

现有 employee-safe projection 没有稳定的 canonical display rate；规则可能是固定金额、分层或其他计算形式。V2 不从金额倒算百分比，也不公开 `ruleSnapshot` / `calculationTrace`。

## 16. ADJUSTMENTS

Adjustments 仅在 canonical adjustment aggregate 非零时出现，正数显示 `+`，负数显示 `−`。已关联的 current-statement `appliedAdjustments` 优先提供安全明细；若 calculated statement 尚无关联行，则以 canonical `statement.adjustmentCents` 显示 aggregate fallback。不会把 future/originating adjustment 错算入当前 statement。

## 17. DETAIL

每个 breakdown row 使用原生 `<details>` / `<summary>` progressive disclosure，保留键盘操作与单一触控目标。自动 REFUND/VOID reason 不暴露可能含内部 UUID 的底层文本；manual correction reason 才显示可读说明。

## 18. EMPTY

当所选 employee/business scope 没有 Commission statement 时，显示 V2 empty state；不会显示 stale、其他 employer 或其他 employee 的金额。测试包含 `noStatement` fixture。

## 19. LOADING

新增 route-level `loading.tsx`，以与最终页面一致的 V2 shell 和 skeleton 呈现，避免 loading 时回退到旧 Staff 视觉层。

## 20. ERROR

新增 route-level `error.tsx`，提供简洁错误说明与 retry action；错误状态不回显 Commission 数据，不修改 calculation 或 workflow state。

## 21. MOBILE 360

360 × 800 已通过：`scrollWidth === innerWidth`，无横向 overflow，bottom-nav clearance 充足。大金额状态专门在 360px 验证，Compact Summary 使用两列加第三项 full-width，金额不再逐字断行。

截图：`artifacts/staff-commission-v2/populated-360x800.png`、`artifacts/staff-commission-v2/large-negative-adjustment-360x800.png`。

## 22. MOBILE 390

390 × 844 已通过 populated、empty、Awaiting review、Approved、Added to payroll、multi-period、positive adjustment、zero-line 与 manager-as-employee 状态。无横向 overflow，最后内容可完整滚动到 fixed bottom navigation 上方。

截图：`artifacts/staff-commission-v2/populated-390x844.png`。

## 23. MOBILE 412

412 × 915 已通过 populated 状态：`scrollWidth === innerWidth`，信息密度与触控间距正常，底部保留足够 safe-area/navigation clearance。

截图：`artifacts/staff-commission-v2/populated-412x915.png`。

## 24. LARGE AMOUNTS

大 total、正负 adjustment 与长 adjustment reason 均有 fixture/visual coverage。金额采用 tabular-safe formatting；窄屏 Compact Summary 不溢出，长文本可自然换行且不挤压金额语义。

## 25. ACCESSIBILITY

页面保留语义 heading、原生 details/summary 键盘行为、可辨识 status text、disabled period control 的 `aria-disabled`、足够触控目标与非颜色唯一状态表达。主要 action/row 在移动端维持可操作尺寸。

## 26. EMPLOYEE OWNERSHIP

读取保持 authenticated employee membership ownership；查询同时 scope `businessId` 与 `employeeMembershipId`。页面不接受任意 membership ID，也不允许 URL period 参数越过 scoped returned periods。

## 27. MULTI-EMPLOYER

测试 fixture 覆盖同一 employee 身份的两个 employer scope。Commission 页面只显示当前 Staff session/workplace 对应 business membership 的 periods、statement、accruals 与 adjustments。

## 28. MANAGER-AS-EMPLOYEE

manager persona 在此页面仍以自己的 employee membership 读取个人 Commission；manager capability 不扩大到他人 Commission。`managerAsEmployee` fixture 已通过 visual/state test。

## 29. PAY HUB REGRESSION

Pay Hub 路由与信息架构未更改。相关 unit tests 与 Staff PWA navigation tests 通过；Commission entry 继续由现有 Pay Hub 进入。

## 30. PAYSLIPS REGRESSION

Payslips list、protected PDF UX、publication/session access 逻辑未更改。Commission focused test run 同时包含 Payslips/Pay correctness coverage，全部通过。

## 31. CLAIM SETTLEMENT GAP

**GAP unchanged**

本次没有把 Claim settlement 状态接入 Commission，也没有用 claim 状态推导 commission/payment。该 gap 不在 Commission V2 presentation scope 内。

## 32. PAYMENT STATUS GAP

**PAYMENT_STATUS_READ_MODEL_REQUIRED**

如未来要显示实际薪资付款状态，必须由 canonical payroll/payment read model 提供可证明的 employee-safe payment fact。`APPLIED_TO_PAYROLL` 不能安全等同 `Paid`。

## 33. FILES CHANGED

主要 runtime/read-model 文件：

- `src/app/staff/commission/page.tsx`
- `src/app/staff/commission/loading.tsx`
- `src/app/staff/commission/error.tsx`
- `src/components/staff-pwa/staff-commission-v2.tsx`
- `src/components/staff-pwa/staff-commission-v2.module.css`
- `src/lib/staff-pwa/commission-v2.ts`
- `src/lib/commission/read.ts`
- `src/components/staff-pwa/staff-v2-primitives.tsx`
- `src/components/staff-pwa/staff-v2.module.css`
- `src/app/staff/staff.css`（只移除已无使用者的 legacy Commission selectors）

QA/fixture 文件：

- `tests/unit/staff-commission-v2.test.ts`
- `tests/unit/staff-pay-read-only-correctness.test.ts`
- `tests/unit/staff-pwa.test.ts`
- `scripts/prepare-staff-commission-v2-visual-fixtures.ts`
- `scripts/capture-staff-commission-v2-visuals.mjs`
- `artifacts/staff-commission-v2/*`

Implementation diff：28 files，1,485 insertions，107 deletions。

## 34. TEST RESULTS

- Focused Commission + Pay Hub + Payslips + Staff PWA：**67 / 67 PASS**
- PostgreSQL integration（Commission engine、Staff Pay read-only correctness、Payroll variable-pay correction）：**5 / 5 PASS**
- TypeScript：**PASS**
- Production build：**PASS**
- ESLint：**PASS，0 errors**；仅 3 个与本次无关的既有 warnings
- `git diff --check`：**PASS**
- Visual fixtures：14 states；12 screenshots；全部 viewport metrics `scrollWidth === innerWidth`
- Railway unauthenticated smoke：`/staff/pay`、`/staff/payslips`、`/staff/commission` 均 **HTTP 200**，Commission 数据 fail closed
- Authenticated browser smoke：现有 Testing 会话已过期并停在 `/staff/login`；按要求没有发送 OTP，因此留给 owner physical-device authenticated review

## 35. FULL UNIT STATUS

完整 unit suite：**1,394 / 1,394 PASS**。

## 36. READ MODEL ENRICHMENT STATUS

本次只做必要且安全的 employee projection enrichment：period ID、明确 safe accrual/source fields、current-statement applied adjustments，并继续排除 raw rule/calculation payload。Item title、display commission rate 与真实 payment status 仍明确标记为后续 canonical read-model enrichment，不在前端猜测。

## 37. CSS DEBT STATUS

Commission V2 使用 scoped CSS module，没有新增第三层全局 giant override。旧 `staff.css` 中已无使用者的 legacy Commission selectors 已移除；共享 V2 primitive 仅增加兼容的 period-navigation disabled 状态与 compact-summary mobile layout。

## 38. NO BUSINESS LOGIC CHANGE

**CONFIRMED.** 没有修改 Commission calculation、revision generation、approval、payroll application、settlement、RBAC、session/device、Attendance、Leave、Claims 或 Payroll 业务规则。所有改动限于 presentation、employee-safe read projection、fixture 与测试。

## 39. NO NEW MIGRATION

**CONFIRMED — NO NEW MIGRATION.** Canonical migration count 保持 **212**。

## 40. TESTING DEPLOYMENT

- Environment：**Railway Testing only**
- Service：`tetamu-staff-app`
- Region：`asia-southeast1-eqsg3a`
- Implementation commit：`772ff07`
- Deployment ID：`765ec4b8-6091-4330-a29e-da1732c0890d`
- Image digest：`sha256:e788f50e9d289b67bb8987e2c694dac07c5f6555b405c48c4f39ac7adca5249f`
- Deployment status：**SUCCESS**
- Health：`ok=true`、`database=ready`、`environment=testing`
- Owner review route：`https://tetamu-staff-app-testing.up.railway.app/staff/commission`

## 41. PRODUCTION STATUS

**TESTING ONLY**

**PRODUCTION NOT ACCESSED**

**PRODUCTION NOT MODIFIED**

本轮在 Commission V2 完成并部署后停止；没有继续实施其他 Staff V2 页面。
