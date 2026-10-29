# GitHub Release Gate 实施计划

目标：实现仅验证、不部署的默认拒绝门禁。需求来源：本次 Phase 4B 用户指令。

约束：基准 22c6f7795068d7636d2c04563279227e7fd4bfd6；独立开发分支；不 Push、不操作 Railway、不修改业务逻辑。

架构：Node 原生模块读取 Git 对象并验证 Schema、部署入口和 exact SHA；GitHub 独立 Release Gate job 汇总 Linux CI 结果。受控变更暂不接受自声明审批文件，缺少可信审批机制即拒绝。候选记录不具备部署权限。

## 实施顺序

- [x] 创建原生 Node 测试：合法候选、受控路径、隐藏钩子、禁止命令、脏工作区、SHA 不一致及过期候选。
- [x] 运行失败测试，再实现 `scripts/ci/release-policy.mjs` 和 `scripts/ci/release-gate.mjs`。
- [x] 接入稳定的 `Release Gate` job，保留原 Linux validation，使用 always 汇总依赖结果。
- [x] 补充运行手册、可信审批与 CODEOWNERS 待配置建议，不创建虚构负责人文件。
- [x] 运行针对性测试、隔离 Linux 验证，检查 GitHub 权限，并进行独立审查。

## 重点风险

- PR 临时合并 SHA 与 PR head 混用：分别验证候选及目标 ref。
- 重命名、删除和新建迁移文件：比较完整 Git tree，处理两端路径。
- 包装脚本及 npm 生命周期隐藏数据库操作：固定普通部署入口，受控工具变化默认拒绝。
- 跳过、取消 Linux job：汇总门禁拒绝非 success，平台仍需管理员配置必需检查。
- 提交自写审批 JSON：不接受，未来审批必须来自可信外部机制。

## 决策记录

沿用现有隔离 Cloud checkout，不创建 worktree；已有未跟踪 smoke 文档不移动、不删除。
当前 node_modules 属于旧快照，不能视为本基准 Linux CI 证据；仅报告实际执行结果。
本轮不自动提交，保留可审阅 diff；首次门禁自举涉及受控文件，不能自动批准自己。

## 验证记录

- 新门禁 51/51 通过，包括可信汇总、GITHUB_PATH 污染、生命周期、构建配置、dotenv 模板及受控路径重命名用例。
- 独立临时验证目录实际执行锁定 npm ci、Prisma generate、原有目标测试、TypeScript、定向 lint 和 Build；用户/网络命名空间隔离替代本机不存在的 sudo，未降级为联网应用验证。
- CI 迁移入口实际验证全新 loopback PostgreSQL 的 230 个迁移、历史校验和与 schema diff，并停止及清理本轮实例。
- 额外全量单元测试首次 2943/2945：临时目录缺少历史 Git 对象导致两项 source ledger 测试失败。只读补齐历史对象后完整重跑 2945/2945。
- 独立审查指出四个 Important：候选汇总器、候选测试污染解释器、遗漏构建配置、dispatch 固定旧基准。均以回归测试复现后修复；实际 workflow shell 的攻击用例已通过。
- 真实基准的干净本地 Git fixture + 文档变更可通过候选检查；当前未提交开发工作区被按预期拒绝。
- GitHub 新工作流未运行、未 Push；当前集成读取分支保护及 Actions 权限返回 403。正式 testing 分支、规则、审批变量与 CODEOWNERS 负责人均未配置。
- 首次可信基准缺门禁文件时拒绝自举，不提供自动 fallback。此选择的代价是需要管理员独立审核后接入，不能把本轮代码当作已启用发布保护。
