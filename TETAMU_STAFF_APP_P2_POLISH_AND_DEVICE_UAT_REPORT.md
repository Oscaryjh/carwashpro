# TETAMU STAFF APP — P2 POLISH & DEVICE UAT REPORT

日期：2026-08-29  
Canonical runtime：`C:\CodexTetamuP0` / port 3000  
范围：Local / Testing only

## 1. FINAL VERDICT

**GOOD WITH DEVICE UAT PENDING**

Staff App 现有五入口架构、canonical backend 边界与主要员工任务没有被扩大或重做。本轮完成 P2 文案、信息层级、证据要求提示、单分店筛选、薪资与设备用语，以及 SALON appointments 的本地 authenticated fixture 和浏览器级移动 UAT。

结论：**适合扩大 Local / Testing UAT**。尚不能当作真实设备最终签核，因为没有在实体 iPhone、实体 Android、原生软键盘和系统 Large Text 下执行。

## 2. HOME

**Before：**欢迎卡重复显示当前 workplace/business/branch，员工在首屏看到相同店名多次。

**Changes：**

- 欢迎卡只保留员工姓名、日期与当前工作状态。
- 当前 workplace 继续由顶部唯一 workplace switcher 表达。
- Clock In / Out、今日排班、下一预约与 quick access 的优先级不变。
- Primary navigation 保持 `Home / Time / Requests / Pay / Profile`。

**Result：**首屏层级更清楚，没有增加入口或卡片；390px 与 412px 没有横向溢出。

## 3. TIMESHEET

**Month context：**页面明确显示当前月份，例如 `August 2026`。

**Action status：**以员工能理解的状态显示 `Action needed`、`Waiting for manager`、`Final` 或 `Up to date`。

**Copy：**摘要改为 `RESULT / WHY / NEXT ACTION`，隐藏 snapshot、materialization、final attendance result 等内部术语；每日记录明确标为 `Final`。OT 仍说明来自 Attendance 结果，不创造员工 OT 申请流程。

**Result：**员工可先理解月份、结果、原因和下一步；canonical timesheet reader、Attendance 与 Payroll 边界没有改变。

## 4. LEAVE

**Evidence：**选择 leave type 后立即说明 supporting document 是 required 或 optional；optional evidence 使用折叠式渐进披露，required evidence 保持展开。

**Leave type：**员工只看到友好 leave 名称与 Paid / Unpaid，不显示内部 policy code 或 readiness 字眼。

**Mobile：**日期使用既有移动 date picker；返回按钮达到 44×44px；日期统一为 `DD MMM YYYY`。390px 键盘模拟时 Reason 输入框可自动滚入可见区域。

**Result：**申请前即可理解假别与附件要求，没有改变 leave policy、审批或 Payroll handoff。

## 5. CLAIMS

**Receipt rule：**在 Step 1 选择 category 后即显示 receipt required / optional。

**Amount guidance：**同一处提前显示 category limit 或 `No category amount limit`。

**Confirmation：**成功文案包含金额、category、日期与下一步 `Waiting for review`。

**Result：**保留既有三步骤；审批与付款仍明确分离。浏览器 UAT 走到 Review step，但没有创建额外 claim，以避免无必要的持久化测试数据。

## 6. ATTENDANCE HISTORY

**Single-branch filter：**只有一个可用 branch 时自动使用该 branch，并隐藏多余 Branch filter；多个 branch 时仍保留选择器；零 branch 时 fail-safe，不猜测 scope。

**Date consistency：**shift 与历史日期统一为 `DD MMM YYYY`；单页结果不再显示无意义分页。

**Result：**单店员工少一个无效选择，多店与 server-derived scope 行为不变。

## 7. PAY

**Payslip copy：**员工端从 `published` 改为 `available`，空状态为 `Not available yet`。

**Commission copy：**明确 commission 是独立 earnings statement；approved amount 不等于已经进入当前 payslip。

**Result：**Gross / Deductions / Net 与 payslip reader 没有改变，只精简员工用语并强化 Payroll 边界。

## 8. PROFILE

**Device copy：**设备区改为 `THIS PHONE / Signed in / This phone / Last active`，技术 metadata 收进 `About this phone` 折叠区；换手机提示重新 OTP 验证。

**Avatar：**沿用 canonical employee avatar upload、atomic replacement 与安全文件名检查；本轮未建立第二套头像状态。

**Result：**普通员工先看到当前手机是否登录，技术详情仍可查但不抢主层级。

## 9. APPROVAL CENTER

**Detail hierarchy：**Leave 按 type、dates、duration、reason、balances 排列；Claims 按 amount、submitted date、purpose、reference 排列；evidence 继续放在较深层。

**Mobile：**390px manager persona 下无横向溢出、无小于 44px 的主要触控目标，固定导航完整可见。

**Result：**Leave / Claims detail 更符合经理决策顺序，canonical review service、自审限制、tenant/branch/capability guard 均未改变。

**Deferred finding：**Approval Center 的统一 `Attendance` 数量会包含 P2 exception、resolution case、潜在 OT 与 monthly timesheet task；`Attendance corrections` 手机页面只处理 manager correction queue 与 pending exception 的子集。本地 fixture 出现 `2 pending` 对 `0 waiting`。这不是单纯 UI 数字错误，直接硬改会改变 unified canonical approval 口径，因此本轮记录为架构决定项，不创建第二套状态或重复 workflow。

## 10. APPOINTMENTS SALON UAT

**Fixture：**新增 local-only `scripts/prepare-staff-p2-salon-uat.ts`。fixture 包含：

- exact membership-linked User；
- 3 个只分配给当前员工的 appointment；
- 长客户名、长服务名、多服务组合；
- 今天有预约与隔天空白日；
- 一个 outside published shift warning；
- 私密电话与备注作为防泄漏验证数据。

**390px：**今天显示 3 bookings，week strip、前后日期、展开详情、长文字和 warning 均无横向溢出；空白日显示可理解 empty state。

**Privacy：**投影验证不会把客户电话或私密备注送到 Staff App；缺少 exact canonical mapping 时仍 fail closed。

**Result：**fixture 投影验证通过，3/3 可见，privacy projection 通过；appointments 保持 read-only，不影响 Attendance 或 Payroll。

## 11. MOBILE 390

配置视口：390×844（浏览器报告 CSS viewport 391px）。

通过页面：Home、Appointments、Schedule、Attendance History、Timesheet、Requests、Leave、New Leave、Claims、Pay、Payslips、Commission、Profile，以及 manager Approval Center / Attendance corrections。

结果：

- 所有已测页面 `horizontalOverflow = false`。
- 固定 bottom navigation 贴合 viewport 底部且不被裁切。
- 无页面 error/alert；最终控制台无 error/warn。
- 主要操作触控尺寸通过；New Leave 返回按钮修正后复验通过。
- New Leave 是独立任务页，按设计不显示 primary bottom navigation。

## 12. MOBILE 412

配置视口：412×915。

结果：同一组员工页面全部无横向溢出、无小于 44px 的主要触控目标、导航完整贴底、没有页面错误。长客户名、长服务名、Leave/Claims 表单与 Pay/Profile 均正常换行。

## 13. KEYBOARD

执行浏览器级软键盘空间模拟：将 viewport 高度缩至 520px。

- Leave Reason：聚焦后 shell 自动滚动，active field 完整可见。
- Claim Amount：active number input 完整可见，页面仍可滚动，无横向溢出。

限制：这不是 iOS/Android 原生键盘，不能代替实体机的键盘、日期 picker、safe-area 与浏览器 toolbar 测试。

## 14. REAL IPHONE

**NOT EXECUTED / PENDING OWNER DEVICE UAT**

本轮没有可控制的实体 iPhone。390×844 与 412×915 浏览器 UAT 不能被宣称为真实 iPhone 通过。

建议实机复验：Add to Home、safe-area、原生 date picker、相机/文件上传、键盘遮挡、头像替换、Clock In GPS permission、后台恢复。

## 15. REAL ANDROID

**NOT EXECUTED / PENDING OWNER DEVICE UAT**

本轮没有可控制的实体 Android。建议在 Chrome/PWA 复验安装提示、相机/文件 chooser、定位授权、返回键、键盘与离线恢复。

## 16. ACCESSIBILITY / LARGE TEXT

已验证：

- 主要动作有可读文字，不只依赖颜色。
- status 同时有文字与视觉样式。
- 主要触控目标在 390/412 页面级检查达到 44px。
- 表单有 label、错误/状态区域，页面层级以 heading/section 组织。
- 长姓名、长服务名与长说明可换行且无横向溢出。

未验证：实体机 VoiceOver/TalkBack、系统 Large Text/Dynamic Type、200% browser zoom、外接键盘完整 focus order。最终 accessibility device sign-off 仍待完成。

## 17. CHANGES IMPLEMENTED

- `src/components/staff-pwa/staff-home-overview.tsx`：移除欢迎卡重复 workplace 文案。
- `src/app/staff/timesheet/page.tsx`、`src/app/staff/staff.css`：月份、状态与 Result/Why/Next Action 层级。
- `src/components/staff-pwa/staff-leave.tsx`、`staff-leave.module.css`：友好 leave 名称、证据规则前置、optional 折叠与 44px back target。
- `src/components/staff-pwa/staff-claims.tsx`、`staff-claims.module.css`：receipt/limit 前置、成功下一步与兼容 UUID。
- `src/components/staff-pwa/staff-history.tsx`：单 branch 隐藏、多 branch 保留、日期与分页精简。
- `src/app/staff/pay/page.tsx`、`payslips/page.tsx`、`commission/page.tsx`：员工化 Pay copy。
- `src/components/staff-pwa/staff-profile.tsx`：当前手机与登录状态 copy。
- `src/app/staff/approvals/[domain]/[requestId]/page.tsx`：审批 detail fact hierarchy。
- `scripts/prepare-staff-p2-salon-uat.ts`：local-only SALON appointments fixture 与 privacy/mapping 验证。
- `tests/unit/staff-pwa.test.ts`：P2 presentation contracts。

没有新增 schema、migration、role、permission、approval state、Payroll rule 或 Attendance pipeline。

## 18. DEFERRED ITEMS

- 实体 iPhone UAT。
- 实体 Android UAT。
- 原生键盘、原生 date picker、camera/file chooser、GPS permission 与 PWA install UAT。
- 系统 Large Text、VoiceOver 与 TalkBack。
- Approval Center unified Attendance count 与 mobile correction queue 的产品/架构口径统一。
- 不新增 OT self-service，不新增 Requests/Approvals 页面，不重做 Payroll/Attendance。

## 19. TEST RESULTS

| Gate | Result |
|---|---|
| Unit | **1323 / 1323 PASS** |
| Integration | **199 / 199 protected disposable PASS**；isolated Attendance route flow **1 / 1 PASS** |
| Staff/security | **91 / 91 PASS** |
| Attendance/Approval | **56 / 56 targeted PASS**；并包含在 Staff/security 与 full unit regression |
| TypeScript | `npx tsc --noEmit` **PASS** |
| ESLint | `npm run lint` **PASS**，0 errors；3 个与本轮无关的既有 warnings |
| Prisma | schema validate **PASS** |
| Migration status | canonical local DB **212 / 212 migrations applied；up to date** |
| Build | `npm run build` **PASS**，Next.js 16.3.0 webpack production build，全部 canonical `/staff` routes 编译成功 |
| Runtime | `https://localhost:3000/staff/login` **HTTP 200**；Staff UI title/content present；`/staff/manifest.webmanifest` **HTTP 200**；port 3100 **not listening** |

说明：Prisma CLI 初次在未加载 `.env.local` 时提示 `DATABASE_URL` 缺失；以 Node `--env-file=.env.local` 明确加载 canonical local 环境后 validate/status 均通过。Build 初次受 Windows 本地 Prisma DLL 文件锁影响；停止已识别的本工作区 dev supervisor 后完整 `npm run build` 通过，随后已恢复 port 3000 local dev runtime。

## 20. FINAL STAFF APP PRODUCT STATUS

Staff App 已适合更广泛的 **Local / Testing UAT**：核心员工任务、五入口 IA、SALON appointments、Leave/Claims 表单、Pay/Profile 与 manager approval detail 在浏览器级 390/412 视口下清楚、稳定且无横向溢出。

它还不是实体设备最终签核，也不是 Production deployment approval。扩大 UAT 时应优先完成第 14–16 节的实机项目，并决定 Approval Center Attendance 统计口径。

## 21. 3100 STATUS

**REFERENCE ONLY / READY TO RETIRE**

本轮没有读取为 runtime、没有改动、没有启动，也没有把任何 3100 redirect/依赖重新引入 canonical Staff App。Port 3100 runtime smoke 为 not listening。

## 22. PRODUCTION STATUS

**LOCAL / TESTING ONLY**  
**PRODUCTION NOT ACCESSED**  
**PRODUCTION NOT MODIFIED**

本轮没有 Production login、Production database query、Production mutation 或 deployment。
