# Tetamu Phase 3：Staff App 个人与团队业绩

日期：2026-09-05。状态：**READY_FOR_UAT**。

含义：本地工程、隔离数据库及优化构建中的必要验证已完成，可在测试环境试用；**不是已上线，也不是生产启用批准**。没有部署、生产迁移、生产数据库访问、历史回填、真实消息发送或奖金／工资功能扩展。

## 1. 工作区与保护

- 仓库 `/Users/innovdia/Development/carwashpro`，分支 `main`，开始及交付 HEAD：`5f9b5b5f350d6ee3670f4d989b203776e6527544`。未提交、切分支或重置。
- 读取适用 AGENTS.md、本地 Next 16 Route Handler／数据安全／路由拦截文档，复核 Phase 1、Closure、Phase 2 报告及实际未提交代码。使用 Postgres 最佳实践约束查询范围和一致快照，没有另造统计公式。
- 开始前保存完整应用源码副本 `/tmp/tetamu-phase3-baseline.Y5JXB7`，包含用户修改、未提交 Phase 1/2 文件；排除 `.git`、依赖、构建缓存、`.env*` 和上传目录。**环境文件没有复制，`.env.example` 亦被排除**，不冒称备份了真实密钥／上传资料。
- 对其中 2,142 个仓库文件核对：2,135 个逐字节不变，7 个必要重叠文件列于第 9 节，0 个删除、0 个非预期差异。`.env.example` 仅追加默认关闭的新变量，单独检查差异。
- [基线指纹](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-baseline.json)；[最终保护核对](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-protection.json)。副本保存文件内容，指纹另提供可复核证据。
- 原 POS、金额捕获、销售／小费更正、目标发布、佣金、Payroll、Staff 导航、Approvals 及考勤业务逻辑保留。认证模块只增加事务内只读复核函数，既有认证／会话发行／滑动有效期没有改变。
- 一次构建启动时目录设置错误，发现后中止；核查发现 `next-env.d.ts` 两条生成类型引用被改变，已按基线恢复原内容及 CRLF，最终指纹一致。最终构建与所有浏览器验收均使用下述隔离副本，不以该中止尝试作为验收证据。未停止用户原 3000 服务。

## 2. 已完成页面与角色差异

### 首页

`/staff` 的业绩卡片位于现有 Next appointment / Up Next 之后、Quick actions 之前；无 Up Next 时也存在。卡片独立客户端请求，不把业绩查询加入首页打卡／审批的等待链。

- 普通员工：My Performance、年份、个人年度目标、同商家跨店已归属年度累计、可确认时的完成率与差额、本月及上月同期比较、当前团队等级／下一门槛进度。
- 获授权店长：Team Performance、当前工作门店、团队累计、等级／下一门槛／差额、当月比较、一行自己的个人目标与实际金额。
- 无个人等级，没有成员排行榜、数字动画、自动轮播或奖励效果。
- 首页只收到汇总 DTO，`detail=null`；不返回全员、年度事件数组或审计历史。测试样本 JSON 小于 5 KB。
- 保留 Home / Time / Pay / Profile 及有权限者的 Approvals **原有导航机制**，没有 Performance 底部按钮，也没有为了显示业绩强制启用 Payroll。测试 fixture 不含 Payroll，故原规则下 Pay 不出现；导航源码与本阶段开始时一致。

### 详情

新增 `/staff/performance`，只读。

- 员工默认 My performance：个人年度目标／累计／进度、销售／小费／退款／净额、按店组成、12 个月实绩、选月比较、本人事件分页。Team performance 页签只有当前团队汇总，无同事列表／订单／份额。
- 获授权店长默认 Team performance：三级累计门槛、当前等级、团队年度／月度实绩、未分配、成员搜索及展开；点击成员进入其**本店**月份和事件，不获得该员工其他门店金额。My performance 查看店长本人跨店年度组成。
- 目标／贡献／年度任职证据中的离职、调出和无目标成员保留；列表按员工编号与稳定 ID 排序，不做竞赛排名。
- 事件页每页 20 条，订单编号仅辅助识别；每行金额是所选人的贡献，**不是整单金额**。收款／退款各自独立，退款不重复扣 CreditNote，不显示完整支付引用或其他人的分配比例。
- 普通员工团队页没有同事数据；管理页无修改目标、补分配、销售／小费更正按钮。

## 3. Staff 身份、范围和 DTO

服务：`src/lib/staff-pwa/performance.ts: readStaffPerformance`。

1. API 从现有 `requireEmployeeSelfServiceAuthContext(request)` 取得真实 Staff session。普通员工不需要后台 User、Payroll、考勤启用或可打卡能力；集成测试验证只有 Staff 身份也可读本人。
2. 同一 READ ONLY / RepeatableRead 事务内调用 `revalidateEmployeeSelfServiceScope`，重新检查 session、membership、account、business、device、有效主门店和实际工作门店任职。比较认证上下文与数据库 session，拒绝替换 membership/business/device/branch 或已轮换、已撤销会话。
3. 团队成员权限检查真实关联 `staffUser`：同商家、active、loginEnabled，且实际 BUSINESS_OWNER，或具有 `PERFORMANCE_VIEW_TEAM`／`PERFORMANCE_MANAGE_TARGETS` 并且 User.branchId 等于当前工作门店。沿用 Phase 2 直接商家门店范围，不新增集团、多店委托权限。
4. 职称、目标里的 managerId、Approvals、canClockIn、服务人员身份均不授权团队成员读取。没有明确业绩权限就按普通员工处理；撤权后下一请求立即拒绝成员读取。
5. 后台 `readSnapshot` 继续先验证原 PerformanceActor 和权限；随后调用共用内部 `readScopedPerformanceSnapshot`。Staff 在真实 session 范围验证后调用内部层，**没有虚拟 owner、借用管理员或伪造 actorUserId**。
6. `readScopedPerformanceSnapshot` 是服务器内部原始投影，不是 API。所有 Staff 投影在服务端裁剪后序列化。普通响应没有同事 ID／姓名／份额、客户电话、银行、工资、后台权限、原始支付 ID、完整审计 JSON。

接口为 `GET /api/employee-performance`：

| 参数 | 用途 |
| --- | --- |
| view | card / auto / mine / team / member；auto 按当前实际授权选择 |
| year、month | 合法自然年／月；省略时使用 Business 经营时区的当前年月 |
| page | 正整数，20 条贡献事件一页 |
| member | 仅获团队权限且 view=member 才可使用；必须有本店年度任职／目标／贡献证据 |
| search | 管理团队名单的姓名／编号搜索，最多 100 字符 |

输入严格校验，拒绝未知及重复参数；businessId、membershipId、actorUserId、branchId、asOf 不能由客户端指定来更换身份或统计截止。直接 URL 查询不会代替本人的服务端身份。服务端 asOf 由每次请求生成。

主要 DTO：
- 公共只读头：mode、canViewTeam、opaque scopeKey、year/month、asOf、timezone、periodStart/periodEnd、当前门店显示名。
- personal/team：年度、当前月、比较期分项，来源完整性、归属完整性、目标状态、可空进度／比较。个人无 level；只有 team 有 levels/level/nextGap/unassigned。
- detail：按角色与所选范围裁剪的 subject、months、本人 branches、获授权 members，以及页内 events。没有后台整份 dashboard/history 透传。

## 4. 个人跨店与覆盖契约

个人年度范围是**同一商家、同一稳定 membership** 的：本年任职门店、本人本年贡献门店、本人年度目标版本涉及门店。原店历史不会跟随当前 workplace 搬走。按店列出金额、目标、目标版本及核查状态；目标合计对应这些年度组成，不仅是当前门店目标。

- 各店有正年度目标时才给出可确认的个人合计目标。任一相关店缺目标或为零，显示尚未完整设置；保留 knownTarget 及按店金额，不把部分目标冒充全部目标。
- 目标缺失不抹掉贡献；零目标不除零、不自动达标。个人超过目标显示真实百分比，进度条仅视觉封顶；负净额保持负号。
- 当前团队只来自合法当前工作门店；更换门店不默默改变跨店个人年度总额。店长查看其他成员时只使用当前获授权门店，不能套用该成员全商家个人查询。
- 1 月比较额外包含上年 12 月的本人任职／贡献门店，但**不把仅属于上年的门店目标加入本年分母**。已有专门跨店跨年测试。
- 若本人贡献存在无法归到合法门店的来源或关联门店缺失，拒绝把可读部分显示成完整个人年度业绩，返回范围待核对错误。

完整性继续使用 Phase 1/2：

- 年初至 asOf 完整即可确认当前年度完成率和等级，不要求 periodClosed。分母不按月份折算。
- 缺捕获、组成／日期／VOID 待核对、退款原来源缺口均使相关期间不完整；金额标为已核对小计，正式进度／等级为 null。
- 已核对未分配金额仍计团队。团队 COMPLETE 不代表个人归属完整；存在未分配事件时，个人只显示已明确归属金额，不确认个人完成率。不是只看未分配净额是否为零。
- 普通异常说明不下发同事身份或客户信息；未知个人事件金额为 null，不以零代替。
- 完整无交易可以显示 0；读取失败／加载／无合法年度范围不能称为完整零业绩。未来月份标尚未开始。
- 经营时区显式继承 `Business.timezone`，验证 IANA，不使用考勤时区或 02:00 边界；不改不可变事件 timezone/localDate。
- 当前月对比上月同期，并显示当地起止日期／时间；上月天数不足取有效月末。已结束月份整月比较，1 月可比较上一年 12 月。任一比较期未完整核查，增长结论不确认；基期 <= 0 时百分比 null，保留金额差及说明。

## 5. 刷新、缓存、功能开关和查询规模

- 新开关 `TETAMU_STAFF_PERFORMANCE` **默认 false**，独立于 Phase 1 捕获与 Phase 2 目标入口；打开显示不意味着捕获启用或历史完整。
- 关闭时首页不渲染卡片、不请求新接口；服务在查询新表前停止；API 404，详情新路由在既有 middleware 中精确提前返回私有 404，避免流式 notFound 已发出 200 响应。仅增加该单一路径，不改变其他后台／Staff 路由认证。
- API 使用 `Cache-Control: private, no-store, max-age=0`、Vary Cookie；页面 force-dynamic。没有 localStorage/sessionStorage/IndexedDB 业绩持久化，没有新增共享缓存或 worker。
- 进入页面、回到前台、网络恢复及手动刷新读取最新结果；单组件请求去重和短间隔限制，参数改变取消原请求。路由不匹配时不展示／读取，处理 Next 保留页面组件的行为。
- scopeKey 是 session/business/member/workplace 的不可逆绑定摘要，不是授权凭证。响应绑定不符时清空并刷新服务端身份，不展示旧响应。
- 页面隐藏、退出／切换事件及跨标签 BroadcastChannel 通知清除数据并取消请求；只广播“上下文改变”，不广播身份／金额／token。断网显示不能更新及已有检查时间，不把旧值当最新。
- 原 Service Worker 只缓存现有静态 PWA 资源，本次未更改；真实浏览器核对缓存中没有业绩 API／页面。
- 身份、目标、金额及来源在同一个只读 MVCC 快照中。每个相关门店年度来源核查一次；1 月额外读前一年 12 月，12 个月在已核对轻量投影内切片。不是员工 × 12 次数据库核查。
- 延续 Phase 2 的**限定门店年度轻量事件内存汇总**；事件结果分页后才查对应订单编号。不是数据库游标分页，未做超大年度数据生产压测；不能宣传为无限规模方案。

## 6. 金额与目标验证结果

RM118 示例：销售100、税8、小费10。销售 A/B 各50%，小费归不在销售名单的 C。

| 项目 | RM |
| --- | ---: |
| 团队计入 | 110.00 |
| A 销售 | 50.00 |
| B 销售 | 50.00 |
| C 小费 | 10.00 |
| 税额（排除） | 8.00 |

独立销售／小费归属没有改变。收退款分币、部分付款、配套销售／核销、最终退款归零及归属更正继续由 Phase 1 定向回归验证；没有重复重跑全部 POS UI。

浏览器主 fixture：54 名成员，26 笔收款、1 笔 RM59 退款。

| 年度核对项 | RM |
| --- | ---: |
| 销售实收 | 602,500.00 |
| 小费实收 | 250.00 |
| 销售退款 | 50.00 |
| 小费退款 | 5.00 |
| 团队净业绩 | 602,695.00 |
| 店长本人 | 301,225.00 |
| 员工 STAFF-001 | 301,225.00 |
| 独立小费员工 | 245.00 |
| 未分配 | 0.00 |

团队 = 301,225 + 301,225 + 245 + 0。原始净收款602,891，减净税196，同样得到602,695。

三级目标600,000/800,000/1,000,000；店长300,000 + 6×50,000 =600,000。当前第一级，下一级差额197,305；员工 STAFF-001 个人完成率602.45%，只有个人年度目标，没有个人等级。9月团队当前110，对8月同期600,550，金额差−600,440，百分比显示约−99.98%；明确为同期，不误标整月比较。

另验证：无目标／零目标、120% 超目标、跨年独立小费退款负净额、退款降级、未分配仍计团队、paid-VOID 待核对、跨店目标未齐、已离职成员保留及过去门店12月不增加本年目标。

## 7. 实际测试、构建、数据库

专用库：`127.0.0.1:5432/tetamu_performance_disposable_phase3_20260905_a`。从空库应用当前216份迁移；本阶段**没有新增迁移或数据模型**。fixture／集成脚本拒绝非 localhost 或非 disposable 库。未使用默认业务库。

优化构建副本：`/tmp/tetamu-phase3-build.HIHDSc`，从完整脏工作区复制，不是 HEAD。最终 `npm run build` → `npm run start` 成功，3104启用、3105关闭展示作对照，不用HMR。环境通过 env -i 明确指定，未继承真实支付、短信或通知凭证，未启动 worker。SMS 配置只有不能实际使用的测试占位值，用于现有 session 配置校验；没有调用发送入口。

实际核心命令：

```sh
node scripts/performance-test-database.mjs tetamu_performance_disposable_phase3_20260905_a
prisma migrate deploy
tsx --test --test-concurrency=1 tests/integration/performance-staff.test.ts tests/integration/performance-targets.test.ts tests/integration/performance-phase1.test.ts tests/unit/performance-money.test.ts tests/unit/performance-targets.test.ts tests/unit/staff-approval-navigation.test.ts tests/unit/staff-performance-route.test.ts tests/unit/staff-home-v2.test.ts
tsc --noEmit --pretty false --incremental false
eslint <本阶段改动及新增 TypeScript/JS 文件>
# 在上述副本内，显式测试 DATABASE_URL、PORT 和测试 flags：
npm run build
npm run start -- --hostname 127.0.0.1 --port 3104
npm run start -- --hostname 127.0.0.1 --port 3105
tsx scripts/seed-performance-staff-browser.ts
node scripts/verify-performance-staff-browser.mjs
node scripts/verify-performance-staff-disabled.mjs
node scripts/verify-performance-staff-switch.mjs
node scripts/verify-performance-staff-workspace.mjs
```

- **91/91 通过，0 fail/skip/todo**。包含13项 Staff 集成、1项新路由单元、既有 Phase 1/2、金额／目标、首页／Approvals 定向回归。不删除原测试、不加skip/todo、不放宽业务断言。
- TypeScript及正式构建类型检查通过，改动范围 ESLint、tracked 文件 diff --check 通过。
- SQL只读测试前后 Payment、Refund、Contribution、目标版本不变；并发另连接插入收款时本次快照仍一致，下次查询明确发现缺捕获，不能出现假完整。
- 数据库约束曾拒绝不完整的测试账号关联／设备撤销数据；修正 fixture 使用完整关联及生命周期证据，没有修改或放宽约束。
- 浏览器等待曾误命中 Next 保留的隐藏页面／旧导航，改为等待真实可见页面及 switch-workplace 的成功响应；没有跳过业务断言。退出后登录页主动 `/me` 401 使用精确端点／状态断言，而不是笼统要求整个退出流程无任何 HTTP 错误。

日志：[迁移](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-migrations.log)、[91项回归](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-regressions.log)、[类型](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-typecheck.log)、[Lint](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-lint.log)、[正式构建](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-build.log)。

## 8. 真实页面与错误证据

本机 Chrome + Playwright，1440×1000及390×844，操作实际优化构建、真实 Staff cookie认证／API／测试数据库。会话用既有发行函数生成，普通员工确无后台User；不是模拟页面或伪造管理员。OTP投递未验收。

- 员工／店长首页卡片顺序、无Up Next情况、长姓名／金额、团队／个人页签、12个月、选月、成员54人、编号搜索、展开、20条分页及完整总额一致均已检查。
- 390px无页面横向溢出，操作按钮可滚动到达，不改变底部安全区。最终卡片实测员工约239px、店长约211px；为长金额、准确比较标签保留可读性，没有硬高度裁剪或缩小金额字号。紧凑程度仍可在UAT收集反馈。
- 对普通与管理首页分别模拟**仅业绩API的503**，真实 Clock In、Quick actions、Approvals入口仍可用；重试恢复。这是故障注入，不宣称实际中断了数据库。
- 真实API篡改身份／范围被拒绝；测试库撤销团队权限后成员API立即403。
- 实际切换至另一商家：旧小费245不再出现，新商家完整零交易、未设目标；Profile真实退出清cookie并返回登录。
- 正常业绩套件 console error=0、pageerror=0；有意越权与故障注入的400/403/503完整单列记录。切换／退出套件pageerror=0，登录页既有 `staff-auth.tsx` 主动请求 `/api/employee-auth/me` 产生1次预期401并自行处理，没有隐藏此记录。
- 稳定构建未出现 `null.removeChild`；未声称修复此前未知根因。保留既有Next middleware弃用／构建警告，未重构无关框架代码。
- **Chrome手机视口不是实体iPhone/Safari或系统软键盘验收。**

截图与机器证据：

- [员工桌面首页](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/staff-desktop-home.png)、[员工桌面详情](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/staff-desktop-detail.png)
- [员工390px首页](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/staff-mobile-home.png)、[本人明细第2页](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/staff-mobile-detail-page2.png)、[普通员工团队汇总](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/staff-mobile-team-summary.png)
- [店长桌面团队](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/manager-desktop-team.png)、[店长390px首页](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/manager-mobile-home.png)
- [成员搜索与展开](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/manager-mobile-member-search-expanded.png)、[成员本店明细](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/manager-mobile-member-detail.png)、[店长本人](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/manager-mobile-my-performance.png)
- [业绩失败而审批保留](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/manager-performance-failure-approvals-retained.png)、[断网清除私有数据](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/staff-offline-private-data-cleared.png)、[关闭功能的首页](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/mobile-feature-off-home.png)
- [切换后新范围](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/mobile-workplace-switch-no-previous-values.png)、[退出登录](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/mobile-signed-out.png)
- [核心浏览器证据](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/evidence.json)、[关闭开关证据](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/disabled-evidence.json)、[切换与退出证据](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-ui/switch-evidence.json)、[服务端日志](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-phase3-server.log)

## 9. 改动清单

现有文件的必要修改：

| 路径（相对仓库） | 目的 |
| --- | --- |
| src/lib/performance/read.ts | 保留后台权限入口，抽出共享事务内核查投影 |
| src/lib/attendance/employee-auth/session.ts | 新增只读session与工作门店复核，不改既有认证流程 |
| src/app/staff/page.tsx | 默认关闭、独立加载的首页卡片插槽 |
| src/components/staff-pwa/staff-home-overview.tsx | Up Next后、Quick actions前渲染可选插槽 |
| src/lib/staff-pwa/client.ts | 既有清理函数广播无数据的上下文变化事件 |
| src/middleware.ts | 精确新详情路径的默认关闭提前拦截；不改原匹配路径权限 |
| docs/environment-variable-contract.md、.env.example | 默认关闭及私有缓存／迁移先决条件说明 |

新增：

- `src/lib/staff-pwa/performance-access.ts`、`performance.ts`：入口开关、绑定键、Staff身份适配及裁剪汇总／详情。
- `src/app/api/employee-performance/route.ts`、`src/app/staff/performance/page.tsx`：私有接口和详情路由。
- `src/components/staff-pwa/staff-performance.tsx`、`staff-performance.module.css`：角色卡片、详情、请求生命周期与响应布局。
- `tests/helpers/performance-staff-fixture.ts`、`tests/integration/performance-staff.test.ts`、`tests/unit/staff-performance-route.test.ts`：真实隔离身份、金额、权限、范围、快照与开关验证。
- `scripts/seed-performance-staff-browser.ts`、`refresh-performance-staff-browser-sessions.ts`：专用fixture与新会话发行，不重写已撤销会话。
- `scripts/verify-performance-staff-{browser,disabled,switch,workspace}.mjs`：真实页面与保护证据生成。
- 本报告及工作目录 outputs 下的日志／截图／核对证据。

## 10. UAT与正式启用前条件

本阶段已完成，**READY_FOR_UAT**。可以继续用测试环境验证 Staff个人／团队体验，不自动进入其他模块。

仍独立保留：

1. 生产代码审阅、授权迁移／备份、发布、逐项显式开关启用；本次没有执行。
2. 生产历史缺捕获／未知组成／未分配处理、Paid-VOID最终历史规则、旧时区证据处理。展示开关不修复历史。
3. 实体iPhone/Safari、系统软键盘、真实OTP投递／支付退款渠道，以及生产量级年度数据性能验收。
4. 测试会话与数据仅供隔离环境；私有fixture token文件留在 `/tmp/tetamu-phase3-browser-fixture.json`（0600），未写入报告、源码或截图。必要时通过专用脚本发行新测试会话，不能用于生产登录旁路。
5. UI保留既有Staff英文标签并补充关键中文状态，不包含全站国际化改造；小费计入目标不代表已经发放。

复用查询契约已集中在 `readStaffPerformance` 及其 DTO：今后需求应继续调用身份适配层，不能绕过它直接下发后台账本。没有增加奖金、排名、推送、后台目标修改或Staff归属更正功能。

验证完成后已停止本次3104／3105服务及自动化浏览器，未停止用户3000服务。隔离库、源码副本与截图保留用于复核；需要试用时按显式隔离配置重启。完成本报告后停止，不自动部署或回填。
