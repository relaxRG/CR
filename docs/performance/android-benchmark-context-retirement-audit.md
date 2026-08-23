# Android 性能基准与 Provider 装配退役审计

## 一、Android 性能基准协议

Android 性能任务使用 Jetpack Macrobenchmark 的物理设备运行结果。候选与基线均必须声明 `platform: "android"`，并且设备 `model`、`apiLevel`、`abi`、`buildType`、`compilationMode` 完全一致。禁止用模拟器数值作为物理设备基线。

| 场景 | Macrobenchmark 指标 | 归一化输出字段 | 目的 |
|---|---|---|---|
| 冷启动至门店首页 | `StartupTimingMetric` | `timeToInitialDisplayMs`、`timeToFullDisplayMs` | 监控首帧与完全绘制。 |
| 店铺库存千行滚动 | `FrameTimingMetric` + `dumpsys meminfo` | `frameDurationCpuP95Ms`、`frameOverrunP95Ms`、`jankFramesOver16Ms`、`peakPssMB` | 监控 CPU 帧时长、错过帧期限、卡顿次数及内存峰值。 |
| 排班选人器滚动 | `FrameTimingMetric` + `dumpsys meminfo` | 同库存滚动 | 验证固定行高 `getItemLayout` 与大字体回退。 |
| 4K 测试图片上传 | `FrameTimingMetric` + `dumpsys meminfo` + 应用内性能标记 | `photoUploadPeakPssMB`、`jankFramesOver16Ms` | 监控预压缩是否抑制图片解码/Base64 峰值。 |

`run-android-performance.sh` 要求恰好连接一台由 CI 管理的物理设备，运行 Macrobenchmark `connectedCheck`，再调用受版本控制的 `ANDROID_METRICS_NORMALIZER` 将原始 JSON 与内存快照转为统一报告。`assert-mobile-performance.mjs` 使用 Android 平台配置进行每场景至少五次采样的 P95 比较。

```text
allowed(metric) = min(baselineP95(metric) × (1 + tolerance(metric)), absoluteLimit(metric))
```

Android 默认绝对上限：初始显示 3,200ms、完全显示 4,500ms、PSS 峰值 420MB、CPU 帧 P95 24ms、帧超限 P95 8ms、16ms 以上卡顿 3 次。库存与排班滚动更严格：CPU 帧 P95 18ms、帧超限 P95 4ms、卡顿最多一次。

## 二、Android CI 运行与告警

```bash
PERFORMANCE_BASELINE=performance-baselines/android-pixel8-api35.json \
ANDROID_METRICS_NORMALIZER=./scripts/ci/normalize-android-macrobenchmark.sh \
./scripts/ci/run-android-performance.sh
```

失败时，统一校验器写入 `artifacts/android-performance-comparison.json`。通知器读取该报告，输出 `android_performance_regression` 结构化载荷，并以失败项与候选设备计算 `Idempotency-Key`。只有配置 `PERFORMANCE_ALERT_WEBHOOK_URL` 时才向外发送；未配置时保留报告、退出成功且不泄露任何业务数据。

## 三、本轮旧全局 Provider 装配清理

重构前，`app/_layout.tsx` 直接静态导入并嵌套 44 个 Provider 名称，所有路由都会创建业务状态。重构后，根布局已物理删除该常驻 JSX 嵌套与对应静态业务 Provider 导入，改为：共享内核 + `AppFeatureBoundary` + 五个功能域 Provider 组。

| 旧根层全局装配 | 新位置 | 状态 |
|---|---|---|
| `PriceAlertProvider`、`IceSettingsProvider`、`MenuProvider`、`MenuPackageProvider`、`ShoppingProvider` | `CocktailFeatureProviders` | 已从根层下沉；实现文件保留。 |
| `LabProvider`、`LabPlanProvider` | `LabFeatureProviders` | 已从根层下沉；实现文件保留。 |
| `FoodIngredientProvider`、`FoodMenuProvider` | `FoodFeatureProviders` | 已从根层下沉；实现文件保留。 |
| `RevenueProvider`、`PettyCashProvider`、`PettyCategoryProvider`、`PettyInventoryLinkProvider`、`PettyLaborLinkProvider`、`SpiritsInventoryProvider`、`BeerInventoryProvider`、`IceNewInventoryProvider`、`FruitNewInventoryProvider`、`GlasswareInventoryProvider`、`TablewareInventoryProvider`、`DailyInventoryProvider`、`EquipmentInventoryProvider`、`DishAnalysisProvider`、`ScheduleProvider`、`PeriodAnalysisProvider`、`MonthlySummaryProvider`、`ModuleMonthCloseProvider`、`LaborProvider`、`SalaryAdvanceProvider`、`SalaryAdvanceCategoryProvider`、`MonthlyReportProvider`、`RawExcelArchiveProvider` | `StoreFeatureProviders` | 已从根层下沉；下一阶段按报表/人力/备用金/库存/店铺继续分域。 |
| `RecipeProvider`、`BottleProvider`、`BottleTaxonomyProvider`、`HomemadeProvider`、`SupplierPurchaseProvider`、`WineProvider` | 共享内核 | 保留唯一实例，因为门店报表、人力、库存或多个业务域跨域读取。 |
| `GlobalBusinessMonthProvider`、`SyncProvider`、`QueryClientProvider`、`ThemeProvider`、`I18nProvider`、`SafeAreaProvider` | 共享内核 | 全路由运行时依赖，不能下沉。 |

此外，`device-manager`、`sync-log`、`pair-device`、`me`、`role-guide`、`role-settings`、`card-tag-settings`、`backup`、`data-management` 等以前会落入 `all` 全域兼容栈的核心路由，现解析为 `core`，不再装配五个业务域。

### 物理删除与迁移的严格区分

本轮没有删除仍由功能域或共享内核需要的 Provider 实现文件，因为删除会破坏业务事实。已物理删除的是根布局内旧的常驻 Provider JSX 树、旧静态业务 Provider 导入和这些核心设置路由的全域兼容装配路径。Provider 模块本身已迁移到功能域或共享内核，不能被误列为废弃文件。

未保留“旧根层 Provider 树”兼容组件；历史仅由 Git 保存。`AllFeatureProviders` 仍存在，但只作为明确标记的跨域技术页兼容边界，不是根布局默认路径。后续每迁移一个门店子边界，必须从 `StoreFeatureProviders` 删除同一 Provider 的旧装配；不得同时装配新旧两份。

## 四、外部参考

Android 官方 Macrobenchmark 支持 `StartupTimingMetric`、`FrameTimingMetric`、`TraceSectionMetric` 与 JSON/trace 输出；官方文档明确建议在物理设备上进行性能测量，模拟器数值不代表最终用户设备。Perfetto 可用于 Android 10+ 的系统级性能追因。

[1]: https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics "Capture Macrobenchmark metrics"
[2]: https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview "Write a Macrobenchmark"
[3]: https://developer.android.com/topic/performance/tracing "Overview of system tracing"
