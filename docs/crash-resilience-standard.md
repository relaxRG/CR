# 应用防崩溃工程规范

## 目标

本规范用于避免页面首次出现后由 Provider 水合、同步重载、损坏持久化数据或原生能力失败引发的闪退。`tests/home-startup-crash-safety.test.ts` 是本规范的可执行首页门禁；`pnpm lint`、`pnpm check` 和全量测试共同构成合入前检查。

## 强制规则

| 类别 | 强制规则 | 禁止行为 |
|---|---|---|
| 根级渲染 | 根路由树必须由 `AppErrorBoundary` 包裹；错误边界须记录组件栈并提供重试入口。 | 依靠未捕获 React 异常退出页面或进程。 |
| Feature Provider | 每个路由边界必须装配其页面消费的事实源；新增 Provider 或路由时同步更新 Provider Stability Matrix 和运行时测试。 | 页面深链依赖“其他 Tab 恰好已挂载”的 Context。 |
| AsyncStorage 水合 | 读取、`Promise.all` 和 reload 回调必须消费拒绝；JSON 解析后必须验证数组/对象形状，再写入状态。 | `JSON.parse` 结果直接 `map`、`forEach`、spread 或写入状态。 |
| 同步回调 | `registerStoreReload` 的回调必须是不会 reject 的 `void` 任务；业务错误记录为受控 warning。 | 返回未处理 Promise 或把远端损坏值直接覆盖内存事实。 |
| 异步副作用 | 生命周期内的后台任务需在卸载或 revision 变化后停止写回；Alert、导航和导入操作需有重入锁。 | 裸 `Promise.all(...).then(...)`、并发重复导入、旧请求覆盖新状态。 |
| 原生模块 | 相机、文件、网络和分享能力的权限/模块失败必须降级为可见提示；Web-only API 只能在平台分支后使用。 | 在跨平台模块顶层假设原生能力、权限或浏览器全局一定存在。 |
| 数据派生 | 历史缓存的可选字符串、数组和记录必须先规范化后参与 `trim`、排序和成本计算。 | 将类型声明当作不可信本地缓存的运行时校验。 |

## 必须新增的测试

任何影响启动、Provider、持久化或原生模块的变更，至少新增一项对应层级的回归测试：

1. **运行时渲染器测试**：模拟“空数据 → 水合完成”“读取拒绝”“损坏 JSON”“路由深链进入”。
2. **源码契约测试**：锁定 Provider 装配、catch、数据形状检查和注册回调。
3. **性能/真机路径测试**：对高频页检查首屏、切换和大数据更新不突破既定预算。

## 发布门禁

发布前必须依次通过：

```bash
pnpm lint
pnpm check
pnpm test
git diff --check
CI=1 npx expo export --platform ios
```

随后应在 TestFlight 真机验证冷启动、首页停留 30 秒、弱网恢复、供应商/采购渠道深链、研发销售页、扫码权限拒绝和损坏导入文件。若发生进程退出，优先收集对应 build 的 `.ips` 崩溃报告，而非仅依据静态检查作结论。
