# WashFlow Car Wash CRM POS SaaS 系统流程说明

本文档用于让 ChatGPT 或新的开发者快速理解当前系统逻辑、使用方式和后续开发注意事项。

## 1. 系统定位

WashFlow 是一个洗车店 CRM + Jobs + POS + Package + Invoice + WhatsApp Notification 的多租户 SaaS 系统。

当前系统重点不是复杂会计或完整 ERP，而是帮助洗车店完成日常流程：

1. 搜车牌
2. 找客户和车辆
3. 建立洗车 Job
4. 推进洗车状态
5. POS 收款或使用洗车套餐
6. 生成 Invoice
7. 记录 WhatsApp 通知
8. 老板查看 Dashboard / Reports

系统 UI 方向：适合 iPad / 平板操作，按钮要够好点、页面要紧凑、信息要一眼看懂，不要浪费空间。

## 2. 技术基础

- Framework: Next.js App Router
- Database: PostgreSQL
- ORM: Prisma
- Auth: 自建 session cookie
- Password: bcryptjs
- UI: 原生 CSS，主要样式在 `src/app/globals.css`
- Local dev database: embedded-postgres
- 文件上传：Business logo 存在 `public/uploads/business-logos`

## 3. 多租户核心逻辑

系统是 multi-tenant SaaS。

每一间洗车店是一个 `Business`，所有业务数据都必须绑定：

- `businessId`
- optional `branchId`

任何查询、创建、更新、删除都不能只靠 id，必须加上当前 session 的 `businessId`。

重要原则：

- `businessId` 是隔离边界
- `branchId` 只是 business 内部的筛选，不可以替代 `businessId`
- 不允许通过 URL 猜 id 访问其他 business 的资料
- Platform Admin 可以管理 businesses，但默认不进入门店 CRM/POS

## 4. 用户角色

### PLATFORM_ADMIN

平台管理员。

用途：

- 登录平台后台
- 创建 Business
- 创建第一个 Business Owner
- 查看所有 businesses
- 重设 business user 密码

主要路由：

- `/admin/businesses`
- `/admin/businesses/new`
- `/admin/businesses/[businessId]`

### BUSINESS_OWNER

洗车店老板。

用途：

- 管理店铺资料
- 管理分店
- 管理服务项目
- 管理套餐
- 查看 Dashboard / Reports
- 使用 CRM / Jobs / POS / Invoices / WhatsApp

主要路由：

- `/dashboard`
- `/crm`
- `/work-orders`，UI 名称显示为 Jobs
- `/pos`
- `/invoices`
- `/whatsapp`
- `/reports`
- `/services`
- `/packages`
- `/branches`
- `/business/settings`

### STAFF

员工 / 收银员 / 洗车操作人员。

用途：

- CRM 搜客户
- 建立 Jobs
- POS 收款
- 查看 invoices
- 处理 WhatsApp logs

Staff 不应该管理 Services、Packages、Branches、Business settings。

主要路由：

- `/dashboard`
- `/crm`
- `/work-orders`
- `/pos`
- `/invoices`
- `/whatsapp`

## 5. 当前导航结构

侧边栏显示当前 business 的店名和 logo。

如果 business 上传了 logo，侧边栏显示：

- logo
- business name

顶部右上角 user name / role 已移除，因为对日常操作价值不大。

## 6. Business / 店铺设置

### Business 字段

- name
- slug
- logoUrl
- phone
- email
- address
- status

### Business Settings

路由：

- `/business/settings`

功能：

- 编辑 business name
- 编辑 phone / email / address
- 上传公司 logo

Logo 上传逻辑：

- 支持 PNG / JPG / WebP
- 如果图片大于 2MB，前端会自动压缩成 WebP
- 压缩后再上传
- Server Action body size limit 设置为 3MB
- logo 文件存在 `public/uploads/business-logos`
- `public/uploads/` 不提交到 git

## 7. Branch / 分店

一个 Business 可以有多个 Branch。

Branch 字段：

- name
- phone
- address
- status: ACTIVE / INACTIVE

主要路由：

- `/branches`
- `/branches/new`
- `/branches/[branchId]`

逻辑：

- Business Owner 可以新增、查看、停用 branch
- 新建核心数据时，如果只有一个 branch 可以自动使用
- 如果有多个 branch，表单需要选择 branch
- Dashboard 和 Reports 支持 branch filter

## 8. CRM 模块

CRM 首页路由：

- `/crm`

CRM 的核心用途不是默认展示所有客户，而是快速搜索：

- 车牌
- 电话
- 客户名

流程：

1. 员工输入车牌 / 电话 / 客户名
2. 如果找到客户或车辆，打开 profile
3. 如果没有记录，引导创建客户和车辆

### Customer

字段：

- businessId
- branchId optional
- name
- phone
- email optional
- notes optional

规则：

- 同一个 business 内 phone 唯一
- 不同 business 可以使用相同 phone

页面：

- `/crm/customers`
- `/crm/customers/new`
- `/crm/customers/[customerId]`
- `/crm/customers/[customerId]/edit`

客户列表需要紧凑，当前方向：

- 有序号
- 可搜索
- 只保留重要字段：Customer、Contact、Email、Joined、Actions
- 不显示重复的 Vehicles / Branch / Orders / Package 等过多列

客户详情显示：

- customer profile
- vehicles
- packages
- timeline
- work orders
- invoices
- payments
- WhatsApp messages

### Vehicle

字段：

- businessId
- branchId optional
- customerId 当前车主
- plateNumber
- brand optional
- model optional
- color optional
- notes optional

规则：

- 同一个 business 内 plateNumber 唯一
- 不同 business 可以使用相同 plateNumber
- Vehicle 必须属于 Customer

页面：

- `/crm/vehicles`
- `/crm/vehicles/new`
- `/crm/vehicles/[vehicleId]`

Vehicle Detail 显示：

- plate number
- brand / model / color
- current owner
- owner phone
- branch
- notes
- ownership history
- work order history
- related invoices

## 9. Vehicle Contact / Ownership Handling

重要业务逻辑：车牌找到车辆后，不可以默认今天送车的人一定是登记客户。

WorkOrder 有 contact 相关字段：

- contactType
  - REGISTERED_OWNER
  - OTHER_PERSON
  - NEW_OWNER
- contactName optional
- contactPhone optional

### Registered owner

场景：

- 登记车主本人送车

逻辑：

- WorkOrder.customerId = Vehicle.customerId
- contactName / contactPhone 可以使用客户资料

### Other person

场景：

- 朋友、家人、员工代送车

逻辑：

- 不修改 Vehicle.customerId
- WorkOrder.customerId 仍然是登记客户
- 记录 contactName / contactPhone
- WhatsApp 通知优先发送给 contactPhone

注意：

- contactPhone 只能输入数字
- 不能输入字母

### New owner / Vehicle transferred

场景：

- 车辆已经转卖给新车主

逻辑：

- 输入新车主姓名和电话
- 如果 phone 已存在当前 business，使用现有 customer
- 如果 phone 不存在，创建新 customer
- 更新 Vehicle.customerId = newCustomer.id
- 新增 VehicleOwnershipHistory
- 新 WorkOrder.customerId = newCustomer.id

非常重要：

- 更新 Vehicle.customerId 只代表当前车主改变
- 不要修改旧 WorkOrder / Invoice / Payment / WhatsAppMessage 的 customerId
- 旧记录必须继续属于当时旧客户
- 只能新创建的 WorkOrder 使用新车主 customerId
- 不可以用批量 update 旧历史资料的方式处理转让

## 10. Jobs / Work Orders

UI 上叫 Jobs，数据库模型叫 WorkOrder。

主要路由：

- `/work-orders`
- `/work-orders/new`
- `/work-orders/[workOrderId]`

### New Job 流程

1. 输入车牌
2. 系统自动转大写
3. 点击 Search
4. 如果车辆存在：
   - 显示当前登记车主
   - 选择今日 contact / ownership
   - 选择服务项目
   - 创建 job
5. 如果车辆不存在：
   - 先输入 owner phone
   - phone 只能数字
   - 如果电话已注册：
     - 显示该客户
     - 问是否把这个新车牌加入该客户名下
     - Add vehicle and continue
   - 如果电话未注册：
     - 创建新 customer + vehicle
     - 再继续开 job

这个流程必须一步一步引导，不要把所有表单一次性堆在一起。

### WorkOrder 状态

- WAITING
- IN_PROGRESS
- READY_FOR_PICKUP
- COMPLETED
- CANCELLED

允许状态推进：

- WAITING -> IN_PROGRESS
- IN_PROGRESS -> READY_FOR_PICKUP
- READY_FOR_PICKUP -> COMPLETED
- 未完成订单可以 CANCELLED

### Payment status

- UNPAID
- PARTIAL
- PAID

### Jobs 列表

路由：

- `/work-orders`

UI 名称：

- Jobs
- 新增按钮叫 `+ Job`

列表优化逻辑：

- 默认不显示 completed 的旧 job
- Completed 只在 Completed 或 All history tab 中查看
- 有 filter tabs:
  - Active + Today
  - Active
  - Ready
  - Unpaid
  - Completed
  - Cancelled
  - All history
- 有 search:
  - order number
  - plate
  - customer
  - phone
- 有 date filter

## 11. Services 模块

Services 是洗车店可以自己创建的服务项目，例如：

- Basic Wash Small RM10
- Basic Wash Medium RM15
- Basic Wash Large RM25

主要路由：

- `/services`
- `/services/new`
- `/services/[serviceId]`

规则：

- Business Owner 管理 Services
- Staff 不管理 Services
- 同一个 business 内 service name 唯一
- Service 有 status ACTIVE / INACTIVE
- 既然已有 status，就不需要单独 Deactivate 按钮

UI 方向：

- `/services` 是列表，不直接编辑
- 点击 service 进入 detail/edit 页面
- detail 页面才有 edit / save / delete
- Save 按钮叫 `Save`
- Delete 要确认
- 列表需要有序号

## 12. Packages / 洗车套餐

Packages 是预付洗车套餐，例如：

- RM150 / 11 washes
- RM180 / 10 washes

主要路由：

- `/packages`
- `/packages/new`
- `/packages/[packageId]`

Package 字段：

- businessId
- branchId optional
- serviceId optional
- name
- description optional
- price
- totalUses
- status

CustomerPackage 字段：

- customerId
- packageId
- purchasePrice
- totalUses
- remainingUses
- status

CustomerPackage 状态：

- PENDING_PAYMENT
- ACTIVE
- USED_UP
- CANCELLED

重要逻辑：

- 客户点击 Sell package 后，不应该马上得到套餐
- 正确流程是先创建 PENDING_PAYMENT 的 CustomerPackage
- 然后进入 POS 付钱
- POS 付清后，CustomerPackage 才变成 ACTIVE
- ACTIVE 后才可以在 POS 用来扣次数

使用套餐付款：

- WorkOrder 未付款时，可以选择 customer 的 active package
- 扣 1 次
- Payment method = PACKAGE
- WorkOrder 变 PAID
- WorkOrder status 变 COMPLETED
- Invoice 变 PAID
- CustomerPackage.remainingUses - 1
- remainingUses = 0 时变 USED_UP

## 13. POS 模块

主要路由：

- `/pos`
- `/pos/[workOrderId]`
- `/pos/packages/[customerPackageId]`

POS 用途：

- 收 job 款项
- 支持部分付款
- 支持现金/卡/DuitNow/Ewallet/Bank Transfer
- 支持 package payment
- 收 package purchase 款项

POS 首页显示：

- To Collect
- Outstanding
- Ready Pickup
- Partial Paid
- Package Sales
- Package Amount
- payable jobs
- pending package sales

Job POS 流程：

1. 进入 `/pos`
2. 找到 payable job
3. Checkout
4. 输入付款金额
5. 选择付款方式
6. 可输入 reference
7. 如果未付清：
   - paymentStatus = PARTIAL
   - Invoice status = PARTIAL
8. 如果付清：
   - paymentStatus = PAID
   - WorkOrder status = COMPLETED
   - Invoice status = PAID
   - 创建 INVOICE_SENT WhatsAppMessage

Package purchase POS 流程：

1. 客户详情 Sell package
2. 产生 PENDING_PAYMENT CustomerPackage
3. `/pos` 显示 pending package sale
4. Checkout package sale
5. 必须全额付款
6. CustomerPackage 变 ACTIVE

## 14. Invoice 模块

主要路由：

- `/invoices`
- `/invoices/[invoiceId]`

规则：

- 第一次付款时自动生成 invoice
- 一个 WorkOrder 只生成一个 Invoice
- invoiceNumber 在同一个 business 内唯一
- Invoice 显示 business name、customer、phone、plate、items、subtotal、total、paidAmount、balance、payment history

Invoice 状态：

- UNPAID
- PARTIAL
- PAID
- VOID

Void 逻辑：

- 如果 POS 按错产生 invoice，可以 void
- Void 不应该删除历史
- Void 应记录 voidReason / voidedAt
- Payment 也支持 VOID 状态

## 15. WhatsApp 模块

当前版本使用 WhatsApp Deep Link，不接真实 Twilio / Meta API，不需要 webhook、template approval 或自动后台发送。系统只生成 `wa.me` link，并记录人工发送 log。

主要路由：

- `/whatsapp`
- `/whatsapp/[messageId]`

WhatsAppMessage type:

- NEW_CUSTOMER_WELCOME
- SERVICE_CONFIRMATION
- READY_FOR_PICKUP
- INVOICE_SENT

WhatsAppMessage status:

- DRAFT
- OPENED
- SENT_MANUALLY
- CANCELLED

Manual flow：

Generate message -> Open wa.me -> User sends manually -> Mark Sent

触发点：

- Work Order detail: Send WhatsApp / Send Pickup WhatsApp
- Invoice detail: Send Invoice WhatsApp

发送方式：

- 第一版点击 Open WhatsApp 走 `https://wa.me/{phone}?text={encodedMessage}`
- 点击按钮后状态记录为 `OPENED`，并记录 `openedAt`
- 用户手动发送后可以 Mark as Sent，状态记录为 `SENT_MANUALLY`，并记录 `sentAt`
- Dashboard 只统计 Opened / Manual Sent，不追踪 delivered / read

Contact phone 规则：

- service confirmation / ready pickup 优先发送给 WorkOrder.contactPhone
- 如果 contactPhone 为空，才发送给 customer.phone

## 16. Dashboard

主要路由：

- `/dashboard`

Business Owner / Staff 登录后看到当前 business 的经营数据。

KPI：

- Today Sales
- Cars Washed Today
- Work Orders Today
- Ready for Pickup
- Unpaid / Partial Invoices
- Package Uses Today
- WhatsApp Sent Today
- New Customers This Month

Lists / Charts：

- Top Services This Month
- Recent Jobs
- Recent Payments
- Low Package Balance Customers

Dashboard 支持 branch filter：

- All branches
- 单一 branch

Platform Admin dashboard 不显示门店经营数据。

## 17. Reports

主要路由：

- `/reports`

Reports 给 Business Owner 使用。

用途：

- 指定日期范围
- 指定 branch
- 查看销售、付款、job、invoice、服务、客户表现

内容：

- Revenue
- Active payments
- Jobs
- Cars washed
- Average ticket
- Package sales
- Payment method breakdown
- Jobs by status
- Invoices by status
- Top services
- Top customers
- Recent payments

## 18. Customer Timeline

客户详情页包含 Timeline。

Timeline 整合：

- Work Orders
- Payments
- Invoices
- Customer Packages
- WhatsApp Messages

每一条显示：

- 日期时间
- 类型
- 标题
- 简短说明
- 金额 optional
- 状态 optional
- 相关链接 optional

用途：

老板输入车牌后，可以立刻看到客户过去的消费、套餐、付款、invoice 和 WhatsApp 互动。

## 19. 删除客户逻辑

开发阶段会有测试客户需要删除，但不能破坏历史数据。

规则：

- 如果客户没有历史记录，可以删除
- 如果客户有关联 work orders、vehicle history、ownership history、payments、invoices、WhatsApp 等，不应该硬删除
- 系统应提示不能删除，因为需要保留历史准确性

未来可考虑：

- archive customer
- mark test customer
- soft delete

## 20. UI / UX 方向

整体 UI 要适合 iPad 平板：

- 字体不要太大
- 间距要紧凑
- 内容要一格一格清楚
- 表格要有序号
- 重要列表要有搜索
- 不要重复显示相同资料
- 不要让用户在流程里一次看到太多不相关表单
- 常用操作一步一步引导
- 返回按钮尽量是 Back，回上一层，不要出现多个 Back to CRM / Back to customers

已经确定的命名：

- Work Orders 在 UI 上叫 Jobs
- New Work Order 在 UI 上叫 `+ Job` 或 New Job
- New Vehicle 在客户详情里叫 Add Vehicle
- Save service 改成 Save

## 21. Offline / Local-first 方向

未来如果要支持无外网基本操作，建议先做店内局域网模式，而不是马上做完全离线 PWA。

推荐第一版：

- Windows 店内电脑运行 Next.js + PostgreSQL
- iPad / Android / Windows 设备连接同一个 WiFi
- 访问 `http://店内电脑IP:3000`
- 没有外网时仍可操作 CRM / Jobs / POS / Invoice / Package
- WhatsApp / Twilio 先排队，恢复网络再发送

完全离线的 iPad 本地写入需要 IndexedDB、同步队列、冲突处理，复杂度较高，后面再做。

## 22. 当前未做或暂不做

当前不要混进以下复杂功能，除非明确进入下一阶段：

- Subscription billing
- Membership 等级
- Campaign
- Twilio 真正自动发送
- PDF 下载
- 完整 accounting
- 多设备离线数据冲突同步
- 原生 iOS / Android / Windows app

## 23. 开发注意事项

后续开发必须遵守：

1. 所有 query/mutation 必须带 `businessId`
2. `branchId` 只能作为 business 内筛选
3. 不要修改旧历史记录来配合车辆转让
4. POS 付款、invoice、package 使用必须保留审计记录
5. 业务流程优先，UI 不要堆大段说明文字
6. iPad 平板体验优先：紧凑、清楚、按钮好点
7. 任何新功能都要考虑 Business Owner 和 Staff 的权限差异
8. Admin 路由只给 PLATFORM_ADMIN
9. Services / Packages / Branches / Business settings 只给 BUSINESS_OWNER
10. CRM / Jobs / POS / Invoices / WhatsApp 给 BUSINESS_OWNER 和 STAFF

## 24. 推荐给 ChatGPT 的使用方式

如果把这个文档交给 ChatGPT，可以这样说：

> 这是我的 WashFlow Car Wash CRM POS SaaS 当前系统说明。请先理解这个文档，不要假设系统是普通 POS。之后所有功能开发都必须符合这里的多租户、Jobs、POS、Package、Invoice、WhatsApp 和 iPad UI 逻辑。
