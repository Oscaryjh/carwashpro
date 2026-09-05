# Staff Performance UI/UX 优化交付

日期：2026-09-05。状态：**UAT_UPDATED / DESKTOP_READY_MOBILE_PENDING**。

已修改真实组件、完成优化构建、更新本机 3106 UAT 服务，并验证普通员工与店长页面。不是生产部署；没有新增交易、重置数据、执行 RM118 收款或重新运行种子。

## 1. 查看入口

在原有员工／店长独立测试 Chrome 窗口中刷新：

- [Staff 首页](http://127.0.0.1:3106/staff)：Up Next 后、Quick Actions 前的新卡片。
- [Performance 详情](http://127.0.0.1:3106/staff/performance)：年度、月度、交易与有权限者的成员列表。

继续使用原有[试用入口快捷方式](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uat/试用入口)恢复测试身份。URL 不含凭证；其他浏览器直接打开仍须登录。此次未调用种子或角色准备流程，原会话及恢复机制没有修改。

仅当前电脑可访问 loopback 地址。390px Chrome 验证不是实体手机、Safari 或手机安全登录验收；此前可信 HTTPS／实体手机登录条件仍待处理。

## 2. 实际界面改动

### 首页

- 普通员工：My Performance、年份／详情提示、一次年度主金额、一个个人进度条、本月金额和精简同期百分比。团队仅一行等级／下一门槛，没有第二个进度条。
- 店长：团队主金额、一个到下一累计门槛的进度条、本月表现、底部本人年度贡献／目标。没有首页成员或12个月列表。
- 一张卡片一个详情链接，无嵌套按钮。390×844 下实际高度：员工 **220.64px**、店长 **228.64px**；没有硬裁文字。
- 未核对、未分配等必要状态仍就地显示；加载与失败独立于打卡、审批和快捷操作。

### 详情

- 紧凑 Home／Performance／年份／刷新标题区；My performance / Team performance 分段切换。月份移到 Monthly performance 内。
- 年度金额只显示一次；移除重复 Net total。Sales / Tips / Refunds 放入 View breakdown，零退款显示 RM0.00，实际负值保留负号。
- 单店直接显示门店名称；多店保留 All your branches、View by branch 和各店目标／覆盖／归属提示。
- 团队保留三级累计里程碑、下一门槛进度和未分配金额，个人没有等级。桌面两栏，390px 单栏。
- 12个月改为轻量 SVG 共用真实金额比例；未设置最低柱高。负值在零线下，未来及待核对分别标识，不绘成已确认零值。无需新增图表依赖。
- 图表下提供44px月份按钮、键盘选月、View monthly figures 精确金额表格。柱状图坐标可缩写，表格和交易保留分币。
- 当前月明确 same period，历史月 full month；完整到秒的范围／经营时区放在 Period details。未来月不显示反向日期范围；零／负比较基期不产生虚假百分比。
- Transactions 显示个人或所选成员贡献，不替换为整单金额；真实长单号折叠显示，展开可完整查看。单页隐藏分页，多页仍用原服务分页／总数。
- 成员默认折叠，姓名／编号、贡献、年度目标进度直接可见；保留搜索、展开和 Back to team members，无排名排序变更。
- 底部仅更新时间及 How performance is calculated。保留键盘 focus、44px主要触摸控件和底部导航滚动余量。
- Staff 业绩组件内统一自然英文；未修改后台中文页面或全站语言。

## 3. 保持不变的契约

仍使用 `/api/employee-performance` 及 Phase 3 原 DTO；没有新增接口或查询范围。身份校验、scopeKey、请求取消、前台刷新、离线清空、权限检查、业务时区、数据完整性及年度目标服务均未更改。

金额仍为销售实收＋实收小费－对应退款、排除税。销售与小费独立归属；团队＝员工贡献＋未分配。目标及等级仅由原服务计算，本次辅助函数只负责显示格式和 SVG 几何。

真实 A／店长 `view=auto` 响应在优化前后逐项对比：除每次查询自然推进的 `asOf`、本期／对比期截止时刻外，金额、目标、成员、权限、范围、覆盖及详情一致。没有以视觉测试重新计算或写入业务汇总。

| 本次真实 UAT 页面 | 年度净业绩 | 本月 | 上月同期 | 差额／百分比 |
| --- | ---: | ---: | ---: | --- |
| 员工 A | RM49,950.00 | RM950.00 | RM49,000.00 | Down RM48,050.00 / 98.06% |
| 店长个人 | RM300,000.00 | RM1,000.00 | RM299,000.00 | Down RM298,000.00 / 99.67% |
| 团队 | RM600,000.00 | RM7,000.00 | RM593,000.00 | Down RM586,000.00 / 98.82% |

A 目标 RM50,000，99.9%，差 RM50；团队第一级已达，下一累计门槛 RM800,000，差 RM200,000。9月比较8月1–5日同期，具体截止时刻每次刷新更新。8月高柱保持真实测试比例，未修改测试数据使图表更均匀。

## 4. 实际验证

使用当前完整脏工作区副本，专用库 `127.0.0.1:5432/tetamu_performance_disposable_phase3_20260905_a`，没有读取仓库真实业务 `.env`。

### 命令及结果

1. `node scripts/verify-performance-uiux.mjs before`：修改前真实 A／店长首页、详情，390×844 与1440×1000截图及 DTO 基线。
2. `./node_modules/.bin/tsx --test tests/unit/staff-performance-display.test.ts tests/unit/staff-performance-route.test.ts tests/unit/staff-approval-navigation.test.ts tests/unit/performance-targets.test.ts tests/unit/performance-money.test.ts`：**31/31通过，0 skip，0 todo**。包含分币／负零、图表真实比例／负值／未知／未来、经营日期显示，以及原金额、目标、路由开关及审批导航定向回归。
3. 对本次 TSX、显示辅助函数、单元测试及两个测试脚本运行 `eslint`：退出码0。
4. 仅对3106执行 `node scripts/performance-user-uat.mjs stop`、`configure`、`build`、`start`。实际构建为 `npm run build` → `prisma generate && node scripts/guard-next-build.mjs && next build --webpack`；优化编译及内置 TypeScript 检查通过。`prisma generate` 只生成客户端，不是数据库迁移。
5. `node scripts/verify-performance-uiux.mjs after`：最终优化构建 **PASS**。

实际浏览器交互覆盖：年份、月份下拉、图表点击／键盘选月、12个月金额表、页签、breakdown、交易展开、刷新、未来月份、店长搜索／成员详情／返回。切换月份后年度累计仍不变。

真实 A 当月只有1页，分页整条隐藏。多页验证使用同一隔离库内**既有上一阶段 fixture**的20条分页，实际 Next 到2/2、Previous 回1/2，未增加交易。仅为该旧测试身份通过原 `createEmployeeSessionRecord` 创建一个本地测试会话，凭证放私有0600文件，不在报告、URL、截图或源码中。

补充状态验证采用**浏览器响应注入，非数据库交易**：待核对／未分配、无目标且零值、负净额、超目标与长单号、店长长姓名／长金额及全部三级已达。真实认证、页面组件及样式照常执行；这些注入截图明确以 `ui-injection-` 命名，不作为真实账目证据。

首页及详情各对两种身份注入503，实际 Retry 恢复成功。首页 Clock In 仍可用，Quick Actions 可见；A没有 Approvals，获授权店长保留 Approvals。底部计算说明经实际点击及中心点命中检查，可滚动到导航上方；交易／分页展开点击也通过。

最终正常流程 **console error=0、pageerror=0**。故障测试出现4条预期503控制台记录，单独标为 expected；没有其他错误。稳定构建未复现 `null.removeChild`，不声称修复了此前未确认的根因。

已有构建警告：Prisma package.json配置与 Next middleware 命名弃用提示；未扩展修改这些无关项。测试脚本初次用了错误的 Schedule 可访问名称及过宽的瞬态组件定位，已按实际 `Open Schedule` 和 Staff home 区域修正，最终通过；未弱化断言。

证据：[测试日志](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/unit-tests.log)、[构建／类型检查](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/build.log)、[最终浏览器记录](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/after/evidence.json)。

## 5. 真实截图：同身份、同数据前后对比

以下均来自真实页面，无设计图替代；截图不包含登录凭证。页面有内部滚动容器，首屏截图并不冒充整个详情，月度／交易／成员补充图独立提供。

| 页面 | 修改前 | 修改后 |
| --- | --- | --- |
| 员工首页390px | [Before](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/before/A-home-390.png) | [After](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/after/A-home-390.png) |
| 员工详情390px | [Before](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/before/A-detail-390.png) | [After](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/after/A-detail-390.png) |
| 店长首页390px | [Before](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/before/manager-home-390.png) | [After](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/after/manager-home-390.png) |
| 店长详情390px | [Before](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/before/manager-detail-390.png) | [After](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/after/manager-detail-390.png) |
| 员工详情1440px | [Before](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/before/A-detail-desktop.png) | [After](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/after/A-detail-desktop.png) |
| 店长详情1440px | [Before](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/before/manager-detail-desktop.png) | [After](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/after/manager-detail-desktop.png) |

补充：[月度图表与短比较](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/after/A-monthly-390.png)、[本人交易展开](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/after/A-transactions-390.png)、[店长成员列表](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/after/manager-members-390.png)、[既有测试记录真实分页](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uiux/after/existing-fixture-pagination-390.png)。

## 6. 工作区保护及修改清单

仓库 `/Users/innovdia/Development/carwashpro`；分支 `main`；HEAD `5f9b5b5f350d6ee3670f4d989b203776e6527544`。已阅读适用 AGENTS、Next本地 use-client 指引及原阶段／UAT实现，隔离会话核查限定专用库与既有身份。

基线为当前完整未提交工作区，不是仅HEAD。保存 `baseline-status.txt` 与 `source-baseline.tar`，对 **2169个已有文件**比较：只改动以下两个组件文件，**无删除**；原业务、Phase1/2/3服务、导航、POS及数据库模型文件保持逐字节不变。

| 文件 | 原因 |
| --- | --- |
| `src/components/staff-pwa/staff-performance.tsx` | 首页、年度／月度／明细和成员交互与自然英文文案 |
| `src/components/staff-pwa/staff-performance.module.css` | 仅业绩范围内的手机优先布局、两栏、图表、状态、焦点和安全区 |
| 新增 `src/components/staff-pwa/staff-performance-display.ts` | 纯显示格式／比例几何，不计算业务汇总 |
| 新增 `tests/unit/staff-performance-display.test.ts` | 金额显示、真实比例、日期和未知状态验证 |
| 新增 `scripts/verify-performance-uiux.mjs` | 真实前后截图、DTO对照、交互及明确标记的注入状态验证 |
| 新增 `scripts/prepare-performance-uiux-session.ts` | 仅已有隔离测试分页身份的安全会话恢复，无交易写入 |
| 本报告 | 交付记录 |

没有修改 `.env`、数据库模型、目标后台、POS、工资、佣金、奖金、导航或用户3000服务；没有提交、回退、种子重跑、付款、退款或目标发布操作。

## 7. 运行状态与未验证边界

- 3106：优化构建 `next start`，最终检查PID **85237**，监听 `127.0.0.1:3106`，保持运行。
- 3000：原PID **58129**仍监听；没有停止或重启。
- 原隔离开关及出站网络阻断保留；未启动通知worker、发送真实消息或调用支付通道。
- 停止／重启继续使用原「停止 UAT」／「启动 UAT」快捷方式；只停3106且不清数据。代码更新已经完成，用户刷新现有身份窗口即可。
- 未重复全量POS、财务数据库集成或生产验收；本次为显示层改动，金额／目标定向回归和真实API一致性验证已通过。
- 极端显示状态使用明确标记的响应注入，不宣称新建并验证了对应退款／调店业务。没有删除、skip或弱化既有测试。
- 实体iPhone/Safari、真实软键盘、手机HTTPS／登录、生产历史补齐、Paid-VOID及正式发布仍为独立后续条件。

完成本次优化后停止，不部署、不扩展模块，等待用户在3106试用反馈。
