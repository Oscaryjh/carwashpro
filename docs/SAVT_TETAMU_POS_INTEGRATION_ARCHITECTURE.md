# SAVT 与 Tetamu POS 集成架构评估

状态：架构评估，待批准
日期：2026-07-15
范围：只分析现有 Tetamu POS 与 SAVT 的集成边界；本阶段不实现代码、不修改数据库、不部署。

## 1. 结论摘要

Tetamu POS 已具备多租户、分店、付款、退款、审计、异步队列和独立 WhatsApp Connector 等基础能力，可以与 SAVT 集成，但不应把 SAVT 直接做进现有 CRM 或本地 Loyalty 模块。

建议采用以下原则：

1. Tetamu POS 继续拥有商家经营数据：Customer、Vehicle、Work Order、Invoice、Payment、Refund、Package。
2. SAVT 继续拥有消费者统一身份、跨商家积分、优惠券、SAVT Cash、营销与授权记录。
3. 两套系统使用独立数据库，通过版本化 API、Webhook 和异步事件连接，禁止直接读取对方数据库。
4. `savtMemberId` 是跨平台稳定身份；手机号只用于查找或验证，不作为永久外部主键。
5. 不把 SAVT 全量会员复制到 Tetamu POS。只有会员主动识别并同意后，才建立本地 Customer 与 SAVT Member 的关联。
6. 正常 POS 付款不能依赖 SAVT 在线。SAVT 故障时，只暂停 SAVT 积分、优惠券和 SAVT Cash，现金、银行卡、配套等原有流程继续可用。
7. 本地财务事务只写本地数据和 Outbox Event；不得在 Prisma transaction 内调用 SAVT HTTP API。

推荐按五个阶段实施：商家与会员映射、Earn Reward、Coupon、SAVT Cash、Consent-based Lead Sharing。每阶段独立上线并可通过 feature flag 关闭。

## 2. 当前 Tetamu POS 架构评估

### 2.1 Customer 与 Vehicle

当前模型：

- `Customer` 按 `businessId` 隔离，`@@unique([businessId, phone])`。
- `Vehicle` 按 `businessId` 隔离，`@@unique([businessId, plateNumber])`。
- 一个 Customer 可以拥有多辆 Vehicle。
- Customer 可带 `branchId`，但业务身份的主要边界仍是 `businessId`。

评估：

- 现有手机号唯一规则适合商家内部 CRM 去重，但不能代替 SAVT 的永久会员 ID。
- 不建议直接给 Customer 增加一个无法追踪历史的裸 `savtMemberId` 后就结束设计。
- 建议使用独立 `SavtMemberLink`，保留验证、同意、解除、重新绑定和审计历史。
- 本地 Customer 即使未绑定 SAVT，也必须保持现有功能完整。

### 2.2 Business、Branch 与租户边界

当前模型：

- `Business` 是 SaaS tenant。
- `Branch` 属于一个 Business。
- User 可绑定 Business 和 Branch，员工权限会限制分店数据。
- Payment、Refund、Invoice、Audit、Queue 和 WhatsApp 记录均带 `businessId`，多数同时带 `branchId`。

评估：

- Tetamu `Business` 应映射 SAVT Merchant。
- Tetamu `Branch` 应映射 SAVT Outlet。
- 所有映射必须先验证 branch 确实属于当前 business。
- API 不可信任浏览器传入的 `businessId`；Web 页面必须从 session 取得 tenant，Webhook 必须从已验证的 SAVT Merchant 映射解析 tenant。

### 2.3 Invoice、Payment、Refund 与 Package

当前模型：

- `Payment` 支持 Work Order 付款及 Customer Package 购买付款。
- `Invoice` 可关联 Work Order，也可关联 Customer Package。
- `PaymentRefund` 关联原 Payment、Invoice 和 Work Order，并记录退款金额、方式和原因。
- 本地 `LoyaltyProgram`、`CustomerMembership`、`LoyaltyTransaction` 已支持商家自有积分。

评估：

- SAVT Reward 不能直接写入本地 Loyalty balance，否则会混淆两个积分账本的所有权。
- SAVT 交易应保存外部 reference 和同步状态，而不是复制 SAVT wallet 成为本地主账本。
- 当前 Package Purchase 存在不同入口和历史实现痕迹。接入 SAVT 前应确认所有入口最终使用同一付款服务，否则相同购买可能漏发或重复发事件。
- 当前 Invoice refund/void 页面仍对 Package Invoice 有限制；SAVT Phase 2 前必须明确 package purchase 的退款与积分冲正规则。

### 2.4 Checkout transaction 边界

现有 Checkout 的重要特征：

- Payment、Invoice、Work Order payment status、Audit 及本地 Loyalty 记账在同一 Prisma transaction 内完成。
- WhatsApp 发票通知在 transaction commit 后执行。

这个边界是正确的，应沿用到 SAVT：

```text
Prisma transaction
  ├─ Payment / Invoice / Refund 本地写入
  ├─ AuditLog 本地写入
  └─ SavtIntegrationEvent (outbox) 本地写入

Commit 后
  └─ SAVT worker 异步发送事件
```

禁止做法：

- 在数据库 transaction 中等待 SAVT API。
- 因 SAVT timeout 回滚已经完成的现金或银行卡付款。
- 先发 SAVT reward，再提交本地 Payment。

### 2.5 Refund、Void 与 Job Cancel

当前规则：

- Refund 在本地 transaction 内创建 `PaymentRefund`、更新 Payment/Invoice/Work Order，并冲回本地 Loyalty。
- Void 会恢复适用的 package uses、void payment、更新 invoice，并可能把已完成工单重新设为 Ready for Pickup。
- Work Order `CANCELLED` 是作业状态，不会天然等于财务退款。

SAVT 事件必须区分：

- `transaction.refunded`：真实退款。
- `transaction.partially_refunded`：部分退款。
- `transaction.voided`：付款或发票作废。
- `work_order.cancelled`：只表示工作取消；没有财务变动时不得自动冲积分。

### 2.6 Queue、Webhook 与 Audit

可复用模式：

- `NotificationQueue` 已具备 QUEUED、SENDING、SENT_TO_SERVER、DELIVERED、READ、FAILED、retryCount 和 nextAttemptAt。
- Notification worker 使用轮询、claim、重试和退避。
- WhatsApp incoming/history/receipt 路由展示了独立 Connector 回调主系统的方式。
- `AuditLog` 已支持 transaction client、actor、IP、user agent、before/after/metadata。

不建议直接复用的数据表：

- SAVT 事件不应写进 WhatsApp `NotificationQueue`。
- WhatsApp delivery 状态不等于业务事件的处理状态。
- SAVT 应建立专用 Outbox、Webhook Inbox、Redemption 和 Reconciliation 表，但可复用 worker、claim、retry、audit 的代码模式。

### 2.7 现有 WhatsApp 架构可借鉴的部分

可借鉴：

- 独立服务与主应用隔离。
- 每个请求带明确 `businessId`，数据按 business/instance scope。
- 回执异步更新本地状态。
- 命令持久化后由 worker 执行。
- Connector 失败不阻塞 POS 核心付款。

必须改进后再用于 SAVT：

- SAVT Webhook 应验证 raw body 的 HMAC 签名、timestamp 和 replay window，不能只依赖共享 header secret。
- 每个 webhook event 必须先持久化和去重，再异步处理。
- 外部 merchant ID 必须映射到 business，不能直接信任 payload 内的本地 business ID。

## 3. 系统所有权与边界

| 领域 | Tetamu POS | SAVT |
| --- | --- | --- |
| 商家、分店、员工权限 | 主系统 | 保存外部 merchant/outlet 映射 |
| Customer、Vehicle | 商家经营主数据 | 不全量复制 |
| Invoice、Payment、Refund | 财务事实来源 | 保存奖励/兑换所需交易摘要 |
| 本地 Package | 主系统 | 可作为交易 item，不接管余额 |
| 商家本地 Loyalty | 主系统 | 与 SAVT Reward 分账本共存 |
| SAVT Member Identity | 保存 link | 主系统 |
| SAVT Points/Coupon/Cash | 只保存 reference、状态和短期 cache | 主系统 |
| Consent 与跨商家营销 | 保存必要证明与 audit | 主系统 |

## 4. 身份和商家映射

### 4.1 会员映射

推荐新增独立实体 `SavtMemberLink`：

- `id`
- `businessId`
- `customerId`
- `savtMemberId`
- `status`: PENDING / VERIFIED / REVOKED / CONFLICT
- `verificationMethod`: QR / OTP / SAVT_APP / MANUAL_ADMIN
- `consentId` 或 consent reference
- `linkedAt`、`verifiedAt`、`revokedAt`
- `lastSyncedAt`
- `metadata`（严格限制非敏感内容）

约束建议：

- `@@unique([businessId, customerId])`
- `@@unique([businessId, savtMemberId])`

手机号只用于发起 lookup。SAVT 返回已验证 member 后，后续事件使用 `savtMemberId`。

### 4.2 Merchant 与 Branch 映射

推荐：

`SavtMerchantConnection`

- 一个 Business 最多一个 active SAVT merchant connection。
- 保存 `savtMerchantId`、连接状态、credential reference、最后健康检查和同步时间。

`SavtBranchMapping`

- `businessId`、`branchId`、`savtOutletId`、status。
- `@@unique([businessId, branchId])`
- `@@unique([businessId, savtOutletId])`

凭证不得以明文写入日志。平台级 secret 可放 Railway/Vault；每商家 OAuth token 需要外部 secrets manager，或使用应用级密钥加密后保存。

## 5. 建议新增的集成数据表

以下是架构建议，不代表本阶段执行 migration。

### 5.1 连接与映射

- `SavtMerchantConnection`
- `SavtBranchMapping`
- `SavtMemberLink`
- `SavtConsentRecord`

### 5.2 Outbox 与 Webhook Inbox

`SavtIntegrationEvent`

- `eventId` UUID，唯一。
- `businessId`、`branchId`。
- `eventType`、`eventVersion`。
- `aggregateType`、`aggregateId`。
- `idempotencyKey`。
- `payload` JSON。
- `status`: PENDING / PROCESSING / SUCCEEDED / RETRY / DEAD_LETTER。
- `attemptCount`、`nextAttemptAt`、`lastErrorCode`、`lastErrorMessage`。
- `savtReferenceId`、`createdAt`、`processedAt`。
- `@@unique([businessId, idempotencyKey])`。

`SavtWebhookEvent`

- `externalEventId` 唯一。
- SAVT merchant/outlet reference。
- 解析后的 `businessId`、`branchId`。
- event type/version、raw payload、signature timestamp。
- processing status、attempts、error、receivedAt、processedAt。

### 5.3 Reward 与 Redemption

- `SavtRewardTransactionLink`: Payment/Refund 与 SAVT reward/reversal reference。
- `SavtRedemptionIntent`: COUPON 或 SAVT_CASH 的 reserve/confirm/release 状态。
- `SavtReconciliationRun` 与 `SavtReconciliationItem`: 对账批次及异常项。

不要把 SAVT wallet balance 当成本地 source of truth。若 UI 需要余额，可保存带 `fetchedAt` 和短 TTL 的只读 cache。

## 6. SAVT API Client

建议建立 server-only 模块：

```text
src/lib/savt/
  client.ts
  auth.ts
  contracts.ts
  errors.ts
  idempotency.ts
  mapper.ts
  signature.ts
```

要求：

- 所有 endpoint 有版本，例如 `/v1/...`。
- 统一 timeout、AbortController、trace ID、structured error。
- 修改型请求必须带 idempotency key。
- Client 自身不要对非幂等请求盲目自动重试。
- 日志屏蔽 token、手机号、QR payload、wallet secret。
- 浏览器永远不能取得 SAVT service credential。

## 7. Webhook 入口

建议路由：

```text
POST /api/integrations/savt/webhook
```

处理顺序：

1. 读取 raw body。
2. 验证 HMAC/signature、timestamp 和 replay window。
3. 使用外部 merchant ID 解析 `SavtMerchantConnection`。
4. 用 external event ID 幂等写入 `SavtWebhookEvent`。
5. 快速返回 `202 Accepted`。
6. Worker 异步处理并写 AuditLog。

签名失败应返回 401；映射不存在应记录隔离事件，不应尝试猜测 tenant。

## 8. 事件目录与通用 Payload

### 8.1 Tetamu 发往 SAVT

- `member.linked.v1`
- `member.unlinked.v1`
- `transaction.completed.v1`
- `transaction.partially_refunded.v1`
- `transaction.refunded.v1`
- `transaction.voided.v1`
- `coupon.redemption.confirmed.v1`
- `coupon.redemption.released.v1`
- `savt_cash.redemption.confirmed.v1`
- `savt_cash.redemption.released.v1`

### 8.2 SAVT 发往 Tetamu

- `member.updated.v1`
- `member.consent.revoked.v1`
- `reward.earned.v1`
- `reward.reversed.v1`
- `coupon.reservation.expired.v1`
- `coupon.redemption.confirmed.v1`
- `savt_cash.redemption.confirmed.v1`
- `savt_cash.redemption.failed.v1`

### 8.3 通用交易 Payload

```json
{
  "eventId": "uuid",
  "eventType": "transaction.completed",
  "eventVersion": 1,
  "occurredAt": "ISO-8601",
  "source": "tetamu-pos",
  "merchantId": "savt-merchant-id",
  "outletId": "savt-outlet-id",
  "memberId": "savt-member-id",
  "transaction": {
    "reference": "payment-id",
    "invoiceReference": "invoice-id",
    "currency": "MYR",
    "grossAmount": "25.00",
    "refundedAmount": "0.00"
  },
  "items": [
    {
      "sku": "service-id",
      "category": "service",
      "name": "Basic Wash",
      "quantity": 1,
      "unitAmount": "25.00",
      "totalAmount": "25.00"
    }
  ]
}
```

Payload 使用通用 `merchant/outlet/member/transaction/items`，不要加入只适用于洗车的强制字段。

## 9. 幂等、重试与对账

### 9.1 幂等 Key

建议：

```text
tetamu:{businessId}:payment:{paymentId}:completed:v1
tetamu:{businessId}:refund:{refundId}:refunded:v1
tetamu:{businessId}:invoice:{invoiceId}:voided:v1
tetamu:{businessId}:redemption:{intentId}:confirmed:v1
```

SAVT 和 Tetamu 两边都必须保存并拒绝重复执行同一个 key。

### 9.2 Outbox 重试

- 在 Payment/Refund/Link 的本地 transaction 内写 Outbox。
- Worker 用 compare-and-set claim，避免多个实例重复处理。
- 建议指数退避加 jitter，例如 30 秒、1 分钟、5 分钟、15 分钟、1 小时。
- 明确区分 retryable：timeout、429、5xx；non-retryable：401、403、payload validation。
- 超过次数进入 DEAD_LETTER，不静默丢弃。

### 9.3 Reconciliation

- 每日按 merchant/outlet/date 对 Payment、Refund、Reward、Redemption 对账。
- 支持按 payment/refund/reference 手动重放。
- 重放仍使用原 idempotency key。
- 对账只补集成状态，不直接改写已结账的财务事实。

## 10. Coupon Reservation 流程

状态建议：

```text
CREATED -> VALIDATED -> RESERVED -> CONFIRMED
                         ├-> RELEASED
                         ├-> EXPIRED
                         └-> FAILED
```

流程：

1. 员工识别 SAVT member。
2. POS 请求 SAVT validate coupon。
3. SAVT 返回适用规则、折扣和 reservation token。
4. POS 保存 `SavtRedemptionIntent`，在 UI 显示已保留优惠。
5. 本地 checkout transaction 创建 Payment/Invoice，并写 confirm outbox。
6. Worker 向 SAVT confirm。
7. 若本地 checkout 失败，发送 release；若 confirm 长时间不确定，由 reconciliation 处理。

Coupon reserve 失败不能影响普通付款，员工可以移除 coupon 后继续 checkout。

## 11. SAVT Cash Redemption 流程

SAVT Cash 属于外部付款来源，不应伪装成 CASH。

建议 Phase 4 增加明确 payment method/tender：`SAVT_CASH`，并支持 split tender 前先评估现有 Payment UI 与 Shift Closing。

流程：

1. 查询余额并显示查询时间。
2. SAVT reserve 指定金额，返回 intent/token。
3. 本地 transaction 写 Payment、Invoice、RedemptionIntent 和 confirm outbox。
4. Worker confirm SAVT debit。
5. 本地失败则 release。
6. SAVT confirm 状态未知时，将 integration 标记为 reconciliation required，不能重复扣款。

必须明确：部分付款、退款回 SAVT Cash、过期 reservation、shift closing 如何展示，以及 SAVT downtime 时是否禁止 SAVT Cash 而保留其他 tender。

## 12. Earn Reward 与冲正

建议规则：

- 只有状态有效的 Payment 产生 `transaction.completed`。
- Package voucher 的“使用”不再次赚取积分；Package purchase 是否赚取由 SAVT campaign rule 决定。
- Refund 使用 `refundId` 发独立冲正事件，并关联原 `paymentId`。
- Partial refund 按实际退款金额发送，不在 Tetamu 自行计算 SAVT 最终余额。
- Work Order cancel 但未退款时不发 reward reversal。
- Reward API 失败不回滚 POS payment；UI 标记 `Reward pending`，由 worker 重试。

现有本地 Loyalty 可继续运行，但 UI 和报告必须明确区分 “Tetamu Loyalty Points” 与 “SAVT Rewards”。是否允许同一交易双重奖励需要产品决策。

## 13. Privacy、Consent 与 Lead Sharing

- 禁止让商家浏览 SAVT 全量会员。
- Lookup 只响应会员主动提供的 QR、手机号或 token。
- 建立 Customer link 前保存 purpose、scope、source、grantedAt、revokedAt。
- Consent revoked 后停止新的营销用途；财务和审计 reference 按法规保留最少必要数据。
- Lead sharing 只在 Phase 5 开启，并默认关闭。
- Audit 记录谁查询、谁绑定、谁兑换、谁解除。
- 日志不得保存完整 QR credential、OTP、access token 或不必要的 PII。

## 14. Multi-tenant 与权限安全

1. 所有 SAVT 表必须带 `businessId`。
2. branch mapping、event、redemption 必须校验 branch 属于 business。
3. 后台操作继续使用 `requireBusinessUser` 和 staff permission。
4. Merchant connection、credentials、dead-letter replay 只允许 owner/admin。
5. Webhook tenant 只能从签名通过后的 SAVT merchant mapping 解析。
6. 每个查询条件必须包含 `businessId`；禁止只用外部 ID 查询后直接更新。
7. Audit metadata 可保存 external reference，但不可保存 secret。

## 15. Backward Compatibility 与可用性

- 所有新关系初始 nullable，连接状态默认 DISABLED。
- 未连接 SAVT 的商家看不到或不能使用 SAVT 控件，原流程不变。
- 使用 business-level feature flags 分阶段开启。
- API contract 版本化，旧 event processor 保留兼容期。
- 新 migration 必须先在 Testing Server 验证，再进入 Production。
- SAVT client、worker、webhook 均设置 circuit breaker/timeout，不能拖慢页面请求。
- 核心 POS 的 SLO 与 SAVT 集成 SLO 分开。

## 16. 分阶段实施计划

### Phase 1：Merchant、Branch 与 Member Linking

目标：建立安全连接，不影响付款。

- Connection/Branch Mapping/Member Link/Consent 数据表。
- Admin/Company Settings 连接状态与映射页面。
- QR/phone lookup、link、unlink。
- Audit、feature flag、基础 API client。

验收：两个商家不能互见 link；同一手机号不能跨 tenant 错绑；SAVT 离线不影响 POS。

### Phase 2：Earn Reward

目标：Payment/Refund 可靠地产生奖励和冲正。

- Outbox、worker、reward link、webhook inbox。
- Payment completed、partial/full refund、void 事件。
- pending/failed/reconcile 状态和管理页面。

验收：重复提交只奖励一次；退款只冲一次；SAVT 停机后可自动补发。

### Phase 3：Coupon

目标：验证、保留、确认、释放优惠券。

- Redemption intent state machine。
- Checkout coupon UI 与金额规则。
- confirm/release/expiry webhook 与 reconciliation。

验收：并发兑换不重复；checkout 失败会释放；过期 reservation 可恢复。

### Phase 4：SAVT Cash

目标：加入外部 wallet tender。

- SAVT_CASH payment method 与可能的 split payment。
- Reserve/confirm/release/refund。
- Invoice、Refund、Shift Closing、Reports 展示。

验收：金额守恒、不会重复扣款、退款路径完整、关账可对账。

### Phase 5：Consent-based Lead Sharing

目标：在明确同意后共享最少必要 lead。

- Consent scope 和撤销。
- Lead import/link review。
- 营销权限和数据保留策略。

验收：无同意不导入；撤销后停止后续用途；全链路可审计。

## 17. 各阶段可能修改的文件

以下为预估，实施前仍需逐阶段确认。

### Phase 1

- `prisma/schema.prisma`
- `prisma/migrations/<timestamp>_add_savt_connections/`
- `src/lib/savt/*`
- `src/app/business/settings/page.tsx`
- `src/app/business/settings/actions.ts`
- `src/app/admin/businesses/*`
- `src/app/crm/customers/[customerId]/page.tsx`
- `src/lib/audit/*`
- `src/lib/auth/staff-permissions.ts`

### Phase 2

- `prisma/schema.prisma`
- `src/app/pos/actions.ts`
- `src/app/invoices/actions.ts`
- `src/app/work-orders/actions.ts`
- `src/lib/savt/outbox.ts`
- `src/lib/savt/rewards.ts`
- `scripts/savt-integration-worker.ts`
- `src/app/api/integrations/savt/webhook/route.ts`
- `src/app/business/settings/integrations/savt/*`

### Phase 3

- Checkout/POS components and actions。
- `src/lib/savt/coupons.ts`
- Redemption schema/migration。
- Invoice calculation and display files。
- Integration worker/webhook processor。

### Phase 4

- Payment method validation/schema/migration。
- `src/app/pos/actions.ts` 和 POS UI。
- `src/app/invoices/actions.ts`、invoice/PDF。
- `src/app/closing/*`
- `src/app/reports/*`
- `src/lib/savt/cash.ts`

### Phase 5

- Customer/CRM linking UI。
- Consent and lead tables/migration。
- SAVT consent/lead client and webhook processor。
- Audit/report/admin review pages。

## 18. 风险与待决策事项

### 高风险

1. SAVT 正式 API、认证方式、签名协议、sandbox 尚未定稿。
2. Coupon/SAVT Cash 若没有 reserve/confirm/release，会产生并发重复兑换。
3. Package purchase 存在多个入口，接事件前需统一交易服务。
4. Package Invoice 退款/void 目前不是所有入口都完整支持。
5. 本地 Loyalty 与 SAVT Reward 可能双重奖励，必须明确产品规则。
6. SAVT Cash 会影响 Payment Method、Refund、Shift Closing 和财务报告，不能只做一个按钮。

### 需要 SAVT 团队确认

- Merchant 与 Outlet ID 的结构和生命周期。
- Member lookup/QR token/OTP 的正式流程。
- API rate limit、timeout、retry 和 idempotency 保留期。
- Webhook signature、重送策略和 event ordering。
- Reward 精度、舍入、币种、package purchase 是否奖励。
- Coupon 可叠加、部分兑换、最低消费和退款恢复规则。
- SAVT Cash split tender、退款和 reservation expiry。
- Reconciliation API、报表字段和 SLA。
- PDPA consent wording、data retention 和删除流程。

### Tetamu 内部待决策

- 使用独立 `SavtMemberLink`（推荐）还是 Customer nullable field。
- 本地 Loyalty 与 SAVT 是否同时启用。
- 哪些角色可 link/unlink、兑换、重放 dead-letter。
- SAVT pending 状态在 Cashier、Invoice、CRM 如何显示。
- 断网时是否只禁用 SAVT tender，还是允许受控离线额度。

## 19. 实施门槛

进入 Phase 1 编码前，至少需要批准：

1. SAVT 与 Tetamu 的数据所有权边界。
2. `Business -> Merchant`、`Branch -> Outlet`、`Customer -> Member` 映射方式。
3. SAVT API sandbox 与认证/签名规范。
4. Consent 的最小字段和业务流程。
5. 本地 Loyalty 与 SAVT Reward 的共存规则。
6. Testing Server 的双商家、双分店、双会员验收数据。

## 20. 最终建议

批准“独立 integration module + transactional outbox + signed webhook inbox + reservation state machine”的方案后再进入 Phase 1。不要从 Coupon 或 SAVT Cash 直接开始，也不要把 SAVT API 调用塞进现有 Checkout transaction。

本评估完成后应停留在架构阶段，待批准再编写 schema、migration、API client 或 UI。
