# Cocktail R GitHub 工程质量规范

本仓库以 **应用不闪退、业务事实不丢失、性能不倒退、发布可追溯** 为合入标准。任何代码变更都必须遵守本规范；与启动、Provider、持久化、原生模块、导入或性能相关的变更执行更高等级要求。

## 合入前必须通过的检查

| 检查 | GitHub 工作流 / 命令 | 阻止的风险 |
|---|---|---|
| Storage Policy | `pnpm ci:storage` | 未登记存储键、动态键无生命周期、存储架构文档漂移 |
| TypeScript 与 UI 契约 | `pnpm check` | 类型错误、未使用代码、同步/功能契约缺失、发布数据污染 |
| Provider Stability Matrix | `pnpm check:provider-stability` | 深链缺少 Context、事实源边界遗漏、无运行时/契约覆盖 |
| 高频渲染性能 | `pnpm test:performance:quick` | 图表、台账、采购、备用金、经营分析和人力工作区性能回归 |
| H5 响应式回归 | `UI Quality Gate` H5 Job | 三端布局溢出、主题和响应式退化 |
| 全量单元/集成测试 | `pnpm test` | 功能、数据迁移、同步和运行时回归 |

合并前默认应执行：

```bash
pnpm lint
pnpm check
pnpm test
git diff --check
```

## 防崩溃强制要求

1. **Provider 先于页面。** 新页面、深链、Tab 或子路由调用任何 Context 前，必须在对应 `AppFeatureBoundary` / `StoreTabBoundary` 中装配事实源，并更新 `lib/stability/provider-stability-matrix.ts`。
2. **不可信存储必须做运行时校验。** `AsyncStorage` 的 JSON 解析成功不代表结构正确；数组、对象、字符串和历史字段必须在 `map`、`trim`、排序或状态写入前验证形状。
3. **异步任务不得逃逸。** `Promise.all`、同步 reload、导入、权限请求和原生 API 调用必须消费拒绝；异步回写必须避免在卸载、revision 变化或旧请求完成后覆盖新状态。
4. **原生能力必须可降级。** 相机、文件、分享、网络和外部跳转失败时必须显示可恢复提示，不得依赖某一平台全局或权限始终存在。
5. **错误边界不得绕过。** 路由根树保持 `AppErrorBoundary` 包裹；错误必须提供重试，不得吞掉错误后无限加载。
6. **修改启动路径必须新增运行时测试。** 至少覆盖空数据到水合、读取拒绝、损坏缓存、深链和高频切换中的一种真实场景。

详细规则见 [`docs/crash-resilience-standard.md`](docs/crash-resilience-standard.md)。

## 存储与迁移要求

修改本地存储访问、备份、恢复或同步时，必须运行：

```bash
pnpm ci:storage
git diff -- docs/local-storage-schema.json docs/local-storage-registry.json docs/local-storage-schema.md
```

生成的存储架构和注册表属于受控产物，应与源码一起提交。不得手工删除动态键记录、以未登记前缀写入业务数据，或将业务数据、测试夹具和凭据放入 production 包。

## 性能与大数据要求

影响长列表、工作区、月切换、图表或导入的改动必须运行对应 Profiler 测试。采购虚拟化相关改动还必须运行：

```bash
pnpm test:performance:stress
```

夜间全量性能套件为：

```bash
pnpm test:performance:nightly
```

不得通过简单放宽预算掩盖退化；先解释新增成本、记录基线和业务数据规模，再调整阈值。

## iOS / TestFlight 发布要求

发布必须来自已推送、工作区干净且已通过门禁的提交。发布前至少确认：冷启动、首页停留、弱网恢复、深链、相机权限拒绝、导入错误文件与大数据人力页。真机若出现退出，必须记录 build number、触发路径和 `.ips` 崩溃报告；不得只依据静态检查宣称原生闪退已经完全消除。

## 直接推送限制

应通过 Pull Request 合入 `main`。仓库当前为私有仓库且 GitHub 当前套餐不支持 REST 分支保护 / rulesets；因此工作流已提供质量信号，但管理员仍可直接推送。若仓库升级到支持分支保护的套餐或改为公开仓库，必须按 `.github/required-status-checks.md` 将质量检查配置为 required status checks，并禁止绕过。
