# iOS 崩溃诊断报告：证据采集阶段

**状态：** 已完成应用侧诊断能力接入；**尚未获得原生崩溃报告，因此不能宣称已定位或修复闪退根因。**

## 1. 排障结论与当前限制

本仓库是 Expo 管理工作流项目，当前审阅环境为 Linux，未安装 Xcode、iOS Simulator 或 `xcrun`，仓库内也没有 `ios/` 工程、`.ips`、`.crash` 或 dSYM 文件。因此，本轮无法在当前环境稳定复现真机/模拟器闪退，也无法确认 Swift/Objective-C 文件、函数、行号、异常类型或原生根因。

这不是功能代码修复。本轮仅增加用于**保留证据**的最小诊断链路：全局 JavaScript 异常观察、未处理 Promise 拒绝观察、React 渲染错误边界记录，以及可复制/导出的脱敏运行日志。捕获器保留原有 React Native 全局错误处理器的调用，绝不吞掉 fatal exception、替换崩溃结果或添加无限重试。

> Apple 将崩溃报告视为定位稳定性问题的主要证据：它包含进程终止机制及所有线程的回溯；分析必须从完整且已符号化的系统报告开始。[1] [2]

## 2. 已修改的文件与关键改动

| 文件 | 关键改动 | 目的 |
|---|---|---|
| `lib/diagnostics/runtime.ts` | 包装现有 React Native 全局异常处理器；记录未处理 Promise 拒绝；对 token、secret、password 与 API key 模式脱敏；截断过长堆栈。 | 在不改变原始崩溃语义的前提下，将 JavaScript 异常输出到控制台和本地诊断环形日志。 |
| `components/runtime-diagnostics-bootstrap.tsx` | 在应用根部记录启动、AppState 和经过标识符脱敏的路由。 | 为崩溃前的生命周期与导航路径提供时间线。 |
| `components/app-error-boundary.tsx` | 在原有降级界面之外记录 React 组件栈。 | 对可恢复的渲染错误保留组件级线索。 |
| `lib/sync/engine.ts` | 为既有本地 `sync.log.v1` 环形缓冲增加 `diagnostic` 类型、来源和详情字段。 | 复用受治理的本地日志机制，不新增业务存储键或上传用户数据。 |
| `app/sync-log.tsx` | 将现有同步日志扩展为“同步与诊断日志”；添加诊断筛选、堆栈文本显示、完整日志复制与 JSON 文件导出。 | 让真机用户可从屏幕导出回传证据。 |
| `tests/runtime-diagnostics.test.ts`、`tests/app-error-boundary-runtime.test.tsx` | 覆盖脱敏、原全局处理器继续被调用、路由标识符遮蔽和错误边界记录。 | 防止诊断代码掩盖异常、泄露 token 或失去回归覆盖。 |

## 3. 真机取证步骤

请先安装**包含本次诊断改动的新构建**，然后不要改变触发操作，按原步骤稳定复现一次。请同步记录 app 的 build 号、iPhone/iPad 型号、iOS 版本、从启动到闪退的每一步操作、是否立即退出和准确时间。

### A. 导出应用侧诊断日志

如果应用在闪退后可再次打开，请进入：**我的 → 数据管理 → 备份与恢复 → 同步日志**。页面标题会显示为“**同步与诊断日志**”。选择“诊断”筛选，然后点击“复制完整日志”并直接粘贴到对话；或者点击“导出文件”，通过系统分享面板将 JSON 文件发回。日志不应包含业务记录、AsyncStorage 内容、请求体或认证凭据；回传前仍请检查是否有不应共享的信息。

如果在重新打开前就持续崩溃，跳过此步骤，直接提供下面的原生证据。

### B. 获取连接设备的 Xcode 控制台

在 macOS 上用数据线连接设备并信任此 Mac。打开 Xcode，选择 **Window → Devices and Simulators**，在左侧选中设备后打开设备 Console。清空或标记当前时间，按原步骤复现，并从复现前数秒到闪退后数秒导出完整文本。Apple 建议在连接设备后使用 macOS Console 检查设备日志，并围绕复现时间定位相关记录。[1]

同时，如果以 Xcode 调试方式运行，请保留控制台中从启动开始的全部 `RuntimeDiagnostics`、`Exception`、`Fatal`、`SIGABRT`、`EXC_`、`RCT`、`Hermes`、`UIKit` 或应用二进制名相关行。不要只发送最后一行。

### C. 导出 `.ips` 崩溃报告

在设备上依次打开 **设置 → 隐私与安全性 → 分析与改进 → 分析数据**，按应用二进制名和发生时间寻找日志；高内存终止还要查找 `JetsamEvent_*`。打开目标日志后，使用分享按钮发送完整 `.ips` 文件。Apple 说明 `.ips` 是优先的系统崩溃报告格式，并且完整报告包含解析异常和调用栈所需的信息。[1]

若 Xcode 正在附加调试器，系统可能不会立即生成完整崩溃报告。为取得系统 `.ips`，可在 Xcode 使用 **Debug → Detach** 后重新触发一次，让进程实际结束并由系统生成报告。[1]

### D. TestFlight 或 App Store 构建

如果问题发生在已分发构建中，可在 Xcode **Organizer → Crashes** 检查报告；请先确认归档和 dSYM 可用以完成符号化。TestFlight 崩溃报告会自动提供给开发者，而 App Store 报告取决于用户诊断数据共享设置。[1] 本轮**不会**触发 TestFlight 或创建新的 TestFlight 构建。

## 4. 请一次性回传的证据

| 证据 | 必需性 | 说明 |
|---|---|---|
| 完整 `.ips` 文件 | 必需（若系统生成） | 不要截断；保留 Header、Exception Information、Termination Reason、Triggered by Thread、Last Exception Backtrace 与 Binary Images。 |
| Xcode/设备 Console 全量片段 | 必需 | 覆盖复现前后，保留时间戳。 |
| 应用“同步与诊断日志”JSON 或复制文本 | 必需（若可重新打开） | 尤其需要 `global_js_fatal`、`unhandled_promise_rejection` 或 `react_render_exception` 条目。 |
| 复现矩阵 | 必需 | build 号、设备、iOS 版本、Debug/Release、真机/模拟器、触发页和操作步骤。 |
| 截屏或录屏 | 建议 | 用于校对路线与崩溃时机，不替代原生日志。 |

## 5. 已检查项与尚未能得出的结论

`app.config.ts` 已含相机、照片和麦克风的人类可读权限说明；本轮未发现可直接证明“缺少 Info.plist 权限说明”导致闪退的证据。项目启用了 React Native New Architecture，并使用 Expo SDK 54 / React Native 0.81.5；不过依赖/架构兼容性、强制解包、数组越界、主线程 UI 更新、生命周期、权限拒绝、存储迁移和真机/模拟器差异都不能仅靠代码审阅排除，仍需以具体异常和堆栈为准。

全局 JavaScript 捕获器对**已经进入 JavaScript 的异常**有效；它不能替代进程级原生崩溃报告。特别是启动前原生崩溃、watchdog、代码签名、内存压力/`JetsamEvent` 或 native module crash 可能在 JavaScript 记录落盘前终止进程，因此必须回传 `.ips`、Console 和符号化信息。[1] [2]

## 6. 已完成验证

| 验证 | 结果 |
|---|---|
| 新增诊断定向测试 | 2 个测试文件、4 个用例通过。 |
| 全量测试 | 233 个测试文件、1387 个用例通过。 |
| `pnpm lint` | 通过；仅出现既有 `eslint.config.js` 模块类型性能警告。 |
| `pnpm check` | 通过，包含类型检查、功能契约、Provider 稳定性、发布数据与工程治理检查。 |
| `pnpm ci:storage` | 通过；存储策略和业务同步覆盖检查通过，并已更新受控存储架构文档。 |
| `git diff --check` | 通过。 |
| Debug/Release、模拟器、真机复现 | **未执行**：当前 Linux 环境没有 Xcode、Simulator 或可连接 iOS 设备。 |

## 7. 后续决策规则

收到原生日志前，不修改业务功能，也不对某个“常见原因”猜测性打补丁。收到完整证据后，将按 `Exception Type`、`Termination Reason`、崩溃线程、最后异常回溯、符号化 App/Framework 帧和应用侧时间线确定唯一或可验证的根因；仅改动相关文件，并使用同一操作路径在 Debug、Release、模拟器和真机重新验证。

## 参考资料

[1] [Apple: Acquiring crash reports and diagnostic logs](https://developer.apple.com/documentation/xcode/acquiring-crash-reports-and-diagnostic-logs)  
[2] [Apple: Diagnosing issues using crash reports and device logs](https://developer.apple.com/documentation/xcode/diagnosing-issues-using-crash-reports-and-device-logs)  
[3] [Apple: Analyzing a crash report](https://developer.apple.com/documentation/xcode/analyzing-a-crash-report)
