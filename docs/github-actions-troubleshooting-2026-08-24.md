# GitHub Actions Checks 与运行器故障排查

## 已观察到的事实

最新 `main` 提交 `c6b813c` 的 Storage Policy 与 UI Quality Gate 作业均在约两秒内完成失败，且作业 `steps` 数组为空；这说明 GitHub 未进入 `actions/checkout`、pnpm 安装或仓库检查脚本。仓库 Actions 已启用、允许所有 actions/workflows，且没有自托管 runner。因而现有证据不支持“Storage 脚本或 UI 测试失败”的结论。

当前 GitHub CLI 对 `GET /repos/{owner}/{repo}/commits/{sha}/check-runs` 返回 `403 Resource not accessible by integration`。这限制了读取 Checks 输出；它与工作流 YAML 中的 `GITHUB_TOKEN` 权限是不同的调用方授权问题。

## 最小权限建议

若在 GitHub Actions **工作流内部**调用 Checks REST API，最小 workflow 权限应是：

```yaml
permissions:
  contents: read
  checks: read
```

现有 Storage/UI 工作流不调用 Checks API，因而添加 `checks: read` 不会修复它们的无步骤失败。若要从外部 GitHub CLI 或脚本读取私有仓库 Check Run，需使用具有该仓库 **Checks: Read** 权限的 fine-grained PAT，或具有 `repo` scope 的 classic PAT；不要把令牌粘贴到聊天或源码中。GitHub 官方要求对私有仓库读取 Check Runs 的 OAuth/classic PAT 具有 `repo` scope，并建议 Actions 令牌始终采用最小权限。[1] [2]

## Storage Policy 与 UI Quality Gate

两个工作流都使用 `ubuntu-latest`、`contents: read`、checkout、Node 22 和 pnpm 9.12.0。由于失败发生在第一个 step 之前，优先排查顺序为：

1. GitHub Actions 用量/支出上限或账户级并发限制；
2. GitHub 托管运行器调度服务；
3. 组织/仓库级 policies（本仓库 Actions 本身已启用且允许所有 actions）；
4. 仅在作业真正开始后，才检查 pnpm、存储治理或 UI 命令的失败日志。

不应为了消除无步骤失败而修改 Storage Policy 或 UI Quality Gate 的业务检查代码。

## macOS 运行器

仓库没有自托管 runner；原 iOS workflow 使用的 `macos-13` 已不在当前 GitHub-hosted runner catalog。已将其迁移为受支持的 `macos-15` 标签，并保留单分支并发控制。GitHub 文档列出标准 macOS 托管标签、计划相关并发上限，以及因并发、账单/支出上限或公平使用导致 larger runner 排队的可能性。[3] [4]

若 `macos-15` 仍在首个 step 前失败，下一步应检查 GitHub Billing → Actions 的付费方式与支出上限、等待当前计划的 macOS 并发槽位释放，或在有组织管理员权限时配置已授权的自托管 macOS runner。macOS runner 无法通过更换 API Token 获得；Token 只影响 API 读写权限。

## 参考资料

[1]: https://docs.github.com/rest/checks/runs "GitHub REST API: Check runs"
[2]: https://docs.github.com/actions/reference/authentication-in-a-workflow "GitHub Actions: Use GITHUB_TOKEN for authentication in workflows"
[3]: https://docs.github.com/en/actions/reference/limits "GitHub Actions limits"
[4]: https://docs.github.com/en/actions/reference/runners/github-hosted-runners "GitHub-hosted runners reference"
