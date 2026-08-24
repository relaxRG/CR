# cocktail-r：iOS 原生风险与已通过测试详细报告

**审查日期：**2026-08-24  
**适用代码：**`main` 分支，提交 `38e534a` 后的工作树  
**结论级别：**本报告区分已由自动化测试覆盖的 JavaScript/业务逻辑，与仅能由 iOS Simulator 或真实 iPhone 证实的原生行为。

## 一、执行摘要

当前完整回归已通过 **233 个测试文件、1,387 个测试用例**。围绕启动、路由、同步、备份恢复、存储水合和崩溃诊断额外执行的定向测试共 **60/60 通过（100%）**。`pnpm lint`、`pnpm check`、`pnpm ci:storage`、`git diff --check`、Expo Doctor（18/18）和 iOS 预构建均通过。

这些结果说明：在可运行的 JavaScript 测试环境中，未复现启动、Provider、路由、同步、备份恢复或存储错误导致的未处理异常。它们**不等价于 iOS 真机无闪退**：云端 iOS 作业在十分钟时限内未获得 macOS 运行器，无法完成五次 Release 冷启动；当前 Linux 环境也没有 CocoaPods 或 iOS Simulator。

## 二、已通过的定向测试与核心模块通过率

| 核心模块 | 定向测试文件 | 通过/总数 | 通过率 | 已验证行为 |
|---|---|---:|---:|---|
| 启动、Provider 与深链 | `provider-deep-link-stability`、`provider-feature-boundary`、`startup-sync-performance-policy`、`provider-async-reload-stability`、`provider-hydration-runtime-stability` | 16/16 | 100% | 深链进入、Provider 边界、延后同步、水合、异步重载失败后的安全状态。 |
| 路由与页面跳转 | `navigation-route-contract` | 4/4 | 100% | 已注册页面、关键入口和导航契约。 |
| 网络、同步与生命周期 | `network-lifecycle-policy` | 5/5 | 100% | 网络恢复、前后台切换、受控重试和第三方依赖生命周期。 |
| 备份、恢复、归零与快照 | `backup-restore-stability`、`fresh-business-baseline-e2e`、`snapshot-v2-p0-extremes`、`archive-sync-coordinator-recovery`、`snapshot-v2-migration` | 19/19 | 100% | 备份恢复、业务归零、极端快照、归档 outbox 断电恢复和迁移。 |
| 崩溃护栏、诊断与 iOS 性能策略 | `runtime-diagnostics`、`app-error-boundary-runtime`、`build138-crash-guard-regressions`、`ios-performance-alert-policy` | 9/9 | 100% | 堆栈脱敏、原有 fatal handler 保留、错误边界、崩溃防护和性能告警。 |
| 存储安全、照片与库存水合 | `storage-security-regression`、`photo-sync-memory-policy`、`spirits-persistence-hydration-stability` | 7/7 | 100% | 存储安全契约、照片同步内存上限和库存数据水合稳定性。 |
| **定向小计** | 上述 21 个测试文件 | **60/60** | **100%** | 覆盖本轮与“闪退”最相关的 JS/业务路径。 |
| **完整项目回归** | 全部 Vitest 测试文件 | **1,387/1,387** | **100%** | 包含配方、酒款、烈酒、葡萄酒、采购、门店、人工、薪资、月报和性能回归。 |

完整回归还通过了功能与同步契约：**38/38 功能、38/38 资源、101 个同步键**均完整声明；Provider 稳定性门禁覆盖 **13 个 Provider、6 个关键事实源、13 项运行时覆盖和 24 项源码契约覆盖**。本地存储治理扫描 **414 个生产源文件**和 **138 个存储键**，存储策略和业务同步覆盖检查均通过。

## 三、Keychain、权限与本地存储代码审查

| 范围 | 审查结论 | 证据与代码位置 | 风险等级 |
|---|---|---|---|
| 同步凭据 / Keychain | 设备 ID、组 ID、设备名和设备令牌在原生端使用 `expo-secure-store`；Web 端才回退到 AsyncStorage。启动同步外层存在失败捕获，凭据读写失败会降级为同步错误或本地模式，而不是设计为进程退出。 | `lib/cf-sync/client.ts` 的 `getDeviceCredentials`、`saveDeviceCredentials`；`SyncProvider` 启动流程的错误处理；水合/崩溃护栏测试。 | **中**：Keychain 被锁定、系统迁移、重装、旧令牌失效仍需真机验证。 |
| 同步组恢复票据 | 组切换票据使用 SecureStore，恢复会话使用 AsyncStorage；JSON 异常会安全返回 `null`，不直接抛出。 | `lib/cf-sync/group-switch.ts` 的 `getPendingGroupSwitchSession`、票据读写与清理路径。 | **中低**：在锁屏、设备重启首次解锁前和升级后仍需真机验证。 |
| 相机 / 相册权限 | `expo-image-picker` 已配置相机与相册用途说明；主要调用路径在请求权限后再打开相机或相册，并处理拒绝与取消。 | `app.config.ts` 的 image-picker 插件；`lib/recipes/photo.ts`、`bulk-import.tsx`、`recipe/[id].tsx`、`labor-employee-form.tsx`、`smart-import-bar.tsx`。 | **中低**：用户选择“拒绝”或“仅限照片”、设置中重新授权等系统状态只可真机验证。 |
| 麦克风权限 | `expo-audio` 已声明麦克风用途说明。 | `app.config.ts` 的 audio 插件。 | **低到中**：实际录音/音频会话、静音模式和权限拒绝分支仍需真机覆盖。 |
| 酒瓶照片 AI 导入 | 直接打开相册后检查取消和 base64 是否存在，并以 `try/catch` 把失败转为界面错误状态。用途说明已存在。 | `app/bottle-form.tsx` 的 `handleLookupPhoto`。 | **低**：没有发现会导致未处理 Promise 的直接路径；仍应真机验证“受限照片库”。 |
| 配方照片文件持久化 | 目录创建、复制和旧文件删除依赖 Expo FileSystem；删除失败被隔离，避免阻断其他业务。 | `lib/recipes/photo.ts`。 | **中**：`ph://` 或文件提供方 URI 与磁盘空间不足可能令复制失败；这是可恢复的 JS 错误风险，但必须用真机素材确认不会演化为原生模块异常。 |
| AsyncStorage / 迁移 / 恢复 | 已覆盖读失败、损坏 JSON、重载失败、快照迁移、归零和 outbox 恢复。Provider 在关键键读取失败时保持已水合的安全状态。 | `provider-hydration-runtime-stability`、`storage-security-regression`、`snapshot-v2-*`、`archive-sync-coordinator-recovery`。 | **中低**：磁盘满、系统清理、极大真实数据集与跨版本升级仍须真机覆盖。 |
| 新架构与原生模块组合 | `newArchEnabled: true`，同时使用 Reanimated、Gesture Handler、Safe Area、ImagePicker、SecureStore 和 FileSystem。静态配置、预构建与依赖诊断通过。 | `app.config.ts`、iOS 预构建和 Expo Doctor。 | **中**：Hermes/新架构下的原生初始化和设备差异仅 iOS 原生运行可证明。 |

> 本次代码审查未发现“缺失用途说明即调用受保护 API”“直接强制解包”或“诊断层吞掉 fatal error”的确定性崩溃根因。因此没有做猜测性业务代码改动。

## 四、仅能在真实 iPhone 验证的原生风险点

| 风险点 | 为什么模拟/JS 测试无法完全排除 | 建议优先级 |
|---|---|---:|
| Keychain 可用性与 SecureStore 行为 | 设备重启后首次解锁、钥匙串迁移、重装、系统备份恢复和令牌失效依赖真实 iOS Keychain。 | P0 |
| 冷启动与后台恢复 | 内存压力终止、锁屏、后台停留、前后台切换与 AppState 回调受真实系统调度影响。 | P0 |
| 相机、相册和麦克风权限状态 | “拒绝”“不再询问”“仅限照片”“设置页重新授权”及系统选择器行为由 iOS 提供。 | P0 |
| 新架构原生模块初始化 | Hermes、Reanimated、Gesture Handler、Safe Area、SecureStore 和 FileSystem 的组合只在原生加载链路中完整执行。 | P0 |
| 照片 URI 与磁盘空间 | `ph://`、云端照片未下载、外部文件提供方 URI、受限相册与磁盘满只能以真实设备素材验证。 | P1 |
| 网络切换与同步凭据 | Wi-Fi/蜂窝切换、VPN、弱网、后台唤醒及真实设备的 Keychain 读取时机无法由纯 JS Mock 覆盖。 | P1 |
| 系统升级与旧数据迁移 | 旧版 App 的 AsyncStorage、SecureStore 和 documentDirectory 残留在升级安装时的组合状态需要真实升级路径。 | P1 |

## 五、真实 iPhone 排查清单

下表是用于取得可归因崩溃证据的最小操作集。每一项都应在 **Release 构建**中执行，且每次都保留同一时段的 Xcode Devices and Simulators Console 或 `.ips` 文件。

| 编号 | 操作 | 预期安全结果 | 需要保存的证据 | 失败信号 |
|---:|---|---|---|---|
| 1 | 从被系统终止的状态冷启动 App，连续 5 次。 | 每次均进入首页且无闪退。 | 每次启动时间、App PID、Console 片段。 | `.ips`、`EXC_CRASH`、`SIGABRT`、`RCTFatal`、watchdog。 |
| 2 | 首次启动后锁屏 30 秒，再解锁回到 App；随后从后台切回 5 次。 | 同步与 Provider 恢复正常，无白屏、卡死或退出。 | AppState、同步和 SecureStore 相关日志。 | Keychain 错误、后台恢复后的崩溃或卡死。 |
| 3 | 未配对状态进入同步/设备管理；再进行配对、退出和重新进入。 | 无凭据时安全本地模式；凭据失败显示可恢复错误。 | `CFSync`、SecureStore、网络日志。 | 401/403 后进程退出、未捕获 Promise。 |
| 4 | 相机权限依次选择拒绝、设置重新允许；相册权限依次选择拒绝、仅限照片、完全允许。 | 显示业务提示或取消，不闪退。 | 系统权限状态和 ImagePicker 日志。 | 隐私用途说明崩溃、选择器返回后退出。 |
| 5 | 从相册选择本地照片、iCloud 照片和受限照片；在磁盘空间紧张时重复保存/替换。 | 成功保存或显示错误，不破坏配方页面。 | FileSystem/图片 URI 及异常堆栈。 | `ph://` 复制失败后未处理异常、内存终止。 |
| 6 | 打开配方、酒瓶、批量导入、员工表单等相机/相册入口，取消后返回；重复 5 次。 | 路由返回正常，页面状态不丢失。 | 导航、ImagePicker 和运行时诊断日志。 | 路由异常、白屏、重复弹窗或进程退出。 |
| 7 | 在弱网、断网和网络恢复时冷启动/前后台切换。 | 进入离线安全状态或受控重试，不无限循环。 | 网络、同步、重试次数日志。 | 重试风暴、主线程卡顿、内存上升、崩溃。 |
| 8 | 对带有历史数据的旧版本安装升级，再启动并进入备份/恢复/数据归零页面。 | 迁移可完成或安全降级，旧数据不导致启动失败。 | 迁移、AsyncStorage、快照日志。 | JSON 解析错误泄漏、启动循环、数据读写崩溃。 |

## 六、已知验证边界

云端 iOS Smoke 作业在十分钟上限内仍未获分配 macOS 运行器，因此没有产生 Xcode、Simulator 或 `.ips` 级别的五次启动证据。当前 Linux 环境未安装 CocoaPods，也无法执行 `pod install`。Web 开发服务器和静态导出均在 Metro 打包最后阶段未完成，因此已停止，避免无期限等待。

因此，本报告的准确表述是：**已覆盖路径未在 JavaScript/业务逻辑测试中复现闪退；真实 iPhone 原生风险仍待设备级证据确认。**

## 七、真机日志收集的准确步骤

1. 使用带 macOS 的电脑连接 iPhone，保持设备解锁并信任该电脑。打开 Xcode 的 **Window → Devices and Simulators**，选中该 iPhone；同时打开 macOS 的 **Console**，在侧栏选择该设备。
2. 先记录时间，再从被系统终止的状态启动 App，按上述第 1 至第 8 项操作复现。若 App 未立即退出，也要在 Console 中保留复现时刻前后至少 30 秒的日志。
3. 若出现闪退，在 iPhone 打开 **设置 → 隐私与安全性 → 分析与改进 → 分析数据**，查找以 App 二进制名开头的 `.ips`，以及同一时间附近的 `JetsamEvent`。通过分享按钮导出完整文件；不要只截取一小段。
4. 一并保存 Xcode/Console 中与 `cocktail R`、`com.app.cocktailrecipes`、`SecureStore`、`ImagePicker`、`RCTFatal`、`SIGABRT`、`EXC_CRASH`、`watchdog`、`jetsam` 或 `CFSync` 相关的完整日志区间。提交前应删去设备名称、邮箱、令牌或任何个人内容。
5. 对 `.ips` 取证时保留对应构建的 archive 和 dSYM；完整符号化报告中的 **Exception Type**、**Termination Reason**、**Triggered by Thread**、**Last Exception Backtrace** 与崩溃线程是根因定位所需的最小字段。

Apple 将 crash report 定义为记录终止机制及全部线程回溯的证据；Jetsam 是系统为回收内存而终止应用时产生的独立内存事件，因此两种文件都必须收集。[1] Apple 也说明设备日志可以通过连接设备并在 Console 中选择该设备来检查；如果没有 Xcode Organizer 报告，可直接从设备“分析数据”导出 `.ips`。[2]

## 参考资料

[1]: https://developer.apple.com/documentation/xcode/diagnosing-issues-using-crash-reports-and-device-logs "Apple: Diagnosing issues using crash reports and device logs"
[2]: https://developer.apple.com/documentation/xcode/acquiring-crash-reports-and-diagnostic-logs "Apple: Acquiring crash reports and diagnostic logs"
[3]: https://developer.apple.com/documentation/xcode/analyzing-a-crash-report "Apple: Analyzing a crash report"
