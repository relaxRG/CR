# Cocktail R 前端性能监控与告警方案

**状态：** 第一阶段门禁已落地；生产遥测为后续受控接入项。  
**维护者：** Manus AI  
**适用范围：** Expo Router / React Native iOS、Android 与 Web（H5）。

## 1. 目标与不可替代的三层信号

本方案将性能质量分为三个互补层次。**提交前与 Pull Request 的实验室门禁**用于尽早阻断确定性的代码回归；**生产真实用户监控（RUM）**用于发现设备、网络、路由与用户行为造成的真实体验退化；**异常与发布关联**用于把性能回归定位到具体版本、路由和业务动作。任一层都不能替代另外两层。

> Core Web Vitals 是面向真实用户体验的加载、交互与视觉稳定性指标；建议按移动端、桌面端分组观察页面访问量的第 75 百分位数。[1]

| 层级 | 当前状态 | 负责回答的问题 | 失败后的动作 |
|---|---|---|---|
| 本地 pre-commit | 已实施 | 此次改动是否已破坏关键 Provider 或高频组件渲染预算？ | 阻止本地提交，开发者先修复或记录获批豁免。 |
| PR CI | 已实施 | 代码在干净环境下是否满足核心 Provider 与 Profiler 预算？ | PR Job 失败；分支保护应拒绝合并。 |
| H5 RUM / Web Vitals | 设计待接入 | 真实浏览器、网络、设备下，首屏、交互和布局是否退化？ | 告警、分解到版本/路由/设备，必要时回滚或灰度止损。 |
| iOS / Android APM | 设计待接入 | 真机启动、慢帧、冻结帧、关键工作区交互是否异常？ | 告警、关联版本与崩溃事件，必要时停止发布。 |

## 2. 当前已实施的本地与CI门禁

### 2.1 本地 pre-commit

项目使用可提交的 `.githooks/pre-commit`，执行两项快速门禁：

```sh
pnpm run check:provider-stability
pnpm run test:performance:quick
```

`pnpm prepare` 会调用 `scripts/install-git-hooks.mjs`，为当前开发者工作树设置 `core.hooksPath=.githooks`；也可以显式运行：

```sh
pnpm setup:git-hooks
```

pre-commit 有意不运行全量测试或 10,000 条压力测试，以避免开发者每次提交等待过久。完整 `pnpm check`、`pnpm test` 和重型压力测试继续由 PR CI、主分支和夜间任务承担。

### 2.2 高频 Profiler 基准

`test:performance:quick` 测量关键交互下的 React Profiler `actualDuration`。这些预算是工程回归线，不等同于真机帧率。

| 场景 | 数据规模 | 快速门禁 |
|---|---:|---:|
| 价格历史图与供应商价格对比 | 30 次无关父更新 | 图表子树总更新 `<5ms` |
| 横向虚拟化台账 | 800 行、30 次滚动 | 平均更新 `<16ms` |
| 人力总览 | 500 员工、6,000 薪资单、30 次比较切换 | 平均更新 `<16ms` |
| 烈酒库存台账 | 500 条记录、30 次滚动 | 平均更新 `<16ms` |
| 经营分析 | 365 天数据、30 次维度切换 | 平均更新 `<16ms` |
| 备用金 | 500 条流水、30 次视图切换 | 平均更新 `<16ms` |
| 采购清单 | 300 条采购、30 次分类切换 | 平均更新 `<16ms` |

采购清单的 `FlatList` 压力夹具严格限制为 **20 条可视行**，以反映真实虚拟列表的渲染窗口，而不是把 300 或 10,000 条数据全量同步绘制。

## 3. 极限压力测试与分层预算

`tests/store-purchase-virtualization-stress.test.tsx` 是非 pre-commit 的 10,000 条采购极限测试。它验证两个约束：来源数组包含 10,000 条记录时，虚拟列表仍只渲染最多 20 条可视行；连续 30 次分类切换的平均 `actualDuration` 必须低于 32ms。

32ms 是实验室极限压力线，不应被解释为常规交互的目标帧时间。常规交互继续使用 16ms 预算；10,000 条数据测试用于发现“虚拟化失效、意外全量 JSX 构建、列表分组复制失控”等灾难性退化。该压力测试应至少在 PR 涉及采购/列表/虚拟化代码时运行，并在夜间主分支任务中固定运行。

## 4. H5 生产真实用户监控（RUM）设计

### 4.1 采集模型

Web 端采用 `web-vitals` 的 `onLCP`、`onINP`、`onCLS`，在 `pagehide`、路由切换或批量阈值达到时通过 `navigator.sendBeacon()` 优先发送，失败时使用 `fetch(..., { keepalive: true })`。这是 Web Vitals 官方推荐的发送模式。[1]

每条事件最小字段如下，**不得上传用户姓名、手机号、供应商名称、采购金额、备注、Excel 内容或任何原始业务记录**：

```ts
interface WebPerformanceEvent {
  schemaVersion: 1;
  metric: "LCP" | "INP" | "CLS" | "FCP" | "TTFB" | "longtask" | "route_transition";
  value: number;
  unit: "millisecond" | "score" | "count";
  route: string;                 // 模板化路由，如 /spirits-inventory
  routeKind: string;             // purchase | ledger | labor | analytics | petty_cash
  appVersion: string;
  buildVersion: string;
  platform: "web";
  viewportBucket: "phone" | "tablet" | "desktop";
  deviceMemoryBucket?: "low" | "mid" | "high";
  connectionBucket?: "slow" | "normal" | "fast";
  sampled: boolean;
  occurredAt: string;
}
```

Web Vitals 的初始生产目标是：LCP P75 `<=2.5s`、INP P75 `<=200ms`、CLS P75 `<=0.1`，并分别按移动/桌面、路由和版本切片。[1]

### 4.2 长任务与业务交互

H5 额外用 `PerformanceObserver` 观察 `longtask`。长任务代表主线程连续占用至少 50ms，可能造成输入延迟、动画与滚动卡顿；浏览器兼容性并不完整，因此它是辅助诊断指标而不是跨浏览器 SLO。[2]

在以下业务动作前后设置标准化 `performance.mark()` / `performance.measure()`：

| 事件名 | 开始 | 结束 | 业务用途 |
|---|---|---|---|
| `spirits.purchase.category_switch` | 点击分类 | 可视列表完成更新 | 采购清单筛选退化 |
| `spirits.ledger.scroll_window` | 滚动事件 | 下一帧 | 台账虚拟化卡顿 |
| `labor.overview.compare` | 点击对比开关 | 卡片提交完成 | 薪资聚合退化 |
| `store.analytics.period_switch` | 点击时间维度 | 汇总卡/明细完成更新 | 日报聚合退化 |
| `petty_cash.view_switch` | 点击视图 Tab | 账本/日历/统计视图完成更新 | 备用金视图退化 |

生产端采样建议：正常会话 10%，发生超过阈值的操作 100%，每个会话每个事件名最多上传 5 条，避免遥测本身成为性能与隐私负担。

## 5. iOS / Android 生产性能监控设计

建议在取得发布与隐私确认后接入 Sentry React Native Performance，或使用等价、已审计的 APM。Sentry React Native 可自动采集冷/热启动与慢帧、冻结帧数据，并支持向 transaction 增加数值型自定义 measurement。[3]

移动端事件必须使用同一组路由与业务事件名，并增加：`platform`、`osVersionBucket`、`deviceClass`、`appVersion`、`buildNumber`。推荐只传聚合数值，例如 `visible_row_count`、`source_row_count_bucket`、`render_duration_ms`；不得传酒款名、员工信息、采购记录或附件路径。

| 指标 | 初始告警观察值 | 处置原则 |
|---|---|---|
| 冷启动 P75 | 相对上个稳定版本上升 `>20%` 且样本数 `>=100` | 阻断继续扩大灰度，检查启动 Provider 与原生初始化。 |
| 冻结帧率 | 相对稳定版本增加 `>30%` | 关联路由、设备等级、JS 长任务与 native trace。 |
| P0 工作区动作 P95 | 相对稳定版本上升 `>25%` 且绝对值超过团队预算 | 建立性能事件，优先排查全量扫描与重复渲染。 |
| 崩溃/无响应 | 新版本显著高于稳定版本 | 自动升级为发布事故，停止扩量或回滚。 |

## 6. 告警规则、去噪与发布关联

### 6.1 告警分级

| 级别 | 条件 | 通知与处置 |
|---|---|---|
| P0 发布阻断 | CI Provider Matrix 或任一快速 Profiler 测试失败 | PR 不允许合并；开发者修复后重跑。 |
| P1 性能回归 | 生产某 P0 路由/动作 P75 或 P95 连续 30 分钟高于稳定版本 25%，且样本数达门槛 | 通知工程负责人；暂停灰度并比较版本差异。 |
| P2 体验预警 | 单路由 Web Vitals P75 进入“需改善”区间，或长任务率持续上升 | 创建性能工单；在下一个迭代前完成归因。 |
| P3 观察 | 样本少、单设备或单浏览器异常 | 记录 Dashboard，不立即通知。 |

### 6.2 去噪规则

告警必须同时满足**绝对阈值、相对稳定版本变化、最小样本数和持续时间**。例如，某个设备仅 3 次访问的 INP 升高不能告警；“本版本 P75 INP >200ms、相对上个稳定版本 +25%、最近 30 分钟至少 100 次交互”才触发 P1。所有 Dashboard 都必须能按 `appVersion/buildVersion/route/viewportBucket/deviceClass` 回溯。

### 6.3 CI 与生产闭环

1. PR 失败时，Profiler 日志显示场景、数据规模、提交数和 `actualDuration`。
2. 合并后，发布系统将 Git SHA、App build number 和发布窗口写入 release 标记。
3. RUM/APM 以版本为维度汇总 P75/P95；告警链接到相应 Git SHA 和 PR。
4. 事故修复后，新增或收紧相应的 Profiler 回归夹具，防止同一原因再次通过 CI。
5. 每月复核预算：预算只能由可重复的真实基线、生产 P75/P95 与目标设备数据共同调整，不能为了“让 CI 绿灯”而放宽。

## 7. 分阶段落地路线

| 阶段 | 工作 | 完成标准 |
|---|---|---|
| A：门禁基线 | pre-commit、Provider Matrix、PR Profiler、10,000条采购压力测试 | 当前已实现。 |
| B：Web RUM | 接入 `web-vitals`、后端批量端点、隐私过滤、按版本/路由Dashboard | 能显示 LCP/INP/CLS P75 与长任务率。 |
| C：移动 APM | 获取确认后配置 React Native APM、release health、P0动作自定义measurement | 能按 iOS/Android build 定位启动和慢/冻结帧回归。 |
| D：告警运营 | 设置去噪阈值、通知路由、值班与回滚SOP | 至少一次演练告警到修复的完整闭环。 |

## 8. 开发者操作手册

提交前，开发者应运行：

```sh
pnpm setup:git-hooks      # 首次或重新克隆后
pnpm test:performance:quick
pnpm vitest run tests/store-purchase-virtualization-stress.test.tsx --reporter=dot
```

若性能门禁失败，首先确认数据规模、可视窗口、交互次数和 Profiler `actualDuration`；其次检查新依赖、非稳定 callback、全量数组扫描、无效 state 更新和列表未虚拟化。不得直接删除测试、放大阈值或跳过 Git hook；如确有业务原因，必须在 PR 中记录基线、原因、临时豁免范围和恢复期限。

## References

[1]: https://web.dev/articles/vitals "Web Vitals — web.dev"
[2]: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming "PerformanceLongTaskTiming — MDN"
[3]: https://docs.sentry.io/platforms/react-native/tracing/instrumentation/performance-metrics/ "Performance Metrics — Sentry for React Native"
