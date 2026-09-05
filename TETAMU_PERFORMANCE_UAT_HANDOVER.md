# 个人与团队业绩：可交互 UAT 交付

日期：2026-09-05，经营时区 Asia/Kuching。

状态：**DESKTOP_READY_MOBILE_PENDING**。电脑端真实页面、独立登录、测试数据及优化构建已准备；实体手机缺少可信 HTTPS 与安全测试登录条件。不是生产部署。

## 1. 现在如何试用

已打开 Finder「试用入口」文件夹，以及老板、店长和员工 A 的独立 Chrome 窗口。

文件夹：[试用入口](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uat/试用入口)。双击其中的 `.command` 文件即可，不需要输入 SQL、密码、OTP 或复杂命令。

| 快捷方式 | 打开的真实页面／身份 |
| --- | --- |
| 01 老板 Owner | 正常老板密码登录，然后进入后台年度目标设置 |
| 02 店长 Manager | Staff 首页，团队业绩及获授权的本店成员 |
| 03 员工 A | Staff 首页，A 本人及团队汇总 |
| 04 员工 B | Staff 首页，B 本人及团队汇总 |
| 05 员工 C | Staff 首页，C 本人及团队汇总 |
| 06 POS 服务结账 | 老板登录，进入已准备、尚未付款的 UAT 服务预约结账 |
| 启动 UAT | 启动已有优化构建，不重新添加交易 |
| 停止 UAT | 仅停止本次 3106 服务，保留数据库与数据 |

每个身份使用独立测试浏览器上下文，不与日常浏览器或 3000 的登录混用。关闭某个测试浏览器后重新双击即可恢复；会话过期／主动退出也使用同一个快捷方式重新打开。不要尝试给测试手机号发送 OTP。

地址均只在当前电脑有效：

- 后台：[年度目标设置](http://127.0.0.1:3106/team/performance?tab=targets&year=2026&month=9)。
- Staff：[首页](http://127.0.0.1:3106/staff)、[业绩详情](http://127.0.0.1:3106/staff/performance)。
- 本次未收款服务预约：[POS 结账](http://127.0.0.1:3106/cashier?appointmentId=36fbf539-ed1c-494f-af5c-e5e5bd257c55)。

**链接本身不带登录凭证。** 从其他浏览器直接打开会要求登录；推荐使用上表快捷方式。在已有测试身份窗口内导航／粘贴同一地址才会沿用该身份。

## 2. 环境与安全隔离

| 项目 | 实际值 |
| --- | --- |
| 服务 | `http://127.0.0.1:3106`，只绑定 loopback |
| 优化构建运行目录 | `/Users/innovdia/.codex/local-uat/tetamu-performance-20260905/runtime` |
| 数据库 | `127.0.0.1:5432/tetamu_performance_disposable_phase3_20260905_a` |
| 数据库连接标识 | `tetamu_performance_user_uat`；通过数据库 `current_database()` 等实查确认 |
| 新商家 | `UAT TEST ONLY · Performance Salon` |
| 新门店 | `UAT ONLY · Test Salon` |
| 页面标识 | 商家／门店名称中固定显示 UAT TEST ONLY，Staff 首页及后台真实截图可见 |
| 环境 | `TETAMU_ENVIRONMENT=TESTING`、`APP_ENVIRONMENT=testing` |
| 开关 | `TETAMU_PERFORMANCE_PHASE1=true`、`TETAMU_PERFORMANCE_PHASE2=true`、`TETAMU_STAFF_PERFORMANCE=true` |

复用上一阶段专用数据库，**未清空旧商家或旧 fixture**。本次新增独立商家／门店，不使用真实员工或客户资料。未执行迁移、生产查询、生产回填或部署。

运行配置单独保存在当前用户的私有目录（目录0700、配置／会话文件0600）。没有继承真实 `.env`，没有真实支付、短信、邮件、WhatsApp 凭证；SMS 配置仅为不可用占位值，用于现有会话配置校验。没有通知 worker。UAT Node 进程额外阻断外部 fetch/TCP，测试浏览器也限制为该本机地址；阻断测试在建立外部连接之前失败。

老板走应用现有密码登录；员工走 `createEmployeeSessionRecord` 签发真实隔离数据库会话，由本机操作脚本注入独立浏览器。**没有新增 HTTP 登录后门、生产 OTP 绕过、虚拟 owner 或修改 SMS123 登录流程。** 签名密钥、密码、cookie/token 不在本报告、URL、截图或源码中。

老板测试账号为 `owner.performance.uat@tetamu.test`，密码由本机随机生成并由快捷方式安全读取，无需手工输入。店长与 A/B/C 用独立 Staff 会话；六位普通员工均没有后台 User。店长明确具有 `PERFORMANCE_VIEW_TEAM`，没有 `PERFORMANCE_MANAGE_TARGETS`；另明确授予原有 `APPROVE_LEAVE` 以检查 Approvals 保留，它不负责授予业绩权限。

仅为新 UAT 商家启用 POS、INVENTORY、SALON、HR、PAYROLL，以保留原 Home / Time / Pay / Profile 及管理者 Approvals 导航。没有新增工资、佣金、小费发放或奖金记录，也没有把 Payroll 设为业绩使用前提。

## 3. 准确基线

以下是用户手动 RM118 收款**之前**的 2026 年数据，全部为 RM。

| 对象 | 年度目标 | 已归属销售 | 小费 | 退款 | 年度净业绩 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 店长 UAT-MGR | 300,000.00 | 300,000.00 | 0.00 | 0.00 | 300,000.00 |
| A / UAT-A | 50,000.00 | 49,950.00 | 0.00 | 0.00 | 49,950.00 |
| B / UAT-B | 50,000.00 | 49,950.00 | 0.00 | 0.00 | 49,950.00 |
| C / UAT-C | 50,000.00 | 50,000.00 | 100.00 | 0.00 | 50,100.00 |
| D / UAT-D | 50,000.00 | 50,000.00 | 0.00 | 0.00 | 50,000.00 |
| E / UAT-E | 50,000.00 | 50,000.00 | 0.00 | 0.00 | 50,000.00 |
| F / UAT-F | 50,000.00 | 50,000.00 | 0.00 | 0.00 | 50,000.00 |
| 团队 | 第一级600,000.00 | 599,900.00 | 100.00 | 0.00 | **600,000.00** |

团队第二／三级：800,000.00／1,000,000.00；个人合计目标600,000.00，分配差额0。当前团队第一级，下一门槛差额200,000.00；A/B各99.9%，C100.2%。个人没有等级。

13笔 Payment、13份对应捕获来源、0笔退款；原始收款600,152.00，税152.00不计入。团队600,000.00＝七名员工合计600,000.00＋未分配0。核查 `COMPLETE`，未捕获0、待核对0、未分配0。

数据由完整 Invoice／InvoiceItem／Payment 及 `capturePerformanceCheckout` 在事务内建立，金额不是直接写入汇总表。七笔上月收款在8月1日经营时间00:00:01；六笔本月收款在9月1日00:00:01，其中一笔是销售1,900＋税152＋小费100，销售A/B各50%，小费归C。目标经 `previewTargets`／`publishTargets` 正常保存第1版及审计。

## 4. 月份比较

基线核查示例截止 **2026-09-05 22:20:37 Asia/Kuching**，页面每次刷新采用当前截止时间，不冻结为本报告时间。

- 本月：2026-09-01 00:00 → 当前统计截止时刻。
- 上月同期：2026-08-01 00:00 → 2026-08-05 相同时刻；页面显示具体范围。
- 选择8月时：8月整月对7月整月。7月完整无交易为0，百分比不适用，不显示无限增长。

| 对象 | 9月基线 | 8月同期 | 金额差 | 百分比（显示四舍五入） |
| --- | ---: | ---: | ---: | ---: |
| 团队 | 7,000.00 | 593,000.00 | −586,000.00 | −98.82% |
| 店长 | 1,000.00 | 299,000.00 | −298,000.00 | −99.67% |
| A | 950.00 | 49,000.00 | −48,050.00 | −98.06% |
| B | 950.00 | 49,000.00 | −48,050.00 | −98.06% |
| C | 1,100.00 | 49,000.00 | −47,900.00 | −97.76% |

这是刻意让年度目标临界状态和月度对比都可见的合成数据，不是真实商家的经营表现。

## 5. 八步试用清单

1. 双击 **01 老板 Owner**，在目标设置确认三级600k／800k／1m，店长300k＋6×50k＝600k，差额0。
2. 双击店长及A/B/C快捷方式，记录上表年度基线；各窗口保持独立。
3. 双击 **06 POS 服务结账**。已准备的服务原价RM100、SST8%=RM8；它只是完成服务、**尚未开出付款发票**的测试预约。点击 `Payment · RM108.00`。
   - 原 Service & sales staff 是服务／佣金字段，保留 UAT Owner，不用它替代业绩分配。
   - 在 `Sales attribution` 选 `Multiple employees`，选 A、B，点 `Split equally`，确认各50%。
   - `Tip amount` 填10；独立 `Search tip recipient` 搜UAT-C，并选C。
   - 付款方式Cash，点 `Exact RM118.00`，核对销售100＋税8＋小费10，最后才点 **Confirm payment · RM118.00**。本次准备工作没有点击这个确认按钮。
4. 刷新A/B/C和店长窗口（或点击详情刷新）：A变50,000，B变50,000，C变50,110，团队变600,110。税8不计业绩；A/B增加50，C只增加小费10。
5. 店长进入团队详情，搜索UAT-A、展开成员，查看本店贡献；普通员工只有自己明细及团队汇总，没有其他成员列表。
6. 切换9月和8月，查看同期／整月标签、范围及金额差；8月对7月零基期百分比不适用。
7. 老板把第一级从600,000改为610,000（仍小于800,000），个人金额不改。填修改原因，明确勾选保留10,000分配差额，预览后发布。团队实际金额不变，等级应回到尚未达到第一级，完成率按610,000重算，所有个人目标保持原值。
8. 可选：在老板窗口通过实际订单／收款详情，对刚才新产生的RM118 **付款发起全额退款**并填写测试原因；不要选择 VOID。退款应分别冲减A50、B50、C10，团队回到600,000、A/B49,950、C50,100。若第7步已改目标，退款只恢复金额，不恢复旧目标版本。可再正常发布目标600,000作为新版本。

如果收款报错，保留当前窗口与输入并反馈错误，不重复点击多次；先在订单／收款记录核对是否已成功。第二天使用时若提示班次到期，按原界面结束／开启测试班次，再继续，不需要SQL。

## 6. 登录与手机验证边界

电脑已验证：老板正常密码登录、A/B/C真实Staff会话、店长真实Staff会话；这些账户／会话与测试商家对应。实际有头 Chrome 窗口已打开，非仅 Playwright 无头截图。快捷方式再次执行只更新本机测试会话，不自动再次收款或覆盖目标。

手机尚不可交付为可登录入口：

- `127.0.0.1` 在手机上代表手机本身，不是这台Mac；当前服务只监听Mac loopback。
- 未发现已配置的本机可信HTTPS测试入口（本次检查443／8443无监听），没有创建公开隧道、开放数据库或关闭认证。
- 仅改成局域网HTTP地址也不等同可用：优化构建的Secure Cookie、PWA／GPS安全上下文及独立Staff登录都需要核对。本次没有放宽这些规则。
- 普通Staff没有后台密码，生产构建不允许mock OTP；本机注入的测试浏览器会话不会自动出现在手机上。未发送真实OTP，未设置固定验证码。
- 最小后续条件：手机可达且可信的HTTPS测试入口，加上明确授权、仅限隔离环境的安全Staff测试登录途径。没有这些条件，不声称实体手机已能试用。

**电脑端已验证，实体手机待用户检查且须先满足以上访问／登录条件。** 390px Chrome仅证明手机尺寸布局，不是实体iPhone、Safari、软键盘或GPS验收。

## 7. 实际验证和问题记录

- 使用完整脏工作区复制的应用源码，`npm run build` 的优化Webpack构建及类型检查通过，`next start` 启动；无HMR。补齐图片路由后再次构建并复验。
- `tsc --noEmit --pretty false --incremental false` 通过；本次新增脚本定向ESLint通过。
- 真实浏览器必要冒烟通过：目标值、桌面／390px、服务预约POS弹窗、A/B50%与C小费、现金118确认按钮可用但未提交、员工与店长首页位置／导航、月份、搜索展开。最终正常流程console error=0、pageerror=0。
- Payment数量前后13，RM118付款0、退款0，目标版本1，预约没有invoice，确保没有提前执行用户手动用例。
- 数据库身份、6名普通员工无User、店长无目标管理权限、完整基线均实查；服务停止／启动快捷方式已实际验证，只操作3106，原3000进程未停止。
- 准备脚本最初缺少Customer必填测试电话，数据库事务回滚后补齐合成值；没有残留半套初始交易。首次浏览器尝试直接服务购物车触发现有预约要求，改用合法未付款预约，不修改POS规则。
- 复制排除规则最初也匹配了源码里的uploads路由，已改为仅排除根目录运行资料，补齐全部`src`并重建。误复制的两份`.local-postgres`物理目录已从**本次副本内**清理；原始目录没有删除，也不将运行中的物理拷贝当数据库备份。测试数据仍在原专用数据库中。
- **新增UAT反馈：后台业绩页面中文／中英混用，与原英文界面不一致。** 已确认文字直接写在Phase2源码，例如`src/app/(business)/team/performance/page.tsx`，不是浏览器自动翻译或全站语言设置改变。本次未擅自进行语言改版，等待用户指示统一英文。
- RM118真正收款、退款以及修改目标的最终操作留给用户，本次不声称已代替用户完成。生产、真实支付／OTP、Paid-VOID历史处理仍不在此次验收范围。

证据目录：[performance-uat](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uat)。关键文件：`build.log`、`build-stderr.log`、`typecheck.log`、`lint.log`、`smoke.json`、`database-verification.json`、`workspace-protection.json`、`server.log`、`desktop-browser.log`。早期`smoke-failure*`仅保留诊断，不是最终结果。

真实独立截图：[普通员工390px首页](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uat/employee-home-390.png)、[店长390px首页](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uat/manager-home-390.png)、[老板目标设置](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uat/owner-targets-desktop.png)、[POS分配390px](/Users/innovdia/Documents/Codex/2026-09-03/bang/outputs/performance-uat/owner-pos-attribution-390.png)。员工与店长首页亦在最终回复作为图片附件展示，不用设计图替代。

## 8. 保护、重启和重复执行

仓库 `/Users/innovdia/Development/carwashpro`，main，HEAD `5f9b5b5f350d6ee3670f4d989b203776e6527544`。已读AGENTS及Phase3报告，使用Postgres最佳实践限定本次fixture事务／商家范围。保护核对纳入2,158个已有源码文件，0改动，运行副本全部`src`与工作区逐字节一致；`.env*`和运行数据库目录不属于源码保护快照。没有回退、提交、变更原功能或删除用户文件。

本次仅新增UAT脚本与本报告：

- `scripts/prepare-performance-user-uat.ts`：精确限定本机专用库，独立商家、13笔基线、目标发布、待付款服务预约、本机测试会话。
- `scripts/performance-user-uat.mjs`：私有配置、复制／优化构建、受限启动停止、角色快捷方式。
- `scripts/performance-user-uat-browser.mjs`：独立可交互Chrome、真实冒烟与截图；不提交RM118。
- `scripts/performance-user-uat-network-guard.mjs`：仅UAT进程外部网络阻断。
- `scripts/verify-performance-user-uat.mjs`：只读专用库和源码保护核对。

日常操作：双击「停止 UAT」停止；双击「启动 UAT」或任一角色快捷方式重新启动。关闭浏览器不会停止服务。电脑休眠／关机期间不可访问；重启后用快捷方式恢复，前提是本机原PostgreSQL服务仍运行。遇到数据库不可用提示请反馈，不需要自行执行SQL。

准备脚本固定使用本次商家slug；已存在时不添加基线Payment、不覆盖已有目标、不重建已付款预约。会话恢复会签发新会话，不重写旧不可变业绩。初始`baseline.json`仅首次写入，后续`current.json`记录当前读取值；它们在私有运行目录，报告不包含任何session token。源码／账目核验脚本的13笔断言仅适用于用户开始手动收款之前，之后不应用它把新增合法测试交易当故障或自动重置。

技术复核命令（用户试用无需执行）：`node scripts/performance-user-uat.mjs build / seed / start / smoke / verify / stop / open <role>`，每次只选一个子命令。`build`要求先停止UAT；`configure`不用于日常启动，禁止在运行期间覆盖副本。

交付时3106测试服务保持运行，停止后数据库可继续保留。此后等待用户试用反馈，不自动部署、生产迁移、生产回填或扩展模块。
