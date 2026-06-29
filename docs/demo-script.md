# Demo Script

这份脚本用于演示 Car Wash CRM POS SaaS MVP。建议使用一组新的 demo business 和 owner，避免和旧测试数据混在一起。

## 关键页面 URL

- Platform Admin: `/admin/businesses`
- CRM Home: `/crm`
- Services: `/services`
- Packages: `/packages`
- Work Orders: `/work-orders`
- POS: `/pos`
- Invoices: `/invoices`
- WhatsApp Logs: `/whatsapp`

## 1. Platform Admin 创建洗车店

1. 打开 `/login`。
2. 使用 seed admin 登录：
   - Email: `admin@example.com`
   - Password: `ChangeMe123!`
3. 进入 `/admin/businesses`。
4. 点击 `Create Business`。
5. 创建一间洗车店：
   - Business name: `Demo Car Wash`
   - Business slug: `demo-car-wash`
   - Owner name: `Demo Owner`
   - Owner email: `demo.owner@example.com`
   - Owner password: `OwnerPass123!`
   - Phone optional: 任意
6. 创建成功后应进入 `/admin/businesses/[businessId]`，并看到 owner user。

## 2. Owner 登录

1. 登出 Platform Admin。
2. 使用刚创建的 owner 登录。
3. 登录后进入 `/dashboard`。
4. 侧边栏应显示：
   - CRM
   - Services
   - Packages
   - Work Orders
   - POS
   - Invoices
   - WhatsApp
   - Business settings

## 3. CRM 新增客户和车辆

1. 打开 `/crm/customers/new`。
2. 新增客户：
   - Name: `Demo Customer`
   - Phone: `60123456789`
   - Email optional: 可空
   - Notes optional: 可空
3. 创建成功后进入客户详情页。
4. 点击 `New Vehicle`。
5. 新增车辆：
   - Plate number: `DEMO123`
   - Brand optional: `Toyota`
   - Model optional: `Vios`
   - Color optional: `White`
6. 回到客户详情页后，应看到车辆列表。

## 4. Service 创建

1. 打开 `/services/new`。
2. 创建服务项目：
   - Name: `Basic Wash`
   - Price: `30.00`
   - Description optional: `Exterior wash`
3. 再创建一个服务：
   - Name: `Premium Wash`
   - Price: `80.00`
4. 打开 `/services`，确认服务只属于当前 business。

## 5. Package 创建和购买

1. 打开 `/packages/new`。
2. 创建 10 次洗车套餐：
   - Name: `10 Wash Package`
   - Prepaid price: `180.00`
   - Total washes: `10`
   - Linked service optional: 可选择 `Basic Wash`，或留空表示任意洗车服务
3. 回到客户详情页 `/crm/customers/[customerId]`。
4. 在 `Sell prepaid package` 区块选择刚创建的套餐。
5. 点击 `Sell package`。
6. 客户详情页应显示该套餐余额为 `10/10 washes`，并在 `Active package balance` 中显示剩余次数。

## 6. Work Order 开单

1. 打开 `/work-orders/new`。
2. 输入车牌 `DEMO123` 并搜索。
3. 系统应显示客户和车辆资料。
4. 勾选一个或多个服务项目。
5. 点击 `Create work order`。
6. 创建成功后进入 `/work-orders/[workOrderId]`，状态默认为 `WAITING`。

## 7. Ready for Pickup

1. 在工单详情页点击 `in progress`。
2. 再点击 `ready for pickup`。
3. 工单状态应显示 `ready for pickup`。
4. 点击 `Send Pickup WhatsApp` 后，系统会打开 `wa.me` deep link，并建立 `READY_FOR_PICKUP` log。

## 8. POS 付款 / 套餐扣次

1. 打开 `/pos`。
2. 找到刚才的 work order，点击 `Checkout`。
3. 在 `/pos/[workOrderId]` 查看：
   - Customer
   - Vehicle
   - Service items
   - Total
   - Paid
   - Balance
4. 如果要演示套餐扣次，在 `Package payment` 区块选择客户已购买的套餐。
5. 点击 `Use 1 package wash`。
6. 系统应扣除 1 次套餐余额，并生成已付清 invoice。
7. 如果要演示现金/卡付款，则输入部分金额，例如 `50.00`，点击 `Record payment`。
8. 系统应生成 invoice，状态为 `PARTIAL`。
9. 回到 POS 再支付剩余金额。
10. 付清后：
   - Work Order payment status 为 `PAID`
   - Work Order status 为 `COMPLETED`
   - Invoice status 为 `PAID`
   - Balance 为 `0.00`

## 9. Invoice

1. 打开 `/invoices`。
2. 点击刚生成的 invoice。
3. 在 `/invoices/[invoiceId]` 确认显示：
   - Business name
   - Invoice No
   - Customer name
   - Phone
   - Plate number
   - Service items
   - Subtotal
   - Total
   - Paid Amount
   - Balance
   - Payment history
4. 如果使用套餐付款，payment history 应显示 method 为 `package`，并显示扣除 1 次套餐。

## 10. WhatsApp Deep Link

1. 在 `/business/settings` 或 `/team` 确认 Owner / Staff 已填写 WhatsApp Number，例如 `60123456789`。
2. 在 Work Order detail 点击 `Send WhatsApp` / `Send Pickup WhatsApp`，或在 Invoice detail 点击 `Send Invoice WhatsApp`。
3. 系统会打开 `https://wa.me/{phone}?text={encodedMessage}`，用户用自己手机的 WhatsApp 手动发送。
4. 系统应建立 WhatsApp log，状态为 `OPENED`，并记录 `openedAt`、`senderPhone`、`recipientPhone`、`sentByUserId`。
5. 回到 `/whatsapp` 或 `/whatsapp/[messageId]` 点击 `Mark Sent`，状态应变成 `SENT_MANUALLY`，并记录 `sentAt`。
6. Dashboard 的 WhatsApp 指标只统计 Opened / Manual Sent，不显示 delivered / read。

## 11. 多租户隔离检查

1. 用 Platform Admin 创建第二间 Business B 和 Owner B。
2. 用 Owner B 登录。
3. 确认看不到 Business A 的：
   - Customers
   - Vehicles
   - Services
   - Packages
   - Work Orders
   - Invoices
   - WhatsApp logs
4. 在 Business B 内可以创建和 Business A 相同的 phone 和 plate number。
5. 在 Business B 内可以创建同名套餐，但不能看到 Business A 客户的套餐余额。
