# Testing Release Gate 使用与接入

## 本轮边界

只实现 CI 门禁，不部署、不迁移、不创建正式 testing 分支，也不修改 GitHub 或 Railway 设置。Production 不使用本流程。CODEOWNERS 暂不创建：负责人必须由仓库管理员确认，建议覆盖 `.github/**`、`scripts/**`、`prisma/**`、部署与依赖配置。

## 检查与信任来源

`Linux validation` 保留 npm ci、Prisma generate、原目标测试、TypeScript、定向 lint、Build 和 CI 临时 PostgreSQL 迁移验证。新增原生 Node 门禁测试，无需应用凭据。

`Release policy` 要求干净 checkout、完整非零 SHA、基准存在且为祖先，并重新读取 origin 的精确 ref。PR 检查对象是 GitHub 临时 merge SHA；它不是最终可部署 SHA。合并后必须对真实 testing 提交重新验证，后续部署前还必须再次检查 ref，避免检查结束后的时序窗口。

实际策略和最终汇总器均从基准 Git 对象提取到 RUNNER_TEMP，候选不能以自己修改后的策略批准自己。策略任务不执行候选测试、npm 或应用脚本，避免通过 GITHUB_PATH 污染解释器。所有 scripts、prisma、workflow、依赖、生命周期、构建配置（包括 PostCSS/Babel/Prisma config 与 rc 文件）和部署工具变化均视为受控变化；Git diff 禁用重命名折叠，因此删除旧路径也会被检查。

普通入口只允许审查过的固定 Build/Start/Worker 命令；新增钩子、未知包装命令、migrate、db push、Seed/reset 均不能混入普通部署。人工工具和隔离测试工具仍保留，但不是部署入口。此检查不替代 Railway 有效命令取证，也不声称能识别所有动态代码行为。

`Release Gate` 使用 always 汇总，只有 Linux 和策略任务均为 success 才通过。失败、跳过、取消或缺少结果均拒绝。取消整个 workflow 不构成可发布证据。

## 审批证据

没有配置审批材料时，受控变更默认失败；普通文档或业务变更仍可通过。仓库内自写 approved=true、标签或 PR 评论不会放行。

管理员未来可配置两个 repository variables（本轮未配置）：

- `RELEASE_GATE_APPROVAL_PUBLIC_KEY`：可信审批人的 Ed25519 公钥，私钥不得提供给 CI、仓库或本助手。
- `RELEASE_GATE_APPROVAL`：签名 envelope，`payload` 是 UTF-8 JSON 的 base64，`signature` 是对 payload base64 文本进行 Ed25519 签名的 base64。

payload 字段为 `version:1`、`environment:"testing"`、`purpose:"reviewed-source-change"`、`sha`、`base`、排序后的完整受控 `paths`、ISO `expiresAt`。候选 SHA 或基准、路径、有效期任一不匹配即失败。审批方应从独立的可信 checkout 生成路径清单并审查差异，不接受候选提供的未经核对清单。

该签名只批准源码变更，**不是 Migration 执行授权，也不是数据库 schema 已应用的证明**。候选输出固定包含 `deploymentAuthorized:false`、`railwayConfigurationVerified:false`、`schemaApplicationVerified:false`。不能用 CI 绿灯替代这些未知项。

## 首次安装与 GitHub 平台控制

原基准没有门禁脚本，因此首个引入门禁的 PR 会在提取可信策略时失败；不提供自动 fallback 或自签名放行。须先由管理员独立审查本次自举变更，在另行批准的安装流程中接入；管理员批准前不应把它当作已启用的发布系统。

PR 使用目标 base SHA，push 使用事件 before SHA，merge_group 使用其 base SHA；手动 workflow_dispatch 使用所选提交的第一父提交作为可信基准。无父提交、全零 before、缺失策略或无法读取远程 ref 均失败。首次自举提交的父提交仍没有门禁，所以仍需管理员自举；以后不永久回退到旧 Cloud 基准。当前公开仓库可匿名只读校验 origin；若改为私有仓库，需要另外设计安全的只读 Git 认证，不得因此降级成仅检查缓存 ref。

Workflow 文件本身仍受 GitHub 的信任模型约束。必须配置受保护 testing 分支、必需 `Release Gate`（限定可信检查来源）、审查及撤销旧批准、禁止直接 push/force-push/delete、最小 bypass 和确认过负责人的 CODEOWNERS；如需要不可被 PR 修改的强制 workflow，应使用平台支持的 required workflow／ruleset 或独立受控检查。没有这些平台设置，PR 可以改 workflow 跳过检查，代码自身无法防止这种治理绕过。

不添加 paths 过滤、不把 skipped/neutral 当作部署成功，也不单靠“曾出现成功同名状态”放行。未来发布控制器必须核对同一 SHA、workflow 来源、完整 job 结果及人工审批。

Production 应使用单独的 Environment、指定审批人、禁止自批和限制绕过，审批后才向 Production job 开放专用凭据；本轮不创建该 job 或凭据。

## 启用部署前仍然阻断

1. 管理员确认规则、Environment 审批能力与实际连接权限，并完成可信自举。
2. 补齐 Railway 实际 Build/Start/Pre-deploy 和 Storage/DB 隔离证据。
3. 另行批准后清空 Testing 自动 Migration，普通部署不得执行 Seed/reset。
4. 建立已批准且已应用的 Testing schema manifest；每个候选均与它比较，不能只比较 PR 或相邻提交。
5. 独立人工 Schema 流程审查迁移、备份恢复与兼容性，执行后才更新受保护证据。
6. 建立唯一、Testing 专用的 exact SHA 发布控制器和发布前新鲜度检查，再单独申请部署演练。

## 本地验证

运行 `node --test tests/release-gates.test.mjs`。门禁 CLI 为 `node scripts/ci/release-gate.mjs --base <40位SHA> --expected <40位SHA> --latest-ref refs/heads/<分支>`；origin 无法读取、ref 已变化、工作区有任何未跟踪文件或实际 dotenv 文件时拒绝；保留仓库中的 `.env.example` 等 example 模板。

不要在带应用 .env 的 Cloud checkout 中运行 CI 初始化脚本。用独立临时验证目录，只复制跟踪源代码与本次变更，使用隔离网络和临时数据库。不要运行 `.runtime/cloud-install.sh`，它包含迁移和 Seed。
