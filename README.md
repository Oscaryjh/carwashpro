# Car Wash CRM POS SaaS

这是一个洗车店 CRM + POS SaaS MVP。系统以多租户为基础，每一家洗车店都有独立的 `business_id`，客户、车辆、服务、工单、付款、发票和 WhatsApp message logs 都按 `business_id` 严格隔离。

## 功能范围

- SaaS 平台管理：
  - Platform Admin 创建洗车店
  - 创建第一位 Business Owner
  - 管理 business profile
- CRM：
  - 客户管理
  - 车辆管理
  - 车牌搜索
- Services：
  - 服务项目创建、编辑、停用
- Packages：
  - RM180 / 10 次洗车等预付套餐
  - 客户购买套餐后记录剩余次数
  - POS 可使用套餐扣 1 次完成付款
- Work Orders：
  - 根据车牌创建洗车工单
  - 状态流转：`WAITING` → `IN_PROGRESS` → `READY_FOR_PICKUP` → `COMPLETED`
  - 未完成工单可取消
- POS：
  - 部分付款
  - 付清后自动完成工单
- Invoices：
  - 第一次付款自动生成 invoice
  - 显示服务项目、付款记录、余额
- WhatsApp logs：
  - 使用 `wa.me` deep link 手动打开 WhatsApp
  - 不使用 Meta Cloud API、webhook、template approval 或自动后台发送
  - 状态记录：`DRAFT` / `OPENED` / `SENT_MANUALLY` / `CANCELLED`
  - Dashboard 统计 WhatsApp Opened / Manual Sent

暂未包含：Membership、Twilio / WhatsApp Business API 自动发送、报表、Subscription Billing。

## 技术栈

- Next.js App Router
- React
- Prisma
- PostgreSQL
- bcryptjs
- jose session JWT
- zod validation

本地开发使用 `embedded-postgres` 自动启动 PostgreSQL，只作为 dev dependency。生产环境应直接提供真实 PostgreSQL 的 `DATABASE_URL`，不需要使用 embedded Postgres。

## 本地启动

```bash
npm.cmd install
copy .env.example .env
npm.cmd run prisma:migrate
npm.cmd run prisma:seed
npm.cmd run dev
```

如果 npm registry 证书链校验失败，可先执行：

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npm.cmd install
```

`npm.cmd run prisma:migrate`、`npm.cmd run prisma:seed`、`npm.cmd run dev` 会通过 `scripts/with-embedded-postgres.mjs` 在本地启动 embedded PostgreSQL。数据库文件保存在 `.local-postgres/`，已被 `.gitignore` 忽略。

## Seed Admin

默认 seed admin 来自 `.env`：

```env
SEED_ADMIN_EMAIL="admin@example.com"
SEED_ADMIN_PASSWORD="ChangeMe123!"
```

登录后进入 `/admin/businesses`，可以创建洗车店和第一位 Business Owner。

## 多租户说明

核心租户字段是 `business_id`。

- `PLATFORM_ADMIN`：可以管理所有 businesses，不进入门店 CRM/POS 数据流。
- `BUSINESS_OWNER`：只能访问自己的 business 数据。
- `STAFF`：只能访问自己的 business 数据，不能进入 business settings。
- 所有业务表都带 `business_id`：
  - `customers`
  - `vehicles`
  - `services`
  - `packages`
  - `customer_packages`
  - `work_orders`
  - `work_order_items`
  - `payments`
  - `invoices`
  - `whatsapp_messages`

详情页和 mutation 都使用当前 session 的 `businessId` 过滤，避免通过 URL 猜测访问其他租户数据。

## 关键 URL

- `/admin/businesses`
- `/crm`
- `/services`
- `/packages`
- `/work-orders`
- `/pos`
- `/invoices`
- `/whatsapp`

## Demo 流程

完整 demo 脚本见 [docs/demo-script.md](docs/demo-script.md)。

简版流程：

1. 用 seed admin 登录。
2. 在 `/admin/businesses` 创建 Business A 和 Owner。
3. 用 Owner 登录。
4. 在 CRM 新增 customer 和 vehicle。
5. 在 Services 新增服务项目。
6. 在 Packages 新增 RM180 / 10 次洗车套餐。
7. 在客户详情页购买套餐，确认剩余次数。
8. 在 Work Orders 输入车牌创建工单。
9. 推进到 `READY_FOR_PICKUP`。
10. 在 POS 使用套餐扣 1 次，或做现金/卡付款。
11. 查看 invoice。
12. 在工单或 invoice 点击 Send WhatsApp，确认打开 `wa.me`，再到 WhatsApp logs 演示 Mark Sent。
