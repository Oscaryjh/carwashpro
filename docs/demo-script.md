# Demo Script

这份脚本用于演示 Car Wash CRM POS SaaS MVP。建议使用一组新的 demo business 和 owner，避免和旧测试数据混在一起。

## 关键页面 URL

- Platform Admin: `/admin/businesses`
- CRM Home: `/crm`
- Services: `/services`
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

## 5. Work Order 开单

1. 打开 `/work-orders/new`。
2. 输入车牌 `DEMO123` 并搜索。
3. 系统应显示客户和车辆资料。
4. 勾选一个或多个服务项目。
5. 点击 `Create work order`。
6. 创建成功后进入 `/work-orders/[workOrderId]`，状态默认为 `WAITING`。

## 6. Ready for Pickup

1. 在工单详情页点击 `in progress`。
2. 再点击 `ready for pickup`。
3. 工单状态应显示 `ready for pickup`。
4. 系统会生成 WhatsApp message log：`READY_FOR_PICKUP`。

## 7. POS 付款

1. 打开 `/pos`。
2. 找到刚才的 work order，点击 `Checkout`。
3. 在 `/pos/[workOrderId]` 查看：
   - Customer
   - Vehicle
   - Service items
   - Total
   - Paid
   - Balance
4. 输入部分金额，例如 `50.00`，点击 `Record payment`。
5. 系统应生成 invoice，状态为 `PARTIAL`。
6. 回到 POS 再支付剩余金额。
7. 付清后：
   - Work Order payment status 为 `PAID`
   - Work Order status 为 `COMPLETED`
   - Invoice status 为 `PAID`
   - Balance 为 `0.00`

## 8. Invoice

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

## 9. WhatsApp Logs

1. 打开 `/whatsapp`。
2. 应看到以下 message logs：
   - `NEW_CUSTOMER_WELCOME`
   - `SERVICE_CONFIRMATION`
   - `READY_FOR_PICKUP`
   - `INVOICE_SENT`
3. 点击 `Open WhatsApp`，系统会打开 `https://wa.me/{phone}?text={encodedMessage}`。
4. 回到系统后点击 `Mark as Sent`。
5. 状态应变成 `SENT`，并记录 `sentAt`。

## 10. 多租户隔离检查

1. 用 Platform Admin 创建第二间 Business B 和 Owner B。
2. 用 Owner B 登录。
3. 确认看不到 Business A 的：
   - Customers
   - Vehicles
   - Services
   - Work Orders
   - Invoices
   - WhatsApp logs
4. 在 Business B 内可以创建和 Business A 相同的 phone 和 plate number。
