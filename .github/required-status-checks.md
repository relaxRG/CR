# GitHub `main` 分支必经状态检查

## 必须设为 required 的检查

当仓库具备 GitHub 分支保护或 rulesets 权限时，`main` 的 Pull Request 合并必须要求以下检查通过：

| 工作流 | 必经 Job | 目的 |
|---|---|---|
| Storage Policy | `Storage registry and dynamic-key policy` | 存储注册表、动态键和受控架构产物一致 |
| UI Quality Gate | `TypeScript and UI contracts` | TypeScript、业务同步、发布数据和工程契约 |
| UI Quality Gate | `Provider Stability Matrix` | Provider 装配、运行时覆盖和源码契约 |
| UI Quality Gate | `High-frequency render performance` | 高频 Profiler 预算与 10,000 条采购虚拟化压力 |
| UI Quality Gate | `H5 theme and responsive regression` | Web/H5 主题与响应式回归 |

## 推荐的分支规则

在 GitHub **Settings → Rules → Rulesets** 或 **Settings → Branches** 中，为 `main` 配置以下要求：

1. 只允许通过 Pull Request 合并。
2. Require status checks to pass before merging。
3. Require branches to be up to date before merging。
4. 勾选上表全部 Job；不要使用可能使 Job 被 `skipped` 的路径过滤条件。
5. 禁止 force push、删除分支和管理员绕过。
6. 至少要求一名具备移动端/数据同步经验的审阅者批准涉及 Provider、存储、同步、备份、原生模块和发布配置的 PR。

## 当前状态

本仓库工作流已生成上述检查并在 push / PR 中执行。当前私有仓库的 GitHub 套餐对 REST branch protection 与 rulesets 返回 `403`，因此无法通过 API 自动开启强制合并限制。升级到支持私有仓库分支保护的套餐，或将仓库改为公开后，应立即按照本文件启用规则。

在限制解除前，团队约定不得直接向 `main` 推送业务代码；提交前应执行 `pnpm lint`、`pnpm check`、`pnpm test`、`git diff --check`，并通过 PR 检查清单进行人工复核。
