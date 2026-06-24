# Multi-tenant foundation

第一阶段的租户边界是 `business_id`。

## 数据库规则

- `businesses.id` 是每一家洗车店的租户 ID。
- `users.business_id` 指向用户所属洗车店。
- `PLATFORM_ADMIN` 可以没有 `business_id`。
- `BUSINESS_OWNER` 与 `STAFF` 必须拥有 `business_id`。
- 后续业务表都应该包含：

```prisma
businessId String @map("business_id") @db.Uuid
business   Business @relation(fields: [businessId], references: [id], onDelete: Restrict)

@@index([businessId])
```

已经加入并遵守同一模式：

- `customers`
- `vehicles`
- `services`
- `work_orders`
- `work_order_items`
- `payments`
- `invoices`
- `whatsapp_messages`

## 应用层规则

- 登录后，session 保存 `userId`、`businessId`、`role`、`status`。
- 页面读取租户上下文时使用 `getBusinessContext()` 或 `requireBusinessContext()`。
- 写入业务资料前使用 `assertCanManageBusiness()` 或更具体的模块权限。
- 查询 POS / CRM 资料时使用 `withBusinessScope(businessId, where)` 自动带上 `businessId`。

示例：

```ts
const { businessId } = await requireBusinessContext();

const customers = await prisma.customer.findMany({
  where: withBusinessScope(businessId, { status: "active" }),
});
```

## 当前权限

- `PLATFORM_ADMIN`：可进入 `/admin/businesses`，查看和编辑所有 businesses。
- `BUSINESS_OWNER`：可进入 `/business/settings`，只编辑自己的 business。
- `BUSINESS_OWNER` 与 `STAFF`：可进入 `/crm/*`、`/services/*`、`/work-orders/*`、`/pos/*`、`/invoices/*`、`/whatsapp/*`，所有 customer、vehicle、service、work order、payment、invoice 与 WhatsApp log 查询必须限制在自己的 business。
- `STAFF`：可进入 `/dashboard` 与门店业务模块，但不能进入 `/business/settings`。
