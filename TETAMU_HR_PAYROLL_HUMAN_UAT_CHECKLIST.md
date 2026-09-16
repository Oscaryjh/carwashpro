# TETAMU HR/PAYROLL — HUMAN UAT CHECKLIST

- 日期：2026-09-17
- Human UAT 状态：`PENDING`
- 当前执行状态：`BLOCKED — Preview 尚未部署`
- Preview URL：`NOT ISSUED`
- 账号交接：`NOT CREATED`；部署成功后必须通过受限的安全交接位置提供，不在本文件记录密码或 OTP。

## 使用方式

1. 只在报告所列的独立 HR/Payroll UAT Preview URL 操作；不要使用 Desktop Testing、Staff Testing 或 Production。
2. 从安全交接位置取得与你负责角色对应的账号。不要把密码、OTP、session token 或员工资料贴到截图和备注中。
3. 按编号逐项执行；将“实际结果”写成你亲眼看到的行为。
4. 每项只勾选一个结果：`PASS` 或 `FAIL`。无法执行时保持未勾选并写明 blocker。
5. 失败时先保存截图、时间、页面 URL（不得含 token）和复现步骤，再填写严重度。
6. 严重度：`S1` 数据/权限/付款/法规安全；`S2` 核心流程无法完成；`S3` 有替代路径但体验明显受损；`S4` 文案或轻微视觉问题。

当前所有项目因 `PREVIEW_EXTERNAL_INTEGRATION_GUARD_MISSING` 尚未开放执行。下面的“实际结果”均预填为“未执行”，供新的已审核 RC 成功部署后由真人覆盖。

## 1. 新增员工

- 测试角色：HR Manager
- 前置条件：已登录 Preview；位于 synthetic business；有员工管理权限。
- 操作步骤：进入 People → 选择“Add employee” → 填写明显合成的姓名、员工编号和联系资料 → 保存。
- 预期结果：员工成功建立；资料页显示正确；没有要求真实身份证、银行账号或客户资料。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：
- Retest 状态：未开始

## 2. 设置 Branch

- 测试角色：HR Manager
- 前置条件：第 1 项员工已建立；Preview 至少有两个 synthetic branches。
- 操作步骤：打开员工资料 → 分配主 branch 与有效日期 → 保存 → 刷新页面。
- 预期结果：主 branch 正确显示；Branch Manager 的范围随后只包含获授权 branch。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：
- Retest 状态：未开始

## 3. 设置排班

- 测试角色：Supervisor
- 前置条件：员工已有 branch；测试日期尚未锁定。
- 操作步骤：进入 Roster → 选择 branch 和日期 → 为员工建立班次及休息时间 → 发布。
- 预期结果：班次保存并发布；Desktop 与 Staff 看到一致的日期、时间和 branch。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：
- Retest 状态：未开始

## 4. Staff 登录

- 测试角色：Staff
- 前置条件：使用 Preview-only synthetic 手机号；测试 OTP 机制已明确标记为 Preview，且不会发送真实 SMS123。
- 操作步骤：打开 `/staff/login` → 输入 synthetic 手机号 → 请求 OTP → 从安全测试交接机制取得一次性验证码 → 完成登录。
- 预期结果：只建立 Preview Staff session；页面不显示 OTP；没有真实短信发送或真实 provider 请求。
- 实际结果：未执行——Preview 缺少 production-build-safe Preview OTP guard。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：S1（若发生真实短信或跨环境会话）
- Retest 状态：未开始

## 5. Clock in / Clock out

- 测试角色：Staff
- 前置条件：已登录；当天有排班；设备为 synthetic UAT device。
- 操作步骤：进入 Attendance → 查看 GPS/clock 状态说明 → Clock in → 等待状态更新 → Clock out。
- 预期结果：每次操作有明确成功反馈；时间、branch 与设备状态正确；重复点击不会产生重复记录。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：
- Retest 状态：未开始

## 6. 制造迟到、早退与缺卡

- 测试角色：Staff、Supervisor
- 前置条件：synthetic fixture 已准备三种安全测试情形。
- 操作步骤：分别打开迟到、早退和缺卡日期 → 比较 Staff 提示与经理 Attendance/Exceptions 页面。
- 预期结果：三种情况清楚区分；不会自动伪造打卡；员工能理解下一步。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：
- Retest 状态：未开始

## 7. 经理处理 Exception

- 测试角色：HR Manager
- 前置条件：存在 synthetic missing-clock 或 late/early exception。
- 操作步骤：进入 Exceptions → 打开个案 → 查看原始资料和影响 → 选择允许的处理动作 → 填写理由 → 确认。
- 预期结果：动作前有原因、确认和影响说明；审计状态更新；其他员工资料不可见。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：
- Retest 状态：未开始

## 8. 员工申请 Leave

- 测试角色：Staff
- 前置条件：Leave 类型可用；测试期间未锁定。
- 操作步骤：进入 Leave → New request → 选择类型、日期和原因 → 提交。
- 预期结果：请求成功；余额/天数解释清楚；状态为待审批；不会误提交到其他 business。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：
- Retest 状态：未开始

## 9. 经理审批 Leave

- 测试角色：HR Manager
- 前置条件：第 8 项请求存在。
- 操作步骤：进入 Leave approvals → 打开请求 → 查看日期和证据要求 → Approve → 确认。
- 预期结果：审批成功并保留审计记录；Staff 状态同步；排班/工时影响说明正确。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：
- Retest 状态：未开始

## 10. 员工提交 Leave evidence

- 测试角色：Staff
- 前置条件：存在要求 evidence 的 synthetic Leave；使用无敏感资料的安全 fixture。
- 操作步骤：打开 Leave request → 上传测试 evidence → 提交 → 重新进入详情。
- 预期结果：上传状态与文件名称清楚；只能查看自己的 evidence；失败时给出可恢复提示。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：
- Retest 状态：未开始

## 11. OT request / approval

- 测试角色：Staff、Supervisor
- 前置条件：存在 potential OT；测试期未锁定。
- 操作步骤：Staff 查看并提交 OT → Supervisor 打开审批 → 查看依据 → Approve。
- 预期结果：potential 与 approved 状态明确；审批权限正确；approved hours 在 Staff 与 Payroll 一致。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：
- Retest 状态：未开始

## 12. Timesheet review

- 测试角色：Payroll Admin
- 前置条件：当期已有 roster、attendance、leave、correction 和 approved OT。
- 操作步骤：进入 Timesheet → 选择员工和期间 → 检查每天明细与总计 → 查看异常解释。
- 预期结果：工时、Leave、OT 和修正可追溯；没有静默覆盖资料。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：
- Retest 状态：未开始

## 13. Timesheet lock

- 测试角色：Payroll Admin
- 前置条件：第 12 项已核对；测试期允许锁定。
- 操作步骤：选择 Lock → 阅读影响说明 → 确认 → 尝试修改已锁明细。
- 预期结果：锁定成功；高风险影响清楚；锁定后不允许未授权修改。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：S1（若可绕过锁定）
- Retest 状态：未开始

## 14. 创建 Payroll

- 测试角色：Payroll Admin
- 前置条件：Timesheet 已锁；期间没有重复 active payroll run。
- 操作步骤：进入 Payroll workspace → New run → 选择期间和 branch → 创建。
- 预期结果：只建立一个 run；状态和下一步清楚；不会包含未授权 branch。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：
- Retest 状态：未开始

## 15. Recurring / Variable / Correction

- 测试角色：Payroll Admin
- 前置条件：第 14 项 run 为可编辑状态；fixture 包含三类 component。
- 操作步骤：打开 run → 检查 recurring pay → 新增或检查 variable pay → 检查 correction → 保存。
- 预期结果：三类 component 清楚区分；金额、来源、备注和审计资料正确。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：
- Retest 状态：未开始

## 16. 检查 Gross / Net / Components

- 测试角色：Payroll Admin、HR Manager（只读）
- 前置条件：Payroll 已计算。
- 操作步骤：比较员工 component 明细、gross、deduction 和 net → 使用 Reconciliation 查看差异。
- 预期结果：加总一致；只读角色不能修改；未知或受限 statutory 项目保持 blocked/review required。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：
- Retest 状态：未开始

## 17. Finalize

- 测试角色：Payroll Admin
- 前置条件：run 满足所有允许的 readiness gate；payment/statutory/PCB 仍受限。
- 操作步骤：选择 Finalize → 阅读不可逆影响 → 确认身份/理由 → 完成。
- 预期结果：run 进入 finalized/locked；未经授权不能执行；Finalize 不等于 paid 或政府提交。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：S1（若自动付款/提交或权限绕过）
- Retest 状态：未开始

## 18. Publish payslip

- 测试角色：Payroll Admin
- 前置条件：Payroll finalized；synthetic Staff 有可发布 payslip。
- 操作步骤：打开 Payslips → 选择员工 → Publish → 确认。
- 预期结果：发布成功；发布日期和期间正确；不会执行银行或 statutory 操作。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：
- Retest 状态：未开始

## 19. Staff 查看自己的 Payslip

- 测试角色：Staff
- 前置条件：第 18 项已发布；Staff session 有效。
- 操作步骤：进入 Pay → Payslips → 打开当前及历史期间 → 查看/下载自己的 payslip。
- 预期结果：只显示自己的资料；gross、net 与 components 解释清楚；移动端可读。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：
- Retest 状态：未开始

## 20. 其他员工 Payslip 必须被拒绝

- 测试角色：Staff
- 前置条件：已安全取得另一 synthetic 员工的 payslip deep-link ID，不把 ID 写入公开备注。
- 操作步骤：在 Staff session 中打开另一员工 deep link。
- 预期结果：返回 404 或明确拒绝；没有姓名、金额、文件或 metadata 泄漏。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：S1
- Retest 状态：未开始

## 21. Reopen 控制

- 测试角色：Payroll Admin、HR Manager
- 前置条件：存在 finalized run；准备业务理由。
- 操作步骤：Payroll Admin 尝试 Reopen 并确认影响 → HR Manager 只读账号尝试相同 deep link。
- 预期结果：只有获授权角色可 Reopen；必须说明原因和影响；只读角色被拒绝。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：S1（若只读角色可修改）
- Retest 状态：未开始

## 22. Branch scope

- 测试角色：Branch Manager
- 前置条件：账号只授权给一个 synthetic branch；另一个 branch 有员工资料。
- 操作步骤：查看 People、Attendance、Roster、Leave → 尝试筛选和 deep-link 到另一 branch。
- 预期结果：只显示授权 branch；跨 branch deep link 被拒绝；Payroll 不可见。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：S1
- Retest 状态：未开始

## 23. Group Manager 限制

- 测试角色：Group Manager
- 前置条件：账号只获 selected-business 读取范围。
- 操作步骤：查看允许的 business → 尝试 Payroll mutation、bank payment、statutory 和直接 URL。
- 预期结果：获授权读取可用；bank/statutory/mutation 全部拒绝；URL 不能绕过。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：S1
- Retest 状态：未开始

## 24. Bank / Statutory / PCB 保持不可执行

- 测试角色：Business Owner、Payroll Admin
- 前置条件：使用 synthetic finalized payroll；所有 Preview restricted flags 为关闭。
- 操作步骤：打开 Payment、Statutory 与 PCB 页面 → 尝试所有可见 CTA 和 deep link；不要输入真实银行或政府资料。
- 预期结果：不能执行付款、不能标记 paid、不能产生官方提交、不能启用 PCB Production；页面说明原因和影响。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：S1
- Retest 状态：未开始

## 25. Mobile 390 / 360 流程

- 测试角色：HR Manager、Payroll Admin、Staff
- 前置条件：分别使用 390px 和 360px viewport；浏览器缩放 100%。
- 操作步骤：检查 People、Payroll Run、Payment blocked、Staff Home、Staff Payslip、Staff date picker；使用键盘与触控完成主要动作。
- 预期结果：无横向溢出或重要截断；table 转 card；modal/drawer 不越界；sticky action 不遮挡；tap target、focus、label、对比度、loading/empty/error/restricted/locked 状态可用。
- 实际结果：未执行——Preview 尚未部署。
- 结果：☐ PASS ☐ FAIL
- 截图/备注：
- Bug severity：
- Retest 状态：未开始

## 签署

- UAT 执行人：
- 执行日期：
- 已完成项目数：0 / 25
- PASS：0
- FAIL：0
- BLOCKED：25
- 是否允许进入下一阶段：否；必须先解决 Preview 安全 guard 并由新 RC 完成隔离部署和自动 smoke。
