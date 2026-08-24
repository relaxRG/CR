# 原生调用静态审查与防御性加固

## 结论

本轮静态审查覆盖项目中直接使用的 Expo、React Native 与存储模块。所有已安装原生模块均通过 Expo 自动链接校验；未发现 `react-native-mmkv`。静态检查无法证明没有 iOS 进程级崩溃，但能提前排除缺失模块、明显错误的权限声明、无保护的关键启动拒绝和不兼容 OTA JavaScript 更新等问题。

## 已静态排除或加固的风险

| 类别 | 静态结论 | 加固措施 | 验证 |
|---|---|---|---|
| 模块链接 | 41 个原生模块的自动链接校验通过。 | 无需修改。 | `expo-modules-autolinking verify -v` 返回 `Everything is fine`。 |
| MMKV | 没有直接或间接安装/引用。 | 无需修改。 | 依赖清单、锁文件与生产源码均无 MMKV。 |
| 相机模块 | `expo-camera` 仅在原生平台动态加载，缺失时回退至手动输入。 | 用户再次触发相机授权时，新增 rejection 捕获与拒绝态显示。 | QR 崩溃护栏和完整回归通过。 |
| 媒体权限 | Image Picker 的照片/相机说明、Audio 的麦克风说明已由 config plugin 写入 iOS 配置。 | 无需新增权限字符串。 | 解析 Expo config 与 Expo Doctor 18/18 通过。 |
| 同步启动 | 元数据刷新是非阻塞的，但之前未捕获 SecureStore/网络 rejection。 | 为 `refreshCurrentDevicePlatform()` 添加 `.catch()`；失败仅记录警告，不中止同步或 UI。 | 启动同步、诊断和 Provider 水合定向测试通过。 |
| OTA 更新 | `appVersion` 策略会使两个同版本、但原生依赖不同的二进制共享 runtimeVersion。 | 切换为 `runtimeVersion.policy = "fingerprint"`，原生配置或依赖改变时不会向旧二进制交付不兼容 JS 更新。 | `expo config --type public` 解析为 fingerprint；Expo Doctor 18/18 通过。 |
| 本地存储 | 关键 Provider 水合、损坏 JSON、拒绝、批量读写和恢复流程已有回归。 | 保留批量读取、错误安全状态和诊断日志；不把存储错误升级为启动崩溃。 | 存储、Provider 与全量 1,387 个用例通过。 |

## 不做猜测性修改的边界

没有真实 iOS 崩溃调用栈时，不应通过删除功能、吞掉所有异常或无限重试来“修复”未知闪退。下列原生情况仍需 iOS Release 或真实设备日志验证：Keychain 在首次解锁前的可访问性、`ph://`/iCloud 图像、系统权限组合、Watchdog、Jetsam、原生桥接 SIGABRT，以及 Reanimated/Camera/文件系统在新架构下的启动时序。

## 当前质量验证

本轮防御性加固后，`pnpm lint`、`pnpm check`、`pnpm test`（233 个文件、1,387 个用例）和 `git diff --check` 均通过。该结果表明已覆盖的 JavaScript、配置、路由、Provider、水合、存储和异步路径没有回归；它不等同于真实 iOS 原生崩溃已被完全排除。
