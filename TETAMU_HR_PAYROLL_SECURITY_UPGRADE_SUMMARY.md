# TETAMU HR/Payroll Phase 2 Security Upgrade Summary

报告日期：2026-09-16

审计 source commit：`58890fda9141a9d0569b796e981eae9056a8ee54`

## 结论

定向 runtime 升级已完成并独立提交为 `c9a033bb8ca3cb214adcc38f0153e514e2b2a190`。Next、Sharp 相关 critical/high findings 已消除；dependency tree 不含 `sharp < 0.35.4`，也不含 Next runtime `< 16.3.3`。未运行 `npm audit fix --force`，未做无关 major upgrade。

## 升级前后

| 项目 | 升级前 | 升级后 |
|---|---:|---:|
| `next` | 16.3.0 | 16.3.5 |
| `@next/env` | 16.3.0 | 16.3.5 |
| `eslint-config-next` | 16.3.0 | 16.3.5 |
| 顶层 `sharp` | 0.35.0 | 0.35.4 |
| Next nested `sharp` | 0.35.3 | 0.35.4 deduped |
| npm audit | 7：1 critical、6 high | 5：0 critical、5 high |

升级前的 runtime findings 为 Next Windows-hosted RCE、Next Image Optimization AVIF RCE，以及 Sharp/libheif。Railway Linux 对 Windows-only advisory 不可利用，但仍通过版本升级消除。AVIF 路径属于真实 runtime surface，所以没有把 Next AVIF/Sharp 风险认定为不可达。

## 最终 dependency 证明

- `npm ls next sharp`：`next@16.3.5`；根与 Next 均解析为同一个 `sharp@0.35.4`。
- `npm explain sharp`：根项目直接依赖 0.35.4；Next 16.3.5 的 `^0.35.4` optional dependency 被 dedupe 到同一副本。
- `package.json`、`package-lock.json` 根声明和已安装版本完全一致。
- 递归 lockfile 检查：`sharp < 0.35.4` 为 0；Next runtime `< 16.3.3` 为 0。
- 安全、非恶意、内存生成的 AVIF fixture：直接员工头像处理输出 512×512 WebP；Next Image Optimization 输出 16×12 AVIF；2/2 通过。没有获取或保存 exploit payload。
- Next 16.3.5 production build：PASS，146 个静态页面生成完成。

## 剩余 audit 分类

| 链路 | 数量表现 | 实际分类 | 本轮 disposition |
|---|---|---|---|
| `@eslint/eslintrc → js-yaml@4.3.1` | 2 个 high 条目 | dev-only lint tooling；不进入 Railway request runtime | 不阻止 Human UAT；Production 前由 dependency maintenance 单独升级 |
| `prisma → @prisma/config → deepmerge-ts@7.1.5` | 3 个 high 条目 | build/migration CLI 链；`@prisma/client` 的 optional peer 会令包存在于安装树，但应用请求代码没有导入 `@prisma/config` 或 `deepmerge-ts` | 不凭 audit 数量误判为 request runtime；不阻止 Human UAT，Production 前保留正式处置项 |

剩余 5 个 high 全部来自上述两个工具链；没有 Next/Sharp finding，且没有已证实的 runtime-exploitable critical/high 路径。因此安全 gate 对 Human UAT 为 PASS，不代表 Production 安全审查完成。

## 证据

完整 JSON 与命令输出位于 worktree 外的 `work/hr-payroll-phase2-evidence/security/`，包括升级前重建 audit、最终 audit、`npm ls`、`npm explain` 和版本一致性检查。该目录未加入 runtime commits。
