# 原生模块、启动桥接与闪退修复差异审查

**审查范围：**当前 `main` 工作树中已安装的原生模块、启动路径、异步拒绝处理，以及与 iOS 闪退相关的 Git 提交。  
**审查结论：**未发现 `react-native-mmkv` 被安装或引用；Expo SDK 54 的已安装原生包版本与 React Native 0.81.5 对齐，自动链接校验通过。发现并修复了一处同步启动期的非阻塞 Promise 未捕获路径。

## 一、依赖与自动链接结论

| 模块/类别 | 当前版本或状态 | 审查结论 | 对 iOS 闪退的含义 |
|---|---|---|---|
| Expo / React Native | Expo `54.0.37`、React Native `0.81.5` | Expo Doctor 18/18 通过；SDK 54 官方基线即为 React Native 0.81。 | **低风险**：没有发现跨 SDK 的显式版本漂移。 |
| `react-native-mmkv` | **未安装、未引用** | `package.json`、锁文件和生产源码均没有该模块。 | MMKV 的 JSI/内存问题不适用于当前项目。 |
| `expo-updates` | `~29.0.20` 已随 SDK 安装，但生产源码未导入，应用配置没有 `updates.url` 或 `runtimeVersion`。 | 未发现手动检查、下载或 `reloadAsync()` 调用。Expo 文档说明缺少有效更新配置时 Updates 会停用并加载嵌入更新。 | **低风险**：当前没有 OTA 更新循环或热重载逻辑；Release 更新链路仍需原生构建验证。 |
| SecureStore / AsyncStorage | `expo-secure-store ~15.0.8`、AsyncStorage `2.2.0` | 原生凭据使用 SecureStore，业务状态使用 AsyncStorage；水合、损坏 JSON、迁移和拒绝路径均有定向测试。 | **中风险**：Keychain 可用性和真实数据量仍必须真机验证。 |
| Reanimated / Gesture Handler | `4.1.6` / `2.28.0` | 根布局最外层使用 `GestureHandlerRootView`，且导入 Reanimated；自动链接校验通过。 | **中低风险**：配置符合 SDK 54 的常规组合；手势工作线程的原生崩溃仍需 iOS 运行验证。 |
| Camera / Image Picker / FileSystem | Camera `17.0.10`、ImagePicker `17.0.11`、FileSystem `19.0.24` | 相机组件采用延迟加载并处理模块不可用；ImagePicker 用途说明已配置；文件导入/照片同步有大小与失败处理策略。 | **中风险**：真实 `ph://`、受限相册、iCloud 素材、磁盘满与系统权限状态不可由 JS 测试完全覆盖。 |
| Expo 模块自动链接 | 41 个原生模块 | `expo-modules-autolinking verify -v` 返回 `Everything is fine`。 | **低风险**：未发现重复、缺失或自动链接解析错误。 |

Expo SDK 54 官方变更说明确认其以 React Native 0.81 为基线，并改进原生模块自动链接；项目使用的 SDK 与 RN 主版本匹配。[1] 官方 SecureStore 文档同时说明 iOS 以 Keychain 存储数据、单值过大可能被底层平台拒绝，且默认可访问级别与设备锁定状态相关。[2]

## 二、启动阶段和原生桥接审查

| 路径 | 现有处理 | 结论 |
|---|---|---|
| 根布局 `initManusRuntime()` | 仅 Web iframe 调用；原生平台立即返回。 | 不构成 iOS 原生启动调用。 |
| 首屏后的迁移与清理 | 通过 `InteractionManager.runAfterInteractions` 延后执行，逐项 `try/catch`。 | 避免首屏并行 I/O，迁移失败不会中断 UI。 |
| 同步启动 | `performSync()` 以 `try/catch/finally` 保护凭据、会话、拉取、合并与推送，并带并发锁和上限重试。 | 已覆盖网络、AsyncStorage 或 SecureStore 失败时的可恢复业务错误。 |
| 新发现的非阻塞平台元数据刷新 | 之前以 `void refreshCurrentDevicePlatform()` 启动；该函数可因 SecureStore 或网络失败而 reject。 | **已修复**：增加 `.catch()` 日志，避免形成未处理 Promise。 |
| React 错误边界 | 捕获 render/lifecycle 渲染错误并记录组件堆栈。 | 不捕获事件处理器、异步 effect 回调和原生进程级崩溃。 |
| 全局运行时诊断 | 包装现有 `ErrorUtils` handler，记录后仍调用原 handler；监听 `unhandledrejection`，日志脱敏。 | 提升 JS 故障可观测性，不吞掉 fatal error，也不能拦截 OOM、SIGABRT、watchdog 或原生桥接进程退出。 |

### 本轮最小代码修复

```diff
- void refreshCurrentDevicePlatform();
+ void refreshCurrentDevicePlatform().catch((error) => {
+   console.warn("[CFSync] device platform metadata refresh failed:", error);
+ });
```

同时在 `tests/startup-sync-performance-policy.test.ts` 增加断言，防止后续改回无捕获的 fire-and-forget 调用。定向回归 **10/10**、`pnpm check`、`pnpm lint`、完整 `pnpm test`（**1,387/1,387**）和 `git diff --check` 均通过。

## 三、与闪退相关的历史修改及实际效果

| 提交/范围 | 修改文件或类型 | 对闪退风险的实际效果 |
|---|---|---|
| `1a61f71` | `app/_layout.tsx`、`lib/backup/icloud-backup.ts` | 移除重复 `Stack.Screen` 注册；历史提交明确该项曾导致 iOS 启动崩溃。对同类导航初始化冲突是**直接风险降低**。 |
| `3a9bdbd` | 深链、导入、Provider 边界、Base64 解码 | 加固深链参数、导入和特性边界。对损坏输入/大导入导致的 JS 失败是**中等风险降低**。 |
| `501e875` | 根布局、错误边界、Feature Provider、QR 扫描、同步 Provider | 加入渲染边界、延迟加载相机、Provider 保护及崩溃护栏。对缺失原生模块、渲染失败和同步水合失败是**中高风险降低**。 |
| `dc9bd15` | 诊断运行时、根布局、同步日志、同步引擎及测试 | 新增全局 JS 观察、脱敏日志和导出。**主要提升定位速度**；不会直接阻止原生 OOM 或 SIGABRT。 |
| `8295901` 至 `7f271da` | iOS Smoke 工作流和脚本 | 由 `simctl launch` PID、系统日志和崩溃签名检查替代错误的 `ps` 探测。**提升验证可信度**，但运行器未获分配，尚未产生五次真机/模拟器运行证据。 |
| 本轮未提交修复 | `lib/cf-sync/provider.tsx`、启动同步测试 | 捕获设备平台元数据刷新 rejection。对网络/Keychain 短暂失败形成未处理 Promise 的风险是**小而直接的降低**；不代表已修复进程级原生崩溃。 |

## 四、仍无法通过代码审查排除的风险

1. Keychain 在设备重启、锁屏、重装同 bundle ID、迁移和系统恢复后的可访问性。
2. 相册“仅限照片”、iCloud 未下载资产、`ph://` URI、磁盘满和照片大文件峰值。
3. 新架构下 Reanimated、Gesture Handler、Camera、SecureStore 和 FileSystem 的真实 iOS 初始化顺序。
4. Watchdog、Jetsam、原生异常（`EXC_CRASH`、`SIGABRT`）和系统因内存压力终止 App。
5. Release 二进制中的 Expo Updates 启动行为。官方文档说明更新 API 的多数行为只能在 Release 构建中完整测试。[3]

## 参考资料

[1]: https://expo.dev/changelog/sdk-54 "Expo SDK 54 Changelog"
[2]: https://docs.expo.dev/versions/latest/sdk/securestore/ "Expo SecureStore Documentation"
[3]: https://docs.expo.dev/versions/latest/sdk/updates/ "Expo Updates Documentation"
